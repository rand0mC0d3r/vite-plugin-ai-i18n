import { describe, expect, it } from "vitest";

import { ProviderError } from "../../src/ai/base.js";
import { alignedCatalog, restoreText } from "../../src/ai/machine-helpers.js";
import type { TranslationRequest } from "../../src/types.js";

const request = (id: string, source: string): TranslationRequest => ({ id, source, context: "", kind: "text" });

describe("restoreText", () => {
  it("decodes decimal, hex and case-insensitive named entities", () => {
    expect(restoreText("&#65;&#x42;&#X43; &AMP; &Quot;", "<x>", "</x>")).toBe('ABC & "');
  });

  it("keeps unknown named entities and numeric references beyond the Unicode range", () => {
    expect(restoreText("&bogus; &#x110000;", "<x>", "</x>")).toBe("&bogus; &#x110000;");
  });
});

describe("alignedCatalog", () => {
  it("pairs translations with requests in order and drops blank ones", () => {
    const messages = [request("a", "Save"), request("b", "Cancel")];
    expect(alignedCatalog(messages, ["Speichern", "   "], "<x>", "</x>")).toEqual({ a: "Speichern" });
  });

  it("rejects a reply whose count differs from the request, so the batch is retried", () => {
    const messages = [request("a", "Save"), request("b", "Cancel")];
    expect(() => alignedCatalog(messages, ["Speichern"], "<x>", "</x>")).toThrow(ProviderError);
  });
});
