import { describe, expect, it } from "vitest";

import { createFingerprint } from "../../src/identity/fingerprint.js";

describe("createFingerprint", () => {
  it("ignores layout-only whitespace differences in the source text", () => {
    expect(createFingerprint({ source: "Save  the\n   file" })).toBe(createFingerprint({ source: "Save the file" }));
  });

  it("changes when the text changes", () => {
    expect(createFingerprint({ source: "Save the file" })).not.toBe(createFingerprint({ source: "Save the document" }));
  });

  it("changes when the auto-plural hint changes", () => {
    expect(createFingerprint({ source: "{count} seconds ago", autoPlural: true, hint: "Use Now at zero" })).not.toBe(
      createFingerprint({ source: "{count} seconds ago", autoPlural: true, hint: "Use Later at zero" }),
    );
  });

  it("is a 24 character lowercase hex string", () => {
    expect(createFingerprint({ source: "Save" })).toMatch(/^[0-9a-f]{24}$/);
  });
});
