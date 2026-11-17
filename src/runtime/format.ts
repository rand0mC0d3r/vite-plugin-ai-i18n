import IntlMessageFormat, { type MessageValues } from "intl-messageformat";

import { ICU_PARSER_OPTIONS } from "../icu.js";

/** Values for the placeholders of an ICU message. */
export type { MessageValues };

const formatters = new Map<string, IntlMessageFormat<MessageValues>>();

function singularWord(word: string): string {
  if (/[^aeiou]ies$/i.test(word)) return word.slice(0, -3) + (word.endsWith("IES") ? "Y" : "y");
  if (/sses$/i.test(word)) return word.slice(0, -2);
  if (/ses$/i.test(word)) {
    return /(uses|oses|ises|eses)$/i.test(word) ? word.slice(0, -2) : word.slice(0, -1);
  }
  if (/(xes|zes|ches|shes)$/i.test(word)) return word.slice(0, -2);
  if (/s$/i.test(word) && !/ss$/i.test(word)) return word.slice(0, -1);
  return word;
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
  const singularSuffix = suffix.replace(word, singular);
  const zeroPrefix = prefix.trim() ? `${prefix.trim()} no` : "No";
  const onePhrase = `${prefix.trim()} ${singularSuffix.trim() ? `# ${singularSuffix.trim()}` : `# ${singular}`}`.trim();
  const otherPhrase = `${prefix.trim()} ${suffix.trim() ? `# ${suffix.trim()}` : `# ${word}`}`.trim();
  const zeroPhrase = `${zeroPrefix} ${suffix.trim()}`.trim();
  const plural = `{count, plural, =0 {${zeroPhrase}} one {${onePhrase}} other {${otherPhrase}}}`;
  return formatMessage(plural, locale, values);
}

/**
 * Formats an ICU MessageFormat string, such as `{count, plural, one {# file} other {# files}}`, for a locale. Messages
 * that fail to parse or are missing a value are logged and returned unformatted, so a bad translation never breaks the
 * page.
 */
export function formatMessage(message: string, locale: string, values: MessageValues): string {
  const key = `${locale}\u0000${message}`;
  try {
    let formatter = formatters.get(key);
    if (!formatter) {
      formatter = new IntlMessageFormat(message, locale, undefined, ICU_PARSER_OPTIONS);
      formatters.set(key, formatter);
    }
    // Without rich-text callbacks the result is a single string, but the type also allows an array of parts.
    return [formatter.format<string>(values)].flat().join("");
  } catch (error) {
    console.warn(`autoi18n: could not format "${message}" for "${locale}".`, error);
    return message;
  }
}
