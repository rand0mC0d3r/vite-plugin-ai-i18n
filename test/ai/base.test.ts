import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAICompatibleProvider } from "../../src/ai/openai.js";
import type { TranslationRequest } from "../../src/types.js";

const request = (id: string): TranslationRequest => ({ id, source: "Save", context: "", kind: "text" });
const input = (messages: TranslationRequest[]) => ({ sourceLocale: "en", targetLocale: "de", messages });
const chat = (content: unknown) =>
  new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 });
const rateLimited = (retryAfter?: string) =>
  new Response("slow down", { status: 429, headers: retryAfter === undefined ? {} : { "retry-after": retryAfter } });

describe("BatchedProvider retries", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const provider = (extra = {}) => new OpenAICompatibleProvider({ apiKey: "k", model: "m", retryDelayMs: 0, ...extra });

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("retries a network failure thrown by fetch itself", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce(chat({ a: "Speichern" }));
    const result = await provider().translate(input([request("a")]));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ a: "Speichern" });
  });

  it("honours a Retry-After given in seconds", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(rateLimited("2")).mockResolvedValueOnce(chat({ a: "Speichern" }));
    const pending = provider({ retryDelayMs: 10_000 }).translate(input([request("a")]));
    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({ a: "Speichern" });
  });

  it("honours a Retry-After given as an HTTP date", async () => {
    vi.useFakeTimers();
    const when = new Date(Date.now() + 3_000).toUTCString();
    fetchMock.mockResolvedValueOnce(rateLimited(when)).mockResolvedValueOnce(chat({ a: "Speichern" }));
    const pending = provider({ retryDelayMs: 10_000 }).translate(input([request("a")]));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(pending).resolves.toEqual({ a: "Speichern" });
  });

  it("falls back to the backoff delay when Retry-After is not a date or number", async () => {
    fetchMock.mockResolvedValueOnce(rateLimited("soon")).mockResolvedValueOnce(chat({ a: "Speichern" }));
    const result = await provider().translate(input([request("a")]));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ a: "Speichern" });
  });

  it("treats a Retry-After date in the past as no delay", async () => {
    const past = new Date(Date.now() - 60_000).toUTCString();
    fetchMock.mockResolvedValueOnce(rateLimited(past)).mockResolvedValueOnce(chat({ a: "Speichern" }));
    const result = await provider().translate(input([request("a")]));
    expect(result).toEqual({ a: "Speichern" });
  });

  it("caps Retry-After at 60 seconds", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(rateLimited("3600")).mockResolvedValueOnce(chat({ a: "Speichern" }));
    const pending = provider().translate(input([request("a")]));
    await vi.advanceTimersByTimeAsync(59_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({ a: "Speichern" });
  });

  it("fails a batch whose reply is a bare number instead of an object", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "42" } }] }), { status: 200 }),
    );
    await expect(provider({ maxRetries: 0 }).translate(input([request("a")]))).rejects.toThrow("non-object");
  });

  it("gives up on an empty model reply after the retry budget", async () => {
    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify({ choices: [{ message: { content: null } }] }), { status: 200 }),
    );
    await expect(provider({ maxRetries: 1 }).translate(input([request("a")]))).rejects.toThrow("no content");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
