import type { Plugin, ResolvedConfig, ViteDevServer } from "vite";
import fg from "fast-glob";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { extractMessages } from "./compiler/extract.js";
import { RUNTIME_MODULE, transformSource } from "./compiler/transform.js";
import { loadRegistry, reconcile, saveRegistry } from "./identity/registry.js";
import { readJsonFile, writeFileAtomic } from "./io.js";
import { createRuntimeModule } from "./runtime/virtual.js";
import { translateLocale } from "./translate.js";
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
  /** Log each message sent to the translation provider and each translation received, with timestamps. Default false. */
  debug?: boolean;
}

const UPDATE_EVENT = "autoi18n:update";
const DEFAULT_INCLUDE = ["src/**/*.{tsx,jsx,ts,js}"];
const DEFAULT_EXCLUDE = ["**/*.test.*", "**/node_modules/**"];
const WATCH_DEBOUNCE_MS = 150;

const hashOf = (code: string): string => createHash("sha1").update(code).digest("hex");
const toJson = (value: unknown): string => JSON.stringify(value, null, 2) + "\n";
// `path.matchesGlob` is only available on newer Node versions, so it is optional here.
const pathWithGlob = path as unknown as { matchesGlob?: (file: string, pattern: string) => boolean };

export default function autoI18n(options: AutoI18nOptions): Plugin {
  const sourceLocale = options.sourceLocale ?? "en";
  const directory = options.directory ?? ".autoi18n";
  const delivery = options.delivery ?? "build";
  const debug = options.debug ?? false;
  let config: ResolvedConfig;
  let registryFile = "";
  let catalogFiles: Record<string, string> = {};
  let fileMessages = new Map<string, ExtractedMessage[]>();
  let fileHashes = new Map<string, string>();
  let catalogs = new Map<string, Catalog>();
  const warnedFiles = new Set<string>();

  interface Reporter { info(message: string): void; warn(message: string): void; error(message: string): void }
  let server: ViteDevServer | undefined;
  let queue: Promise<void> = Promise.resolve();
  let watchTimer: ReturnType<typeof setTimeout> | undefined;
  const devReporter = (): Reporter => ({ info: m => config.logger.info(m), warn: m => config.logger.warn(m), error: m => config.logger.error(m) });
  const selectedLocale = (): string => options.locale ?? process.env.AUTOI18N_LOCALE ?? sourceLocale;

  // With build delivery and an explicit locale (for example one CI matrix job), only that catalogue is needed.
  function localesToTranslate(): string[] {
    const others = options.locales.filter(x => x !== sourceLocale);
    const explicit = options.locale ?? process.env.AUTOI18N_LOCALE;
    if (delivery === "build" && explicit && config.command !== "serve") return others.filter(x => x === explicit);
    return others;
  }

  // Re-indexes every source file, translates only missing or stale messages and writes the catalogues.
  // Results are built locally and swapped in at the end, so a transform never sees half-updated state.
  async function sync(report: Reporter): Promise<void> {
    const files = await fg(options.include ?? DEFAULT_INCLUDE, { cwd: config.root, ignore: options.exclude ?? DEFAULT_EXCLUDE, absolute: true });
    const all: ExtractedMessage[] = [];
    const nextMessages = new Map<string, ExtractedMessage[]>();
    const nextHashes = new Map<string, string>();
    for (const file of files) {
      const code = await readFile(file, "utf8");
      const messages = extractMessages(code, file);
      nextMessages.set(file, messages);
      nextHashes.set(file, hashOf(code));
      all.push(...messages);
    }
    const { registry, ambiguous } = reconcile(await loadRegistry(registryFile, report.warn), all);
    await saveRegistry(registryFile, registry);
    if (ambiguous.length) {
      const message = `autoi18n: ${ambiguous.length} duplicated texts changed occurrence count, so their IDs may have moved (e.g. "${ambiguous[0]}").`;
      if (options.onAmbiguous === "error") report.error(message);
      else report.warn(message);
    }

    const outDir = path.resolve(config.root, directory, "locales");
    const sourceCatalog: Catalog = {};
    for (const m of all) if (m.id) sourceCatalog[m.id] = m.source;
    await writeFileAtomic(path.join(outDir, `${sourceLocale}.json`), toJson(sourceCatalog));

    const requests = all.filter(m => m.id).map(m => ({ id: m.id!, source: m.source, context: `${m.component} > ${m.context}`, kind: m.kind, placeholders: m.placeholders }));
    const nextFiles = Object.fromEntries(options.locales.map(locale => [locale, path.join(outDir, `${locale}.json`)]));
    const nextCatalogs = new Map<string, Catalog>([[sourceLocale, sourceCatalog]]);
    for (const locale of localesToTranslate()) {
      const catalogPath = nextFiles[locale];
      const sourcesPath = path.join(outDir, `${locale}.sources.json`);
      const result = await translateLocale({
        provider: options.provider,
        sourceLocale,
        locale,
        requests,
        previous: await readJsonFile<Catalog>(catalogPath, {}, report.warn),
        previousSources: await readJsonFile<Catalog>(sourcesPath, {}, report.warn),
        debug
      });
      if (result.requested && !options.provider && options.failOnMissingProvider) {
        report.error(`Missing ${result.requested} ${locale} translations and no provider is configured.`);
      }
      if (result.rejected) report.info(`autoi18n: rejected ${result.rejected} ${locale} translations with changed placeholders.`);
      if (result.untranslated) {
        const log = options.provider ? report.warn : report.info;
        log(`autoi18n: ${result.untranslated} ${locale} messages have no translation and fall back to the source text.`);
      }
      await writeFileAtomic(catalogPath, toJson(result.catalog));
      await writeFileAtomic(sourcesPath, toJson(result.sources));
      nextCatalogs.set(locale, result.catalog);
    }

    fileMessages = nextMessages;
    fileHashes = nextHashes;
    catalogs = nextCatalogs;
    catalogFiles = nextFiles;
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

  // A burst of added or removed files (for example a git checkout) causes one re-index instead of one per file.
  function scheduleRetranslate(): void {
    clearTimeout(watchTimer);
    watchTimer = setTimeout(() => void retranslate(), WATCH_DEBOUNCE_MS);
  }

  function isSourceCandidate(file: string): boolean {
    if (!/\.[jt]sx?$/.test(file)) return false;
    if (!pathWithGlob.matchesGlob) return true;
    const relative = path.relative(config.root, file).split(path.sep).join("/");
    const matches = pathWithGlob.matchesGlob;
    return (options.include ?? DEFAULT_INCLUDE).some(p => matches(relative, p))
      && !(options.exclude ?? DEFAULT_EXCLUDE).some(p => matches(relative, p));
  }

  return {
    name: "vite-plugin-autoi18n",
    enforce: "pre",
    configResolved(resolved) {
      config = resolved;
      registryFile = path.resolve(config.root, directory, "registry.json");
      const selected = selectedLocale();
      if (selected !== sourceLocale && !options.locales.includes(selected)) {
        throw new Error(`autoi18n: locale "${selected}" is not one of the configured locales (${options.locales.join(", ")}).`);
      }
    },
    resolveId(id) { if (id === RUNTIME_MODULE) return `\0${RUNTIME_MODULE}`; },
    load(id) { if (id === `\0${RUNTIME_MODULE}`) return createRuntimeModule(catalogFiles, sourceLocale); },
    configureServer(devServer) {
      server = devServer;
      // Adding or removing a file cannot go through handleHotUpdate, so re-index here.
      devServer.watcher.on("add", file => { if (isSourceCandidate(file)) scheduleRetranslate(); });
      devServer.watcher.on("unlink", file => { if (fileMessages.has(file)) scheduleRetranslate(); });
    },
    closeBundle() { clearTimeout(watchTimer); },
    async buildStart() {
      await sync({ info: m => this.info(m), warn: m => this.warn(m), error: m => this.error(m) });
    },
    async transform(code, id) {
      const file = id.split("?")[0];
      if (!fileMessages.has(file)) return null;
      if (hashOf(code) !== fileHashes.get(file)) {
        // The file changed after it was indexed, e.g. the watcher has not fired yet; re-index once.
        await runSync(devReporter());
      }
      const messages = fileMessages.get(file);
      if (!messages || hashOf(code) !== fileHashes.get(file)) {
        if (!warnedFiles.has(file)) {
          warnedFiles.add(file);
          this.warn(`autoi18n: ${file} changed while it was being indexed; its messages are left untranslated.`);
        }
        return null;
      }
      const locale = config.command === "serve" ? sourceLocale : selectedLocale();
      const result = transformSource(code, file, messages, locale, catalogs.get(locale) ?? {}, delivery === "runtime", sourceLocale);
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
export type { OpenAICompatibleOptions } from "./ai/provider.js";
export type * from "./types.js";
