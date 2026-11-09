export type LocaleLoader = () => Promise<{ default: Record<string, string> } | Record<string, string>>;

/**
 * Returns a cached catalogue loader. Unknown locales load the fallback, and a failed load is not cached.
 * `prime` stores a catalogue that was already fetched, such as one pushed by the dev server.
 * Serialised into the runtime module via toString(), so it must not reference anything outside its body.
 */
export function createLocaleLoader(loaders: Record<string, LocaleLoader>, fallback = "en") {
  const cache = new Map<string, Promise<Record<string, string>>>();
  function loadLocale(locale: string): Promise<Record<string, string>> {
    const selected = loaders[locale] ? locale : fallback;
    const cached = cache.get(selected);
    if (cached) return cached;
    const loader = loaders[selected];
    if (!loader) return Promise.reject(new Error(`No catalogue loader for locale "${selected}"`));
    const pending = loader().then(module => ("default" in module ? module.default : module) as Record<string, string>);
    cache.set(selected, pending);
    pending.catch(() => { if (cache.get(selected) === pending) cache.delete(selected); });
    return pending;
  }
  loadLocale.prime = (locale: string, catalog: Record<string, string>): void => {
    cache.set(locale, Promise.resolve(catalog));
  };
  return loadLocale;
}
