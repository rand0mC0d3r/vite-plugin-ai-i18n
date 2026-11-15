import { icuArgumentNames } from "../icu.js";

/** True when both lists contain the same distinct names, regardless of order or repetition. */
function sameNames(a: string[], b: string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((name) => right.has(name));
}

/**
 * A translation may be used only if it is non-empty, parses as ICU MessageFormat, and uses exactly the source's
 * argument names. Each argument is passed once to the formatter, so a translation may repeat or reorder them.
 */
export function isUsableTranslation(text: string, placeholders: string[]): boolean {
  if (text.trim() === "") return false;
  const found = icuArgumentNames(text);
  return found !== undefined && sameNames(found, placeholders);
}
