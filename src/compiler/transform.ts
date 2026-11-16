import MagicString, { type SourceMap } from "magic-string";

import type { Catalog, ResolvedMessage } from "../types.js";

/** Virtual module id that exposes the runtime `setLocale()` and catalogues. */
export const RUNTIME_MODULE = "virtual:autoi18n";
/** Global name of the translation lookup function injected into transformed code. */
const RUNTIME_LOOKUP = "__autoI18nT";

/**
 * Build mode bakes the catalogue for `locale` into the code. Runtime mode emits `lookup(id, source)` calls that resolve
 * against the catalogues loaded by RUNTIME_MODULE. Messages written in `sourceLocale` are emitted as-is.
 *
 * Each `t("...")` call is replaced in place with MagicString, so the returned source map points back to the original
 * file. When a runtime lookup is used, the matching import from RUNTIME_MODULE is prepended.
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
    const replacement = runtime
      ? `${RUNTIME_LOOKUP}(${JSON.stringify(message.id)}, ${JSON.stringify(message.source)})`
      : JSON.stringify(textFor(message));
    s.overwrite(message.start, message.end, replacement);
  }

  if (runtime && messages.length) s.prepend(`import { lookup as ${RUNTIME_LOOKUP} } from "${RUNTIME_MODULE}";\n`);

  return { code: s.toString(), map: s.generateMap({ source: filename, hires: true, includeContent: true }) };
}
