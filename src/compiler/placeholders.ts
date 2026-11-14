import { PLACEHOLDER } from "../constants.js";

export function placeholderNames(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map(match => match[1]);
}

export function sameNames(a: string[], b: string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every(name => right.has(name));
}

/**
 * A translation may be used only if it is non-empty and uses each source placeholder exactly once.
 * A repeated placeholder would paste its expression twice in build mode, evaluating it twice.
 */
export function isUsableTranslation(text: string, placeholders: string[]): boolean {
  const found = placeholderNames(text);
  return text.trim() !== "" && found.length === placeholders.length && sameNames(found, placeholders);
}
