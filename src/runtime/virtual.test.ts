import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRuntimeModule } from "./virtual.js";

type RuntimeModule = {
  setLocale(locale: string): Promise<void>;
  getLocale(): string;
  getVersion(): number;
  t(id: string, source: string): string;
};

describe("generated setLocale", () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(path.join(os.tmpdir(), "autoi18n-runtime-")); });
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
    expect(runtime.t("a", "Save")).toBe("Speichern");
  });

  it("falls back to the source locale when the requested catalogue fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const runtime = await load({ en: `{ a: "Save" }`, de: null });
    await expect(runtime.setLocale("de")).resolves.toBeUndefined();
    expect(runtime.getLocale()).toBe("en");
    expect(runtime.t("a", "Save")).toBe("Save");
  });

  it("does not reject and keeps the current state when the source catalogue fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const runtime = await load({ en: null, de: null });
    const before = runtime.getVersion();
    await expect(runtime.setLocale("de")).resolves.toBeUndefined();
    expect(runtime.getLocale()).toBe("en");
    expect(runtime.getVersion()).toBe(before);
    expect(runtime.t("a", "Save")).toBe("Save");
    expect(warn).toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
  });
});
