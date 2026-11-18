import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRuntimeModule } from "../../src/virtual/runtime.js";

type RuntimeModule = {
  setLocale(locale: string): Promise<void>;
  getLocale(): string;
  getVersion(): number;
  lookup(id: string, source: string, values?: Record<string, unknown>): string;
  t(source: string, values?: Record<string, unknown>): string;
  tt(source: string, values?: Record<string, unknown>, hint?: string): string;
};

describe("createRuntimeModule escaping", () => {
  it("encodes markup and line separators in embedded values", () => {
    const code = createRuntimeModule({ 'en"</script>\u2028': "/x/en.json" }, "en\u2029&");
    expect(code).not.toContain("</script>");
    expect(code).not.toContain("\u2028");
    expect(code).not.toContain("\u2029");
    expect(code).toContain("\\u003c/script\\u003e");
    expect(code).toContain("\\u2029\\u0026");
  });
});

describe("generated setLocale", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "autoi18n-runtime-"));
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  async function load(catalogs: Record<string, string | null>): Promise<RuntimeModule> {
    const files: Record<string, string> = {};
    for (const [locale, body] of Object.entries(catalogs)) {
      if (body === null) {
        files[locale] = pathToFileURL(path.join(dir, `missing-${locale}.mjs`)).href;
        continue;
      }
      const file = path.join(dir, `${locale}.mjs`);
      await writeFile(file, `export default { messages: ${body} };\n`);
      files[locale] = pathToFileURL(file).href;
    }
    const code = createRuntimeModule(files, "en");
    const moduleFile = path.join(dir, `runtime-${Math.random().toString(36).slice(2)}.mjs`);
    await writeFile(moduleFile, code);
    return import(pathToFileURL(moduleFile).href) as Promise<RuntimeModule>;
  }

  it("switches to a locale whose catalogue loads", async () => {
    const runtime = await load({ en: `{ a: "Save" }`, de: `{ a: "Speichern" }` });
    await runtime.setLocale("de");
    expect(runtime.getLocale()).toBe("de");
    expect(runtime.lookup("a", "Save")).toBe("Speichern");
    expect(runtime.t("Save")).toBe("Save");
  });

  it("formats messages with values in the active locale", async () => {
    const runtime = await load({
      en: `{ a: "{count, plural, one {# file} other {# files}}" }`,
      de: `{ a: "{count, plural, one {# Datei} other {# Dateien}}" }`,
    });
    await runtime.setLocale("en");
    expect(runtime.lookup("a", "unused", { count: 1 })).toBe("1 file");
    await runtime.setLocale("de");
    expect(runtime.lookup("a", "unused", { count: 2 })).toBe("2 Dateien");
    expect(runtime.t("{count, plural, one {# Datei} other {# Dateien}}", { count: 1 })).toBe("1 Datei");
  });

  it("formats tt() plural fallbacks in the active source locale", async () => {
    const runtime = await load({ en: `{}` });
    expect(runtime.tt("{count} items", { count: 0 })).toBe("No items");
    expect(runtime.tt("{count} items", { count: 1 })).toBe("1 item");
    expect(runtime.tt("{count} items", { count: 5 })).toBe("5 items");
  });

  it("returns the source unformatted when a value is missing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const runtime = await load({ en: `{}` });
    expect(runtime.t("Hello {name}", {})).toBe("Hello {name}");
    expect(warn).toHaveBeenCalled();
  });

  it("falls back to the source locale when the requested catalogue fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const runtime = await load({ en: `{ a: "Save" }`, de: null });
    await expect(runtime.setLocale("de")).resolves.toBeUndefined();
    expect(runtime.getLocale()).toBe("en");
    expect(runtime.lookup("a", "Save")).toBe("Save");
  });

  it("does not reject and keeps the current state when the source catalogue fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const runtime = await load({ en: null, de: null });
    const before = runtime.getVersion();
    await expect(runtime.setLocale("de")).resolves.toBeUndefined();
    expect(runtime.getLocale()).toBe("en");
    expect(runtime.getVersion()).toBe(before);
    expect(runtime.lookup("a", "Save")).toBe("Save");
    expect(warn).toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
  });
});
