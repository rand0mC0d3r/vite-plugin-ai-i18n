import * as v from "valibot";
import { BatchedProvider, httpError, systemPrompt, userContent, type BatchedProviderOptions, type TranslateInput } from "./base.js";
import { chatCompletionSchema } from "../schemas.js";
import type { Catalog } from "../types.js";
import { OPENAI_BASE_URL } from "../constants.js";

/** Options for an OpenAI or OpenAI-compatible chat completions endpoint. */
export interface OpenAICompatibleOptions extends BatchedProviderOptions {
  apiKey: string;
  model: string;
  /** Overrides the API root, for example to target a proxy or a self-hosted compatible server. */
  baseURL?: string;
}

/**
 * Translates batches through the `/chat/completions` endpoint. Requests use JSON mode so the reply is a parseable
 * object of translations.
 */
export class OpenAICompatibleProvider extends BatchedProvider<OpenAICompatibleOptions> {
  protected async request(input: TranslateInput): Promise<Catalog> {
    const response = await fetch(`${this.options.baseURL ?? OPENAI_BASE_URL}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 60_000),
      headers: { Authorization: `Bearer ${this.options.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.options.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt(input) },
          { role: "user", content: userContent(input.messages) }
        ]
      })
    });
    if (!response.ok) throw await httpError(response);
    const envelope = v.safeParse(chatCompletionSchema, await response.json());
    return this.toCatalog(envelope.success ? envelope.output.choices[0].message.content ?? undefined : undefined, input.messages);
  }
}
