/**
 * Picks the best supported locale for a list of preferred locales (for example `navigator.languages`).
 * This function is also embedded into the generated `virtual:autoi18n` module via `toString()`,
 * so it must stay self-contained and must not reference anything outside its body.
 */
export function resolveLocale(preferred: string[], supported: string[], fallback = "en"): string {
  for (const candidate of preferred) {
    const exact = supported.find(x => x.toLowerCase() === candidate.toLowerCase());
    if (exact) return exact;
    const base = candidate.split("-")[0].toLowerCase();
    const language = supported.find(x => x.split("-")[0].toLowerCase() === base);
    if (language) return language;
  }
  return fallback;
}
