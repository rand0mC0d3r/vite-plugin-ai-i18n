import { describe, expect, it } from "vitest";

import { locales } from "../src/locales.js";

describe("locale groups", () => {
  const groups = Object.entries(locales);

  it.each(groups)("%s holds unique, valid BCP 47 codes", (_name, codes) => {
    expect(codes.length).toBeGreaterThan(0);
    expect(new Set(codes).size).toBe(codes.length);
    expect(Intl.getCanonicalLocales(codes)).toEqual(codes);
  });
});
