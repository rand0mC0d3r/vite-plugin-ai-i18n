import { PLACEHOLDER_PATTERN } from "../compiler/placeholders.js";
import { formatPlaceholders } from "./format.js";
import { createLocaleLoader } from "./loader.js";
import { resolveLocale } from "./resolve.js";

/**
 * Builds the `virtual:autoi18n` module. It is plain JavaScript because it runs in the browser and must not
 * import the plugin itself, so the shared helpers are embedded with `toString()`. Those helpers must stay
 * self-contained (see their doc comments).
 */
export function createRuntimeModule(catalogFiles: Record<string, string>, sourceLocale: string): string {
  const loaders = Object.entries(catalogFiles)
    .map(([locale, file]) => `  ${JSON.stringify(locale)}: () => import(${JSON.stringify(file)}).then(m => (m.default ?? m).messages)`)
    .join(",\n");
  return [
    `const loaders = {\n${loaders}\n};`,
    `const sourceLocale = ${JSON.stringify(sourceLocale)};`,
    `const resolveLocale = ${resolveLocale.toString()};`,
    `const createLocaleLoader = ${createLocaleLoader.toString()};`,
    `const formatPlaceholders = ${formatPlaceholders.toString()};`,
    `const PLACEHOLDER = new RegExp(${JSON.stringify(PLACEHOLDER_PATTERN)}, "g");`,
    `const loadLocale = createLocaleLoader(loaders, sourceLocale);`,
    `const listeners = new Set();`,
    `let currentLocale = sourceLocale;`,
    `let messages = {};`,
    `let version = 0;`,
    `let latestRequest = 0;`,
    `export const locales = Object.keys(loaders);`,
    `export function getLocale() { return currentLocale; }`,
    `export function getVersion() { return version; }`,
    `export function resolveSupported(preferred) { return resolveLocale(preferred, locales, sourceLocale); }`,
    `export async function setLocale(locale) {`,
    `  const request = ++latestRequest;`,
    `  let selected = loaders[locale] ? locale : sourceLocale;`,
    `  let catalog;`,
    `  try {`,
    `    catalog = await loadLocale(selected);`,
    `  } catch (error) {`,
    `    console.warn('autoi18n: could not load "' + selected + '", falling back to "' + sourceLocale + '".', error);`,
    `    selected = sourceLocale;`,
    `    try {`,
    `      catalog = await loadLocale(selected);`,
    `    } catch (fallbackError) {`,
    `      // Keep the current locale and messages so the UI stays consistent. Texts without a catalogue show their source.`,
    `      console.error('autoi18n: could not load the source catalogue "' + sourceLocale + '".', fallbackError);`,
    `      return;`,
    `    }`,
    `  }`,
    `  // A slower earlier request must not overwrite the locale the user picked last.`,
    `  if (request !== latestRequest) return;`,
    `  messages = catalog;`,
    `  currentLocale = selected;`,
    `  notify();`,
    `}`,
    `function notify() {`,
    `  version++;`,
    `  listeners.forEach(fn => fn(currentLocale));`,
    `}`,
    `export function subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; }`,
    `export function t(id, source) { return messages[id] ?? source; }`,
    `export function format(text, values) { return formatPlaceholders(text, values, PLACEHOLDER); }`,
    `// Dev server pushes fresh catalogues after a source change; no page reload is needed.`,
    `if (import.meta.hot) {`,
    `  import.meta.hot.on("autoi18n:update", data => {`,
    `    for (const [locale, catalog] of Object.entries(data.catalogs)) loadLocale.prime(locale, catalog);`,
    `    if (data.catalogs[currentLocale]) messages = data.catalogs[currentLocale];`,
    `    notify();`,
    `  });`,
    `}`
  ].join("\n") + "\n";
}
