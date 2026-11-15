import { ArkErrors } from "arktype";

import { Semaphore } from "../concurrency.js";
import { MAX_RETRY_AFTER_MS } from "../constants.js";
import { PartialTranslationError } from "../errors.js";
import { translationMapSchema } from "../schemas.js";
import type { Catalog, TranslationProvider, TranslationRequest } from "../types.js";

/** Tuning options shared by every HTTP provider that sends messages in batches. */
export interface BatchedProviderOptions {
  /** Messages sent per request. Smaller batches keep responses within output limits. Default 40. */
  batchSize?: number;
  /** Abort a single request after this many milliseconds. Default 60000. */
  timeoutMs?: number;
  /** Extra attempts for network errors, timeouts, 408/409/429/5xx and malformed responses. Default 2. */
  maxRetries?: number;
  /**
   * Base delay before a retry; doubles on each attempt and is jittered. A Retry-After header overrides it (max 60 s).
   * Default 500.
   */
  retryDelayMs?: number;
  /** Batches sent in parallel across all locales of one provider instance. Default 4. */
  concurrency?: number;
}

/** One translation call: the locale pair and the messages to translate between them. */
export interface TranslateInput {
  sourceLocale: string;
  targetLocale: string;
  messages: TranslationRequest[];
}

/**
 * Error raised for failures in a provider's response. `retryable` tells the batch retry loop whether another attempt
 * may succeed; `retryAfterMs` carries the server's Retry-After hint when one was sent.
 */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

/** Accepts both forms of Retry-After: delay in seconds, or an HTTP date. */
function parseRetryAfter(header: string | null, now = Date.now()): number | undefined {
  if (header === null || header === "") return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.min(Math.max(seconds, 0) * 1000, MAX_RETRY_AFTER_MS);
  const date = Date.parse(header);
  if (Number.isNaN(date)) return undefined;
  return Math.min(Math.max(date - now, 0), MAX_RETRY_AFTER_MS);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Builds the system instruction that tells the model the locale pair and to reply with a bare JSON ID-to-text object. */
export function systemPrompt(input: TranslateInput): string {
  return `You are a professional software localization engine. Translate UI messages from ${input.sourceLocale} to ${input.targetLocale}. Preserve placeholders exactly. Messages of kind "mixed" are ICU MessageFormat: keep each {name} argument unchanged, keep apostrophes and braces valid ICU (a literal apostrophe is written as two apostrophes, and literal braces are quoted), and use plural or select only when the target language needs them. Respect context and UI conventions. Return ONLY a JSON object mapping message IDs to translated strings. Do not translate product names or code.`;
}

/** Serializes messages as a JSON array of `{ id, text, context, kind }` for the user turn of the prompt. */
export function userContent(messages: TranslationRequest[]): string {
  return JSON.stringify(messages.map((m) => ({ id: m.id, text: m.source, context: m.context, kind: m.kind })));
}

/**
 * Builds a retryable-or-not error from a non-2xx response. The body is not included: provider error payloads can echo
 * credentials or source text into logs.
 */
export async function httpError(response: Response): Promise<Error> {
  const retryable =
    response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500;
  await response.body?.cancel().catch(() => undefined);
  return new ProviderError(
    `Translation API failed (${response.status})`,
    retryable,
    parseRetryAfter(response.headers.get("retry-after")),
  );
}

/**
 * Shared batching, concurrency and retry logic for HTTP translation providers. Subclasses implement one request per
 * batch and return the translations it produced.
 */
export abstract class BatchedProvider<O extends BatchedProviderOptions> implements TranslationProvider {
  // One limiter per provider instance, so concurrent locales share the request budget instead of multiplying it.
  private readonly slots: Semaphore;

  constructor(protected readonly options: O) {
    this.slots = new Semaphore(options.concurrency ?? 4);
  }

  /**
   * Translates in parallel batches. If every batch fails, the first error is thrown. If only some fail, a
   * PartialTranslationError carries the translations that succeeded.
   */
  async translate(input: TranslateInput): Promise<Catalog> {
    const batchSize = Math.max(1, this.options.batchSize ?? 40);
    const batches: TranslationRequest[][] = [];
    for (let start = 0; start < input.messages.length; start += batchSize)
      batches.push(input.messages.slice(start, start + batchSize));

    const settled = await Promise.allSettled(
      batches.map((batch) => this.slots.run(() => this.translateBatch({ ...input, messages: batch }))),
    );
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
    throw new PartialTranslationError(
      `${failed} messages failed to translate: ${(errors[0] as Error).message}`,
      result,
      failed,
    );
  }

  /**
   * Runs one batch, retrying retryable failures with exponential backoff (`retryDelayMs * 2^attempt`, jittered) up to
   * `maxRetries` extra attempts. Non-retryable errors are rethrown immediately.
   */
  private async translateBatch(input: TranslateInput): Promise<Catalog> {
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

  /** Sends one batch to the provider and returns the translations it produced for the requested IDs. */
  protected abstract request(input: TranslateInput): Promise<Catalog>;

  /**
   * POSTs a JSON body with the given headers and returns the parsed JSON reply. Non-2xx replies throw a classified
   * error.
   */
  protected async post(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
    const response = await fetch(url, {
      method: "POST",
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 60_000),
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw await httpError(response);
    return response.json();
  }

  /**
   * Posts one batch and reads its translations from the reply. `parse` validates the provider's response envelope and
   * `text` extracts the model's text from it. An invalid envelope is treated as an empty reply.
   */
  protected async complete<E>(
    url: string,
    headers: Record<string, string>,
    body: unknown,
    parse: (data: unknown) => E | ArkErrors,
    text: (envelope: E) => string | undefined,
    input: TranslateInput,
  ): Promise<Catalog> {
    const envelope = parse(await this.post(url, headers, body));
    return this.toCatalog(envelope instanceof ArkErrors ? undefined : text(envelope), input.messages);
  }

  /**
   * Parses the model's text reply, which must be a JSON object mapping IDs to strings. A surrounding Markdown code
   * fence is stripped first, because models sometimes add one even when told not to.
   */
  protected toCatalog(content: string | undefined, messages: TranslationRequest[]): Catalog {
    const text = content?.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
    if (text === undefined || text === "") throw new ProviderError("Translation provider returned no content", true);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ProviderError("Translation provider returned invalid JSON", true);
    }
    const map = translationMapSchema(parsed);
    if (map instanceof ArkErrors) throw new ProviderError("Translation provider returned a non-object", true);
    // Keep only usable strings for the IDs that were requested; the caller decides what to do with the rest.
    const requested = new Set(messages.map((m) => m.id));
    const result: Catalog = {};
    for (const [id, text] of Object.entries(map)) {
      if (requested.has(id) && typeof text === "string" && text.trim()) result[id] = text;
    }
    return result;
  }
}
