import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GeminiProvider } from "../../src/ai/gemini.js";
import type { PartialTranslationError } from "../../src/errors.js";
import type { TranslationRequest } from "../../src/types.js";

const request = (id: string, source = "Save"): TranslationRequest => ({ id, source, context: "", kind: "text" });
const input = (messages: TranslationRequest[]) => ({ sourceLocale: "en", targetLocale: "de", messages });

type GeminiBody = {
  systemInstruction: { parts: { text: string }[] };
  contents: { role: string; parts: { text: string }[] }[];
  generationConfig: unknown;
};

const generateResponse = (text: string, status = 200) =>
  new Response(
    JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }] }),
    { status },
  );

describe("GeminiProvider", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const provider = (extra = {}) =>
    new GeminiProvider({ apiKey: "gemini-test-key", model: "gemini-test", retryDelayMs: 0, ...extra });

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("calls generateContent with the expected headers and body", async () => {
    fetchMock.mockResolvedValue(generateResponse(JSON.stringify({ a: "Speichern" })));
    const result = await provider({ maxOutputTokens: 1000 }).translate(input([request("a")]));

    expect(result).toEqual({ a: "Speichern" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("gemini-test-key");
    expect(headers["Authorization"]).toBeUndefined();
    const body = JSON.parse(init.body as string) as GeminiBody;
    expect(body.systemInstruction.parts[0].text).toContain("from en to de");
    expect(body.contents[0].role).toBe("user");
    expect(JSON.parse(body.contents[0].parts[0].text)).toEqual([{ id: "a", text: "Save", context: "", kind: "text" }]);
    expect(body.generationConfig).toEqual({ responseMimeType: "application/json", maxOutputTokens: 1000 });
  });

  it("uses a custom baseURL", async () => {
    fetchMock.mockResolvedValue(generateResponse(JSON.stringify({ a: "x" })));
    await provider({ baseURL: "https://proxy.example/v1beta" }).translate(input([request("a")]));
    expect(fetchMock.mock.calls[0][0]).toBe("https://proxy.example/v1beta/models/gemini-test:generateContent");
  });

  it("strips a Markdown code fence around the JSON", async () => {
    fetchMock.mockResolvedValue(generateResponse('```json\n{"a":"Speichern"}\n```'));
    expect(await provider().translate(input([request("a")]))).toEqual({ a: "Speichern" });
  });

  it("retries a 429 and then succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("{}", { status: 429 }))
      .mockResolvedValueOnce(generateResponse(JSON.stringify({ a: "Speichern" })));
    expect(await provider().translate(input([request("a")]))).toEqual({ a: "Speichern" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails immediately on a 400 without retrying", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 400 }));
    await expect(provider().translate(input([request("a")]))).rejects.toThrow("Translation API failed (400)");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns nothing for an empty candidate list", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ candidates: [] }), { status: 200 }));
    await expect(provider({ maxRetries: 0 }).translate(input([request("a")]))).rejects.toThrow();
  });

  it("ignores parts that carry no text", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { role: "model", parts: [{ text: '{"a":"Speichern"}' }, { inlineData: {} }] } }],
        }),
      ),
    );
    expect(await provider().translate(input([request("a")]))).toEqual({ a: "Speichern" });
  });

  it("treats a candidate without content as an empty reply", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ candidates: [{ finishReason: "SAFETY" }] })));
    await expect(provider({ maxRetries: 0 }).translate(input([request("a")]))).rejects.toThrow("no content");
  });

  it("joins text across all parts of the first candidate", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { role: "model", parts: [{ text: '{"a":' }, { text: '"Speichern"}' }] } }],
        }),
      ),
    );
    expect(await provider().translate(input([request("a")]))).toEqual({ a: "Speichern" });
  });

  it("drops IDs that were not requested and empty translations", async () => {
    fetchMock.mockResolvedValue(generateResponse(JSON.stringify({ a: "Speichern", b: "  ", extra: "x" })));
    expect(await provider().translate(input([request("a"), request("b")]))).toEqual({ a: "Speichern" });
  });

  it("fails the batch when the reply is not JSON", async () => {
    fetchMock.mockResolvedValue(generateResponse("Sure! Here you go."));
    await expect(provider({ maxRetries: 0 }).translate(input([request("a")]))).rejects.toThrow("invalid JSON");
  });

  it("splits requests into batches and reports partial failures", async () => {
    fetchMock
      .mockResolvedValueOnce(generateResponse(JSON.stringify({ a: "A" })))
      .mockResolvedValueOnce(new Response("{}", { status: 400 }));
    const error = await provider({ batchSize: 1, concurrency: 1, maxRetries: 0 })
      .translate(input([request("a"), request("b")]))
      .catch((e: PartialTranslationError) => e);
    expect(error.name).toBe("PartialTranslationError");
    expect(error.partial).toEqual({ a: "A" });
    expect(error.failed).toBe(1);
  });
});
