import type { TranslationProvider, TranslationRequest, Catalog } from "../types.js";

export interface OpenAICompatibleOptions {
  apiKey: string;
  model: string;
  baseURL?: string;
  /** Messages sent per request. Smaller batches keep responses within output limits. Default 40. */
  batchSize?: number;
  /** Abort a single request after this many milliseconds. Default 60000. */
  timeoutMs?: number;
  /** Extra attempts for network errors, timeouts, 408/409/429/5xx and malformed responses. Default 2. */
  maxRetries?: number;
  /** Base delay before a retry; doubles on each attempt. Default 500. */
  retryDelayMs?: number;
}

class ProviderError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export class OpenAICompatibleProvider implements TranslationProvider {
  constructor(private options: OpenAICompatibleOptions) {}

  async translate(input: { sourceLocale: string; targetLocale: string; messages: TranslationRequest[] }): Promise<Catalog> {
    const batchSize = Math.max(1, this.options.batchSize ?? 40);
    const result: Catalog = {};
    for (let start = 0; start < input.messages.length; start += batchSize) {
      Object.assign(result, await this.translateBatch({ ...input, messages: input.messages.slice(start, start + batchSize) }));
    }
    return result;
  }

  private async translateBatch(input: { sourceLocale: string; targetLocale: string; messages: TranslationRequest[] }): Promise<Catalog> {
    const maxRetries = this.options.maxRetries ?? 2;
    const retryDelayMs = this.options.retryDelayMs ?? 500;
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.request(input);
      } catch (error) {
        // Errors thrown by fetch itself (network failure, timeout) are transient and retried.
        const retryable = !(error instanceof ProviderError) || error.retryable;
        if (!retryable || attempt >= maxRetries) throw error;
        await sleep(retryDelayMs * 2 ** attempt);
      }
    }
  }

  private async request(input: { sourceLocale: string; targetLocale: string; messages: TranslationRequest[] }): Promise<Catalog> {
    const response = await fetch(`${this.options.baseURL ?? "https://api.openai.com/v1"}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 60_000),
      headers: { Authorization: `Bearer ${this.options.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.options.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: `You are a professional software localization engine. Translate UI messages from ${input.sourceLocale} to ${input.targetLocale}. Preserve placeholders exactly. Respect context and UI conventions. Return ONLY a JSON object mapping message IDs to translated strings. Do not translate product names or code.` },
          { role: "user", content: JSON.stringify(input.messages.map(m => ({ id: m.id, text: m.source, context: m.context, kind: m.kind }))) }
        ]
      })
    });
    if (!response.ok) {
      const retryable = response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500;
      throw new ProviderError(`Translation API failed (${response.status}): ${await response.text()}`, retryable);
    }
    const json = await response.json() as any;
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content) throw new ProviderError("Translation provider returned no content", true);
    let parsed: unknown;
    try { parsed = JSON.parse(content); } catch { throw new ProviderError("Translation provider returned invalid JSON", true); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new ProviderError("Translation provider returned a non-object", true);
    // Keep only usable strings for the IDs that were requested; the caller decides what to do with the rest.
    const requested = new Set(input.messages.map(m => m.id));
    const result: Catalog = {};
    for (const [id, text] of Object.entries(parsed)) {
      if (requested.has(id) && typeof text === "string" && text.trim()) result[id] = text;
    }
    return result;
  }
}
