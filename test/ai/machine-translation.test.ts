import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DeepLProvider } from "../../src/ai/deepl.js";
import { GoogleTranslateProvider } from "../../src/ai/google.js";
import type { TranslationRequest } from "../../src/types.js";

const request = (id: string, source: string): TranslationRequest => ({ id, source, context: "", kind: "text" });
const input = (messages: TranslationRequest[], targetLocale = "de") => ({ sourceLocale: "en", targetLocale, messages });
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

type DeepLBody = { text: string[]; target_lang: string };

describe("machine-translation adapters", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  describe("DeepLProvider", () => {
    it("uses the Free host for :fx keys and keeps placeholders intact", async () => {
      fetchMock.mockResolvedValue(json({ translations: [{ text: "Gespeichert <x>{name}</x> & mehr" }] }));
      const result = await new DeepLProvider({ apiKey: "key:fx", retryDelayMs: 0 }).translate(
        input([request("a", "Saved {name} & more")]),
      );

      expect(result).toEqual({ a: "Gespeichert {name} & mehr" });
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://api-free.deepl.com/v2/translate");
      expect((init.headers as Record<string, string>)["authorization"]).toBe("DeepL-Auth-Key key:fx");
      const body = JSON.parse(init.body as string) as DeepLBody;
      expect(body.text).toEqual(["Saved <x>{name}</x> &amp; more"]);
      expect(body).toMatchObject({ source_lang: "EN", target_lang: "DE", tag_handling: "xml", ignore_tags: ["x"] });
    });

    it("maps plain English and Portuguese to regional DeepL targets", async () => {
      fetchMock.mockResolvedValue(json({ translations: [{ text: "x" }] }));
      await new DeepLProvider({ apiKey: "key", retryDelayMs: 0 }).translate(input([request("a", "Save")], "en"));
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect((JSON.parse(init.body as string) as DeepLBody).target_lang).toBe("EN-US");
      expect(fetchMock.mock.calls[0][0]).toBe("https://api.deepl.com/v2/translate");
    });

    it("keeps explicit regional targets and maps plain Portuguese to PT-BR", async () => {
      const provider = new DeepLProvider({ apiKey: "key", retryDelayMs: 0 });
      const targetOf = async (locale: string) => {
        fetchMock.mockResolvedValueOnce(json({ translations: [{ text: "x" }] }));
        await provider.translate(input([request("a", "Save")], locale));
        const [, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
        return (JSON.parse(init.body as string) as DeepLBody).target_lang;
      };
      expect(await targetOf("en-gb")).toBe("EN-GB");
      expect(await targetOf("pt")).toBe("PT-BR");
      expect(await targetOf("pt_pt")).toBe("PT-PT");
    });

    it("treats a reply without translations as a retryable provider error", async () => {
      fetchMock.mockResolvedValue(json({ unexpected: true }));
      const provider = new DeepLProvider({ apiKey: "key", retryDelayMs: 0, maxRetries: 0 });
      await expect(provider.translate(input([request("a", "Save")]))).rejects.toThrow(
        "DeepL returned an unexpected response",
      );
    });
  });

  describe("GoogleTranslateProvider", () => {
    it("decodes the HTML entities Google returns and keeps placeholders", async () => {
      fetchMock.mockResolvedValue(
        json({ data: { translations: [{ translatedText: '<span translate="no">{name}</span> l&#39;espace' }] } }),
      );
      const result = await new GoogleTranslateProvider({ apiKey: "key", retryDelayMs: 0 }).translate(
        input([request("a", "{name} space")], "fr"),
      );
      expect(result).toEqual({ a: "{name} l'espace" });
    });

    it("treats a reply without translations as a retryable provider error", async () => {
      fetchMock.mockResolvedValue(json({ unexpected: true }));
      const provider = new GoogleTranslateProvider({ apiKey: "key", retryDelayMs: 0, maxRetries: 0 });
      await expect(provider.translate(input([request("a", "Save")]))).rejects.toThrow(
        "Google Translate returned an unexpected response",
      );
    });
  });
});
