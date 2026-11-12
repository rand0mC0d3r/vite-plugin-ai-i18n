import * as z from "zod/mini";
import { BatchedProvider, httpError, systemPrompt, userContent, type BatchedProviderOptions, type TranslateInput } from "./base.js";
import { anthropicMessageSchema } from "../schemas.js";
import type { Catalog } from "../types.js";

export interface AnthropicOptions extends BatchedProviderOptions {
  apiKey: string;
  model: string;
  baseURL?: string;
  /** Maximum tokens the model may generate per batch. Default 8192. */
  maxTokens?: number;
}

const ANTHROPIC_VERSION = "2023-06-01";

export class AnthropicProvider extends BatchedProvider<AnthropicOptions> {
  protected async request(input: TranslateInput): Promise<Catalog> {
    const response = await fetch(`${this.options.baseURL ?? "https://api.anthropic.com/v1"}/messages`, {
      method: "POST",
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 60_000),
      headers: {
        "x-api-key": this.options.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: this.options.model,
        max_tokens: this.options.maxTokens ?? 8192,
        system: systemPrompt(input),
        messages: [{ role: "user", content: userContent(input.messages) }]
      })
    });
    if (!response.ok) throw await httpError(response);
    const envelope = z.safeParse(anthropicMessageSchema, await response.json());
    const text = envelope.success ? envelope.data.content.filter(block => block.type === "text").map(block => block.text ?? "").join("") : "";
    // Claude sometimes wraps JSON in a Markdown code fence even when told not to.
    return this.toCatalog(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "") || undefined, input.messages);
  }
}
