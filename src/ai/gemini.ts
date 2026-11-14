import * as z from "zod/mini";
import { BatchedProvider, httpError, systemPrompt, userContent, type BatchedProviderOptions, type TranslateInput } from "./base.js";
import { geminiResponseSchema } from "../schemas.js";
import type { Catalog } from "../types.js";
import { GEMINI_BASE_URL } from "../constants.js";

export interface GeminiOptions extends BatchedProviderOptions {
  apiKey: string;
  model: string;
  baseURL?: string;
  /** Maximum tokens the model may generate per batch. Default 8192. */
  maxOutputTokens?: number;
}

export class GeminiProvider extends BatchedProvider<GeminiOptions> {
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
    const envelope = z.safeParse(geminiResponseSchema, await response.json());
    const text = envelope.success
      ? (envelope.data.candidates[0]?.content?.parts ?? []).map(part => part.text ?? "").join("")
      : "";
    return this.toCatalog(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "") || undefined, input.messages);
  }
}
