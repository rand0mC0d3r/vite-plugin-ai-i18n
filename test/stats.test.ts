import { describe, expect, it } from "vitest";

import { computeStats } from "../src/core/stats.js";
import type { Registry, RegistryEntry } from "../src/types.js";

function entry(id: string, overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    id,
    source: `text ${id}`,
    component: "App",
    location: "src/App.tsx:1",
    status: "active",
    firstSeen: "2020-01-01T00:00:00.000Z",
    lastSeen: "2020-01-01T00:00:00.000Z",
    fingerprint: id,
    ...overrides,
  };
}

describe("computeStats", () => {
  const registry: Registry = {
    version: 1,
    entries: {
      a: entry("a", { component: "Header" }),
      b: entry("b", { component: "Header" }),
      c: entry("c", { component: "Footer" }),
      old1: entry("old1", { status: "orphaned", lastSeen: "2021-01-01T00:00:00.000Z" }),
      old2: entry("old2", { status: "orphaned", lastSeen: "2020-06-01T00:00:00.000Z" }),
    },
  };

  it("breaks ties between orphans with the same last-seen time by ID", () => {
    const tied: Registry = {
      version: 1,
      entries: {
        z: entry("z", { status: "orphaned", lastSeen: "2020-01-01T00:00:00.000Z" }),
        m: entry("m", { status: "orphaned", lastSeen: "2020-01-01T00:00:00.000Z" }),
      },
    };
    expect(computeStats(tied, {}).registry.orphans.map((orphan) => orphan.id)).toEqual(["m", "z"]);
  });

  it("counts registry entries by status and component, and lists orphans oldest first", () => {
    const report = computeStats(registry, {});
    expect(report.registry.total).toBe(5);
    expect(report.registry.active).toBe(3);
    expect(report.registry.orphaned).toBe(2);
    expect(report.registry.byComponent).toEqual({ Header: 2, Footer: 1 });
    expect(report.registry.orphans.map((orphan) => orphan.id)).toEqual(["old2", "old1"]);
  });

  it("measures coverage, missing, outdated and orphaned keys per locale", () => {
    const report = computeStats(registry, {
      de: {
        messages: { a: "Hallo", b: "Attr", gone: "Alt" },
        sources: { a: "text a", b: "old text b", gone: "gone" },
      },
    });
    expect(report.locales).toHaveLength(1);
    const [de] = report.locales;
    expect(de.locale).toBe("de");
    expect(de.total).toBe(3);
    expect(de.translated).toBe(2);
    expect(de.coverage).toBeCloseTo(2 / 3);
    expect(de.missing).toEqual(["c"]);
    expect(de.outdated).toEqual(["b"]);
    expect(de.orphanedKeys).toEqual(["gone"]);
    expect(report.averageCoverage).toBeCloseTo(2 / 3);
  });

  it("sorts locales and averages coverage across them", () => {
    const report = computeStats(registry, {
      fr: { messages: { a: "x", b: "y", c: "z" }, sources: { a: "text a", b: "text b", c: "text c" } },
      de: { messages: {}, sources: {} },
    });
    expect(report.locales.map((stats) => stats.locale)).toEqual(["de", "fr"]);
    expect(report.locales[0].coverage).toBe(0);
    expect(report.locales[1].coverage).toBe(1);
    expect(report.averageCoverage).toBe(0.5);
  });

  it("reports null average and full coverage when there is nothing to translate", () => {
    expect(computeStats(registry, {}).averageCoverage).toBeNull();
    const empty = computeStats({ version: 1, entries: {} }, { de: { messages: {}, sources: {} } });
    expect(empty.locales[0].coverage).toBe(1);
    expect(empty.averageCoverage).toBe(1);
  });
});
