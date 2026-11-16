import IntlMessageFormat, { type MessageValues } from "intl-messageformat";

import { ICU_PARSER_OPTIONS } from "../icu.js";

/** Values for the placeholders of an ICU message. */
export type { MessageValues };

const formatters = new Map<string, IntlMessageFormat<MessageValues>>();

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
