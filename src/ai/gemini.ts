import * as v from "valibot";
import { BatchedProvider, httpError, systemPrompt, userContent, type BatchedProviderOptions, type TranslateInput } from "./base.js";
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
  /** Sends one batch and parses the first candidate's text; a surrounding Markdown code fence is stripped first. */
  protected async request(input: TranslateInput): Promise<Catalog> {
    const base = this.options.baseURL ?? GEMINI_BASE_URL;
    const response = await fetch(`${base}/models/${encodeURIComponent(this.options.model)}:generateContent`, {
      method: "POST",
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 60_000),
      headers: {
        "x-goog-api-key": this.options.apiKey,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt(input) }] },
        contents: [{ role: "user", parts: [{ text: userContent(input.messages) }] }],
        generationConfig: {
          responseMimeType: "application/json",
          maxOutputTokens: this.options.maxOutputTokens ?? 8192
        }
      })
    });
    if (!response.ok) throw await httpError(response);
    const envelope = v.safeParse(geminiResponseSchema, await response.json());
    const text = envelope.success
      ? (envelope.output.candidates[0]?.content?.parts ?? []).map(part => part.text ?? "").join("")
      : "";
    return this.toCatalog(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "") || undefined, input.messages);
  }
}
