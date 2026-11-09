export type LocaleLoader = () => Promise<{ default: Record<string, string> } | Record<string, string>>;

export { resolveLocale } from "./resolve.js";

export function createLocaleLoader(loaders: Record<string, LocaleLoader>, fallback = "en") {
  const cache = new Map<string, Promise<Record<string, string>>>();
  return function loadLocale(locale: string): Promise<Record<string, string>> {
    const selected = loaders[locale] ? locale : fallback;
    const cached = cache.get(selected);
    if (cached) return cached;
    const loader = loaders[selected];
    if (!loader) return Promise.reject(new Error(`No catalogue loader for locale "${selected}"`));
    const pending = loader().then(module => ("default" in module ? module.default : module) as Record<string, string>);
    cache.set(selected, pending);
    // A failed load must not stay cached, otherwise every later request for this locale fails too.
    pending.catch(() => { if (cache.get(selected) === pending) cache.delete(selected); });
    return pending;
  };
}
