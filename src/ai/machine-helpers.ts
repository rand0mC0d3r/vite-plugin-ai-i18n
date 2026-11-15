import type { Catalog, TranslationRequest } from "../types.js";
import { ProviderError } from "./base.js";

/** Simple ICU arguments such as `{name}`. Complex plural or select blocks are not protected. */
const PLACEHOLDER = /\{[A-Za-z_]\w*\}/g;
const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const ENTITY = /&(#\d+|#x[\da-f]+|[a-z]+);/gi;

/**
 * Escapes markup characters, then wraps each `{name}` argument in `open`/`close` so the engine copies it unchanged.
 * Pair with restoreText on the output.
 */
export function protectText(source: string, open: string, close: string): string {
  const escaped = source.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return escaped.replace(PLACEHOLDER, (name) => `${open}${name}${close}`);
}

/** Removes the wrappers added by protectText and decodes the HTML entities the engine returns, in a single pass. */
export function restoreText(translated: string, open: string, close: string): string {
  return translated
    .split(open)
    .join("")
    .split(close)
    .join("")
    .replace(ENTITY, (match, entity: string) => {
      if (entity[0] !== "#") return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
      const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return code <= 0x10ffff ? String.fromCodePoint(code) : match;
    });
}

/**
 * Pairs index-aligned engine output with the requested messages. Engines that don't echo IDs return translations in
 * request order, so a count mismatch means the reply can't be trusted and the batch is retried.
 */
export function alignedCatalog(
  messages: TranslationRequest[],
  translations: string[],
  open: string,
  close: string,
): Catalog {
  if (translations.length !== messages.length)
    throw new ProviderError("Translation provider returned a different number of translations", true);
  const result: Catalog = {};
  messages.forEach((message, index) => {
    const text = restoreText(translations[index], open, close);
    if (text.trim()) result[message.id] = text;
  });
  return result;
}
