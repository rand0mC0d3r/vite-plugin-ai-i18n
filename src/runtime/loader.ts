/**
 * Lazily imports one locale's catalogue. Resolves to a module whose default export, or the object itself, is the
 * catalogue.
 */
export type LocaleLoader = () => Promise<{ default: Record<string, string> } | Record<string, string>>;

/**
 * Returns a module's default export when it has one, otherwise the module itself. Serialised into the runtime module
 * via toString(), so it must not reference anything outside its body.
 */
export function unwrapDefault(module: object): unknown {
  return "default" in module ? module.default : module;
}

/**
 * Returns a cached catalogue loader. Unknown locales load the fallback, and a failed load is not cached. `prime` stores
 * a catalogue that was already fetched, such as one pushed by the dev server. Serialised into the runtime module via
 * toString(), so it must not reference anything outside its body (other than `unwrapDefault`, which is embedded too).
 *
 * @param loaders Loader for each supported locale, keyed by locale code.
 * @param fallback Locale loaded when the requested one has no loader.
 * @returns A function that resolves a locale to its catalogue, with a `prime(locale, catalog)` method.
 */
export function createLocaleLoader(loaders: Record<string, LocaleLoader>, fallback = "en") {
  const cache = new Map<string, Promise<Record<string, string>>>();
  function loadLocale(locale: string): Promise<Record<string, string>> {
    const selected = Object.hasOwn(loaders, locale) ? locale : fallback;
    const cached = cache.get(selected);
    if (cached) return cached;
    const loader: LocaleLoader | undefined = Object.hasOwn(loaders, selected) ? loaders[selected] : undefined;
    if (!loader) return Promise.reject(new Error(`No catalogue loader for locale "${selected}"`));
    const pending = loader().then((module) => unwrapDefault(module) as Record<string, string>);
    cache.set(selected, pending);
    pending.catch(() => {
      if (cache.get(selected) === pending) cache.delete(selected);
    });
    return pending;
  }
  loadLocale.prime = (locale: string, catalog: Record<string, string>): void => {
    cache.set(locale, Promise.resolve(catalog));
  };
  return loadLocale;
}

/**
 * Picks the best supported locale for a list of preferred locales (for example `navigator.languages`). This function is
 * also embedded into the generated `virtual:autoi18n` module via `toString()`, so it must stay self-contained and must
 * not reference anything outside its body.
 *
 * @param preferred Locales in priority order, such as `navigator.languages`.
 * @param supported Locales the app has catalogues for.
 * @param fallback Returned when no preferred locale matches.
 * @returns The supported locale that matches first, preferring an exact match over a same-language match.
 */
export function resolveLocale(preferred: string[], supported: string[], fallback = "en"): string {
  for (const candidate of preferred) {
    const exact = supported.find((x) => x.toLowerCase() === candidate.toLowerCase());
    if (exact !== undefined) return exact;
    const base = candidate.split("-")[0].toLowerCase();
    const language = supported.find((x) => x.split("-")[0].toLowerCase() === base);
    if (language !== undefined) return language;
  }
  return fallback;
}
