import type { Logger, Plugin, ResolvedConfig, ViteDevServer } from "vite";
import * as z from "zod/mini";
import { glob } from "tinyglobby";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { debugLog } from "./debug.js";
import { buildCatalogs } from "./engine.js";
import { extractMessages } from "./compiler/extract.js";
import { transformSource } from "./compiler/transform.js";
import { localeFilePath, readLocaleFile, writeLocaleFile, type LocaleFile } from "./catalog.js";
import { loadRegistry, saveRegistry } from "./identity/registry.js";
import { DEFAULT_EXCLUDE, DEFAULT_INCLUDE, DEFAULT_ORPHAN_RETENTION_MINUTES, RUNTIME_MODULE, UPDATE_EVENT, WATCH_DEBOUNCE_MS } from "./constants.js";
import { hashContent } from "./io.js";
import { createRuntimeModule } from "./runtime/virtual.js";
import { optionsSchema } from "./schemas.js";
import type { Catalog, ExtractedMessage, ProviderConfig, ResolvedMessage } from "./types.js";
import { resolveProvider } from "./ai/fallback.js";

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
  /**
   * One provider, or named providers such as `{ primary: "anthropic", anthropic, openai }`. The primary is tried first;
   * when it fails, messages it did not translate go to the next configured provider.
   */
  provider?: ProviderConfig;
  failOnMissingProvider?: boolean;
  onAmbiguous?: "warn" | "error";
  /**
   * Minutes an orphaned message (one no longer in the source) is kept in the registry before it is deleted.
   * Default 43200 (30 days). `0` deletes orphans on the next build; `Infinity` keeps them forever.
   */
  orphanRetentionMinutes?: number;
  /**
   * Locales translated at the same time. Default 2. Batches within a locale are limited separately by
   * `OpenAICompatibleOptions.concurrency`. Lower this if your provider rate-limits per account.
   */
  localeConcurrency?: number;
  /** Log each message sent to the translation provider and each translation received, with timestamps. Default false. */
  debug?: boolean;
  /**
   * String attributes of custom components that hold UI copy, keyed by component name, for example
   * `{ Button: ["aria-label", "title"] }`. Only these attributes are extracted from those components.
   */
  componentProps?: Record<string, string[]>;
  /** Text of the block comment that marks a string literal for translation. Default `i18n`. */
  stringMarker?: string;
}

interface Reporter { info(message: string): void; warn(message: string): void; error(message: string): void }

interface ExtractionCacheEntry { hash: string; messages: ExtractedMessage[] }

function validateOptions(options: unknown): void {
  const result = z.safeParse(optionsSchema, options);
  if (result.success) return;
  const details = result.error.issues.map(issue => `${issue.path.join(".") || "options"}: ${issue.message}`).join("; ");
  throw new Error(`autoi18n: invalid options (${details}).`);
}

const reporterFor = (logger: Logger): Reporter => ({
  info: m => logger.info(m),
  warn: m => logger.warn(m),
  error: m => logger.error(m)
});

// Pre-merge builds wrote `<locale>.sources.json` next to `<locale>.json`. Nothing reads those files any more.
async function removeLegacySidecars(outDir: string, locales: string[]): Promise<void> {
  await Promise.all(locales.map(locale => rm(path.join(outDir, `${locale}.sources.json`), { force: true })));
}

