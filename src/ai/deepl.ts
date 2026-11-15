import { ArkErrors } from "arktype";
import { BatchedProvider, ProviderError, type BatchedProviderOptions, type TranslateInput } from "./base.js";
import { alignedCatalog, protectText } from "./machine.js";
import { deeplResponseSchema } from "../schemas.js";
import type { Catalog } from "../types.js";
import { DEEPL_BASE_URL, DEEPL_FREE_BASE_URL } from "../constants.js";

/** Options for the DeepL `/v2/translate` API. */
export interface DeepLOptions extends BatchedProviderOptions {
  /** DeepL auth key. Keys ending in `:fx` are Free keys and use the Free API host. */
  apiKey: string;
  /** Overrides the API root, for example to target a proxy. */
  baseURL?: string;
}

const WRAP_OPEN = "<x>";
const WRAP_CLOSE = "</x>";

/** DeepL target codes: plain `EN` and `PT` are rejected as targets, so they map to a regional variant. */
function targetLang(locale: string): string {
  const [lang, region] = locale.split(/[-_]/);
  const upper = lang.toUpperCase();
  if (upper === "EN") return region ? `EN-${region.toUpperCase()}` : "EN-US";
  if (upper === "PT") return region ? `PT-${region.toUpperCase()}` : "PT-BR";
  return upper;
}

/**
 * Translates batches through DeepL. Placeholders are wrapped in `<x>` tags and `tag_handling: "xml"` with
 * `ignore_tags: ["x"]` keeps them intact. Each entry in the reply lines up with the request order.
 */
export class DeepLProvider extends BatchedProvider<DeepLOptions> {
  protected async request(input: TranslateInput): Promise<Catalog> {
    const base = this.options.baseURL ?? (this.options.apiKey.endsWith(":fx") ? DEEPL_FREE_BASE_URL : DEEPL_BASE_URL);
    const data = await this.post(
      `${base}/v2/translate`,
      { authorization: `DeepL-Auth-Key ${this.options.apiKey}` },
      {
        text: input.messages.map(m => protectText(m.source, WRAP_OPEN, WRAP_CLOSE)),
        source_lang: input.sourceLocale.split(/[-_]/)[0].toUpperCase(),
        target_lang: targetLang(input.targetLocale),
        tag_handling: "xml",
        ignore_tags: ["x"]
      }
    );
    const parsed = deeplResponseSchema(data);
    if (parsed instanceof ArkErrors) throw new ProviderError("DeepL returned an unexpected response", true);
    return alignedCatalog(input.messages, parsed.translations.map(t => t.text), WRAP_OPEN, WRAP_CLOSE);
  }
}
