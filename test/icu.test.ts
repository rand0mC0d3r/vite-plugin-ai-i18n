import { describe, expect, it } from "vitest";

import { argumentNames, keepsArguments } from "../src/icu.js";

describe("argumentNames", () => {
  it("collects arguments nested in plural branches and ignores literals and #", () => {
    expect(argumentNames("{count, plural, one {# {name} file} other {# files for {owner}}}")).toEqual(
      new Set(["count", "name", "owner"]),
    );
  });

  it("throws for a message that is not valid ICU", () => {
    expect(() => argumentNames("Use {")).toThrow();
  });
});

describe("keepsArguments", () => {
  const source = "{count, plural, one {# file} other {# files}}";

  it("accepts a translation that uses the same arguments with different text", () => {
    expect(keepsArguments(source, "{count, plural, one {# Datei} other {# Dateien}}")).toBe(true);
  });

  it("rejects a translation that drops or renames an argument", () => {
    expect(keepsArguments(source, "{anzahl, plural, one {# Datei} other {# Dateien}}")).toBe(false);
    expect(keepsArguments("Hello {name}, {count} new", "Hallo {name}")).toBe(false);
  });

  it("rejects a translation that is not valid ICU", () => {
    expect(keepsArguments(source, "{count, plural, one {# Datei}")).toBe(false);
  });

  it("accepts any translation when the source is not valid ICU", () => {
    expect(keepsArguments("Use {", "Verwende {")).toBe(true);
  });
});