export default function autoI18n(options: AutoI18nOptions): Plugin {
  validateOptions(options);
  resolveProvider(options.provider);
  const sourceLocale = options.sourceLocale ?? "en";
  const directory = options.directory ?? ".autoi18n";
  const delivery = options.delivery ?? "build";
  const debug = options.debug ?? false;
  const extractOptions = { componentProps: options.componentProps, stringMarker: options.stringMarker };
  const orphanRetentionMinutes = options.orphanRetentionMinutes ?? DEFAULT_ORPHAN_RETENTION_MINUTES;
  let config: ResolvedConfig;
  let registryFile = "";
  let catalogFiles: Record<string, string> = {};
  let extractions = new Map<string, ExtractionCacheEntry>();
  let fileMessages = new Map<string, ResolvedMessage[]>();
  let fileHashes = new Map<string, string>();
  let catalogs = new Map<string, Catalog>();
  const warnedFiles = new Set<string>();

  let server: ViteDevServer | undefined;
  let queue: Promise<void> = Promise.resolve();
  let watchTimer: ReturnType<typeof setTimeout> | undefined;
  const selectedLocale = (): string => options.locale ?? process.env.AUTOI18N_LOCALE ?? sourceLocale;

  // With build delivery and an explicit locale (for example one CI matrix job), only that catalogue is needed.
  function localesToTranslate(): string[] {
    const others = options.locales.filter(x => x !== sourceLocale);
    const explicit = options.locale ?? process.env.AUTOI18N_LOCALE;
    if (delivery === "build" && explicit && config.command !== "serve") return others.filter(x => x === explicit);
    return others;
  }

  // Re-indexes source files, translates only missing or stale messages and writes the catalogues.
  // With `changedFile` set (a hot update to an already indexed file), only that file is read again and the
  // rest reuse their cached extraction, so the project is not scanned on every save. Adding or removing
  // files, and the first build, use a full glob. In-memory state is swapped in before any
  // translation error is rethrown, so a transform never sees a half-updated index.
  async function sync(report: Reporter, changedFile?: string): Promise<void> {
    const provider = resolveProvider(options.provider, report.warn);
    const incremental = changedFile !== undefined && extractions.has(changedFile);
    const files = incremental
      ? [...extractions.keys()]
      : await glob(options.include ?? DEFAULT_INCLUDE, { cwd: config.root, ignore: options.exclude ?? DEFAULT_EXCLUDE, absolute: true });
    const nextExtractions = new Map<string, ExtractionCacheEntry>();
    const indexed: { file: string; messages: ExtractedMessage[] }[] = [];
    for (const file of files) {
      const cached = extractions.get(file);
      let entry: ExtractionCacheEntry;
      if (cached && incremental && file !== changedFile) {
        entry = cached;
      } else {
        const code = await readFile(file, "utf8");
        const hash = hashContent(code);
        entry = cached?.hash === hash ? cached : { hash, messages: extractMessages(code, file, extractOptions) };
      }
      nextExtractions.set(file, entry);
      indexed.push({ file, messages: entry.messages });
    }

    const outDir = path.resolve(config.root, directory, "locales");
    const locales = localesToTranslate();
    const previous = new Map<string, LocaleFile>();
    for (const locale of locales) previous.set(locale, await readLocaleFile(localeFilePath(outDir, locale), report.warn));

    const result = await buildCatalogs({
      files: indexed,
      registry: await loadRegistry(registryFile, report.warn),
      orphanRetentionMinutes,
      sourceLocale,
      locales,
      localeConcurrency: Math.max(1, Math.floor(options.localeConcurrency ?? 2)),
      previous,
      provider,
      debug
    });

    if (debug) for (const entry of result.pruned) debugLog(`removed ${entry.id} ${JSON.stringify(entry.source)} (last seen ${entry.lastSeen})`);
    if (result.pruned.length) report.info(`autoi18n: removed ${result.pruned.length} registry entries no longer in the source.`);
    await saveRegistry(registryFile, result.registry);
    if (result.ambiguous.length) {
      const message = `autoi18n: ${result.ambiguous.length} duplicated texts changed occurrence count, so their IDs may have moved (e.g. "${result.ambiguous[0]}").`;
      if (options.onAmbiguous === "error") report.error(message);
      else report.warn(message);
    }

    await writeLocaleFile(localeFilePath(outDir, sourceLocale), result.sourceFile);
    await removeLegacySidecars(outDir, [sourceLocale, ...options.locales]);

    const nextCatalogs = new Map<string, Catalog>([[sourceLocale, result.sourceFile.messages]]);
    for (const [locale, translation] of result.locales) {
      await writeLocaleFile(localeFilePath(outDir, locale), translation.file);
      nextCatalogs.set(locale, translation.file.messages);
    }
    // A failed locale keeps its previous file on disk, so the build keeps serving the previous text for it.
    for (const locale of result.failures.keys()) nextCatalogs.set(locale, previous.get(locale)?.messages ?? {});

    let offset = 0;
    fileMessages = new Map();
    for (const { file, messages } of indexed) {
      fileMessages.set(file, result.messages.slice(offset, offset + messages.length));
      offset += messages.length;
    }
    fileHashes = new Map([...nextExtractions].map(([file, entry]) => [file, entry.hash]));
    extractions = nextExtractions;
    catalogs = nextCatalogs;
    catalogFiles = Object.fromEntries(options.locales.map(locale => [locale, localeFilePath(outDir, locale)]));

    for (const [locale, translation] of result.locales) {
      if (translation.requested && !provider && options.failOnMissingProvider) {
        report.error(`Missing ${translation.requested} ${locale} translations and no provider is configured.`);
      }
      if (translation.rejected) report.info(`autoi18n: rejected ${translation.rejected} ${locale} translations with changed placeholders.`);
      if (translation.untranslated) {
        const log = provider ? report.warn : report.info;
        log(`autoi18n: ${translation.untranslated} ${locale} messages have no translation and fall back to the source text.`);
      }
      if (translation.failed) {
        report.warn(`autoi18n: ${translation.failed} ${locale} translation batches failed (${translation.failure}); they will be requested again on the next build.`);
      }
    }

    if (result.messages.length) report.info(`autoi18n: indexed ${result.messages.length} messages across ${files.length} files.`);

    // The successful locales are already written, so only the first failure is thrown; the rest are reported.
    const failures = [...result.failures];
    for (const [locale, error] of failures.slice(1)) report.warn(`autoi18n: ${locale} translation failed: ${(error as Error).message}`);
    if (failures.length) throw failures[0][1];
  }

  // Runs syncs one after another so overlapping saves cannot interleave writes or API calls.
  function runSync(report: Reporter, changedFile?: string): Promise<void> {
    const next = queue.then(() => sync(report, changedFile));
    queue = next.catch(() => undefined);
    return next;
  }

  function pushCatalogs(): void {
    server?.ws.send({ type: "custom", event: UPDATE_EVENT, data: { catalogs: Object.fromEntries(catalogs) } });
  }

  async function retranslate(changedFile?: string): Promise<void> {
    try {
      await runSync(reporterFor(config.logger), changedFile);
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
    const relative = path.relative(config.root, file).split(path.sep).join("/");
    return (options.include ?? DEFAULT_INCLUDE).some(p => path.matchesGlob(relative, p))
      && !(options.exclude ?? DEFAULT_EXCLUDE).some(p => path.matchesGlob(relative, p));
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
      if (hashContent(code) !== fileHashes.get(file)) {
        // The file changed after it was indexed, e.g. the watcher has not fired yet; re-index once.
        await runSync(reporterFor(config.logger), file);
      }
      const messages = fileMessages.get(file);
      if (!messages || hashContent(code) !== fileHashes.get(file)) {
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
      await retranslate(file);
    }
  };
}

export { PartialTranslationError } from "./errors.js";
export { FallbackProvider, resolveProvider } from "./ai/fallback.js";
export { OpenAICompatibleProvider } from "./ai/openai.js";
export type { OpenAICompatibleOptions } from "./ai/openai.js";
export { AnthropicProvider } from "./ai/anthropic.js";
export type { AnthropicOptions } from "./ai/anthropic.js";
export { GeminiProvider } from "./ai/gemini.js";
export type { GeminiOptions } from "./ai/gemini.js";
export type * from "./types.js";
