import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnthropicProvider } from "./ai/anthropic.js";
import { OpenAICompatibleProvider } from "./ai/openai.js";
import type { TranslationRequest } from "./types.js";

const request = (id: string, source = "Save"): TranslationRequest => ({ id, source, context: "", kind: "text" });
const input = (messages: TranslationRequest[]) => ({ sourceLocale: "en", targetLocale: "de", messages });

const messageResponse = (text: string, status = 200) =>
  new Response(JSON.stringify({ content: [{ type: "text", text }], stop_reason: "end_turn" }), { status });

describe("AnthropicProvider", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const provider = (extra = {}) => new AnthropicProvider({ apiKey: "sk-ant-test", model: "claude-test", retryDelayMs: 0, ...extra });

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("calls the Messages API with the expected headers and body", async () => {
    fetchMock.mockResolvedValue(messageResponse(JSON.stringify({ a: "Speichern" })));
    const result = await provider({ maxTokens: 1000 }).translate(input([request("a")]));

    expect(result).toEqual({ a: "Speichern" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-ant-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers.Authorization).toBeUndefined();
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("claude-test");
    expect(body.max_tokens).toBe(1000);
    expect(body.system).toContain("from en to de");
    expect(body.messages[0].role).toBe("user");
    expect(JSON.parse(body.messages[0].content)).toEqual([{ id: "a", text: "Save", context: "", kind: "text" }]);
  });

  it("uses a custom baseURL", async () => {
    fetchMock.mockResolvedValue(messageResponse(JSON.stringify({ a: "x" })));
    await provider({ baseURL: "https://proxy.example/v1" }).translate(input([request("a")]));
    expect(fetchMock.mock.calls[0][0]).toBe("https://proxy.example/v1/messages");
  });

  it("joins text blocks and ignores other block types", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      content: [{ type: "thinking", text: "ignored" }, { type: "text", text: "{\"a\":" }, { type: "text", text: "\"Speichern\"}" }]
    })));
    expect(await provider().translate(input([request("a")]))).toEqual({ a: "Speichern" });
  });

  it("accepts JSON wrapped in a Markdown code fence", async () => {
    fetchMock.mockResolvedValue(messageResponse("```json\n{\"a\": \"Speichern\"}\n```"));
    expect(await provider().translate(input([request("a")]))).toEqual({ a: "Speichern" });
  });

  it("retries an overloaded (529) response and then succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("overloaded", { status: 529 }))
      .mockResolvedValueOnce(messageResponse(JSON.stringify({ a: "Speichern" })));
    expect(await provider().translate(input([request("a")]))).toEqual({ a: "Speichern" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry an authentication error", async () => {
    fetchMock.mockResolvedValue(new Response("denied", { status: 401 }));
    await expect(provider().translate(input([request("a")]))).rejects.toThrow("Translation API failed (401)");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails the batch when the reply is not JSON", async () => {
    fetchMock.mockResolvedValue(messageResponse("Sure! Here you go."));
    await expect(provider({ maxRetries: 0 }).translate(input([request("a")]))).rejects.toThrow("invalid JSON");
  });

  it("splits requests into batches and reports partial failures", async () => {
    fetchMock
      .mockResolvedValueOnce(messageResponse(JSON.stringify({ a: "A" })))
      .mockResolvedValueOnce(new Response("denied", { status: 400 }));
    const error = await provider({ batchSize: 1, concurrency: 1, maxRetries: 0 })
      .translate(input([request("a"), request("b")]))
      .catch(e => e);
    expect(error.name).toBe("PartialTranslationError");
    expect(error.partial).toEqual({ a: "A" });
    expect(error.failed).toBe(1);
  });
});

describe("OpenAICompatibleProvider (shared base)", () => {
  it("keeps its endpoint and header behavior", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "{\"a\":\"Hallo\"}" } }] })));
    vi.stubGlobal("fetch", fetchMock);
    try {
      expect(await new OpenAICompatibleProvider({ apiKey: "k", model: "m", baseURL: "https://x.example/v1" }).translate(input([request("a", "Hello")]))).toEqual({ a: "Hallo" });
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://x.example/v1/chat/completions");
      expect((init.headers as Record<string, string>).Authorization).toMatch(/^Bearer k$/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
