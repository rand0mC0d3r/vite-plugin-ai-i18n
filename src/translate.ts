import { isUsableTranslation } from "./compiler/placeholders.js";
import type { Catalog, TranslationProvider, TranslationRequest } from "./types.js";

export interface LocaleTranslationInput {
  provider?: TranslationProvider;
  sourceLocale: string;
  locale: string;
  requests: TranslationRequest[];
  previous: Catalog;
  previousSources: Catalog;
  /** Logs every message sent to the provider and every translation received, with timestamps. */
  debug?: boolean;
}

export interface LocaleTranslation {
  catalog: Catalog;
  sources: Catalog;
  /** Messages that had no usable translation after this run, so they show the source text. */
  untranslated: number;
  /** Messages whose translation was dropped for changing placeholders. */
  rejected: number;
  /** Messages that needed a translation this run. */
  requested: number;
}

const debugLog = (message: string): void => console.log(`[autoi18n debug] ${new Date().toISOString()} ${message}`);

/**
 * Brings one locale's catalogue up to date. Messages are re-requested when they are new or when their
 * source text changed under the same ID. Unusable translations are dropped so they are requested again later.
 */
export async function translateLocale(input: LocaleTranslationInput): Promise<LocaleTranslation> {
  const { provider, sourceLocale, locale, requests, previous, previousSources, debug } = input;
  const missing = requests.filter(x => previous[x.id] === undefined || previousSources[x.id] !== x.source);
  let translated: Catalog = {};
  if (missing.length && provider) {
    if (debug) {
      for (const m of missing) debugLog(`sent ${sourceLocale} -> ${locale} ${m.id}: ${JSON.stringify(m.source)} (context: ${m.context})`);
    }
    translated = await provider.translate({ sourceLocale, targetLocale: locale, messages: missing });
    if (debug) {
      for (const m of missing) {
        const text = translated[m.id];
        debugLog(`received ${sourceLocale} -> ${locale} ${m.id}: ${typeof text === "string" ? JSON.stringify(text) : "(no translation)"}`);
      }
    }
  }

  const catalog: Catalog = { ...previous };
  const sources: Catalog = { ...previousSources };
  let rejected = 0;
  for (const request of missing) {
    delete catalog[request.id];
    delete sources[request.id];
    const text = translated[request.id];
    if (typeof text !== "string" || !text.trim()) continue;
    if (request.kind === "mixed" && !isUsableTranslation(text, request.placeholders ?? [])) { rejected++; continue; }
    catalog[request.id] = text;
    sources[request.id] = request.source;
  }
  const untranslated = requests.filter(x => catalog[x.id] === undefined).length;
  return { catalog, sources, untranslated, rejected, requested: missing.length };
}
