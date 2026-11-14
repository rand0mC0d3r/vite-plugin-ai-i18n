import { NAMED_ENTITIES, REFERENCE } from "../constants.js";

/** Decodes character references the way Babel does: unknown or out-of-range references are left as written. */
export function decodeJsxEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(REFERENCE, (match, numeric: string | undefined, named: string | undefined) => {
    if (named !== undefined) return NAMED_ENTITIES.get(named) ?? match;
    const codePoint = numeric!.startsWith("x") ? parseInt(numeric!.slice(1), 16) : parseInt(numeric!, 10);
    return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match;
  });
}
