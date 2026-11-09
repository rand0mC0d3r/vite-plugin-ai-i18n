/**
 * Source of the `virtual:autoi18n` module used by runtime delivery. It is emitted as
 * plain JavaScript because it runs in the browser and must not import the plugin itself.
 */
export function createRuntimeModule(catalogFiles: Record<string, string>, sourceLocale: string): string {
  const loaders = Object.entries(catalogFiles)
    .map(([locale, file]) => `  ${JSON.stringify(locale)}: () => import(${JSON.stringify(file)})`)
    .join(",\n");
  return [
    `const loaders = {\n${loaders}\n};`,
    `const sourceLocale = ${JSON.stringify(sourceLocale)};`,
    `const cache = new Map();`,
    `const listeners = new Set();`,
    `let currentLocale = sourceLocale;`,
    `let messages = {};`,
    `export const locales = Object.keys(loaders);`,
    `export function getLocale() { return currentLocale; }`,
    `export function resolveSupported(preferred) {`,
    `  for (const candidate of preferred) {`,
    `    const exact = locales.find(x => x.toLowerCase() === candidate.toLowerCase());`,
    `    if (exact) return exact;`,
    `    const base = candidate.split("-")[0].toLowerCase();`,
    `    const language = locales.find(x => x.split("-")[0].toLowerCase() === base);`,
    `    if (language) return language;`,
    `  }`,
    `  return sourceLocale;`,
    `}`,
    `function loadCatalog(locale) {`,
    `  if (!cache.has(locale)) cache.set(locale, loaders[locale]().then(m => m.default ?? m));`,
    `  return cache.get(locale);`,
    `}`,
    `export async function setLocale(locale) {`,
    `  const selected = loaders[locale] ? locale : sourceLocale;`,
    `  const catalog = await loadCatalog(selected);`,
    `  messages = catalog;`,
    `  currentLocale = selected;`,
    `  listeners.forEach(fn => fn(selected));`,
    `}`,
    `export function subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; }`,
    `export function t(id, source) { return messages[id] ?? source; }`
  ].join("\n") + "\n";
}
