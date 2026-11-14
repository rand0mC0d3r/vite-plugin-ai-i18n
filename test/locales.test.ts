import { describe, expect, it } from "vitest";
import * as plugin from "../src/index.js";
import * as locales from "../src/locales.js";

describe("locale groups", () => {
  const groups = Object.entries(locales);

  it("are re-exported from the package entry", () => {
    for (const [name, codes] of groups) {
      expect(plugin[name as keyof typeof plugin], name).toEqual(codes);
    }
  });

  it.each(groups)("%s holds unique, valid BCP 47 codes", (_name, codes) => {
    expect(codes.length).toBeGreaterThan(0);
    expect(new Set(codes).size).toBe(codes.length);
    expect(Intl.getCanonicalLocales(codes)).toEqual(codes);
  });

  it("EU lists the 23 official languages", () => {
    expect(locales.EU).toHaveLength(23);
  });

  it("composite groups contain their parts", () => {
    expect(locales.EUROPE).toEqual(expect.arrayContaining(locales.EU));
    expect(locales.ASIA).toEqual(expect.arrayContaining([...locales.EAST_ASIA, ...locales.SOUTH_ASIA, ...locales.SOUTHEAST_ASIA]));
    expect(locales.AMERICAS).toEqual(expect.arrayContaining(locales.SOUTH_AMERICA));
  });
});
