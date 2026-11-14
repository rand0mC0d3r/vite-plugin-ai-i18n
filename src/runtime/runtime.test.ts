import { describe, expect, it, vi } from "vitest";
import { formatPlaceholders } from "./format.js";
import { createLocaleLoader } from "./loader.js";
import { resolveLocale } from "./resolve.js";
import { PLACEHOLDER } from "../constants.js";

describe("formatPlaceholders", () => {
  it("splits the text around known placeholders and keeps the values as they are", () => {
    const node = { el: true };
    const parts = formatPlaceholders("You have {count} documents, {doc} is ready", { count: 3, doc: node }, PLACEHOLDER);
    expect(parts).toEqual(["You have ", 3, " documents, ", node, " is ready"]);
  });

  it("keeps unknown placeholder names as literal text", () => {
    expect(formatPlaceholders("Hi {name}, {missing}!", { name: "Ann" }, PLACEHOLDER)).toEqual(["Hi ", "Ann", ", {missing}!"]);
  });

  it("returns the text unchanged when there are no placeholders", () => {
    expect(formatPlaceholders("Plain text", {}, PLACEHOLDER)).toEqual(["Plain text"]);
  });

  it("does not emit empty strings for placeholders at the edges", () => {
    expect(formatPlaceholders("{a}{b}", { a: 1, b: 2 }, PLACEHOLDER)).toEqual([1, 2]);
    expect(formatPlaceholders("", {}, PLACEHOLDER)).toEqual([]);
  });

  it("does not treat inherited object properties as values", () => {
    expect(formatPlaceholders("{toString}", {}, PLACEHOLDER)).toEqual(["{toString}"]);
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
    const load = createLocaleLoader({ en: async () => ({ hello: "Hello" }) as unknown as { default: Record<string, string> } });
    expect(await load("en")).toEqual({ hello: "Hello" });
  });

  it("rejects when neither the locale nor the fallback has a loader", async () => {
    const load = createLocaleLoader({ de: async () => ({ default: {} }) }, "en");
    await expect(load("en")).rejects.toThrow('No catalogue loader for locale "en"');
  });

  it("does not cache a failed load, so the next request tries again", async () => {
    const loader = vi.fn()
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
