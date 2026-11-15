import { geminiResponseSchema } from "../schemas.js";
import type { Catalog } from "../types.js";
import {
  BatchedProvider,
  type BatchedProviderOptions,
  systemPrompt,
  type TranslateInput,
  userContent,
} from "./base.js";

/** Default API endpoint for the Gemini generateContent API. */
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";


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
    return this.complete(
      `${this.options.baseURL ?? GEMINI_BASE_URL}/models/${encodeURIComponent(this.options.model)}:generateContent`,
      { "x-goog-api-key": this.options.apiKey },
      {
        systemInstruction: { parts: [{ text: systemPrompt(input) }] },
        contents: [{ role: "user", parts: [{ text: userContent(input.messages) }] }],
        generationConfig: {
          responseMimeType: "application/json",
          maxOutputTokens: this.options.maxOutputTokens ?? 8192,
        },
      },
      geminiResponseSchema,
      (envelope) => (envelope.candidates[0]?.content?.parts ?? []).map((part) => part.text ?? "").join(""),
      input,
    );
  }
}
