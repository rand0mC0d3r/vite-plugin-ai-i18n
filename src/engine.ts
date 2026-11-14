import { mapWithConcurrency } from "./concurrency.js";
import { emptyLocaleFile, type LocaleFile } from "./catalog.js";
import { translateLocale, type LocaleTranslation } from "./translate.js";
import { pruneOrphans, reconcile } from "./identity/registry.js";
import type { Catalog, ExtractedMessage, Registry, RegistryEntry, ResolvedMessage, TranslationProvider } from "./types.js";

/** Inputs for {@link buildCatalogs}. */
export interface CatalogBuildInput {
  /** Messages extracted from each source file, in the order the files were found. */
  files: { file: string; messages: ExtractedMessage[] }[];
  /** Persisted ID registry from the previous run. It is copied, never modified in place. */
  registry: Registry;
  /** Minutes an orphaned registry entry is kept before it is pruned. */
  orphanRetentionMinutes: number;
  /** Language of the source strings. It is never translated. */
  sourceLocale: string;
  /** Locales to translate in this run. The source locale is never translated. */
  locales: string[];
  /** Locales translated in parallel. */
  localeConcurrency: number;
  /** The current contents of each locale file, keyed by locale. Missing locales start empty. */
  previous: Map<string, LocaleFile>;
  /** Without a provider, missing translations are not requested and stay untranslated. */
  provider?: TranslationProvider;
  /** Logs every message sent to and received from the provider. */
  debug: boolean;
}

/** Result of {@link buildCatalogs}. Nothing has been written to disk yet; the caller persists it. */
export interface CatalogBuildResult {
  /** The updated registry to persist, with reconciled IDs and orphans pruned. */
  registry: Registry;
  /** Sources whose duplicate count changed, so their IDs may have moved. */
  ambiguous: string[];
  /** Registry entries deleted because they were orphaned for longer than the retention period. */
  pruned: RegistryEntry[];
  /** Every extracted message with its resolved stable ID, in the same order as the input files. */
  messages: ResolvedMessage[];
  /** The source-locale catalogue: each ID mapped to its source text. */
  sourceFile: LocaleFile;
  /** Successful translations, keyed by locale. */
  locales: Map<string, LocaleTranslation>;
  /** Locales whose translation threw. Their previous file is left as it was. */
  failures: Map<string, unknown>;
}

/**
 * Pure build step: reconciles IDs with the registry, prunes orphans and translates the missing or stale messages
 * for each locale. It does no file IO and does not mutate its input, so the same inputs always produce the same catalogues
 * (apart from the IDs of newly seen messages, which are random).
 */
export async function buildCatalogs(input: CatalogBuildInput): Promise<CatalogBuildResult> {
  const registry = structuredClone(input.registry);
  const { ambiguous, messages } = reconcile(registry, input.files.flatMap(f => f.messages));
  const pruned = pruneOrphans(registry, input.orphanRetentionMinutes);

  const sourceCatalog: Catalog = {};
  for (const m of messages) sourceCatalog[m.id] = m.source;
  const requests = messages.map(m => ({ id: m.id, source: m.source, context: `${m.component} > ${m.context}`, kind: m.kind, placeholders: m.placeholders }));

  const outcomes = await mapWithConcurrency(input.locales, input.localeConcurrency, locale => translateLocale({
    provider: input.provider,
    sourceLocale: input.sourceLocale,
    locale,
    requests,
    previous: input.previous.get(locale) ?? emptyLocaleFile(),
    debug: input.debug
  }));

  const locales = new Map<string, LocaleTranslation>();
  const failures = new Map<string, unknown>();
  outcomes.forEach((outcome, index) => {
    const locale = input.locales[index];
    if (outcome.status === "fulfilled") locales.set(locale, outcome.value);
    else failures.set(locale, outcome.reason);
  });

  return {
    registry,
    ambiguous,
    pruned,
    messages,
    sourceFile: { messages: sourceCatalog, sources: {} },
    locales,
    failures
  };
}
