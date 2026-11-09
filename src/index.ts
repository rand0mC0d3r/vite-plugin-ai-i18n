import type { Plugin, ResolvedConfig, ViteDevServer } from "vite";
import fg from "fast-glob";
import path from "node:path";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { extractMessages, relativeFile } from "./compiler/extract.js";
import { RUNTIME_MODULE, transformSource } from "./compiler/transform.js";
import { loadRegistry, reconcile, saveRegistry } from "./identity/registry.js";
import { createRuntimeModule } from "./runtime/virtual.js";
import type { Catalog, ExtractedMessage, TranslationProvider } from "./types.js";

export interface AutoI18nOptions {
  locales: string[];
  sourceLocale?: string;
  /**
   * "build" (default) compiles one locale per build. "runtime" ships every catalogue and
   * switches locale in the browser via `setLocale()` from the `virtual:autoi18n` module.
   */
  delivery?: "build" | "runtime";
  /** Compile this build for one locale. Defaults to sourceLocale; set AUTOI18N_LOCALE for CI matrix builds. */
  locale?: string;
  include?: string[];
  exclude?: string[];
  directory?: string;
  provider?: TranslationProvider;
  failOnMissingProvider?: boolean;
  onAmbiguous?: "warn" | "error";
}

const UPDATE_EVENT = "autoi18n:update";

async function readJson(file: string): Promise<Catalog> {
  try { return JSON.parse(await readFile(file, "utf8")) as Catalog; } catch { return {}; }
}

export default function autoI18n(options: AutoI18nOptions): Plugin {
  const sourceLocale = options.sourceLocale ?? "en";
  const directory = options.directory ?? ".autoi18n";
  const delivery = options.delivery ?? "build";
  let config: ResolvedConfig;
  let registryFile = "";
  let catalogFiles: Record<string, string> = {};
  const fileMessages = new Map<string, ExtractedMessage[]>();
  const catalogs = new Map<string, Catalog>();

  interface Reporter { info(message: string): void; error(message: string): void }
  let server: ViteDevServer | undefined;
  let queue: Promise<void> = Promise.resolve();
  const devReporter = (): Reporter => ({ info: m => config.logger.info(m), error: m => config.logger.error(m) });

  // Re-indexes every source file, translates only missing or stale messages and writes the catalogues.
  async function sync(report: Reporter): Promise<void> {
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
    catalogFiles = Object.fromEntries(options.locales.map(locale => [locale, path.join(outDir, `${locale}.json`)]));
    for (const locale of options.locales.filter(x => x !== sourceLocale)) {
      const catalogPath = path.join(outDir, `${locale}.json`);
      const sourcesPath = path.join(outDir, `${locale}.sources.json`);
      const previous = await readJson(catalogPath);
      const previousSources = await readJson(sourcesPath);
      // Translations are stale when the source text changed under the same ID; re-request them.
      const missing = requests.filter(x => previous[x.id] === undefined || previousSources[x.id] !== x.source);
      let translated: Catalog = {};
      if (missing.length && options.provider) translated = await options.provider.translate({ sourceLocale, targetLocale: locale, messages: missing });
      else if (missing.length && options.failOnMissingProvider) report.error(`Missing ${missing.length} ${locale} translations and no provider is configured.`);
      const merged: Catalog = { ...previous };
      const sources: Catalog = { ...previousSources };
      for (const x of missing) {
        delete merged[x.id]; delete sources[x.id];
        if (typeof translated[x.id] === "string") { merged[x.id] = translated[x.id]; sources[x.id] = x.source; }
      }
      catalogs.set(locale, merged);
      await writeFile(catalogPath, JSON.stringify(merged, null, 2) + "\n");
      await writeFile(sourcesPath, JSON.stringify(sources, null, 2) + "\n");
    }
    catalogs.set(sourceLocale, sourceCatalog);
    if (all.length) report.info(`autoi18n: indexed ${all.length} messages across ${files.length} files.`);
  }

  // Runs syncs one after another so overlapping saves cannot interleave writes or API calls.
  function runSync(report: Reporter): Promise<void> {
    const next = queue.then(() => sync(report));
    queue = next.catch(() => undefined);
    return next;
  }

  function pushCatalogs(): void {
    server?.ws.send({ type: "custom", event: UPDATE_EVENT, data: { catalogs: Object.fromEntries(catalogs) } });
  }

  async function retranslate(): Promise<void> {
    try {
      await runSync(devReporter());
      pushCatalogs();
    } catch (error) {
      config.logger.error(`autoi18n: re-translation failed: ${(error as Error).message}`);
    }
  }

  return {
    name: "vite-plugin-autoi18n",
    enforce: "pre",
    configResolved(resolved) { config = resolved; registryFile = path.resolve(config.root, directory, "registry.json"); },
    resolveId(id) { if (id === RUNTIME_MODULE) return `\0${RUNTIME_MODULE}`; },
    load(id) { if (id === `\0${RUNTIME_MODULE}`) return createRuntimeModule(catalogFiles, sourceLocale); },
    configureServer(devServer) {
      server = devServer;
      // Adding or removing a file cannot go through handleHotUpdate, so re-index here.
      devServer.watcher.on("add", file => { if (/\.[jt]sx?$/.test(file)) void retranslate(); });
      devServer.watcher.on("unlink", file => { if (fileMessages.has(file)) void retranslate(); });
    },
    async buildStart() {
      await sync({ info: m => this.info(m), error: m => this.error(m) });
    },
    transform(code, id) {
      const file = id.split("?")[0];
      const messages = fileMessages.get(file);
      if (!messages) return null;
      const selectedLocale = config.command === "serve" ? sourceLocale : (options.locale ?? process.env.AUTOI18N_LOCALE ?? sourceLocale);
      const result = transformSource(code, file, messages, selectedLocale, catalogs.get(selectedLocale) ?? {}, delivery === "runtime");
      return { code: result.code, map: result.map };
    },
    async handleHotUpdate({ file }) {
      // Catalogue writes must not trigger a reload; the new data is pushed over the custom event instead.
      if (file.startsWith(path.resolve(config.root, directory, "locales") + path.sep)) return [];
      if (!fileMessages.has(file)) return;
      await retranslate();
    }
  };
}

export { OpenAICompatibleProvider } from "./ai/provider.js";
export { createLocaleLoader, resolveLocale } from "./runtime/index.js";
export type * from "./types.js";
