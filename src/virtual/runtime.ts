import { createLocaleLoader, unwrapDefault } from "../runtime/loader.js";
import { resolveLocale } from "../runtime/resolve.js";

/**
 * Encodes a value as a JavaScript string literal. Besides JSON escaping, `<`, `>`, `&`, U+2028 and U+2029 are written
 * as unicode escapes so the literal cannot close a surrounding script or line early.
 */
function toJsStringLiteral(value: string): string {
  return JSON.stringify(value).replace(
    /[<>&\u2028\u2029]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/**
 * Builds the `virtual:autoi18n` module. It is plain JavaScript because it runs in the browser and must not import the
 * plugin itself, so the shared helpers are embedded with `toString()`. Those helpers must stay self-contained (see
 * their doc comments).
 */
export function createRuntimeModule(catalogFiles: Record<string, string>, sourceLocale: string): string {
  const loaders = Object.entries(catalogFiles)
    .map(
      ([locale, file]) =>
        `  ${toJsStringLiteral(locale)}: () => import(${toJsStringLiteral(file)}).then(m => unwrapDefault(m).messages)`,
    )
    .join(",\n");
  return (
    [
      `const unwrapDefault = ${unwrapDefault.toString()};`,
      `const loaders = {\n${loaders}\n};`,
      `const sourceLocale = ${toJsStringLiteral(sourceLocale)};`,
      `const resolveLocale = ${resolveLocale.toString()};`,
      `const createLocaleLoader = ${createLocaleLoader.toString()};`,
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
      `export function lookup(id, source) { return messages[id] ?? source; }`,
      `// Only literal t("...") calls are translated at build time. Any other call returns its argument unchanged.`,
      `export function t(source) { return source; }`,
      `// Dev server pushes the catalogues that changed after a source change; no page reload is needed.`,
      `if (import.meta.hot) {`,
      `  import.meta.hot.on("autoi18n:update", data => {`,
      `    for (const [locale, catalog] of Object.entries(data.catalogs)) loadLocale.prime(locale, catalog);`,
      `    if (!data.catalogs[currentLocale]) return;`,
      `    messages = data.catalogs[currentLocale];`,
      `    notify();`,
      `  });`,
      `}`,
    ].join("\n") + "\n"
  );
}
