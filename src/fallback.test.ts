import { describe, expect, it, vi } from "vitest";
import { FallbackProvider, resolveProvider } from "./ai/fallback.js";
import { PartialTranslationError } from "./errors.js";
import type { Catalog, TranslationProvider, TranslationRequest } from "./types.js";

const messages: TranslationRequest[] = [
  { id: "a", source: "Save", context: "", kind: "string" },
  { id: "b", source: "Open", context: "", kind: "string" },
  { id: "c", source: "Close", context: "", kind: "string" }
];
const input = { sourceLocale: "en", targetLocale: "de", messages };

function fake(result: () => Promise<Catalog>): TranslationProvider & { translate: ReturnType<typeof vi.fn> } {
  return { translate: vi.fn(result) } as TranslationProvider & { translate: ReturnType<typeof vi.fn> };
}

describe("resolveProvider", () => {
  it("returns a single provider unchanged", () => {
    const provider = fake(async () => ({}));
    expect(resolveProvider(provider)).toBe(provider);
  });

  it("returns undefined when nothing is configured", () => {
    expect(resolveProvider(undefined)).toBeUndefined();
    expect(resolveProvider({ anthropic: undefined, openai: undefined })).toBeUndefined();
  });

  it("returns the only configured provider without wrapping it", () => {
    const anthropic = fake(async () => ({}));
    expect(resolveProvider({ anthropic, openai: undefined })).toBe(anthropic);
  });

  it("rejects a primary that is not configured", () => {
    expect(() => resolveProvider({ primary: "openai", anthropic: fake(async () => ({})) })).toThrow(/primary provider "openai" is not configured/);
  });

  it("rejects an entry that is not a provider", () => {
    expect(() => resolveProvider({ anthropic: "key" as unknown as TranslationProvider })).toThrow(/provider "anthropic" must be/);
  });
});

describe("FallbackProvider", () => {
  it("uses the primary and never calls the fallback when it succeeds", async () => {
    const primary = fake(async () => ({ a: "A", b: "B", c: "C" }));
    const secondary = fake(async () => ({}));
    const provider = resolveProvider({ primary: "anthropic", anthropic: primary, openai: secondary });

    expect(await provider!.translate(input)).toEqual({ a: "A", b: "B", c: "C" });
    expect(secondary.translate).not.toHaveBeenCalled();
  });

  it("falls back to the next provider when the primary throws", async () => {
    const onFallback = vi.fn();
    const primary = fake(async () => { throw new Error("401 unauthorized"); });
    const secondary = fake(async () => ({ a: "A", b: "B", c: "C" }));
    const provider = resolveProvider({ primary: "anthropic", anthropic: primary, openai: secondary }, onFallback);

    expect(await provider!.translate(input)).toEqual({ a: "A", b: "B", c: "C" });
    expect(secondary.translate.mock.calls[0][0].messages).toEqual(messages);
    expect(onFallback).toHaveBeenCalledWith(expect.stringContaining("anthropic failed (401 unauthorized)"));
  });

  it("sends only the missing messages after a partial result", async () => {
    const primary = fake(async () => { throw new PartialTranslationError("1 failed", { a: "A" }, 2); });
    const secondary = fake(async () => ({ b: "B", c: "C" }));
    const provider = resolveProvider({ primary: "anthropic", anthropic: primary, openai: secondary });

    expect(await provider!.translate(input)).toEqual({ a: "A", b: "B", c: "C" });
    expect(secondary.translate.mock.calls[0][0].messages.map((m: TranslationRequest) => m.id)).toEqual(["b", "c"]);
  });

  it("uses the declared order when no primary is set", async () => {
    const first = fake(async () => { throw new Error("down"); });
    const second = fake(async () => ({ a: "A", b: "B", c: "C" }));
    const provider = resolveProvider({ openai: first, anthropic: second });

    expect(await provider!.translate(input)).toEqual({ a: "A", b: "B", c: "C" });
    expect(first.translate).toHaveBeenCalledOnce();
    expect(second.translate).toHaveBeenCalledOnce();
  });

  it("rethrows the first error when every provider fails completely", async () => {
    const first = new Error("first");
    const provider = new FallbackProvider([
      { name: "anthropic", provider: fake(async () => { throw first; }) },
      { name: "openai", provider: fake(async () => { throw new Error("second"); }) }
    ]);

    await expect(provider.translate(input)).rejects.toBe(first);
  });

  it("throws a PartialTranslationError when some messages remain after every provider", async () => {
    const provider = new FallbackProvider([
      { name: "anthropic", provider: fake(async () => ({ a: "A" })) },
      { name: "openai", provider: fake(async () => { throw new Error("down"); }) }
    ]);

    const error = await provider.translate(input).catch(e => e);
    expect(error).toBeInstanceOf(PartialTranslationError);
    expect(error.partial).toEqual({ a: "A" });
    expect(error.failed).toBe(2);
  });
});
