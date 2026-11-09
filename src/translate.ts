import { isUsableTranslation } from "./compiler/placeholders.js";
import type { Catalog, TranslationProvider, TranslationRequest } from "./types.js";

export interface LocaleTranslationInput {
  provider?: TranslationProvider;
  sourceLocale: string;
  locale: string;
  requests: TranslationRequest[];
  previous: Catalog;
  previousSources: Catalog;
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

/**
 * Brings one locale's catalogue up to date. Messages are re-requested when they are new or when their
 * source text changed under the same ID. Unusable translations are dropped so they are requested again later.
 */
export async function translateLocale(input: LocaleTranslationInput): Promise<LocaleTranslation> {
  const { provider, sourceLocale, locale, requests, previous, previousSources } = input;
  const missing = requests.filter(x => previous[x.id] === undefined || previousSources[x.id] !== x.source);
  let translated: Catalog = {};
  if (missing.length && provider) {
    translated = await provider.translate({ sourceLocale, targetLocale: locale, messages: missing });
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
