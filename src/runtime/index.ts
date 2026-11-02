export type LocaleLoader = () => Promise<{ default: Record<string, string> } | Record<string, string>>;

export function createLocaleLoader(loaders: Record<string, LocaleLoader>, fallback = "en") {
  const cache = new Map<string, Promise<Record<string, string>>>();
  return async function loadLocale(locale: string): Promise<Record<string, string>> {
    const selected = loaders[locale] ? locale : fallback;
    let pending = cache.get(selected);
    if (!pending) {
      pending = loaders[selected]().then(module => "default" in module ? module.default : module);
      cache.set(selected, pending);
    }
    return pending;
  };
}

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
