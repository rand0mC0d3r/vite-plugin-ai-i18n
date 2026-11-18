import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAICompatibleProvider } from "../../src/ai/openai.js";
import type { PartialTranslationError } from "../../src/errors.js";
import type { TranslationRequest } from "../../src/types.js";

const request = (id: string, source = "Save"): TranslationRequest => ({ id, source, context: "" });
const input = (messages: TranslationRequest[]) => ({ sourceLocale: "en", targetLocale: "de", messages });

type ChatBody = {
  model: string;
  temperature: number;
  response_format: unknown;
  messages: { role: string; content: string }[];
};

const chatResponse = (content: string, status = 200) =>
  new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }] }), {
    status,
  });

describe("OpenAICompatibleProvider", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const provider = (extra = {}) =>
    new OpenAICompatibleProvider({ apiKey: "sk-test", model: "gpt-test", retryDelayMs: 0, ...extra });

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("calls chat/completions with the expected headers and body", async () => {
    fetchMock.mockResolvedValue(chatResponse(JSON.stringify({ a: "Speichern" })));
    const result = await provider().translate(input([request("a")]));

    expect(result).toEqual({ a: "Speichern" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer sk-test");
    expect(headers["x-api-key"]).toBeUndefined();
    const body = JSON.parse(init.body as string) as ChatBody;
    expect(body.model).toBe("gpt-test");
    expect(body.temperature).toBe(0);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toContain("from en to de");
    expect(body.messages[1].role).toBe("user");
    expect(JSON.parse(body.messages[1].content)).toEqual([{ id: "a", text: "Save", context: "" }]);
  });

  it("sends no Authorization header when no apiKey is set (for example Ollama)", async () => {
    fetchMock.mockResolvedValue(chatResponse(JSON.stringify({ a: "Speichern" })));
    await new OpenAICompatibleProvider({ model: "llama-test", baseURL: "http://localhost:11434/v1" }).translate(
      input([request("a")]),
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:11434/v1/chat/completions");
    expect((init.headers as Record<string, string>)["Authorization"]).toBeUndefined();
  });

  it("marks auto-plural count templates in the provider request", async () => {
    fetchMock.mockResolvedValue(
      chatResponse(
        JSON.stringify({
          a: "{count, plural, =0 {No items} one {# item} other {# items}}",
        }),
      ),
    );
    await provider().translate(input([{ id: "a", source: "{count} items", context: "Items", autoPlural: true }]));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as ChatBody;
    expect(body.messages[0].content).toContain("autoPlural");
    expect(JSON.parse(body.messages[1].content)).toEqual([
      { id: "a", text: "{count} items", context: "Items", autoPlural: true },
    ]);
  });

  it("includes an auto-plural hint in the provider request", async () => {
    fetchMock.mockResolvedValue(
      chatResponse(
        JSON.stringify({
          a: "{count, plural, =0 {Now} one {# second ago} other {# seconds ago}}",
        }),
      ),
    );
    await provider().translate(
      input([
        { id: "a", source: "{count} seconds ago", context: "App", autoPlural: true, hint: "Use Now when count is 0" },
      ]),
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as ChatBody;
    expect(JSON.parse(body.messages[1].content)).toEqual([
      {
        id: "a",
        text: "{count} seconds ago",
        context: "App",
        autoPlural: true,
        hint: "Use Now when count is 0",
      },
    ]);
  });

  it("uses a custom baseURL", async () => {
    fetchMock.mockResolvedValue(chatResponse(JSON.stringify({ a: "x" })));
    await provider({ baseURL: "https://x.example/v1" }).translate(input([request("a")]));
    expect(fetchMock.mock.calls[0][0]).toBe("https://x.example/v1/chat/completions");
  });

  it("retries a 429 and then succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("{}", { status: 429 }))
      .mockResolvedValueOnce(chatResponse(JSON.stringify({ a: "Speichern" })));
    expect(await provider().translate(input([request("a")]))).toEqual({ a: "Speichern" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry an authentication error", async () => {
    fetchMock.mockResolvedValue(new Response("denied", { status: 401 }));
    await expect(provider().translate(input([request("a")]))).rejects.toThrow("Translation API failed (401)");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns nothing for an empty choices list", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ choices: [] }), { status: 200 }));
    await expect(provider({ maxRetries: 0 }).translate(input([request("a")]))).rejects.toThrow();
  });

  it("fails the batch when the reply is not JSON", async () => {
    fetchMock.mockResolvedValue(chatResponse("Sure! Here you go."));
    await expect(provider({ maxRetries: 0 }).translate(input([request("a")]))).rejects.toThrow("invalid JSON");
  });

  it("drops IDs that were not requested and empty translations", async () => {
    fetchMock.mockResolvedValue(chatResponse(JSON.stringify({ a: "Speichern", b: "  ", extra: "x" })));
    expect(await provider().translate(input([request("a"), request("b")]))).toEqual({ a: "Speichern" });
  });

  it("splits requests into batches and reports partial failures", async () => {
    fetchMock
      .mockResolvedValueOnce(chatResponse(JSON.stringify({ a: "A" })))
      .mockResolvedValueOnce(new Response("denied", { status: 400 }));
    const error = await provider({ batchSize: 1, concurrency: 1, maxRetries: 0 })
      .translate(input([request("a"), request("b")]))
      .catch((e: PartialTranslationError) => e);
    expect(error.name).toBe("PartialTranslationError");
    expect(error.partial).toEqual({ a: "A" });
    expect(error.failed).toBe(1);
  });
});
