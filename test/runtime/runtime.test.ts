import { describe, expect, it, vi } from "vitest";

import { createLocaleLoader, resolveLocale } from "../../src/runtime/loader.js";

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
    const loader = vi.fn(() => Promise.resolve({ default: { a: "A" } }));
    const load = createLocaleLoader({ en: loader });
    expect(await load("en")).toEqual({ a: "A" });
    expect(await load("en")).toEqual({ a: "A" });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("returns module objects that have no default export as they are", async () => {
    const load = createLocaleLoader({
      en: () => Promise.resolve({ hello: "Hello" }),
    });
    expect(await load("en")).toEqual({ hello: "Hello" });
  });

  it("rejects when neither the locale nor the fallback has a loader", async () => {
    const load = createLocaleLoader({ de: () => Promise.resolve({ default: {} }) }, "en");
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
    const loader = vi.fn(() => Promise.resolve({ default: { a: "old" } }));
    const load = createLocaleLoader({ de: loader });
    load.prime("de", { a: "new" });
    expect(await load("de")).toEqual({ a: "new" });
    expect(loader).not.toHaveBeenCalled();
  });
});
