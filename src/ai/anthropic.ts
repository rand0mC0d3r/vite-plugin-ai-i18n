import * as v from "valibot";
import { BatchedProvider, systemPrompt, userContent, type BatchedProviderOptions, type TranslateInput } from "./base.js";
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
  protected async request(input: TranslateInput): Promise<Catalog> {
    const envelope = v.safeParse(anthropicMessageSchema, await this.post(
      `${this.options.baseURL ?? ANTHROPIC_BASE_URL}/messages`,
      { "x-api-key": this.options.apiKey, "anthropic-version": ANTHROPIC_VERSION },
      {
        model: this.options.model,
        max_tokens: this.options.maxTokens ?? 8192,
        system: systemPrompt(input),
        messages: [{ role: "user", content: userContent(input.messages) }]
      }
    ));
    return this.toCatalog(envelope.success ? envelope.output.content.filter(block => block.type === "text").map(block => block.text ?? "").join("") : undefined, input.messages);
  }
}
