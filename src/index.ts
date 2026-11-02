import type { Plugin, ResolvedConfig } from "vite";
import fg from "fast-glob";
import path from "node:path";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { extractMessages, relativeFile } from "./compiler/extract.js";
import { transformSource } from "./compiler/transform.js";
import { loadRegistry, reconcile, saveRegistry } from "./identity/registry.js";
import type { Catalog, ExtractedMessage, TranslationProvider } from "./types.js";

export interface AutoI18nOptions {
  locales: string[];
  sourceLocale?: string;
  /** Compile this build for one locale. Defaults to sourceLocale; set AUTOI18N_LOCALE for CI matrix builds. */
  locale?: string;
  include?: string[];
  exclude?: string[];
  directory?: string;
  provider?: TranslationProvider;
  failOnMissingProvider?: boolean;
  onAmbiguous?: "warn" | "error";
}

export default function autoI18n(options: AutoI18nOptions): Plugin {
  const sourceLocale = options.sourceLocale ?? "en";
  const directory = options.directory ?? ".autoi18n";
  let config: ResolvedConfig;
  let registryFile = "";
  const fileMessages = new Map<string, ExtractedMessage[]>();
  const catalogs = new Map<string, Catalog>();

  return {
    name: "vite-plugin-autoi18n",
    enforce: "pre",
    configResolved(resolved) { config = resolved; registryFile = path.resolve(config.root, directory, "registry.json"); },
    async buildStart() {
      fileMessages.clear(); catalogs.clear();
      const files = await fg(options.include ?? ["src/**/*.{tsx,jsx,ts,js}"], { cwd: config.root, ignore: options.exclude ?? ["**/*.test.*", "**/node_modules/**"] , absolute: true });
      const all: ExtractedMessage[] = [];
      for (const file of files) {
        const code = await readFile(file, "utf8");
        const messages = extractMessages(code, file);
        fileMessages.set(file, messages); all.push(...messages);
      }
      const registry = reconcile(await loadRegistry(registryFile), all);
      await saveRegistry(registryFile, registry);

      const outDir = path.resolve(config.root, directory, "locales");
      await mkdir(outDir, { recursive: true });
      const sourceCatalog: Catalog = {};
      for (const m of all) if (m.id) sourceCatalog[m.id] = m.source;
      await writeFile(path.join(outDir, `${sourceLocale}.json`), JSON.stringify(sourceCatalog, null, 2) + "\n");

      const requests = all.filter(m => m.id).map(m => ({ id: m.id!, source: m.source, context: `${m.component} > ${m.context}`, kind: m.kind }));
      for (const locale of options.locales.filter(x => x !== sourceLocale)) {
        const catalogPath = path.join(outDir, `${locale}.json`);
        let previous: Catalog = {};
        try { previous = JSON.parse(await readFile(catalogPath, "utf8")); } catch { /* first build */ }
        const missing = requests.filter(x => !previous[x.id]);
        let translated: Catalog = {};
        if (missing.length && options.provider) translated = await options.provider.translate({ sourceLocale, targetLocale: locale, messages: missing });
        else if (missing.length && options.failOnMissingProvider) this.error(`Missing ${missing.length} ${locale} translations and no provider is configured.`);
        const merged = { ...previous, ...translated };
        catalogs.set(locale, merged);
        await writeFile(catalogPath, JSON.stringify(merged, null, 2) + "\n");
      }
      catalogs.set(sourceLocale, sourceCatalog);
      if (all.length) this.info(`autoi18n: indexed ${all.length} messages across ${files.length} files.`);
    },
    transform(code, id) {
      const file = id.split("?")[0];
      const messages = fileMessages.get(file);
      if (!messages) return null;
      const selectedLocale = config.command === "serve" ? sourceLocale : (options.locale ?? process.env.AUTOI18N_LOCALE ?? sourceLocale);
      const result = transformSource(code, file, messages, selectedLocale, catalogs.get(selectedLocale) ?? {});
      return { code: result.code, map: result.map };
    },
    handleHotUpdate({ file, server }) {
      if (/\.[jt]sx$/.test(file)) {
        // Force a full module reload; next buildStart/dev server restart refreshes the manifest.
        server.ws.send({ type: "full-reload" });
      }
    }
  };
}

export { OpenAICompatibleProvider } from "./ai/provider.js";
export { createLocaleLoader, resolveLocale } from "./runtime/index.js";
export type * from "./types.js";
