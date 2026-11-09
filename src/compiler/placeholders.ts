// Matches `{name}` placeholders in mixed-content messages such as "You have {count} documents".
export const PLACEHOLDER_PATTERN = "\\{([^{}]+)\\}";
export const PLACEHOLDER = new RegExp(PLACEHOLDER_PATTERN, "g");

export function placeholderNames(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map(match => match[1]);
}

export function sameNames(a: string[], b: string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every(name => right.has(name));
}

/** A translation may be used only if it is non-empty and keeps exactly the source's placeholders. */
export function isUsableTranslation(text: string, placeholders: string[]): boolean {
  return text.trim() !== "" && sameNames(placeholderNames(text), placeholders);
}
