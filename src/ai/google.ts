import { ArkErrors } from "arktype";
import { BatchedProvider, ProviderError, type BatchedProviderOptions, type TranslateInput } from "./base.js";
import { alignedCatalog, protectText } from "./machine.js";
import { googleTranslateResponseSchema } from "../schemas.js";
import type { Catalog } from "../types.js";
import { GOOGLE_TRANSLATE_BASE_URL } from "../constants.js";

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
    const parsed = googleTranslateResponseSchema(data);
    if (parsed instanceof ArkErrors) throw new ProviderError("Google Translate returned an unexpected response", true);
    return alignedCatalog(
      input.messages,
      parsed.data.translations.map((t) => t.translatedText),
      WRAP_OPEN,
      WRAP_CLOSE,
    );
  }
}
