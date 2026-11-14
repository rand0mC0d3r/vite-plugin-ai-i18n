import { ArkErrors } from "arktype";
import { BatchedProvider, systemPrompt, userContent, type BatchedProviderOptions, type TranslateInput } from "./base.js";
import { geminiResponseSchema } from "../schemas.js";
import type { Catalog } from "../types.js";
import { GEMINI_BASE_URL } from "../constants.js";

/** Options for the Gemini `generateContent` API. */
export interface GeminiOptions extends BatchedProviderOptions {
  apiKey: string;
  model: string;
  /** Overrides the API root, for example to target a proxy. */
  baseURL?: string;
  /** Maximum tokens the model may generate per batch. Default 8192. */
  maxOutputTokens?: number;
}

/**
 * Translates batches through the Gemini `generateContent` API. The system prompt goes in `systemInstruction`, and
 * `responseMimeType` requests JSON output.
 */
export class GeminiProvider extends BatchedProvider<GeminiOptions> {
  protected async request(input: TranslateInput): Promise<Catalog> {
    const envelope = geminiResponseSchema(await this.post(
      `${this.options.baseURL ?? GEMINI_BASE_URL}/models/${encodeURIComponent(this.options.model)}:generateContent`,
      { "x-goog-api-key": this.options.apiKey },
      {
        systemInstruction: { parts: [{ text: systemPrompt(input) }] },
        contents: [{ role: "user", parts: [{ text: userContent(input.messages) }] }],
        generationConfig: {
          responseMimeType: "application/json",
          maxOutputTokens: this.options.maxOutputTokens ?? 8192
        }
      }
    ));
    return this.toCatalog(envelope instanceof ArkErrors ? undefined : (envelope.candidates[0]?.content?.parts ?? []).map(part => part.text ?? "").join(""), input.messages);
  }
}
