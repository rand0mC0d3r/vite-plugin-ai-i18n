import { googleTranslateResponseSchema } from "../schemas.js";
import type { Catalog, TranslateInput } from "../types.js";
import { BatchedProvider, type BatchedProviderOptions } from "./base.js";
import { alignedCatalog, parseReply, protectText } from "./machine-helpers.js";

/** Cloud Translation v2 endpoint root (the Basic edition). */
const GOOGLE_TRANSLATE_BASE_URL = "https://translation.googleapis.com/language/translate/v2";

/** Options for the Cloud Translation v2 (Basic) API. */
export interface GoogleTranslateOptions extends BatchedProviderOptions {
  apiKey: string;
  /** Overrides the endpoint, for example to target a proxy. */
  baseURL?: string;
}

const WRAP_OPEN = '<span translate="no">';
const WRAP_CLOSE = "</span>";

/**
 * Translates batches through Cloud Translation v2 in HTML mode. Placeholders are wrapped in `translate="no"` spans,
 * which Google leaves untranslated. The reply is index-aligned with the request.
 */
export class GoogleTranslateProvider extends BatchedProvider<GoogleTranslateOptions> {
  protected async request(input: TranslateInput): Promise<Catalog> {
    const data = await this.post(
      this.options.baseURL ?? GOOGLE_TRANSLATE_BASE_URL,
      { "x-goog-api-key": this.options.apiKey },
      {
        q: input.messages.map((m) => protectText(m.source, WRAP_OPEN, WRAP_CLOSE)),
        source: input.sourceLocale,
        target: input.targetLocale,
        format: "html",
      },
    );
    const parsed = parseReply(googleTranslateResponseSchema(data), "Google Translate");
    return alignedCatalog(
      input.messages,
      parsed.data.translations.map((t) => t.translatedText),
      WRAP_OPEN,
      WRAP_CLOSE,
    );
  }
}
