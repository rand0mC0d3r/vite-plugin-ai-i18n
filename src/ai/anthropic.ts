import * as v from "valibot";
import { BatchedProvider, httpError, systemPrompt, userContent, type BatchedProviderOptions, type TranslateInput } from "./base.js";
import { anthropicMessageSchema } from "../schemas.js";
import type { Catalog } from "../types.js";
import { ANTHROPIC_BASE_URL, ANTHROPIC_VERSION } from "../constants.js";

/** Options for the Anthropic Messages API. */
export interface AnthropicOptions extends BatchedProviderOptions {
  apiKey: string;
  model: string;
  /** Overrides the API root, for example to target a proxy. */
  baseURL?: string;
  /** Maximum tokens the model may generate per batch. Default 8192. */
  maxTokens?: number;
}

/**
 * Translates batches through the Anthropic Messages API. The reply's text blocks are joined before parsing.
 */
export class AnthropicProvider extends BatchedProvider<AnthropicOptions> {
  /** Sends one batch and parses the model's text reply; a surrounding Markdown code fence is stripped first. */
  protected async request(input: TranslateInput): Promise<Catalog> {
    const response = await fetch(`${this.options.baseURL ?? ANTHROPIC_BASE_URL}/messages`, {
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
    const envelope = v.safeParse(anthropicMessageSchema, await response.json());
    const text = envelope.success ? envelope.output.content.filter(block => block.type === "text").map(block => block.text ?? "").join("") : "";
    // Claude sometimes wraps JSON in a Markdown code fence even when told not to.
    return this.toCatalog(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "") || undefined, input.messages);
  }
}
