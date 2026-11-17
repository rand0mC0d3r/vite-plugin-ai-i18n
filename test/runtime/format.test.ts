import { afterEach, describe, expect, it, vi } from "vitest";

import { formatAutoPluralMessage, formatMessage } from "../../src/runtime/format.js";

const FILES = "{count, plural, one {# file} other {# files}}";

describe("formatMessage", () => {
  afterEach(() => vi.restoreAllMocks());

  it("picks the plural category for the locale", () => {
    expect(formatMessage(FILES, "en", { count: 1 })).toBe("1 file");
    expect(formatMessage(FILES, "en", { count: 3 })).toBe("3 files");
    expect(formatMessage("{count, plural, one {# Datei} other {# Dateien}}", "de", { count: 1 })).toBe("1 Datei");
  });

  it("reuses the parsed message on repeated calls", () => {
    expect(formatMessage(FILES, "en", { count: 2 })).toBe("2 files");
    expect(formatMessage(FILES, "en", { count: 5 })).toBe("5 files");
  });

  it("formats generic currency values using the locale's currency", () => {
    expect(formatMessage("Price: {price, number, currency}", "en", { price: 129.99 })).toBe("Price: $129.99");
    expect(formatMessage("Price: {price, number, currency}", "de", { price: 129.99 })).toBe("Price: 129,99 €");
    expect(formatMessage("Price: {price, number, currency}", "en-GB", { price: 129.99 })).toBe("Price: £129.99");
    expect(formatMessage("Price: {price, number, currency}", "ja-JP", { price: 129.99 })).toBe("Price: ￥130");
    expect(formatMessage("Price: {price, number, currency}", "en-CA", { price: 129.99 })).toBe("Price: $129.99");
    expect(formatMessage("Price: {price, number, currency}", "en-AU", { price: 129.99 })).toBe("Price: $129.99");
    expect(formatMessage("Price: {price, number, currency}", "zh-CN", { price: 129.99 })).toBe("Price: ¥129.99");
    expect(formatMessage("Price: {price, number, currency}", "en-IN", { price: 129.99 })).toBe("Price: ₹129.99");
    expect(formatMessage("Price: {price, number, currency}", "es-MX", { price: 129.99 })).toBe("Price: USD 129.99");
  });

  it("formats explicit ISO currency codes", () => {
    expect(formatMessage("Price: {price, number, EUR}", "en", { price: 129.99 })).toBe("Price: €129.99");
    expect(formatMessage("Price: {price, number, EUR}", "de", { price: 129.99 })).toBe("Price: 129,99 €");
  });

  it("creates singular, zero and plural fallbacks for tt() count templates", () => {
    expect(formatAutoPluralMessage("{count} items", "en", { count: 0 })).toBe("No items");
    expect(formatAutoPluralMessage("{count} items", "en", { count: 1 })).toBe("1 item");
    expect(formatAutoPluralMessage("{count} items", "en", { count: 5 })).toBe("5 items");
  });

  it("handles irregular English noun fallback patterns", () => {
    expect(formatAutoPluralMessage("{count} categories", "en", { count: 1 })).toBe("1 category");
    expect(formatAutoPluralMessage("{count} classes", "en", { count: 1 })).toBe("1 class");
    expect(formatAutoPluralMessage("{count} buses", "en", { count: 1 })).toBe("1 bus");
    expect(formatAutoPluralMessage("{count} boxes", "en", { count: 1 })).toBe("1 box");
  });

  it("preserves prefix wording and handles missing counts", () => {
    expect(formatAutoPluralMessage("There are {count} items", "en", { count: 1 })).toBe("There are 1 item");
    expect(formatAutoPluralMessage("{count}", "en", {})).toBe("{count}");
  });

  it("returns the message unformatted and logs when a value is missing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(formatMessage("Hello {name}", "en", {})).toBe("Hello {name}");
    expect(warn).toHaveBeenCalledOnce();
  });

  it("returns the message unformatted and logs when it is not valid ICU", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(formatMessage("Use {", "en", { a: 1 })).toBe("Use {");
    expect(warn).toHaveBeenCalledOnce();
  });
});
