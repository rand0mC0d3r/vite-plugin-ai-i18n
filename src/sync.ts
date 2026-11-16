import { glob, readFile, rm } from "node:fs/promises";
import path from "node:path";

import type { Logger, ResolvedConfig } from "vite";

import { resolveProvider } from "./ai/fallback.js";
import { type ParsedSource, parseSource } from "./compiler/ast.js";
import { extractMessages } from "./compiler/extract.js";
import { buildCatalogs } from "./core/engine.js";
import { debugLog } from "./debug.js";
import { DEFAULT_ORPHAN_RETENTION_MINUTES } from "./identity/registry.js";
import { type LocaleFile, localeFilePath } from "./io/catalog.js";
import { hashContent } from "./io/files.js";
import { type ExtractionCacheEntry, IndexState, sameCatalog } from "./io/state.js";
import type { AutoI18nOptions } from "./options.js";
import type { Catalog, ExtractedMessage } from "./types.js";

/** Default source globs scanned for translatable text. */
const DEFAULT_INCLUDE = ["src/**/*.{tsx,jsx,ts,js}"];
/** Default globs skipped during scanning: tests and dependencies. */
const DEFAULT_EXCLUDE = ["**/*.test.*", "**/node_modules/**"];

/** Sink for build-time messages. Vite's logger and the plugin context's `info`/`warn`/`error` both satisfy this shape. */
export interface Reporter {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}
type BuildResult = Awaited<ReturnType<typeof buildCatalogs>>;

export const reporterFor = (logger: Logger): Reporter => ({
  info: (m) => logger.info(m),
  warn: (m) => logger.warn(m),
  error: (m) => logger.error(m),
});

// Pre-merge builds wrote `<locale>.sources.json` next to `<locale>.json`. Nothing reads those files any more.
async function removeLegacySidecars(outDir: string, locales: string[]): Promise<void> {
  await Promise.all(locales.map((locale) => rm(path.join(outDir, `${locale}.sources.json`), { force: true })));
}

/**
 * Owns the source index for one plugin instance: which files are extracted, which messages are translated, and what is
 * written to disk. Syncs run one at a time through `runSync`.
 */
