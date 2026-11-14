import * as v from "valibot";
import { BatchedProvider, systemPrompt, userContent, type BatchedProviderOptions, type TranslateInput } from "./base.js";
import { chatCompletionSchema } from "../schemas.js";
import type { Catalog } from "../types.js";
import { OPENAI_BASE_URL } from "../constants.js";

/** Options for an OpenAI or OpenAI-compatible chat completions endpoint. */
export interface OpenAICompatibleOptions extends BatchedProviderOptions {
  /** Sent as a bearer token. Omit it for servers that need no key, such as a local Ollama. */
  apiKey?: string;
  model: string;
  /** API root. Defaults to OpenAI. Point it at any compatible service, for example `http://localhost:11434/v1` for Ollama. */
  baseURL?: string;
}

/**
 * Translates batches through the `/chat/completions` endpoint. Requests use JSON mode so the reply is a parseable
 * object of translations.
 */
export class OpenAICompatibleProvider extends BatchedProvider<OpenAICompatibleOptions> {
  protected async request(input: TranslateInput): Promise<Catalog> {
    const { apiKey, model, baseURL = OPENAI_BASE_URL } = this.options;
    const envelope = v.safeParse(chatCompletionSchema, await this.post(
      `${baseURL}/chat/completions`,
      apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      {
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt(input) },
          { role: "user", content: userContent(input.messages) }
        ]
      }
    ));
    return this.toCatalog(envelope.success ? envelope.output.choices[0].message.content ?? undefined : undefined, input.messages);
  }
}
