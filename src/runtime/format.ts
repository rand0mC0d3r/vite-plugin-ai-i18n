import IntlMessageFormat, { type MessageValues } from "intl-messageformat";

import { ICU_PARSER_OPTIONS } from "../icu.js";

/** Values for the placeholders of an ICU message. */
export type { MessageValues };

const formatters = new Map<string, IntlMessageFormat<MessageValues>>();

const EURO_COUNTRIES = new Set([
  "AT",
  "BE",
  "CY",
  "DE",
  "EE",
  "ES",
  "FI",
  "FR",
  "GR",
  "HR",
  "IE",
  "IT",
  "LT",
  "LU",
  "LV",
  "MT",
  "NL",
  "PT",
  "SI",
  "SK",
]);

function operatingSystemLocale(): string {
  if (typeof navigator !== "undefined" && navigator.languages.length > 0) return navigator.languages[0];
  return Intl.NumberFormat().resolvedOptions().locale;
}

function defaultCurrency(operatingLocale?: string): string {
  const locale = operatingLocale ?? operatingSystemLocale();
  const region = new Intl.Locale(locale).maximize().region;
  if (region !== undefined && EURO_COUNTRIES.has(region)) return "EUR";
  if (region === "GB") return "GBP";
  if (region === "JP") return "JPY";
  if (region === "CA") return "CAD";
  if (region === "AU") return "AUD";
  if (region === "CN") return "CNY";
  if (region === "IN") return "INR";
  return "USD";
}

function numberFormats(message: string, operatingLocale?: string): Record<string, Record<string, unknown>> {
  const formats: Record<string, Record<string, unknown>> = {};
  for (const match of message.matchAll(/\{[^,{}]+,\s*number,\s*([^{}]+)\}/g)) {
    const style = match[1].trim();
    if (style === "currency") {
      formats["currency"] = { style: "currency", currency: defaultCurrency(operatingLocale) };
    } else if (/^[A-Z]{3}$/.test(style)) formats[style] = { style: "currency", currency: style };
  }
  return formats;
}

function singularWord(word: string): string {
  const irregular: Record<string, string> = {
    people: "person",
    children: "child",
    men: "man",
    women: "woman",
    mice: "mouse",
    teeth: "tooth",
    feet: "foot",
    geese: "goose",
  };
  if (Object.hasOwn(irregular, word.toLowerCase())) {
    const singular = irregular[word.toLowerCase()];
    return matchCase(word, singular);
  }
  if (/[^aeiou]ies$/i.test(word)) return word.slice(0, -3) + (word.endsWith("IES") ? "Y" : "y");
  if (/sses$/i.test(word)) return word.slice(0, -2);
  if (/ses$/i.test(word)) {
    return /(uses|oses|ises|eses)$/i.test(word) ? word.slice(0, -2) : word.slice(0, -1);
  }
  if (/(xes|zes|ches|shes)$/i.test(word)) return word.slice(0, -2);
  if (/s$/i.test(word) && !/ss$/i.test(word)) return word.slice(0, -1);
  return word;
}

function pluralWord(word: string): string {
  const irregular: Record<string, string> = {
    person: "people",
    child: "children",
    man: "men",
    woman: "women",
    mouse: "mice",
    tooth: "teeth",
    foot: "feet",
    goose: "geese",
  };
  if (Object.hasOwn(irregular, word.toLowerCase())) {
    const plural = irregular[word.toLowerCase()];
    return matchCase(word, plural);
  }
  if (/[^aeiou]y$/i.test(word)) return word.slice(0, -1) + (word.endsWith("Y") ? "IES" : "ies");
  if (/(s|x|z|ch|sh)$/i.test(word)) return word + "es";
  return word + "s";
}

function matchCase(word: string, result: string): string {
  if (word === word.toUpperCase()) return result.toUpperCase();
  if (word[0] === word[0].toUpperCase()) return result[0].toUpperCase() + result.slice(1);
  return result;
}

function conjugateEnglishPrefix(prefix: string, singular: boolean): string {
  if (!/^There\s+/i.test(prefix)) return prefix;
  const replacements = singular
    ? { are: "is", have: "has", were: "was", do: "does" }
    : { is: "are", has: "have", was: "were", does: "do" };
  return prefix.replace(/\b(are|is|have|has|were|was|do|does)\b/gi, (verb) => {
    const lower = verb.toLowerCase();
    const replacement = replacements[lower as keyof typeof replacements];
    if (replacement === undefined) return verb;
    if (verb === verb.toUpperCase()) return replacement.toUpperCase();
    if (verb[0] === verb[0].toUpperCase()) {
      return replacement[0].toUpperCase() + replacement.slice(1);
    }
    return replacement;
  });
}

/** Converts a plain count template used by `tt()` into a fallback ICU plural message. */
export function formatAutoPluralMessage(message: string, locale: string, values: MessageValues): string {
  if (!message.includes("{count}") || typeof values["count"] !== "number") {
    return formatMessage(message, locale, values);
  }

  const [prefix, suffix] = message.split("{count}", 2);
  const word = suffix.match(/[A-Za-z][A-Za-z-]*\w*/)?.[0];
  if (word === undefined || word.length === 0) return formatMessage(message, locale, values);
  const singular = singularWord(word);
  const nounPlural = pluralWord(singular);
  const singularSuffix = suffix.replace(word, singular);
  const pluralSuffix = suffix.replace(word, nounPlural);
  const trimmedPrefix = prefix.trim();
  const singularPrefix = conjugateEnglishPrefix(trimmedPrefix, true);
  const pluralPrefix = conjugateEnglishPrefix(trimmedPrefix, false);
  const zeroPrefix = pluralPrefix ? `${pluralPrefix} no` : "No";
  const onePhrase =
    `${singularPrefix} ${singularSuffix.trim() ? `# ${singularSuffix.trim()}` : `# ${singular}`}`.trim();
  const otherPhrase = `${pluralPrefix} ${pluralSuffix.trim() ? `# ${pluralSuffix.trim()}` : `# ${nounPlural}`}`.trim();
  const zeroPhrase = `${zeroPrefix} ${pluralSuffix.trim()}`.trim();
  const plural = `{count, plural, =0 {${zeroPhrase}} one {${onePhrase}} other {${otherPhrase}}}`;
  return formatMessage(plural, locale, values);
}

/**
 * Formats an ICU MessageFormat string, such as `{count, plural, one {# file} other {# files}}`, for a locale. Messages
 * that fail to parse or are missing a value are logged and returned unformatted, so a bad translation never breaks the
 * page.
 */
export function formatMessage(
  message: string,
  locale: string,
  values: MessageValues,
  operatingLocale?: string,
): string {
  const resolvedOperatingLocale = operatingLocale ?? operatingSystemLocale();
  const key = `${locale}\u0000${resolvedOperatingLocale}\u0000${message}`;
  try {
    let formatter = formatters.get(key);
    if (!formatter) {
      const numberFormatsByStyle = numberFormats(message, resolvedOperatingLocale);
      const formats = Object.keys(numberFormatsByStyle).length ? { number: numberFormatsByStyle } : undefined;
      formatter = new IntlMessageFormat(message, locale, formats, ICU_PARSER_OPTIONS);
      formatters.set(key, formatter);
    }
    // Without rich-text callbacks the result is a single string, but the type also allows an array of parts.
    return [formatter.format<string>(values)].flat().join("");
  } catch (error) {
    console.warn(`autoi18n: could not format "${message}" for "${locale}".`, error);
    return message;
  }
}
