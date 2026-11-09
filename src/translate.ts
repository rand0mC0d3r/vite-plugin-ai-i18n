import { isUsableTranslation } from "./compiler/placeholders.js";
import { pruneCatalog, type LocaleFile } from "./catalog.js";
import { debugLog } from "./debug.js";
import { PartialTranslationError } from "./errors.js";
import type { Catalog, TranslationProvider, TranslationRequest } from "./types.js";

export interface LocaleTranslationInput {
  provider?: TranslationProvider;
  sourceLocale: string;
  locale: string;
  /** Every message that is currently active. Anything else in `previous` is pruned. */
  requests: TranslationRequest[];
  previous: LocaleFile;
  /** Logs every message sent to the provider and every translation received, with timestamps. */
  debug?: boolean;
}

export interface LocaleTranslation {
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
  failure?: string;
}

/**
 * Brings one locale up to date. Messages are re-requested when they are new or when their source text changed
 * under the same ID. Unusable translations are dropped so they are requested again later, and keys for messages
 * that are no longer active are removed. A partially failed request keeps the translations that did succeed.
 */
export async function translateLocale(input: LocaleTranslationInput): Promise<LocaleTranslation> {
  const { provider, sourceLocale, locale, requests, previous, debug } = input;
  const active = new Set(requests.map(x => x.id));
  const previousMessages = pruneCatalog(previous.messages, active).catalog;
  const previousSources = pruneCatalog(previous.sources, active).catalog;

  const missing = requests.filter(x => previousMessages[x.id] === undefined || previousSources[x.id] !== x.source);
  let translated: Catalog = {};
  let failed = 0;
  let failure: string | undefined;
  if (missing.length && provider) {
    if (debug) {
      for (const m of missing) debugLog(`sent ${sourceLocale} -> ${locale} ${m.id}: ${JSON.stringify(m.source)} (context: ${m.context})`);
    }
    try {
      translated = await provider.translate({ sourceLocale, targetLocale: locale, messages: missing });
    } catch (error) {
      if (!(error instanceof PartialTranslationError)) throw error;
      translated = error.partial;
      failed = error.failed;
      failure = error.message;
    }
    if (debug) {
      for (const m of missing) {
        const text = translated[m.id];
        debugLog(`received ${sourceLocale} -> ${locale} ${m.id}: ${typeof text === "string" ? JSON.stringify(text) : "(no translation)"}`);
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
    if (request.kind === "mixed" && !isUsableTranslation(text, request.placeholders ?? [])) { rejected++; continue; }
    messages[request.id] = text;
    sources[request.id] = request.source;
  }
  const untranslated = requests.filter(x => messages[x.id] === undefined).length;
  return { file: { messages, sources }, untranslated, rejected, requested: missing.length, failed, failure };
}
