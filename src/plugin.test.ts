import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import autoI18n, { OpenAICompatibleProvider, PartialTranslationError, type AutoI18nOptions } from "./index.js";
import { RUNTIME_MODULE } from "./compiler/transform.js";
import type { TranslationProvider, TranslationRequest } from "./types.js";

const SOURCE = `export function App() { return <button title="Save the file">Save</button>; }\n`;
const TWO_SAVES = `export function App() { return <div><button>Save</button><button>Save</button></div>; }\n`;
const ONE_SAVE = `export function App() { return <div><button>Save</button></div>; }\n`;

interface Ctx { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> }

interface FakeServer {
  watcher: { on: (event: string, handler: (file: string) => void) => void };
  ws: { send: ReturnType<typeof vi.fn> };
  handlers: Record<string, (file: string) => void>;
}

interface Hooks {
  configResolved(config: Record<string, unknown>): void;
  buildStart(this: Ctx): Promise<void>;
  transform(this: Ctx, code: string, id: string): Promise<{ code: string } | null>;
  resolveId(id: string): string | undefined;
  load(id: string): string | undefined;
  configureServer(server: FakeServer): void;
  handleHotUpdate(ctx: { file: string }): Promise<unknown>;
  closeBundle(): void;
}

const context = (): Ctx => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn((message: string) => { throw new Error(message); })
});

const fakeProvider = (): TranslationProvider & { calls: TranslationRequest[][] } => {
  const calls: TranslationRequest[][] = [];
  return {
    calls,
    async translate({ messages }) {
      calls.push(messages);
      return Object.fromEntries(messages.map(m => [m.id, `DE:${m.source}`]));
    }
  };
};

