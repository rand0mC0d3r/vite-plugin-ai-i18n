import * as z from "zod/mini";
import { mapWithConcurrency } from "../concurrency.js";
import { PartialTranslationError } from "../errors.js";
import { chatCompletionSchema, translationMapSchema } from "../schemas.js";
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
  /** Base delay before a retry; doubles on each attempt and is jittered. A Retry-After header overrides it (max 60 s). Default 500. */
  retryDelayMs?: number;
  /** Batches sent in parallel. Default 4. */
  concurrency?: number;
}

const MAX_RETRY_AFTER_MS = 60_000;

class ProviderError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly retryAfterMs?: number) {
    super(message);
  }
}

/** Accepts both forms of Retry-After: delay in seconds, or an HTTP date. */
function parseRetryAfter(header: string | null, now = Date.now()): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.min(Math.max(seconds, 0) * 1000, MAX_RETRY_AFTER_MS);
  const date = Date.parse(header);
  if (Number.isNaN(date)) return undefined;
  return Math.min(Math.max(date - now, 0), MAX_RETRY_AFTER_MS);
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export class OpenAICompatibleProvider implements TranslationProvider {
  constructor(private options: OpenAICompatibleOptions) {}

  /**
   * Translates in parallel batches. If every batch fails, the first error is thrown. If only some fail,
   * a PartialTranslationError carries the translations that succeeded.
   */
  async translate(input: { sourceLocale: string; targetLocale: string; messages: TranslationRequest[] }): Promise<Catalog> {
    const batchSize = Math.max(1, this.options.batchSize ?? 40);
    const batches: TranslationRequest[][] = [];
    for (let start = 0; start < input.messages.length; start += batchSize) batches.push(input.messages.slice(start, start + batchSize));

    const settled = await mapWithConcurrency(batches, this.options.concurrency ?? 4, batch => this.translateBatch({ ...input, messages: batch }));
    const result: Catalog = {};
    const errors: unknown[] = [];
    let failed = 0;
    let succeeded = 0;
    settled.forEach((outcome, index) => {
      if (outcome.status === "fulfilled") {
        succeeded++;
        Object.assign(result, outcome.value);
      } else {
        errors.push(outcome.reason);
        failed += batches[index].length;
      }
    });
    if (!errors.length) return result;
    if (!succeeded) throw errors[0];
    throw new PartialTranslationError(`${failed} messages failed to translate: ${(errors[0] as Error).message}`, result, failed);
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
        // Jitter spreads out parallel batches that failed together; the server's Retry-After wins when given.
        const retryAfterMs = error instanceof ProviderError ? error.retryAfterMs : undefined;
        await sleep(retryAfterMs ?? retryDelayMs * 2 ** attempt * (0.5 + Math.random() / 2));
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
      // The body is not included: provider error payloads can echo credentials or source text into logs.
      await response.body?.cancel().catch(() => undefined);
      throw new ProviderError(`Translation API failed (${response.status})`, retryable, parseRetryAfter(response.headers.get("retry-after")));
    }
    const envelope = z.safeParse(chatCompletionSchema, await response.json());
    const content = envelope.success ? envelope.data.choices[0].message.content : undefined;
    if (!content) throw new ProviderError("Translation provider returned no content", true);
    let parsed: unknown;
    try { parsed = JSON.parse(content); } catch { throw new ProviderError("Translation provider returned invalid JSON", true); }
    const map = z.safeParse(translationMapSchema, parsed);
    if (!map.success) throw new ProviderError("Translation provider returned a non-object", true);
    // Keep only usable strings for the IDs that were requested; the caller decides what to do with the rest.
    const requested = new Set(input.messages.map(m => m.id));
    const result: Catalog = {};
    for (const [id, text] of Object.entries(map.data)) {
      if (requested.has(id) && typeof text === "string" && text.trim()) result[id] = text;
    }
    return result;
  }
}
