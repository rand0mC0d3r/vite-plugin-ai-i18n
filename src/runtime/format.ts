import { FORMAT_LIBRARY } from "../constants.js";

/** The subset of IntlMessageFormat that the formatter uses. */
interface Formatter {
  formatToParts(values: Record<string, unknown>): { value: unknown }[];
}

/**
 * Renders an ICU MessageFormat text. Values are kept as they are, so React nodes stay separate parts of the result.
 * Text that cannot be formatted is returned unchanged. Serialised into the format module via toString(), so it must
 * not reference anything outside its body.
 */
export function formatMessage(
  IntlMessageFormat: new (text: string, locale: string) => Formatter,
  cache: Map<string, Formatter>,
  text: string,
  values: Record<string, unknown>,
  locale: string
): unknown[] {
  try {
    const key = locale + "\u0000" + text;
    let formatter = cache.get(key);
    if (!formatter) {
      formatter = new IntlMessageFormat(text, locale);
      cache.set(key, formatter);
    }
    return formatter.formatToParts(values).map(part => part.value);
  } catch (error) {
    console.warn("autoi18n: could not format " + JSON.stringify(text) + ".", error);
    return [text];
  }
}

/** Builds the `virtual:autoi18n-format` module, which imports the formatting library from this plugin's install. */
export function createFormatModule(): string {
  return [
    `import { IntlMessageFormat } from ${JSON.stringify(FORMAT_LIBRARY)};`,
    `const formatMessage = ${formatMessage.toString()};`,
    `const cache = new Map();`,
    `export function format(text, values, locale) { return formatMessage(IntlMessageFormat, cache, text, values, locale); }`
  ].join("\n") + "\n";
}
