import { afterEach, describe, expect, it, vi } from "vitest";
import { IntlMessageFormat } from "intl-messageformat";
import { createFormatModule, formatMessage } from "../../src/runtime/format.js";
import { createLocaleLoader } from "../../src/runtime/loader.js";
import { resolveLocale } from "../../src/runtime/resolve.js";

const format = (text: string, values: Record<string, unknown>, locale = "en") =>
  formatMessage(IntlMessageFormat, new Map(), text, values, locale);

describe("formatMessage", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps values as they are, so React nodes stay separate parts", () => {
    const node = { $$typeof: "react-element" };
    const parts = format("You have {count} documents, {doc} is ready", { count: 3, doc: node });
    expect(parts).toContain(node);
    expect(parts.filter((part) => typeof part === "string").join("")).toBe("You have 3 documents,  is ready");
  });

  it("supports plural and select arguments", () => {
    expect(format("{n, plural, one {# file} other {# files}}", { n: 1 }).join("")).toBe("1 file");
    expect(format("{n, plural, one {# file} other {# files}}", { n: 2 }).join("")).toBe("2 files");
    expect(format("{g, select, female {She} other {They}} wrote it", { g: "female" }).join("")).toBe("She wrote it");
  });

  it("gives the same result when a cached formatter is reused", () => {
    const cache = new Map();
    const text = "{n, plural, one {# file} other {# files}}";
    expect(formatMessage(IntlMessageFormat, cache, text, { n: 3 }, "en").join("")).toBe("3 files");
    expect(formatMessage(IntlMessageFormat, cache, text, { n: 1 }, "en").join("")).toBe("1 file");
    expect(cache.size).toBe(1);
  });

  it("reads escaped apostrophes and braces as literal text", () => {
    expect(format("Don''t delete '{'{count}'}' files", { count: 2 }).join("")).toBe("Don't delete {2} files");
  });

  it("returns the text unchanged when it cannot be parsed or a value is missing", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(format("Unclosed {count", {})).toEqual(["Unclosed {count"]);
    expect(format("Hi {name}", {})).toEqual(["Hi {name}"]);
  });
});

describe("createFormatModule", () => {
  it("imports the library and exports format(text, values, locale)", () => {
    const code = createFormatModule();
    expect(code).toContain('import { IntlMessageFormat } from "intl-messageformat";');
    expect(code).toContain("export function format(text, values, locale)");
  });
});

describe("resolveLocale", () => {
  it("matches an exact locale case-insensitively", () => {
    expect(resolveLocale(["pt-br"], ["en", "pt-BR"])).toBe("pt-BR");
  });

  it("prefers an exact match over a language match from the same list entry", () => {
    expect(resolveLocale(["en-US"], ["en", "en-US"])).toBe("en-US");
  });

  it("uses the first preferred language that has a supported match", () => {
    expect(resolveLocale(["ja", "fr-CA"], ["en", "fr"])).toBe("fr");
  });

  it("falls back to the given fallback when nothing matches", () => {
    expect(resolveLocale([], ["de"], "de")).toBe("de");
    expect(resolveLocale(["zh"], ["de"], "de")).toBe("de");
  });
});

describe("createLocaleLoader", () => {
  it("loads a catalogue once and serves later requests from the cache", async () => {
    const loader = vi.fn(async () => ({ default: { a: "A" } }));
    const load = createLocaleLoader({ en: loader });
    expect(await load("en")).toEqual({ a: "A" });
    expect(await load("en")).toEqual({ a: "A" });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("returns module objects that have no default export as they are", async () => {
    const load = createLocaleLoader({
      en: async () => ({ hello: "Hello" }) as unknown as { default: Record<string, string> },
    });
    expect(await load("en")).toEqual({ hello: "Hello" });
  });

  it("rejects when neither the locale nor the fallback has a loader", async () => {
    const load = createLocaleLoader({ de: async () => ({ default: {} }) }, "en");
    await expect(load("en")).rejects.toThrow('No catalogue loader for locale "en"');
  });

  it("does not cache a failed load, so the next request tries again", async () => {
    const loader = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({ default: { a: "A" } });
    const load = createLocaleLoader({ en: loader });
    await expect(load("en")).rejects.toThrow("network");
    expect(await load("en")).toEqual({ a: "A" });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("serves a primed catalogue without calling the loader", async () => {
    const loader = vi.fn(async () => ({ default: { a: "old" } }));
    const load = createLocaleLoader({ de: loader });
    load.prime("de", { a: "new" });
    expect(await load("de")).toEqual({ a: "new" });
    expect(loader).not.toHaveBeenCalled();
  });
});