describe("autoI18n plugin", () => {
  let root: string;
  let logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  const savedLocaleEnv = process.env.AUTOI18N_LOCALE;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "autoi18n-plugin-"));
    await mkdir(path.join(root, "src"), { recursive: true });
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    delete process.env.AUTOI18N_LOCALE;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (savedLocaleEnv === undefined) delete process.env.AUTOI18N_LOCALE;
    else process.env.AUTOI18N_LOCALE = savedLocaleEnv;
    await rm(root, { recursive: true, force: true });
  });

  const srcFile = (name = "App.tsx") => path.join(root, "src", name);
  const localeFile = (locale: string) => path.join(root, ".autoi18n/locales", `${locale}.json`);

  function start(options: AutoI18nOptions, command: "build" | "serve" = "build"): Hooks {
    const plugin = autoI18n(options) as unknown as Hooks;
    plugin.configResolved({ root, command, logger });
    return plugin;
  }

  it("bakes the translated text into the source on transform in build mode", async () => {
    await writeFile(srcFile(), SOURCE);
    const hooks = start({ locales: ["en", "de"], provider: fakeProvider(), locale: "de" });
    const ctx = context();
    await hooks.buildStart.call(ctx);
    const result = await hooks.transform.call(ctx, SOURCE, srcFile());
    expect(result?.code).toContain('"DE:Save the file"');
    expect(result?.code).toContain('"DE:Save"');
    expect(result?.code).not.toContain(RUNTIME_MODULE);
  });

  it("uses the source text in serve mode, even when another locale is selected", async () => {
    await writeFile(srcFile(), SOURCE);
    const hooks = start({ locales: ["en", "de"], provider: fakeProvider(), locale: "de" }, "serve");
    const ctx = context();
    await hooks.buildStart.call(ctx);
    const result = await hooks.transform.call(ctx, SOURCE, srcFile());
    expect(result?.code).toContain('"Save the file"');
    expect(result?.code).not.toContain("DE:");
  });

  it("emits runtime lookups that import the virtual module in runtime delivery", async () => {
    await writeFile(srcFile(), SOURCE);
    const hooks = start({ locales: ["en", "de"], provider: fakeProvider(), delivery: "runtime" });
    const ctx = context();
    await hooks.buildStart.call(ctx);
    const result = await hooks.transform.call(ctx, SOURCE, srcFile());
    expect(result?.code).toContain(`from "${RUNTIME_MODULE}"`);
    expect(result?.code).toContain('__autoI18nT("');
  });

  it("returns null from transform for files that are not indexed", async () => {
    await writeFile(srcFile(), SOURCE);
    const hooks = start({ locales: ["en", "de"], provider: fakeProvider() });
    const ctx = context();
    await hooks.buildStart.call(ctx);
    expect(await hooks.transform.call(ctx, "const a = 1;", path.join(root, "src", "other.css"))).toBeNull();
  });

  it("strips query strings from the module id when looking up indexed files", async () => {
    await writeFile(srcFile(), SOURCE);
    const hooks = start({ locales: ["en", "de"], provider: fakeProvider(), locale: "de" });
    const ctx = context();
    await hooks.buildStart.call(ctx);
    const result = await hooks.transform.call(ctx, SOURCE, `${srcFile()}?v=1`);
    expect(result?.code).toContain('"DE:Save"');
  });

  it("re-indexes a file that changed after the last build before transforming it", async () => {
    await writeFile(srcFile(), SOURCE);
    const hooks = start({ locales: ["en", "de"], provider: fakeProvider(), locale: "de" });
    const ctx = context();
    await hooks.buildStart.call(ctx);

    const changed = SOURCE.replace("Save the file", "Save the document");
    await writeFile(srcFile(), changed);
    const result = await hooks.transform.call(ctx, changed, srcFile());
    expect(result?.code).toContain('"DE:Save the document"');
    expect(ctx.warn).not.toHaveBeenCalled();
  });

  it("leaves a file untranslated and warns once when its code differs from the disk", async () => {
    await writeFile(srcFile(), SOURCE);
    const hooks = start({ locales: ["en", "de"], provider: fakeProvider() });
    const ctx = context();
    await hooks.buildStart.call(ctx);

    const unsaved = SOURCE.replace("Save the file", "Unsaved text");
    expect(await hooks.transform.call(ctx, unsaved, srcFile())).toBeNull();
    expect(await hooks.transform.call(ctx, unsaved, srcFile())).toBeNull();
    expect(ctx.warn).toHaveBeenCalledTimes(1);
    expect(ctx.warn.mock.calls[0][0]).toMatch(/changed while it was being indexed/);
  });

  it("resolves and loads the virtual runtime module listing every catalogue", async () => {
    await writeFile(srcFile(), SOURCE);
    const hooks = start({ locales: ["en", "de"], provider: fakeProvider() });
    await hooks.buildStart.call(context());
    expect(hooks.resolveId(RUNTIME_MODULE)).toBe(`\0${RUNTIME_MODULE}`);
    expect(hooks.resolveId("./other")).toBeUndefined();
    expect(hooks.load(`\0${RUNTIME_MODULE}`)).toContain(`"de": () => import(`);
    expect(hooks.load("./other")).toBeUndefined();
  });

  it("only translates the explicitly selected locale when building one locale", async () => {
    await writeFile(srcFile(), SOURCE);
    const provider = fakeProvider();
    const hooks = start({ locales: ["en", "de", "fr"], provider, locale: "fr" });
    await hooks.buildStart.call(context());
    expect(existsSync(localeFile("fr"))).toBe(true);
    expect(existsSync(localeFile("de"))).toBe(false);
    expect(provider.calls.length).toBe(1);
  });

  it("honours the AUTOI18N_LOCALE environment variable as the selected locale", async () => {
    await writeFile(srcFile(), SOURCE);
    process.env.AUTOI18N_LOCALE = "de";
    const hooks = start({ locales: ["en", "de", "fr"], provider: fakeProvider() });
    await hooks.buildStart.call(context());
    expect(existsSync(localeFile("de"))).toBe(true);
    expect(existsSync(localeFile("fr"))).toBe(false);
  });

  it("rejects a selected locale that is not in the configured list", () => {
    process.env.AUTOI18N_LOCALE = "xx";
    const plugin = autoI18n({ locales: ["en", "de"] }) as unknown as Hooks;
    expect(() => plugin.configResolved({ root, command: "build", logger })).toThrow(/"xx" is not one of the configured locales/);
  });

  it("fails the build when a locale needs translation but no provider is configured and failOnMissingProvider is set", async () => {
    await writeFile(srcFile(), SOURCE);
    const hooks = start({ locales: ["en", "de"], failOnMissingProvider: true });
    await expect(hooks.buildStart.call(context())).rejects.toThrow(/Missing 2 de translations/);
  });

  it("reports untranslated messages as information when no provider is configured", async () => {
    await writeFile(srcFile(), SOURCE);
    const hooks = start({ locales: ["en", "de"] });
    const ctx = context();
    await hooks.buildStart.call(ctx);
    expect(ctx.info).toHaveBeenCalledWith(expect.stringMatching(/2 de messages have no translation/));
    expect(ctx.warn).not.toHaveBeenCalled();
  });

  it("warns about untranslated messages when a provider is configured but returned nothing", async () => {
    await writeFile(srcFile(), SOURCE);
    const silent: TranslationProvider = { translate: async () => ({}) };
    const hooks = start({ locales: ["en", "de"], provider: silent });
    const ctx = context();
    await hooks.buildStart.call(ctx);
    expect(ctx.warn).toHaveBeenCalledWith(expect.stringMatching(/2 de messages have no translation/));
  });

  it("reports rejected translations that changed placeholders", async () => {
    await writeFile(srcFile("Dialog.tsx"), `export function Dialog({ count }) { return <p>You have {count} documents</p>; }\n`);
    const broken: TranslationProvider = { translate: async ({ messages }) => Object.fromEntries(messages.map(m => [m.id, "Viele Dokumente"])) };
    const hooks = start({ locales: ["en", "de"], provider: broken });
    const ctx = context();
    await hooks.buildStart.call(ctx);
    expect(ctx.info).toHaveBeenCalledWith("autoi18n: rejected 1 de translations with changed placeholders.");
  });

  it("throws the first locale failure and warns about the others, keeping the previous file", async () => {
    await writeFile(srcFile(), SOURCE);
    const failing: TranslationProvider = { translate: async () => { throw new Error("boom"); } };
    const hooks = start({ locales: ["en", "de", "fr"], provider: failing });
    const ctx = context();
    await expect(hooks.buildStart.call(ctx)).rejects.toThrow("boom");
    expect(ctx.warn).toHaveBeenCalledWith(expect.stringMatching(/fr translation failed: boom/));
    expect(existsSync(localeFile("de"))).toBe(false);
  });

  it("warns about failed batches but still writes the translations that succeeded", async () => {
    await writeFile(srcFile(), SOURCE);
    const partial: TranslationProvider = {
      translate: async ({ messages }) => {
        throw new PartialTranslationError("1 messages failed to translate: busy", { [messages[0].id]: "Speichern" }, 1);
      }
    };
    const hooks = start({ locales: ["en", "de"], provider: partial });
    const ctx = context();
    await hooks.buildStart.call(ctx);
    expect(ctx.warn).toHaveBeenCalledWith(expect.stringMatching(/1 de translation batches failed \(1 messages failed to translate: busy\)/));
    const file = JSON.parse(await readFile(localeFile("de"), "utf8"));
    expect(Object.values(file.messages)).toContain("Speichern");
  });

  it("warns about a duplicated text whose occurrence count changed, and fails when onAmbiguous is error", async () => {
    await writeFile(srcFile(), TWO_SAVES);
    await start({ locales: ["en", "de"], provider: fakeProvider() }).buildStart.call(context());

    await writeFile(srcFile(), ONE_SAVE);
    const warned = context();
    await start({ locales: ["en", "de"], provider: fakeProvider() }).buildStart.call(warned);
    expect(warned.warn).toHaveBeenCalledWith(expect.stringMatching(/duplicated texts changed occurrence count/));

    await writeFile(srcFile(), TWO_SAVES);
    await start({ locales: ["en", "de"], provider: fakeProvider() }).buildStart.call(context());

    await writeFile(srcFile(), ONE_SAVE);
    const strict = context();
    await expect(start({ locales: ["en", "de"], provider: fakeProvider(), onAmbiguous: "error" }).buildStart.call(strict))
      .rejects.toThrow(/duplicated texts changed occurrence count/);
  });

  it("removes orphans past their retention period and logs the removals in debug mode", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await writeFile(srcFile(), `export function App() { return <div><p>Keep</p><p>Remove me</p></div>; }\n`);
    await start({ locales: ["en", "de"], provider: fakeProvider(), orphanRetentionMinutes: 0 }).buildStart.call(context());

    await writeFile(srcFile(), `export function App() { return <div><p>Keep</p></div>; }\n`);
    const ctx = context();
    await start({ locales: ["en", "de"], provider: fakeProvider(), orphanRetentionMinutes: 0, debug: true }).buildStart.call(ctx);
    expect(ctx.info).toHaveBeenCalledWith("autoi18n: removed 1 registry entries no longer in the source.");
    expect(log.mock.calls.map(call => String(call[0])).some(line => line.includes('removed') && line.includes('"Remove me"'))).toBe(true);
    const registry = JSON.parse(await readFile(path.join(root, ".autoi18n/registry.json"), "utf8"));
    expect(Object.values(registry.entries).map((e: { source: string }) => e.source)).toEqual(["Keep"]);
  });

  it("deletes the legacy <locale>.sources.json sidecar files", async () => {
    await writeFile(srcFile(), SOURCE);
    await mkdir(path.join(root, ".autoi18n/locales"), { recursive: true });
    await writeFile(path.join(root, ".autoi18n/locales/de.sources.json"), "{}");
    await start({ locales: ["en", "de"], provider: fakeProvider() }).buildStart.call(context());
    expect(existsSync(path.join(root, ".autoi18n/locales/de.sources.json"))).toBe(false);
  });

  it("writes the source-locale catalogue alongside the translations", async () => {
    await writeFile(srcFile(), SOURCE);
    await start({ locales: ["en", "de"], provider: fakeProvider() }).buildStart.call(context());
    const source = JSON.parse(await readFile(localeFile("en"), "utf8"));
    expect(Object.values(source.messages)).toEqual(["Save the file", "Save"]);
  });

  describe("dev server", () => {
    function server(): FakeServer {
      const handlers: Record<string, (file: string) => void> = {};
      return {
        handlers,
        watcher: { on: (event, handler) => { handlers[event] = handler; } },
        ws: { send: vi.fn() }
      };
    }

    it("pushes fresh catalogues after a source file is added", async () => {
      await writeFile(srcFile(), SOURCE);
      const hooks = start({ locales: ["en", "de"], provider: fakeProvider() }, "serve");
      await hooks.buildStart.call(context());
      const dev = server();
      hooks.configureServer(dev);

      await writeFile(srcFile("New.tsx"), `export function New() { return <p>Hello</p>; }\n`);
      dev.handlers.add(srcFile("New.tsx"));
      await vi.waitFor(() => expect(dev.ws.send).toHaveBeenCalledWith(expect.objectContaining({ type: "custom", event: "autoi18n:update" })));
    });

    it("ignores added files that are not source candidates", async () => {
      await writeFile(srcFile(), SOURCE);
      const hooks = start({ locales: ["en", "de"], provider: fakeProvider() }, "serve");
      await hooks.buildStart.call(context());
      const dev = server();
      hooks.configureServer(dev);
      dev.handlers.add(path.join(root, "src", "styles.css"));
      dev.handlers.add(path.join(root, "src", "App.test.tsx"));
      await new Promise(resolve => setTimeout(resolve, 250));
      expect(dev.ws.send).not.toHaveBeenCalled();
    });

    it("re-indexes when an indexed source file is removed but not when an unknown file is", async () => {
      await writeFile(srcFile(), SOURCE);
      const hooks = start({ locales: ["en", "de"], provider: fakeProvider() }, "serve");
      await hooks.buildStart.call(context());
      const dev = server();
      hooks.configureServer(dev);

      dev.handlers.unlink(path.join(root, "src", "unknown.tsx"));
      await new Promise(resolve => setTimeout(resolve, 250));
      expect(dev.ws.send).not.toHaveBeenCalled();

      dev.handlers.unlink(srcFile());
      await vi.waitFor(() => expect(dev.ws.send).toHaveBeenCalledTimes(1));
    });

    it("cancels a pending re-index when the bundle closes", async () => {
      await writeFile(srcFile(), SOURCE);
      const hooks = start({ locales: ["en", "de"], provider: fakeProvider() }, "serve");
      await hooks.buildStart.call(context());
      const dev = server();
      hooks.configureServer(dev);
      dev.handlers.add(path.join(root, "src", "New.tsx"));
      hooks.closeBundle();
      await new Promise(resolve => setTimeout(resolve, 250));
      expect(dev.ws.send).not.toHaveBeenCalled();
    });

    it("ignores HMR updates to catalogue files and to unindexed files", async () => {
      await writeFile(srcFile(), SOURCE);
      const hooks = start({ locales: ["en", "de"], provider: fakeProvider() }, "serve");
      await hooks.buildStart.call(context());
      const dev = server();
      hooks.configureServer(dev);
      expect(await hooks.handleHotUpdate({ file: path.join(root, ".autoi18n/locales/de.json") })).toEqual([]);
      expect(await hooks.handleHotUpdate({ file: path.join(root, "src", "other.tsx") })).toBeUndefined();
      expect(dev.ws.send).not.toHaveBeenCalled();
    });

    it("re-translates and pushes catalogues when an indexed source file is edited", async () => {
      await writeFile(srcFile(), SOURCE);
      const hooks = start({ locales: ["en", "de"], provider: fakeProvider() }, "serve");
      await hooks.buildStart.call(context());
      const dev = server();
      hooks.configureServer(dev);
      await writeFile(srcFile(), SOURCE.replace("Save the file", "Save the note"));
      await hooks.handleHotUpdate({ file: srcFile() });
      expect(dev.ws.send).toHaveBeenCalledWith(expect.objectContaining({
        data: { catalogs: expect.objectContaining({ de: expect.any(Object) }) }
      }));
    });

    it("logs an error instead of rejecting when a dev re-translation fails", async () => {
      await writeFile(srcFile(), SOURCE);
      let offline = false;
      const flaky: TranslationProvider = {
        translate: async ({ messages }) => {
          if (offline) throw new Error("offline");
          return Object.fromEntries(messages.map(m => [m.id, `DE:${m.source}`]));
        }
      };
      const hooks = start({ locales: ["en", "de"], provider: flaky }, "serve");
      await hooks.buildStart.call(context());
      const dev = server();
      hooks.configureServer(dev);
      await writeFile(srcFile(), SOURCE.replace("Save the file", "Broken"));
      offline = true;
      await hooks.handleHotUpdate({ file: srcFile() });
      expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/re-translation failed: offline/));
      expect(dev.ws.send).not.toHaveBeenCalled();
    });
  });
});

describe("public exports", () => {
  it("exposes the OpenAI-compatible provider and the partial-failure error", () => {
    expect(typeof OpenAICompatibleProvider).toBe("function");
    expect(new PartialTranslationError("x", {}, 0).name).toBe("PartialTranslationError");
  });
});
