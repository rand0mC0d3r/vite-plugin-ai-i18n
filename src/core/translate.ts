import { debugLog } from "../debug.js";
import { PartialTranslationError } from "../errors.js";
import { isUsableTranslation } from "../icu.js";
import { type LocaleFile, pruneLocaleFile } from "../io/catalog.js";
import type { Catalog, TranslationProvider, TranslationRequest } from "../types.js";

/** Inputs for {@link translateLocale}, which brings a single target locale up to date. */
export interface LocaleTranslationInput {
  /** Without a provider, missing messages are left untranslated and reported as such. */
  provider?: TranslationProvider | undefined;
  /** Language the source strings are written in. */
  sourceLocale: string;
  /** Target locale to translate into. */
  locale: string;
  /** Every message that is currently active. Anything else in `previous` is pruned. */
  requests: TranslationRequest[];
  /** The locale file as it currently exists on disk. Its translations are reused when still valid. */
  previous: LocaleFile;
  /** Logs every message sent to the provider and every translation received, with timestamps. */
  debug?: boolean;
}

/** Result of {@link translateLocale}: the updated locale file plus counts for reporting. */
export interface LocaleTranslation {
  /** The updated locale file, to be written to disk. */
  file: LocaleFile;
  /** Messages that had no usable translation after this run, so they show the source text. */
  untranslated: number;
  /** Messages whose translation was dropped for changing placeholders. */
  rejected: number;
  /** Messages that needed a translation this run. */
  requested: number;
  /** Messages whose batch failed at the provider this run. They are requested again on the next build. */
  failed: number;
  /** The provider's error message for the failed batches, if any. */
  failure?: string | undefined;
}

/**
 * Brings one locale up to date. Messages are re-requested when they are new or when their source text changed under the
 * same ID. Unusable translations are dropped so they are requested again later, and keys for messages that are no
 * longer active are removed. A partially failed request keeps the translations that did succeed.
 */
export async function translateLocale(input: LocaleTranslationInput): Promise<LocaleTranslation> {
  const { provider, sourceLocale, locale, requests, previous, debug } = input;
  const active = new Set(requests.map((x) => x.id));
  const { messages: previousMessages, sources: previousSources } = pruneLocaleFile(previous, active).file;

  const missing = requests.filter((x) => !Object.hasOwn(previousMessages, x.id) || previousSources[x.id] !== x.source);
  let translated: Catalog = {};
  let failed = 0;
  let failure: string | undefined;
  if (missing.length && provider) {
    if (debug === true) {
      for (const m of missing)
        debugLog(`sent ${sourceLocale} -> ${locale} ${m.id}: ${JSON.stringify(m.source)} (context: ${m.context})`);
    }
    try {
      translated = await provider.translate({ sourceLocale, targetLocale: locale, messages: missing });
    } catch (error) {
      if (!(error instanceof PartialTranslationError)) throw error;
      translated = error.partial;
      failed = error.failed;
      failure = error.message;
    }
    if (debug === true) {
      for (const m of missing) {
        const text = translated[m.id];
        debugLog(
          `received ${sourceLocale} -> ${locale} ${m.id}: ${typeof text === "string" ? JSON.stringify(text) : "(no translation)"}`,
        );
      }
    }
  }

  const messages: Catalog = { ...previousMessages };
  const sources: Catalog = { ...previousSources };
  let rejected = 0;
  for (const request of missing) {
    delete messages[request.id];
    delete sources[request.id];
    const text = translated[request.id];
    if (typeof text !== "string" || !text.trim()) continue;
    if (request.kind === "mixed" && !isUsableTranslation(text, request.placeholders ?? [])) {
      rejected++;
      continue;
    }
    messages[request.id] = text;
    sources[request.id] = request.source;
  }
  const untranslated = requests.filter((x) => !Object.hasOwn(messages, x.id)).length;
  return { file: { messages, sources }, untranslated, rejected, requested: missing.length, failed, failure };
}
