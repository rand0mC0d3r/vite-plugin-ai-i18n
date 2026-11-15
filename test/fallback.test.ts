import { describe, expect, it, vi, type Mock } from "vitest";
import { FallbackProvider, resolveProvider } from "../src/ai/fallback.js";
import { PartialTranslationError } from "../src/errors.js";
import type { Catalog, TranslationProvider, TranslationRequest } from "../src/types.js";

/** Narrows an optional provider for tests, failing loudly if resolution returned nothing. */
function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("expected a provider");
  return value;
}

const messages: TranslationRequest[] = [
  { id: "a", source: "Save", context: "", kind: "string" },
  { id: "b", source: "Open", context: "", kind: "string" },
  { id: "c", source: "Close", context: "", kind: "string" },
];
const input = { sourceLocale: "en", targetLocale: "de", messages };

type Translate = TranslationProvider["translate"];

function fake(result: () => Promise<Catalog>): { translate: Mock<Translate> } {
  return { translate: vi.fn<Translate>(result) };
}

describe("resolveProvider", () => {
  it("returns a single provider unchanged", () => {
    const provider = fake(() => Promise.resolve({}));
    expect(resolveProvider(provider)).toBe(provider);
  });

  it("returns undefined when nothing is configured", () => {
    expect(resolveProvider(undefined)).toBeUndefined();
    expect(resolveProvider({ anthropic: undefined, openai: undefined })).toBeUndefined();
  });

  it("returns the only configured provider without wrapping it", () => {
    const anthropic = fake(() => Promise.resolve({}));
    expect(resolveProvider({ anthropic, openai: undefined })).toBe(anthropic);
  });

  it("rejects a primary that is not configured", () => {
    expect(() => resolveProvider({ primary: "openai", anthropic: fake(() => Promise.resolve({})) })).toThrow(
      /primary provider "openai" is not configured/,
    );
  });

  it("rejects an entry that is not a provider", () => {
    expect(() => resolveProvider({ anthropic: "key" as unknown as TranslationProvider })).toThrow(
      /provider "anthropic" must be/,
    );
  });
});

describe("FallbackProvider", () => {
  it("sends message IDs that match Object.prototype names to the fallback", async () => {
    const requests: TranslationRequest[] = [{ id: "constructor", source: "Build", context: "", kind: "string" }];
    const primary = fake(() => Promise.resolve({}));
    const secondary = fake(() => Promise.resolve({ constructor: "Bauen" }));
    const provider = resolveProvider({ primary: "anthropic", anthropic: primary, openai: secondary });

    const result = await must(provider).translate({ sourceLocale: "en", targetLocale: "de", messages: requests });

    expect(secondary.translate).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ constructor: "Bauen" });
  });

  it("uses the primary and never calls the fallback when it succeeds", async () => {
    const primary = fake(() => Promise.resolve({ a: "A", b: "B", c: "C" }));
    const secondary = fake(() => Promise.resolve({}));
    const provider = resolveProvider({ primary: "anthropic", anthropic: primary, openai: secondary });

    expect(await must(provider).translate(input)).toEqual({ a: "A", b: "B", c: "C" });
    expect(secondary.translate).not.toHaveBeenCalled();
  });

  it("falls back to the next provider when the primary throws", async () => {
    const onFallback = vi.fn();
    const primary = fake(() => Promise.reject(new Error("401 unauthorized")));
    const secondary = fake(() => Promise.resolve({ a: "A", b: "B", c: "C" }));
    const provider = resolveProvider({ primary: "anthropic", anthropic: primary, openai: secondary }, onFallback);

    expect(await must(provider).translate(input)).toEqual({ a: "A", b: "B", c: "C" });
    expect(secondary.translate.mock.calls[0][0].messages).toEqual(messages);
    expect(onFallback).toHaveBeenCalledWith(expect.stringContaining("anthropic failed (401 unauthorized)"));
  });

  it("describes a thrown value that is not an Error by its string form", async () => {
    const onFallback = vi.fn();
    // Deliberately a non-Error rejection reason: the fallback message must use its string form.
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the test needs a non-Error reason
    const primary = fake(() => Promise.reject("quota exhausted"));
    const secondary = fake(() => Promise.resolve({ a: "A", b: "B", c: "C" }));
    const provider = resolveProvider({ primary: "anthropic", anthropic: primary, openai: secondary }, onFallback);

    await must(provider).translate(input);
    expect(onFallback).toHaveBeenCalledWith(expect.stringContaining("anthropic failed (quota exhausted)"));
  });

  it("sends only the missing messages after a partial result", async () => {
    const primary = fake(() => Promise.reject(new PartialTranslationError("1 failed", { a: "A" }, 2)));
    const secondary = fake(() => Promise.resolve({ b: "B", c: "C" }));
    const provider = resolveProvider({ primary: "anthropic", anthropic: primary, openai: secondary });

    expect(await must(provider).translate(input)).toEqual({ a: "A", b: "B", c: "C" });
    expect(secondary.translate.mock.calls[0][0].messages.map((m) => m.id)).toEqual(["b", "c"]);
  });

  it("uses the declared order when no primary is set", async () => {
    const first = fake(() => Promise.reject(new Error("down")));
    const second = fake(() => Promise.resolve({ a: "A", b: "B", c: "C" }));
    const provider = resolveProvider({ openai: first, anthropic: second });

    expect(await must(provider).translate(input)).toEqual({ a: "A", b: "B", c: "C" });
    expect(first.translate).toHaveBeenCalledOnce();
    expect(second.translate).toHaveBeenCalledOnce();
  });

  it("rethrows the first error when every provider fails completely", async () => {
    const first = new Error("first");
    const provider = new FallbackProvider([
      { name: "anthropic", provider: fake(() => Promise.reject(first)) },
      { name: "openai", provider: fake(() => Promise.reject(new Error("second"))) },
    ]);

    await expect(provider.translate(input)).rejects.toBe(first);
  });

  it("throws a PartialTranslationError when some messages remain after every provider", async () => {
    const provider = new FallbackProvider([
      { name: "anthropic", provider: fake(() => Promise.resolve({ a: "A" })) },
      { name: "openai", provider: fake(() => Promise.reject(new Error("down"))) },
    ]);

    const error: unknown = await provider.translate(input).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PartialTranslationError);
    expect((error as PartialTranslationError).partial).toEqual({ a: "A" });
    expect((error as PartialTranslationError).failed).toBe(2);
  });
});
