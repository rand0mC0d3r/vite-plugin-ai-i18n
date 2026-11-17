import MagicString, { type SourceMap } from "magic-string";

import type { Catalog, ResolvedMessage } from "../types.js";

/** Virtual module id that exposes the runtime `setLocale()` and catalogues. */
export const RUNTIME_MODULE = "virtual:autoi18n";
/** Package subpath that exports the ICU formatter used by build output. */
export const FORMAT_MODULE = "vite-plugin-ai-auto-i18n/runtime";
/** Global name of the translation lookup function injected into transformed code. */
const RUNTIME_LOOKUP = "__autoI18nT";
/** Global name of the ICU formatter injected into build output for calls with values. */
const FORMAT_FN = "__autoI18nFormat";
/** Global name of the fallback ICU generator injected for `tt()` calls. */
const FORMAT_AUTO_FN = "__autoI18nFormatAutoPlural";

/**
 * Build mode bakes the catalogue for `locale` into the code. Runtime mode emits `lookup(id, source)` calls that resolve
 * against the catalogues loaded by RUNTIME_MODULE. Messages written in `sourceLocale` are emitted as-is.
 *
 * A call with values, such as `t("{count} files", { count })`, keeps its values argument. Build mode formats the
 * translation with FORMAT_MODULE; runtime mode passes the values to `lookup`, which formats them.
 *
 * Each `t("...")` call is replaced in place with MagicString, so the returned source map points back to the original
 * file. The matching import is prepended when it is needed.
 *
 * @param code Source text of the module to transform.
 * @param filename Used as the source name in the source map.
 * @param messages Messages extracted from this file, each with the character range of its call in `code`.
 * @param locale Locale being built. Build mode looks translations up for this locale.
 * @param catalog Translations for `locale`, keyed by message ID. Missing IDs fall back to the source text.
 * @param runtime When true, emit runtime lookups instead of baked-in text.
 * @param sourceLocale Locale the source code is written in. Its messages are never looked up.
 * @returns The transformed code and its source map.
 */
export function transformSource(
  code: string,
  filename: string,
  messages: ResolvedMessage[],
  locale: string,
  catalog: Catalog,
  runtime = false,
  sourceLocale = "en",
): { code: string; map: SourceMap } {
  const s = new MagicString(code);

  const textFor = (message: ResolvedMessage): string =>
    locale === sourceLocale ? message.source : (catalog[message.id] ?? message.source);

  for (const message of messages) {
    if (message.valuesStart === undefined) {
      const replacement = runtime
        ? `${RUNTIME_LOOKUP}(${JSON.stringify(message.id)}, ${JSON.stringify(message.source)})`
        : JSON.stringify(textFor(message));
      s.overwrite(message.start, message.end, replacement);
      continue;
    }
    let head: string;
    if (runtime && message.autoPlural === true) {
      head = `__autoI18nLookupAutoPlural(${JSON.stringify(message.id)}, ${JSON.stringify(message.source)}, `;
    } else if (runtime) {
      head = `${RUNTIME_LOOKUP}(${JSON.stringify(message.id)}, ${JSON.stringify(message.source)}, `;
    } else if (message.autoPlural === true) {
      head = `${FORMAT_AUTO_FN}(${JSON.stringify(textFor(message))}, ${JSON.stringify(locale)}, `;
    } else {
      head = `${FORMAT_FN}(${JSON.stringify(textFor(message))}, ${JSON.stringify(locale)}, `;
    }
    s.overwrite(message.start, message.valuesStart, head);
  }

  const imports: string[] = [];
  if (runtime && messages.length) imports.push(`import { lookup as ${RUNTIME_LOOKUP} } from "${RUNTIME_MODULE}";`);
  if (runtime && messages.some((message) => message.autoPlural === true))
    imports.push(`import { lookupAutoPlural as __autoI18nLookupAutoPlural } from "${RUNTIME_MODULE}";`);
  if (!runtime && messages.some((message) => message.valuesStart !== undefined))
    imports.push(`import { formatMessage as ${FORMAT_FN} } from "${FORMAT_MODULE}";`);
  if (!runtime && messages.some((message) => message.autoPlural === true))
    imports.push(`import { formatAutoPluralMessage as ${FORMAT_AUTO_FN} } from "${FORMAT_MODULE}";`);
  if (imports.length) s.prepend(`${imports.join("\n")}\n`);

  return { code: s.toString(), map: s.generateMap({ source: filename, hires: true, includeContent: true }) };
}
