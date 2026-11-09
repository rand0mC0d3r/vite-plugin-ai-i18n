import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import autoI18n, { OpenAICompatibleProvider } from "./index.js";
import { extractMessages } from "./compiler/extract.js";
import { transformSource } from "./compiler/transform.js";
import { createLocaleLoader, resolveLocale } from "./runtime/index.js";
import { createRuntimeModule } from "./runtime/virtual.js";
import type { ExtractedMessage, TranslationProvider, TranslationRequest } from "./types.js";

const SOURCE = `export function App() { return <button title="Save the file">Save</button>; }\n`;

function withIds(messages: ExtractedMessage[]): ExtractedMessage[] {
  return messages.map((m, i) => ({ ...m, id: `msg_${i}` }));
}

describe("transformSource", () => {
  const messages = withIds(extractMessages(SOURCE, "App.tsx"));
  const catalog = { msg_0: "Datei speichern", msg_1: "Speichern" };

  it("bakes the selected locale into the code in build mode", () => {
    const { code } = transformSource(SOURCE, "App.tsx", messages, "de", catalog);
    expect(code).toContain('"Datei speichern"');
    expect(code).toContain('"Speichern"');
    expect(code).not.toContain("virtual:autoi18n");
  });

  it("emits runtime lookups with the source as fallback in runtime mode", () => {
    const { code } = transformSource(SOURCE, "App.tsx", messages, "de", catalog, true);
    expect(code).toContain('import { t as __autoI18nT } from "virtual:autoi18n"');
    expect(code).toContain('__autoI18nT("msg_0", "Save the file")');
    expect(code).toContain('__autoI18nT("msg_1", "Save")');
    expect(code).not.toContain('"Datei speichern"');
  });
});

describe("runtime module", () => {
  it("lists every catalogue and resolves unknown locales to the source", () => {
    const code = createRuntimeModule({ en: "/x/en.json", de: "/x/de.json" }, "en");
    expect(code).toContain('"de": () => import("/x/de.json")');
    expect(code).toContain('const sourceLocale = "en"');
    expect(code).toContain("export function t(id, source)");
  });
});

describe("runtime loader", () => {
  it("falls back to the fallback locale and unwraps JSON default exports", async () => {
    const load = createLocaleLoader({
      en: async () => ({ default: { a: "A" } }),
      de: async () => ({ b: "B" })
    });
    expect(await load("de")).toEqual({ b: "B" });
    expect(await load("fr")).toEqual({ a: "A" });
  });

  it("resolves preferred languages to supported locales", () => {
    expect(resolveLocale(["de-AT"], ["en", "de", "fr"])).toBe("de");
    expect(resolveLocale(["ja"], ["en", "de"])).toBe("en");
  });
});

describe("OpenAICompatibleProvider", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends the API key as a bearer token and validates the response", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ msg_0: "Speichern" }) } }]
    })));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAICompatibleProvider({ apiKey: "test-key", model: "m" });
    const result = await provider.translate({
      sourceLocale: "en", targetLocale: "de",
      messages: [{ id: "msg_0", source: "Save", context: "", kind: "text" }]
    });
    expect(result).toEqual({ msg_0: "Speichern" });
    const init = fetchMock.mock.calls[0]?.[1];
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
  });
});

describe("autoI18n build hook", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "autoi18n-"));
    await mkdir(path.join(root, "src"), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function fakeProvider(): TranslationProvider & { calls: TranslationRequest[][] } {
    const calls: TranslationRequest[][] = [];
    return {
      calls,
      async translate({ messages }) {
        calls.push(messages);
        return Object.fromEntries(messages.map(m => [m.id, `DE:${m.source}`]));
      }
    };
  }

  async function runBuild(plugin: ReturnType<typeof autoI18n>) {
    const hooks = plugin as unknown as {
      configResolved: (c: { root: string }) => void;
      buildStart: (this: unknown) => Promise<void>;
    };
    hooks.configResolved({ root });
    await hooks.buildStart.call({ info() {}, error(message: string) { throw new Error(message); } });
  }

  it("translates new messages and re-requests those whose source text changed", async () => {
    await writeFile(path.join(root, "src/App.tsx"), SOURCE);
    const provider = fakeProvider();
    const plugin = autoI18n({ locales: ["en", "de"], provider });

    await runBuild(plugin);
    expect(provider.calls.flat().map(m => m.source)).toEqual(["Save the file", "Save"]);
    const catalog = JSON.parse(await readFile(path.join(root, ".autoi18n/locales/de.json"), "utf8"));
    expect(Object.values(catalog)).toEqual(["DE:Save the file", "DE:Save"]);

    // Second build with unchanged sources must not call the provider again.
    await runBuild(autoI18n({ locales: ["en", "de"], provider }));
    expect(provider.calls).toHaveLength(1);

    // Changing the text while keeping the same ID triggers a re-translation of just that message.
    await writeFile(path.join(root, "src/App.tsx"), SOURCE.replace("Save the file", "Save the document"));
    await runBuild(autoI18n({ locales: ["en", "de"], provider }));
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[1].map(m => m.source)).toContain("Save the document");

    // Same ID with a source text that no longer matches the sidecar must be re-translated.
    const sourcesPath = path.join(root, ".autoi18n/locales/de.sources.json");
    const sources = JSON.parse(await readFile(sourcesPath, "utf8"));
    const staleId = provider.calls[1][0].id;
    sources[staleId] = "Previously translated text";
    await writeFile(sourcesPath, JSON.stringify(sources));
    await runBuild(autoI18n({ locales: ["en", "de"], provider }));
    expect(provider.calls).toHaveLength(3);
    expect(provider.calls[2].map(m => m.id)).toEqual([staleId]);
  });

  it("fails when translations are missing and no provider is configured", async () => {
    await writeFile(path.join(root, "src/App.tsx"), SOURCE);
    const plugin = autoI18n({ locales: ["en", "de"], failOnMissingProvider: true });
    await expect(runBuild(plugin)).rejects.toThrow(/no provider is configured/);
  });
});
