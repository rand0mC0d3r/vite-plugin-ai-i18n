import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Registry, RegistryEntry } from "../../src/types.js";

const OLD = "2020-01-01T00:00:00.000Z";
const OLDER = "2019-01-01T00:00:00.000Z";

function entry(id: string, overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    id,
    source: `text ${id}`,
    kind: "text",
    tag: "p",
    component: "App",
    location: "src/a.tsx:1",
    status: "active",
    firstSeen: OLD,
    lastSeen: OLD,
    context: "",
    fingerprint: id,
    ...overrides,
  };
}

/** Runs the stats CLI (which calls main() on import) with the given arguments inside `cwd`. */
async function runCli(cwd: string, args: string[]): Promise<void> {
  const originalArgv = process.argv;
  const originalCwd = process.cwd();
  process.argv = ["node", "stats.js", ...args];
  process.chdir(cwd);
  vi.resetModules();
  try {
    await import("../../src/cli/stats.js");
    await vi.waitFor(() =>
      expect(
        process.exitCode === 1 ||
          vi.mocked(console.log).mock.calls.length + vi.mocked(console.error).mock.calls.length > 0,
      ).toBe(true),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
  } finally {
    process.argv = originalArgv;
    process.chdir(originalCwd);
  }
}

const logged = () =>
  vi
    .mocked(console.log)
    .mock.calls.map((call) => String(call[0]))
    .join("\n");

type StatsReport = {
  registry: { total: number };
  locales: { locale: string; coverage: number }[];
  averageCoverage: number;
};

describe("stats CLI", () => {
  let root: string;
  let outDir: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "autoi18n-stats-"));
    outDir = path.join(root, ".autoi18n");
    await mkdir(path.join(outDir, "locales"), { recursive: true });
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    process.exitCode = 0;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    process.exitCode = 0;
    await rm(root, { recursive: true, force: true });
  });

  it("reports that there is nothing to report when no registry exists", async () => {
    await runCli(root, []);
    expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/no registry found .*nothing to report/));
    expect(process.exitCode).toBe(0);
  });

  it("prints registry counts, per-locale coverage and orphans in text form", async () => {
    const registry: Registry = {
      version: 1,
      entries: {
        a: entry("a", { kind: "text", component: "Header" }),
        b: entry("b", { kind: "attribute", component: "Header" }),
        c: entry("c", { kind: "text", component: "Footer" }),
        gone: entry("gone", { status: "orphaned", lastSeen: OLDER }),
      },
    };
    await writeFile(path.join(outDir, "registry.json"), JSON.stringify(registry));
    await writeFile(
      path.join(outDir, "locales", "de.json"),
      JSON.stringify({
        messages: { a: "Hallo", b: "Attr", stale: "Alt" },
        sources: { a: "text a", b: "old b", stale: "x" },
      }),
    );
    await writeFile(path.join(outDir, "locales", "en.json"), JSON.stringify({ messages: {}, sources: {} }));

    await runCli(root, []);

    const output = logged();
    expect(output).toContain("entries: 4 (3 active, 1 orphaned)");
    expect(output).toContain("by kind: attribute 1, text 2");
    expect(output).toContain("by component: Footer 1, Header 2");
    expect(output).toMatch(/locale\s+translated\s+missing\s+outdated\s+orphaned keys\s+coverage/);
    expect(output).toMatch(/de\s+2\/3\s+1\s+1\s+1\s+66\.7%/);
    expect(output).toContain("average coverage: 66.7%");
    expect(output).not.toContain("de missing:");
    expect(output).toContain(`gone  "text gone"  src/a.tsx:1  last seen ${OLDER}`);
    expect(console.log).toHaveBeenCalledTimes(1);
  });

  it("lists missing, outdated and orphaned keys per locale with --verbose", async () => {
    const registry: Registry = {
      version: 1,
      entries: { a: entry("a"), b: entry("b") },
    };
    await writeFile(path.join(outDir, "registry.json"), JSON.stringify(registry));
    await writeFile(
      path.join(outDir, "locales", "fr.json"),
      JSON.stringify({ messages: { a: "Bonjour", gone: "x" }, sources: { a: "changed", gone: "x" } }),
    );

    await runCli(root, ["--verbose"]);

    const output = logged();
    expect(output).toContain("fr missing: b");
    expect(output).toContain("fr outdated: a");
    expect(output).toContain("fr orphaned keys: gone");
    expect(output).toContain("Orphans\n  none.");
  });

  it("prints the report as JSON with --json", async () => {
    const registry: Registry = { version: 1, entries: { a: entry("a") } };
    await writeFile(path.join(outDir, "registry.json"), JSON.stringify(registry));
    await writeFile(path.join(outDir, "locales", "de.json"), JSON.stringify({ messages: {}, sources: {} }));

    await runCli(root, ["--json"]);

    const report = JSON.parse(logged()) as StatsReport;
    expect(report.locales).toEqual([
      { locale: "de", translated: 0, total: 1, coverage: 0, missing: ["a"], outdated: [], orphanedKeys: [] },
    ]);
    expect(report.averageCoverage).toBe(0);
  });

  it("reports no locale files and treats a missing locales directory as empty", async () => {
    await writeFile(path.join(outDir, "registry.json"), JSON.stringify({ version: 1, entries: { a: entry("a") } }));
    await rm(path.join(outDir, "locales"), { recursive: true, force: true });

    await runCli(root, []);

    const output = logged();
    expect(output).toContain("no locale files found.");
    expect(output).toContain("Orphans\n  none.");
    expect(output).not.toContain("average coverage");
  });

  it("skips the source locale, legacy sidecars and non-JSON files", async () => {
    await writeFile(path.join(outDir, "registry.json"), JSON.stringify({ version: 1, entries: { a: entry("a") } }));
    await writeFile(path.join(outDir, "locales", "en.json"), JSON.stringify({ messages: {}, sources: {} }));
    await writeFile(path.join(outDir, "locales", "de.json.sources.json"), JSON.stringify({}));
    await writeFile(path.join(outDir, "locales", "notes.txt"), "ignored");

    await runCli(root, ["--json"]);

    expect((JSON.parse(logged()) as StatsReport).locales).toEqual([]);
  });

  it("honours --directory and --source-locale", async () => {
    const custom = path.join(root, "i18n");
    await mkdir(path.join(custom, "locales"), { recursive: true });
    await writeFile(path.join(custom, "registry.json"), JSON.stringify({ version: 1, entries: { a: entry("a") } }));
    await writeFile(
      path.join(custom, "locales", "de.json"),
      JSON.stringify({ messages: { a: "Hallo" }, sources: { a: "text a" } }),
    );
    await writeFile(path.join(custom, "locales", "en-GB.json"), JSON.stringify({ messages: {}, sources: {} }));

    await runCli(root, ["--directory", "i18n", "--source-locale", "en-GB", "--json"]);

    const report = JSON.parse(logged()) as StatsReport;
    expect(report.locales.map((locale) => locale.locale)).toEqual(["de"]);
    expect(report.locales[0].coverage).toBe(1);
  });

  it("warns about and drops invalid locale file contents", async () => {
    await writeFile(path.join(outDir, "registry.json"), JSON.stringify({ version: 1, entries: { a: entry("a") } }));
    await writeFile(path.join(outDir, "locales", "de.json"), "{not json");

    await runCli(root, ["--json"]);

    expect(console.warn).toHaveBeenCalled();
    expect((JSON.parse(logged()) as StatsReport).locales).toHaveLength(1);
  });

  it("reports an error for an unknown option", async () => {
    await runCli(root, ["--bogus"]);
    expect(console.error).toHaveBeenCalledWith("autoi18n: Unknown option --bogus");
    expect(process.exitCode).toBe(1);
  });

  it.each([["--directory"], ["--source-locale"]])("reports an error when %s has no value", async (flag) => {
    await runCli(root, [flag]);
    expect(console.error).toHaveBeenCalledWith(`autoi18n: ${flag} needs a value`);
    expect(process.exitCode).toBe(1);
  });

  it("rejects a flag that is given where a value is expected", async () => {
    await runCli(root, ["--directory", "--json"]);
    expect(console.error).toHaveBeenCalledWith("autoi18n: --directory needs a value");
    expect(process.exitCode).toBe(1);
  });
});
