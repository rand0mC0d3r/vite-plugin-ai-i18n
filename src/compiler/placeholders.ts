// Matches `{name}` placeholders in mixed-content messages such as "You have {count} documents".
export const PLACEHOLDER = /\{([^{}]+)\}/g;

export function placeholderNames(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map(match => match[1]);
}

export function sameNames(a: string[], b: string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every(name => right.has(name));
}
