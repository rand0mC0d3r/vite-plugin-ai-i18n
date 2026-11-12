import * as z from "zod/mini";
import { BatchedProvider, httpError, systemPrompt, userContent, type BatchedProviderOptions, type TranslateInput } from "./base.js";
import { chatCompletionSchema } from "../schemas.js";
import type { Catalog } from "../types.js";

export interface OpenAICompatibleOptions extends BatchedProviderOptions {
  apiKey: string;
  model: string;
  baseURL?: string;
}

export class OpenAICompatibleProvider extends BatchedProvider<OpenAICompatibleOptions> {
  protected async request(input: TranslateInput): Promise<Catalog> {
    const response = await fetch(`${this.options.baseURL ?? "https://api.openai.com/v1"}/chat/completions`, {
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
    const envelope = z.safeParse(chatCompletionSchema, await response.json());
    return this.toCatalog(envelope.success ? envelope.data.choices[0].message.content ?? undefined : undefined, input.messages);
  }
}
