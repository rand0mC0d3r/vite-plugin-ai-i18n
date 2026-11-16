import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { extractMessages } from "../src/compiler/extract.js";
import { transformSource } from "../src/compiler/transform.js";
import autoI18n, { OpenAICompatibleProvider } from "../src/index.js";
import { createLocaleLoader, resolveLocale } from "../src/runtime/index.js";
import type { ResolvedMessage, TranslationProvider, TranslationRequest } from "../src/types.js";
import { createRuntimeModule } from "../src/virtual/runtime.js";

const SOURCE = `import { t } from "virtual:autoi18n";\nexport function App() { return <button title={t("Save the file")}>{t("Save")}</button>; }\n`;

function withIds(messages: ReturnType<typeof extractMessages>): ResolvedMessage[] {
  return messages.map((m, i) => ({ ...m, id: `msg_${i}` }));
}

describe("transformSource", () => {
  const messages = withIds(extractMessages(SOURCE, "App.tsx"));
  const catalog = { msg_0: "Datei speichern", msg_1: "Speichern" };

  it("bakes the selected locale into the code in build mode", () => {
    const { code } = transformSource(SOURCE, "App.tsx", messages, "de", catalog);
    expect(code).toContain('"Datei speichern"');
    expect(code).toContain('"Speichern"');
    expect(code).not.toContain("__autoI18nT(");
  });

  it("keeps the source text for messages without a translation in build mode", () => {
    const { code } = transformSource(SOURCE, "App.tsx", messages, "de", { msg_0: "Datei speichern" });
    expect(code).toContain('"Datei speichern"');
    expect(code).toContain('"Save"');
  });

  it("emits the source text, ignoring catalogues, when building the source locale", () => {
    const { code } = transformSource(SOURCE, "App.tsx", messages, "en", catalog);
    expect(code).toContain('"Save the file"');
    expect(code).not.toContain('"Datei speichern"');
  });

  it("escapes translated text so it cannot break out of its string literal in build mode", () => {
    const payload = 'He said "hi" \\ </script>';
    const { code } = transformSource(SOURCE, "App.tsx", messages, "de", { msg_0: payload });
    expect(code).toContain(JSON.stringify(payload));
  });

  it("emits runtime lookups with the source as fallback in runtime mode", () => {
    const { code } = transformSource(SOURCE, "App.tsx", messages, "de", catalog, true);
    expect(code).toContain('import { lookup as __autoI18nT } from "virtual:autoi18n"');
    expect(code).toContain('__autoI18nT("msg_0", "Save the file")');
    expect(code).toContain('__autoI18nT("msg_1", "Save")');
    expect(code).not.toContain('"Datei speichern"');
  });

  it("leaves the code untouched when there are no messages", () => {
    const code = `export const x = 1;\n`;
    const result = transformSource(code, "x.ts", [], "de", {}, true);
    expect(result.code).toBe(code);
  });
});

