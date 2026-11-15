import { describe, expect, it } from "vitest";

import { argumentName, escapeIcu, icuArgumentNames, isUsableTranslation } from "../src/icu.js";

describe("isUsableTranslation", () => {
  it("rejects blank, unparseable and argument-changing translations", () => {
    expect(isUsableTranslation("   ", ["n"])).toBe(false);
    expect(isUsableTranslation("{n", ["n"])).toBe(false);
    expect(isUsableTranslation("{total} files", ["n"])).toBe(false);
  });

  it("accepts a translation that repeats or reorders the source arguments", () => {
    expect(isUsableTranslation("{b} {a} {a}", ["a", "b"])).toBe(true);
  });
});

describe("escapeIcu", () => {
  it("doubles apostrophes and quotes braces so the text is read literally", () => {
    expect(escapeIcu("Don't {save}")).toBe("Don''t '{'save'}'");
  });

  it("leaves plain text unchanged", () => {
    expect(escapeIcu("You have 3 documents")).toBe("You have 3 documents");
  });
});

describe("argumentName", () => {
  it("replaces characters that ICU does not allow in argument names", () => {
    expect(argumentName("doc.name")).toBe("doc_name");
    expect(argumentName("items[0]")).toBe("items_0_");
    expect(argumentName("count")).toBe("count");
  });
});

describe("icuArgumentNames", () => {
  it("returns the distinct argument names, including those inside plural and select options", () => {
    expect(
      icuArgumentNames(
        "{n} files, {n, plural, one {# of {total}} other {# of {total}}}, {kind, select, a {x} other {y}}",
      ),
    ).toEqual(["n", "total", "kind"]);
  });

  it("returns undefined for text that is not valid ICU", () => {
    expect(icuArgumentNames("{count Dokumente")).toBeUndefined();
  });
});
