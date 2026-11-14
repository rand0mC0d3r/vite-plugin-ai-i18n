import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import autoI18n, { OpenAICompatibleProvider } from "../src/index.js";
import { extractMessages } from "../src/compiler/extract.js";
import { transformSource } from "../src/compiler/transform.js";
import { createFingerprint } from "../src/identity/fingerprint.js";
import { createLocaleLoader, resolveLocale } from "../src/runtime/index.js";
import { createRuntimeModule } from "../src/runtime/virtual.js";
import type { ExtractedMessage, ResolvedMessage, TranslationProvider, TranslationRequest } from "../src/types.js";

const SOURCE = `export function App() { return <button title="Save the file">Save</button>; }\n`;

function withIds(messages: ExtractedMessage[]): ResolvedMessage[] {
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

describe("marked string literals outside JSX", () => {
  const CODE = `const items = [{ label: /* i18n */ "Shared with your team", size: "12 KB" }, { label: "Private" }];\nexport const App = () => <p>{items.length}</p>;\n`;
  const messages = withIds(extractMessages(CODE, "Items.tsx"));

  it("extracts only literals preceded by the i18n marker", () => {
    expect(messages.map(m => [m.kind, m.source])).toEqual([["string", "Shared with your team"]]);
  });

  it("uses a custom string marker when configured", () => {
    const custom = `const items = [{ label: /* t */ "Shared with your team" }, { label: /* i18n */ "Ignored" }];\n`;
    expect(extractMessages(custom, "Items.tsx", { stringMarker: "t" }).map(m => m.source)).toEqual(["Shared with your team"]);
  });

  it("uses the catalogue translation in build mode", () => {
    const { code } = transformSource(CODE, "Items.tsx", messages, "de", { msg_0: "Mit deinem Team geteilt" });
    expect(code).toContain('"Mit deinem Team geteilt"');
    expect(code).toContain('"Private"');
    expect(code).toContain('"12 KB"');
  });

  it("emits a runtime lookup in runtime mode", () => {
    const { code } = transformSource(CODE, "Items.tsx", messages, "de", {}, true);
    expect(code).toContain('__autoI18nT("msg_0", "Shared with your team")');
    expect(code).toContain('"Private"');
  });
});

describe("mixed-content messages", () => {
  const MIXED = `export function Dialog({ count, doc }) { return <p>You have {count} documents, {doc.name} is {count} selected.</p>; }\n`;
  const messages = withIds(extractMessages(MIXED, "Dialog.tsx"));

  it("extracts a sentence with simple expressions as one message with ICU argument names", () => {
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      kind: "mixed",
      source: "You have {count} documents, {doc_name} is {count_2} selected.",
      placeholders: ["count", "doc_name", "count_2"]
    });
  });

  it("escapes apostrophes and braces for ICU and keeps the identity of the unescaped text", () => {
    const [message] = extractMessages(`export const A = ({ n }) => <p>Don't delete {n} files</p>;\n`, "A.tsx");
    expect(message.source).toBe("Don''t delete {n} files");
    expect(message.fingerprint).toBe(createFingerprint({ ...message, source: "Don't delete {n} files" }));
  });

  it("rebuilds the message from the translation in build mode, passing each value once", () => {
    const catalog = { msg_0: "{doc_name} hat {count} Dokumente, {count_2} gewählt." };
    const { code } = transformSource(MIXED, "Dialog.tsx", messages, "de", catalog);
    expect(code).toContain('import { format as __autoI18nFormat } from "virtual:autoi18n-format"');
    expect(code).toContain('__autoI18nFormat("{doc_name} hat {count} Dokumente, {count_2} gewählt.", {"count": count, "doc_name": doc.name, "count_2": count}, "de")');
    expect(code).not.toContain('from "virtual:autoi18n"');
  });

  it("falls back to the source when a translation changes the argument names", () => {
    const { code } = transformSource(MIXED, "Dialog.tsx", messages, "de", { msg_0: "{doc} hat {count}" });
    expect(code).toContain('"You have {count} documents, {doc_name} is {count_2} selected."');
  });

  it("falls back to the source when a translation is not valid ICU", () => {
    const { code } = transformSource(MIXED, "Dialog.tsx", messages, "de", { msg_0: "{count Dokumente" });
    expect(code).toContain('"You have {count} documents, {doc_name} is {count_2} selected."');
  });

  it("accepts a translation that repeats or reorders arguments, since each value is passed once", () => {
    const { code } = transformSource(MIXED, "Dialog.tsx", messages, "de", { msg_0: "{doc_name}: {count} von {count}, {count_2}" });
    expect(code).toContain('"{doc_name}: {count} von {count}, {count_2}"');
  });

  it("formats runtime translations through the format module with the expression values and the current locale", () => {
    const { code } = transformSource(MIXED, "Dialog.tsx", messages, "de", {}, true);
    expect(code).toContain('import { t as __autoI18nT, getLocale as __autoI18nLocale } from "virtual:autoi18n"');
    expect(code).toContain('import { format as __autoI18nFormat } from "virtual:autoi18n-format"');
    expect(code).toContain('__autoI18nFormat(__autoI18nT("msg_0", "You have {count} documents, {doc_name} is {count_2} selected."), {');
    expect(code).toContain('"doc_name": doc.name');
    expect(code).toContain('"count_2": count');
    expect(code).toContain("}, __autoI18nLocale())}");
  });

  it("does not extract sentences whose expressions are not plain references", () => {
    const code = `export const A = () => <p>You have {getCount()} documents</p>;\n`;
    expect(extractMessages(code, "A.tsx")).toEqual([]);
  });
});