export class Syncer {
  readonly sourceLocale: string;
  readonly delivery: "build" | "runtime";
  readonly state = new IndexState();
  /** Resolved once, so an invalid provider fails at startup. Fallback warnings go to the sync that is running. */
  private readonly provider: ReturnType<typeof resolveProvider>;
  private readonly directory: string;
  private readonly debug: boolean;
  private readonly extractOptions: { componentProps?: Record<string, string[]> };
  private readonly orphanRetentionMinutes: number;
  private readonly include: string[];
  private readonly exclude: string[];
  private activeReport: Reporter | undefined;
  private config!: ResolvedConfig;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly options: AutoI18nOptions) {
    this.sourceLocale = options.sourceLocale ?? "en";
    this.directory = options.directory ?? ".autoi18n";
    this.delivery = options.delivery ?? "build";
    this.debug = options.debug ?? false;
    this.extractOptions = {
      ...(options.componentProps !== undefined && { componentProps: options.componentProps }),
    };
    this.orphanRetentionMinutes = options.orphanRetentionMinutes ?? DEFAULT_ORPHAN_RETENTION_MINUTES;
    this.include = options.include ?? DEFAULT_INCLUDE;
    this.exclude = options.exclude ?? DEFAULT_EXCLUDE;
    this.provider = resolveProvider(options.provider, (message) => this.activeReport?.warn(message));
  }

  /** Called once Vite has resolved the config, before any sync runs. */
  attach(config: ResolvedConfig): void {
    this.config = config;
  }

  explicitLocale(): string | undefined {
    return this.options.locale ?? process.env["AUTOI18N_LOCALE"];
  }

  selectedLocale(): string {
    return this.explicitLocale() ?? this.sourceLocale;
  }

  localesDir(): string {
    return path.resolve(this.config.root, this.directory, "locales");
  }

  private registryFile(): string {
    return path.resolve(this.config.root, this.directory, "registry.json");
  }

  /** Whether a newly created file matches the configured `include` and `exclude` globs, relative to the Vite root. */
  isSourceCandidate(file: string): boolean {
    if (!/\.[jt]sx?$/.test(file)) return false;
    const relative = path.relative(this.config.root, file).split(path.sep).join("/");
    return (
      this.include.some((p) => path.matchesGlob(relative, p)) &&
      !this.exclude.some((p) => path.matchesGlob(relative, p))
    );
  }

  // With build delivery and an explicit locale (for example one CI matrix job), only that catalogue is needed.
  private localesToTranslate(): string[] {
    const others = this.options.locales.filter((x) => x !== this.sourceLocale);
    const explicit = this.explicitLocale();
    if (this.delivery === "build" && explicit !== undefined && explicit !== "" && this.config.command !== "serve")
      return others.filter((x) => x === explicit);
    return others;
  }

  // Node's glob resolves paths relative to `cwd`, so they are made absolute here.
  private async collectFiles(): Promise<string[]> {
    const found: string[] = [];
    for await (const file of glob(this.include, { cwd: this.config.root, exclude: this.exclude })) {
      found.push(path.resolve(this.config.root, file));
    }
    return found;
  }

  // Reads and extracts each file, reusing a cached extraction whose content hash is unchanged.
  private async extractFiles(files: string[], incremental: boolean, changedFile: string | undefined) {
    const nextExtractions = new Map<string, ExtractionCacheEntry>();
    const nextParsed = new Map<string, ParsedSource>();
    const indexed: { file: string; messages: ExtractedMessage[] }[] = [];
    for (const file of files) {
      const cached = this.state.extractions.get(file);
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
          entry = { hash, messages: extractMessages(code, file, this.extractOptions, parsed) };
          nextParsed.set(file, parsed);
        }
      }
      nextExtractions.set(file, entry);
      indexed.push({ file, messages: entry.messages });
    }
    return { nextExtractions, nextParsed, indexed };
  }

  // Logs the per-locale outcome of a build: missing providers, rejected, untranslated and failed messages.
  private reportLocales(report: Reporter, result: BuildResult): void {
    for (const [locale, translation] of result.locales) {
      if (translation.requested > 0 && !this.provider && this.options.failOnMissingProvider === true) {
        report.error(`Missing ${translation.requested} ${locale} translations and no provider is configured.`);
      }
      if (translation.rejected)
        report.info(`autoi18n: rejected ${translation.rejected} ${locale} translations with changed placeholders.`);
      if (translation.untranslated) {
        const log = this.provider ? report.warn : report.info;
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
  async sync(report: Reporter, changedFile?: string): Promise<string[]> {
    const state = this.state;
    const sourceLocale = this.sourceLocale;
    this.activeReport = report;
    const incremental = changedFile !== undefined && state.extractions.has(changedFile);
    const files = incremental ? [...state.extractions.keys()] : await this.collectFiles();
    const { nextExtractions, nextParsed, indexed } = await this.extractFiles(files, incremental, changedFile);

    const outDir = this.localesDir();
    const locales = this.localesToTranslate();
    const previous = new Map<string, LocaleFile>();
    for (const locale of locales)
      previous.set(locale, await state.readLocale(localeFilePath(outDir, locale), report.warn));

    const result = await buildCatalogs({
      files: indexed,
      registry: await state.readRegistry(this.registryFile(), report.warn),
      orphanRetentionMinutes: this.orphanRetentionMinutes,
      sourceLocale,
      locales,
      localeConcurrency: Math.max(1, Math.floor(this.options.localeConcurrency ?? 2)),
      previous,
      provider: this.provider,
      debug: this.debug,
    });

    if (this.debug)
      for (const entry of result.pruned)
        debugLog(`removed ${entry.id} ${JSON.stringify(entry.source)} (last seen ${entry.lastSeen})`);
    if (result.pruned.length)
      report.info(`autoi18n: removed ${result.pruned.length} registry entries no longer in the source.`);
    await state.writeRegistry(this.registryFile(), result.registry);
    if (result.ambiguous.length) {
      const message = `autoi18n: ${result.ambiguous.length} duplicated texts changed occurrence count, so their IDs may have moved (e.g. "${result.ambiguous[0]}").`;
      if (this.options.onAmbiguous === "error") report.error(message);
      else report.warn(message);
    }

    await state.writeLocale(localeFilePath(outDir, sourceLocale), result.sourceFile);
    // Sidecars from pre-merge builds only need deleting once; later syncs cannot recreate them.
    if (!state.legacySidecarsRemoved) {
      await removeLegacySidecars(outDir, [sourceLocale, ...this.options.locales]);
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
    state.catalogFiles = Object.fromEntries(
      this.options.locales.map((locale) => [locale, localeFilePath(outDir, locale)]),
    );

    this.reportLocales(report, result);

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
  runSync(report: Reporter, changedFile?: string): Promise<string[]> {
    const next = this.queue.then(() => this.sync(report, changedFile));
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}
