import type { Logger, Plugin, ResolvedConfig, ViteDevServer } from "vite";
import { ArkErrors } from "arktype";
import { glob, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { debugLog } from "./debug.js";
import { buildCatalogs } from "./engine.js";
import { extractMessages } from "./compiler/extract.js";
import { parseSource, type ParsedSource } from "./compiler/ast.js";
import { transformSource } from "./compiler/transform.js";
import { localeFilePath, type LocaleFile } from "./catalog.js";
import {
  DEFAULT_EXCLUDE,
  DEFAULT_INCLUDE,
  DEFAULT_ORPHAN_RETENTION_MINUTES,
  FORMAT_LIBRARY,
  FORMAT_MODULE,
  RUNTIME_MODULE,
  UPDATE_EVENT,
  WATCH_DEBOUNCE_MS,
} from "./constants.js";
import { hashContent } from "./io.js";
import { createFormatModule } from "./runtime/format.js";
import { createRuntimeModule } from "./runtime/virtual.js";
import { optionsSchema } from "./schemas.js";
import { IndexState, sameCatalog, type ExtractionCacheEntry } from "./state.js";
import type { Catalog, ExtractedMessage, ProviderConfig } from "./types.js";
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
   * Locales translated at the same time. Default 2. The provider's `concurrency` option caps the batches in
   * flight across all locales, so the total number of parallel requests does not multiply with this value.
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

/** Sink for build-time messages. Vite's logger and the plugin context's `info`/`warn`/`error` both satisfy this shape. */
interface Reporter {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}
type BuildResult = Awaited<ReturnType<typeof buildCatalogs>>;

/** Throws a single error listing every invalid option, so a misconfigured plugin fails at startup. */
function validateOptions(options: unknown): void {
  const result = optionsSchema(options);
  if (!(result instanceof ArkErrors)) return;
  const details = result.map((issue) => `${issue.path.join(".") || "options"}: ${issue.message}`).join("; ");
  throw new Error(`autoi18n: invalid options (${details}).`);
}

const reporterFor = (logger: Logger): Reporter => ({
  info: (m) => logger.info(m),
  warn: (m) => logger.warn(m),
  error: (m) => logger.error(m),
});

// Pre-merge builds wrote `<locale>.sources.json` next to `<locale>.json`. Nothing reads those files any more.
async function removeLegacySidecars(outDir: string, locales: string[]): Promise<void> {
  await Promise.all(locales.map((locale) => rm(path.join(outDir, `${locale}.sources.json`), { force: true })));
}

/**
 * Vite plugin that extracts translatable strings from source files, translates them and serves the catalogues.
 * Options are validated and the provider is resolved immediately, so a bad configuration throws before the build starts.
 *
 * @example
 * ```ts
 * import autoI18n from "vite-plugin-ai-i18n";
 * export default defineConfig({ plugins: [autoI18n({ locales: ["en", "de"] })] });
 * ```
 */
export default function autoI18n(options: AutoI18nOptions): Plugin {
  validateOptions(options);
  const sourceLocale = options.sourceLocale ?? "en";
  const directory = options.directory ?? ".autoi18n";
  const delivery = options.delivery ?? "build";
  const debug = options.debug ?? false;
  const extractOptions = { componentProps: options.componentProps, stringMarker: options.stringMarker };
  const orphanRetentionMinutes = options.orphanRetentionMinutes ?? DEFAULT_ORPHAN_RETENTION_MINUTES;
  // Resolved once, so an invalid provider fails at startup. Fallback warnings go to the sync that is running.
  let activeReport: Reporter | undefined;
  const provider = resolveProvider(options.provider, (message) => activeReport?.warn(message));
  let config: ResolvedConfig;
  let registryFile = "";
  const state = new IndexState();

  let server: ViteDevServer | undefined;
  let queue: Promise<void> = Promise.resolve();
  let watchTimer: ReturnType<typeof setTimeout> | undefined;
  const explicitLocale = (): string | undefined => options.locale ?? process.env.AUTOI18N_LOCALE;
  const selectedLocale = (): string => explicitLocale() ?? sourceLocale;
  const localesDir = (): string => path.resolve(config.root, directory, "locales");
  const include = options.include ?? DEFAULT_INCLUDE;
  const exclude = options.exclude ?? DEFAULT_EXCLUDE;

  // With build delivery and an explicit locale (for example one CI matrix job), only that catalogue is needed.
  function localesToTranslate(): string[] {
    const others = options.locales.filter((x) => x !== sourceLocale);
    const explicit = explicitLocale();
    if (delivery === "build" && explicit && config.command !== "serve") return others.filter((x) => x === explicit);
    return others;
  }

  // Node's glob resolves paths relative to `cwd`, so they are made absolute here.
  async function collectFiles(): Promise<string[]> {
    const found: string[] = [];
    for await (const file of glob(include, { cwd: config.root, exclude })) {
      found.push(path.resolve(config.root, file));
    }
    return found;
  }

  // Reads and extracts each file, reusing a cached extraction whose content hash is unchanged.
  async function extractFiles(files: string[], incremental: boolean, changedFile: string | undefined) {
    const nextExtractions = new Map<string, ExtractionCacheEntry>();
    const nextParsed = new Map<string, ParsedSource>();
    const indexed: { file: string; messages: ExtractedMessage[] }[] = [];
    for (const file of files) {
      const cached = state.extractions.get(file);
      let entry: ExtractionCacheEntry;
      if (cached && incremental && file !== changedFile) {
        entry = cached;
      } else {
        const code = await readFile(file, "utf8");
        const hash = hashContent(code);
        if (cached?.hash === hash) {
          entry = cached;
        } else {
          const parsed = parseSource(code, file);
          entry = { hash, messages: extractMessages(code, file, extractOptions, parsed) };
          nextParsed.set(file, parsed);
        }
      }
      nextExtractions.set(file, entry);
      indexed.push({ file, messages: entry.messages });
    }
    return { nextExtractions, nextParsed, indexed };
  }

  // Logs the per-locale outcome of a build: missing providers, rejected, untranslated and failed messages.
  function reportLocales(report: Reporter, result: BuildResult): void {
    for (const [locale, translation] of result.locales) {
      if (translation.requested && !provider && options.failOnMissingProvider) {
        report.error(`Missing ${translation.requested} ${locale} translations and no provider is configured.`);
      }
      if (translation.rejected)
        report.info(`autoi18n: rejected ${translation.rejected} ${locale} translations with changed placeholders.`);
      if (translation.untranslated) {
        const log = provider ? report.warn : report.info;
        log(
          `autoi18n: ${translation.untranslated} ${locale} messages have no translation and fall back to the source text.`,
        );
      }
      if (translation.failed) {
        report.warn(
          `autoi18n: ${translation.failed} ${locale} translation batches failed (${translation.failure}); they will be requested again on the next build.`,
        );
      }
    }
  }

  // Re-indexes source files, translates only missing or stale messages and writes the catalogues.
  // With `changedFile` set (a hot update to an already indexed file), only that file is read again and the
  // rest reuse their cached extraction, so the project is not scanned on every save. Adding or removing
  // files, and the first build, use a full glob. In-memory state is swapped in before any
  // translation error is rethrown, so a transform never sees a half-updated index.
  async function sync(report: Reporter, changedFile?: string): Promise<string[]> {
    activeReport = report;
    const incremental = changedFile !== undefined && state.extractions.has(changedFile);
    const files = incremental ? [...state.extractions.keys()] : await collectFiles();
    const { nextExtractions, nextParsed, indexed } = await extractFiles(files, incremental, changedFile);

    const outDir = localesDir();
    const locales = localesToTranslate();
    const previous = new Map<string, LocaleFile>();
    for (const locale of locales)
      previous.set(locale, await state.readLocale(localeFilePath(outDir, locale), report.warn));

    const result = await buildCatalogs({
      files: indexed,
      registry: await state.readRegistry(registryFile, report.warn),
      orphanRetentionMinutes,
      sourceLocale,
      locales,
      localeConcurrency: Math.max(1, Math.floor(options.localeConcurrency ?? 2)),
      previous,
      provider,
      debug,
    });

    if (debug)
      for (const entry of result.pruned)
        debugLog(`removed ${entry.id} ${JSON.stringify(entry.source)} (last seen ${entry.lastSeen})`);
    if (result.pruned.length)
      report.info(`autoi18n: removed ${result.pruned.length} registry entries no longer in the source.`);
    await state.writeRegistry(registryFile, result.registry);
    if (result.ambiguous.length) {
      const message = `autoi18n: ${result.ambiguous.length} duplicated texts changed occurrence count, so their IDs may have moved (e.g. "${result.ambiguous[0]}").`;
      if (options.onAmbiguous === "error") report.error(message);
      else report.warn(message);
    }

    await state.writeLocale(localeFilePath(outDir, sourceLocale), result.sourceFile);
    // Sidecars from pre-merge builds only need deleting once; later syncs cannot recreate them.
    if (!state.legacySidecarsRemoved) {
      await removeLegacySidecars(outDir, [sourceLocale, ...options.locales]);
      state.legacySidecarsRemoved = true;
    }

    const nextCatalogs = new Map<string, Catalog>([[sourceLocale, result.sourceFile.messages]]);
    for (const [locale, translation] of result.locales) {
      await state.writeLocale(localeFilePath(outDir, locale), translation.file);
      nextCatalogs.set(locale, translation.file.messages);
    }
    // A failed locale keeps its previous file on disk, so the build keeps serving the previous text for it.
    for (const locale of result.failures.keys()) nextCatalogs.set(locale, previous.get(locale)?.messages ?? {});
    const changed = [...nextCatalogs]
      .filter(([locale, messages]) => !sameCatalog(state.catalogs.get(locale), messages))
      .map(([locale]) => locale);

    let offset = 0;
    state.fileMessages = new Map();
    for (const { file, messages } of indexed) {
      state.fileMessages.set(file, result.messages.slice(offset, offset + messages.length));
      offset += messages.length;
    }
    state.extractions = nextExtractions;
    state.parsedSources = nextParsed;
    state.catalogs = nextCatalogs;
    state.catalogFiles = Object.fromEntries(options.locales.map((locale) => [locale, localeFilePath(outDir, locale)]));

    reportLocales(report, result);

    if (result.messages.length)
      report.info(`autoi18n: indexed ${result.messages.length} messages across ${files.length} files.`);

    // The successful locales are already written, so only the first failure is thrown; the rest are reported.
    const failures = [...result.failures];
    for (const [locale, error] of failures.slice(1))
      report.warn(`autoi18n: ${locale} translation failed: ${(error as Error).message}`);
    if (failures.length) throw failures[0][1];
    return changed;
  }

  // Runs syncs one after another so overlapping saves cannot interleave writes or API calls.
  function runSync(report: Reporter, changedFile?: string): Promise<string[]> {
    const next = queue.then(() => sync(report, changedFile));
    queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  /** Sends the catalogues that changed to the browser over HMR, so a dev page updates without a reload. */
  function pushCatalogs(locales: string[]): void {
    if (!locales.length) return;
    server?.ws.send({
      type: "custom",
      event: UPDATE_EVENT,
      data: { catalogs: Object.fromEntries(locales.map((locale) => [locale, state.catalogs.get(locale)])) },
    });
  }

  /** Runs a sync and pushes the result to the browser. Errors are logged, not thrown, because this runs from a watcher. */
  async function retranslate(changedFile?: string): Promise<void> {
    try {
      pushCatalogs(await runSync(reporterFor(config.logger), changedFile));
    } catch (error) {
      config.logger.error(`autoi18n: re-translation failed: ${(error as Error).message}`);
    }
  }

  // A burst of added or removed files (for example a git checkout) causes one re-index instead of one per file.
  function scheduleRetranslate(): void {
    clearTimeout(watchTimer);
    watchTimer = setTimeout(() => void retranslate(), WATCH_DEBOUNCE_MS);
  }

  /** Whether a newly created file matches the configured `include` and `exclude` globs, relative to the Vite root. */
  function isSourceCandidate(file: string): boolean {
    if (!/\.[jt]sx?$/.test(file)) return false;
    const relative = path.relative(config.root, file).split(path.sep).join("/");
    return include.some((p) => path.matchesGlob(relative, p)) && !exclude.some((p) => path.matchesGlob(relative, p));
  }

  return {
    name: "vite-plugin-autoi18n",
    enforce: "pre",
    configResolved(resolved) {
      config = resolved;
      registryFile = path.resolve(config.root, directory, "registry.json");
      const selected = selectedLocale();
      if (selected !== sourceLocale && !options.locales.includes(selected)) {
        throw new Error(
          `autoi18n: locale "${selected}" is not one of the configured locales (${options.locales.join(", ")}).`,
        );
      }
    },
    resolveId(id, importer) {
      if (id === RUNTIME_MODULE) return `\0${RUNTIME_MODULE}`;
      if (id === FORMAT_MODULE) return `\0${FORMAT_MODULE}`;
      // The app does not install the formatting library, so it is resolved from this plugin's dependencies.
      if (importer === `\0${FORMAT_MODULE}` && id === FORMAT_LIBRARY)
        return this.resolve(id, fileURLToPath(import.meta.url), { skipSelf: true });
    },
    load(id) {
      if (id === `\0${RUNTIME_MODULE}`) return createRuntimeModule(state.catalogFiles, sourceLocale);
      if (id === `\0${FORMAT_MODULE}`) return createFormatModule();
    },
    configureServer(devServer) {
      server = devServer;
      // Adding or removing a file cannot go through handleHotUpdate, so re-index here.
      devServer.watcher.on("add", (file) => {
        if (isSourceCandidate(file)) scheduleRetranslate();
      });
      devServer.watcher.on("unlink", (file) => {
        if (state.fileMessages.has(file)) scheduleRetranslate();
      });
    },
    closeBundle() {
      clearTimeout(watchTimer);
    },
    async buildStart() {
      await sync({ info: (m) => this.info(m), warn: (m) => this.warn(m), error: (m) => this.error(m) });
    },
    async transform(code, id) {
      const file = id.split("?")[0];
      if (!state.fileMessages.has(file)) return null;
      // Hashed once: the same hash decides whether the index is stale and whether the messages still fit this code.
      const codeHash = hashContent(code);
      if (codeHash !== state.hashOf(file)) {
        // The file changed after it was indexed, e.g. the watcher has not fired yet; re-index once.
        await runSync(reporterFor(config.logger), file);
      }
      const messages = state.fileMessages.get(file);
      if (!messages || codeHash !== state.hashOf(file)) {
        if (!state.warnedFiles.has(file)) {
          state.warnedFiles.add(file);
          this.warn(`autoi18n: ${file} changed while it was being indexed; its messages are left untranslated.`);
        }
        return null;
      }
      const locale = config.command === "serve" ? sourceLocale : selectedLocale();
      // The AST is only reused while the code still matches the indexed hash, so it describes the same text.
      const parsed = state.parsedSources.get(file);
      state.parsedSources.delete(file);
      const result = transformSource(
        code,
        file,
        messages,
        locale,
        state.catalogs.get(locale) ?? {},
        delivery === "runtime",
        sourceLocale,
        parsed,
      );
      return { code: result.code, map: result.map };
    },
    async handleHotUpdate({ file }) {
      // Catalogue writes must not trigger a reload; the new data is pushed over the custom event instead.
      if (file.startsWith(localesDir() + path.sep)) return [];
      if (!state.fileMessages.has(file)) return;
      await retranslate(file);
    },
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
export { DeepLProvider } from "./ai/deepl.js";
export type { DeepLOptions } from "./ai/deepl.js";
export { GoogleTranslateProvider } from "./ai/google.js";
export type { GoogleTranslateOptions } from "./ai/google.js";
export { HostedService, LocalService, MachineService, hosted, local, machine } from "./ai/presets.js";
export * from "./locales.js";
export type * from "./types.js";