describe("t() call sites", () => {
  const CODE = `import { t } from "virtual:autoi18n";\nconst items = [{ label: t("Shared with your team"), size: "12 KB" }, { label: "Private" }];\nexport const App = () => <p>{items.length}</p>;\n`;
  const messages = withIds(extractMessages(CODE, "Items.tsx"));

  it("extracts only the string passed to t()", () => {
    expect(messages.map((m) => m.source)).toEqual(["Shared with your team"]);
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

describe("t() calls with values", () => {
  const CODE = `import { t } from "virtual:autoi18n";\nexport const App = ({ count }) => <p>{t("{count, plural, one {# file} other {# files}}", { count })}</p>;\n`;
  const messages = withIds(extractMessages(CODE, "Files.tsx"));

  it("formats the translation with the values in build mode and imports the formatter", () => {
    const { code } = transformSource(CODE, "Files.tsx", messages, "de", {
      msg_0: "{count, plural, one {# Datei} other {# Dateien}}",
    });
    expect(code).toContain('import { formatMessage as __autoI18nFormat } from "vite-plugin-ai-auto-i18n/runtime";');
    expect(code).toContain('__autoI18nFormat("{count, plural, one {# Datei} other {# Dateien}}", "de", { count })');
  });

  it("passes the values to lookup in runtime mode", () => {
    const { code } = transformSource(CODE, "Files.tsx", messages, "de", {}, true);
    expect(code).toContain('__autoI18nT("msg_0", "{count, plural, one {# file} other {# files}}", { count })');
    expect(code).not.toContain("__autoI18nFormat");
  });
});

describe("runtime module", () => {
  it("lists every catalogue and resolves unknown locales to the source", () => {
    const code = createRuntimeModule({ en: "/x/en.json", de: "/x/de.json" }, "en");
    expect(code).toContain('"de": () => import("/x/de.json")');
    expect(code).toContain('const sourceLocale = "en"');
    expect(code).toContain("export function lookup(id, source, values)");
    expect(code).toContain("export function t(source, values)");
  });
});

describe("runtime loader", () => {
  it("falls back to the fallback locale and unwraps JSON default exports", async () => {
    const load = createLocaleLoader({
      en: () => Promise.resolve({ default: { a: "A" } }),
      de: () => Promise.resolve({ b: "B" }),
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
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ msg_0: "Speichern" }) } }],
          }),
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAICompatibleProvider({ apiKey: "test-key", model: "m" });
    const result = await provider.translate({
      sourceLocale: "en",
      targetLocale: "de",
      messages: [{ id: "msg_0", source: "Save", context: "" }],
    });
    expect(result).toEqual({ msg_0: "Speichern" });
    const init = fetchMock.mock.calls[0]?.[1];
    expect((init?.headers as Record<string, string>)["Authorization"]).toBe("Bearer test-key");
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

  // Shape of the generated locale file under .autoi18n/locales.
  type LocaleFile = { messages: Record<string, string>; sources: Record<string, string> };

  async function readLocale(file: string): Promise<LocaleFile> {
    return JSON.parse(await readFile(path.join(root, file), "utf8")) as LocaleFile;
  }

  function fakeProvider(): TranslationProvider & { calls: TranslationRequest[][] } {
    const calls: TranslationRequest[][] = [];
    return {
      calls,
      translate({ messages }) {
        calls.push(messages);
        return Promise.resolve(Object.fromEntries(messages.map((m) => [m.id, `DE:${m.source}`])));
      },
    };
  }

  async function runBuild(plugin: ReturnType<typeof autoI18n>) {
    const hooks = plugin as unknown as {
      configResolved: (c: { root: string }) => void;
      buildStart: (this: unknown) => Promise<void>;
    };
    hooks.configResolved({ root });
    await hooks.buildStart.call({
      info() {},
      warn() {},
      error(message: string) {
        throw new Error(message);
      },
    });
  }

  it("translates new messages and re-requests those whose source text changed", async () => {
    await writeFile(path.join(root, "src/App.tsx"), SOURCE);
    const provider = fakeProvider();
    const plugin = autoI18n({ locales: ["en", "de"], provider });

    await runBuild(plugin);
    expect(provider.calls.flat().map((m) => m.source)).toEqual(["Save the file", "Save"]);
    const catalog = (await readLocale(".autoi18n/locales/de.json")).messages;
    expect(Object.values(catalog)).toEqual(["DE:Save the file", "DE:Save"]);

    // Second build with unchanged sources must not call the provider again.
    await runBuild(autoI18n({ locales: ["en", "de"], provider }));
    expect(provider.calls).toHaveLength(1);

    // Same ID with a source text that no longer matches the recorded source must be re-translated.
    const localePath = path.join(root, ".autoi18n/locales/de.json");
    const localeFile = await readLocale(".autoi18n/locales/de.json");
    const staleId = provider.calls[0][0].id;
    localeFile.sources[staleId] = "Previously translated text";
    await writeFile(localePath, JSON.stringify(localeFile));
    await runBuild(autoI18n({ locales: ["en", "de"], provider }));
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[1].map((m) => m.id)).toEqual([staleId]);
  });

  it("re-translates a message whose text changed in the source", async () => {
    await writeFile(path.join(root, "src/App.tsx"), SOURCE);
    const provider = fakeProvider();
    await runBuild(autoI18n({ locales: ["en", "de"], provider }));

    await writeFile(path.join(root, "src/App.tsx"), SOURCE.replace("Save the file", "Save the document"));
    await runBuild(autoI18n({ locales: ["en", "de"], provider }));
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[1].map((m) => m.source)).toEqual(["Save the document"]);
  });

  it("fails when translations are missing and no provider is configured", async () => {
    await writeFile(path.join(root, "src/App.tsx"), SOURCE);
    const plugin = autoI18n({ locales: ["en", "de"], failOnMissingProvider: true });
    await expect(runBuild(plugin)).rejects.toThrow(/no provider is configured/);
  });

  it("re-indexes only the changed file on a hot update and skips the provider when nothing changed", async () => {
    await writeFile(path.join(root, "src/App.tsx"), SOURCE);
    await writeFile(
      path.join(root, "src/Other.tsx"),
      `import { t } from "virtual:autoi18n";\nexport function Other() { return <p>{t("Cancel")}</p>; }\n`,
    );
    const provider = fakeProvider();
    const plugin = autoI18n({ locales: ["en", "de"], provider });
    const errors: string[] = [];
    const logger = { info() {}, warn() {}, error: (message: string) => errors.push(message) };
    const hooks = plugin as unknown as {
      configResolved: (c: { root: string; logger: unknown }) => void;
      buildStart: (this: unknown) => Promise<void>;
      handleHotUpdate: (context: { file: string }) => Promise<unknown>;
    };
    hooks.configResolved({ root, logger });
    await hooks.buildStart.call({
      info() {},
      warn() {},
      error(message: string) {
        throw new Error(message);
      },
    });
    expect(provider.calls.flat()).toHaveLength(3);

    await writeFile(path.join(root, "src/App.tsx"), SOURCE.replace("Save the file", "Save the document"));
    await hooks.handleHotUpdate({ file: path.join(root, "src/App.tsx") });
    expect(errors).toEqual([]);
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[1].map((m) => m.source)).toContain("Save the document");

    await hooks.handleHotUpdate({ file: path.join(root, "src/App.tsx") });
    expect(errors).toEqual([]);
    expect(provider.calls).toHaveLength(2);
  });
});

describe("plugin hooks", () => {
  type Hooks = {
    resolveId: (this: unknown, id: string) => unknown;
    load: (this: unknown, id: string) => unknown;
  };
  const noopProvider: TranslationProvider = { translate: () => Promise.resolve({}) };

  it("resolves and loads the runtime module, and leaves other ids alone", () => {
    const hooks = autoI18n({ locales: ["en", "de"], provider: noopProvider }) as unknown as Hooks;
    expect(hooks.resolveId.call({}, "virtual:autoi18n")).toBe("\0virtual:autoi18n");
    expect(hooks.resolveId.call({}, "/app/src/App.tsx")).toBeUndefined();
    expect(hooks.load.call({}, "\0virtual:autoi18n")).toContain("export");
    expect(hooks.load.call({}, "/app/src/App.tsx")).toBeUndefined();
  });

  it("names the options path in the error when the whole options value is invalid", () => {
    expect(() => autoI18n("nope" as never)).toThrow(/invalid options \(options:/);
  });
});