describe("translate=\"no\" opt-out", () => {
  it("skips text, mixed content and translatable attributes of the marked element", () => {
    const code = `export const A = ({ n }) => <div>
      <p translate="no">Keep this as is</p>
      <button translate="no" title="Do not translate me">Save</button>
      <p translate="no">Count {n} items here</p>
    </div>;\n`;
    expect(extractMessages(code, "A.tsx")).toEqual([]);
  });

  it("skips descendants of a marked element, like the HTML attribute", () => {
    const code = `export const A = () => <section translate="no"><h2>Sample code</h2><span title="Hidden copy">x</span></section>;\n`;
    expect(extractMessages(code, "A.tsx")).toEqual([]);
  });

  it("still extracts copy outside the marked element and ignores other translate values", () => {
    const code = `export const A = () => <main><p translate="no">Skip</p><p translate="yes">Translate me</p><p>Also me</p></main>;\n`;
    expect(extractMessages(code, "A.tsx").map(m => m.source)).toEqual(["Translate me", "Also me"]);
  });
});

describe("runtime module", () => {
  it("lists every catalogue and resolves unknown locales to the source", () => {
    const code = createRuntimeModule({ en: "/x/en.json", de: "/x/de.json" }, "en");
    expect(code).toContain('"de": () => import("/x/de.json")');
    expect(code).toContain('const sourceLocale = "en"');
    expect(code).toContain("export function t(id, source)");
    expect(code).not.toContain("export function format");
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
    await hooks.buildStart.call({ info() {}, warn() {}, error(message: string) { throw new Error(message); } });
  }

  it("translates new messages and re-requests those whose source text changed", async () => {
    await writeFile(path.join(root, "src/App.tsx"), SOURCE);
    const provider = fakeProvider();
    const plugin = autoI18n({ locales: ["en", "de"], provider });

    await runBuild(plugin);
    expect(provider.calls.flat().map(m => m.source)).toEqual(["Save the file", "Save"]);
    const catalog = JSON.parse(await readFile(path.join(root, ".autoi18n/locales/de.json"), "utf8")).messages;
    expect(Object.values(catalog)).toEqual(["DE:Save the file", "DE:Save"]);

    // Second build with unchanged sources must not call the provider again.
    await runBuild(autoI18n({ locales: ["en", "de"], provider }));
    expect(provider.calls).toHaveLength(1);

    // Changing the text while keeping the same ID triggers a re-translation of just that message.
    await writeFile(path.join(root, "src/App.tsx"), SOURCE.replace("Save the file", "Save the document"));
    await runBuild(autoI18n({ locales: ["en", "de"], provider }));
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[1].map(m => m.source)).toContain("Save the document");

    // Same ID with a source text that no longer matches the recorded source must be re-translated.
    const localePath = path.join(root, ".autoi18n/locales/de.json");
    const localeFile = JSON.parse(await readFile(localePath, "utf8"));
    const staleId = provider.calls[1][0].id;
    localeFile.sources[staleId] = "Previously translated text";
    await writeFile(localePath, JSON.stringify(localeFile));
    await runBuild(autoI18n({ locales: ["en", "de"], provider }));
    expect(provider.calls).toHaveLength(3);
    expect(provider.calls[2].map(m => m.id)).toEqual([staleId]);
  });

  it("does not store translations whose placeholders changed, and requests them again", async () => {
    await writeFile(path.join(root, "src/App.tsx"), `export function App({ count }) { return <p>You have {count} documents</p>; }\n`);
    const broken: TranslationProvider = { async translate({ messages }) { return Object.fromEntries(messages.map(m => [m.id, "Viele Dokumente"])); } };
    await runBuild(autoI18n({ locales: ["en", "de"], provider: broken }));
    const catalog = JSON.parse(await readFile(path.join(root, ".autoi18n/locales/de.json"), "utf8")).messages;
    expect(catalog).toEqual({});

    const provider = fakeProvider();
    await runBuild(autoI18n({ locales: ["en", "de"], provider }));
    expect(provider.calls).toHaveLength(1);
    expect(Object.values(JSON.parse(await readFile(path.join(root, ".autoi18n/locales/de.json"), "utf8")).messages)).toEqual(["DE:You have {count} documents"]);
  });

  it("fails when translations are missing and no provider is configured", async () => {
    await writeFile(path.join(root, "src/App.tsx"), SOURCE);
    const plugin = autoI18n({ locales: ["en", "de"], failOnMissingProvider: true });
    await expect(runBuild(plugin)).rejects.toThrow(/no provider is configured/);
  });
});
