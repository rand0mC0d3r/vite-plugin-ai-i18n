import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Registry, RegistryEntry } from "../types.js";

const OLD = "2020-01-01T00:00:00.000Z";
const RECENT = new Date().toISOString();

function entry(id: string, status: RegistryEntry["status"], lastSeen: string): RegistryEntry {
  return {
    id,
    source: `text ${id}`,
    kind: "text",
    tag: "p",
    component: "App",
    location: "src/a.tsx:1",
    status,
    firstSeen: OLD,
    lastSeen,
    context: "",
    fingerprint: id
  } as RegistryEntry;
}

/** Runs the CLI module (which calls main() on import) with the given arguments inside `cwd`. */
async function runCli(cwd: string, args: string[]): Promise<void> {
  const originalArgv = process.argv;
  const originalCwd = process.cwd();
  process.argv = ["node", "prune.js", ...args];
  process.chdir(cwd);
  vi.resetModules();
  try {
    await import("./prune.js");
    await vi.waitFor(() => expect(process.exitCode === 1 || console.log.mock.calls.length + console.error.mock.calls.length > 0).toBe(true));
    await new Promise(resolve => setTimeout(resolve, 20));
  } finally {
    process.argv = originalArgv;
    process.chdir(originalCwd);
  }
}

describe("prune CLI", () => {
  let root: string;
  let outDir: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "autoi18n-prune-"));
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

  it("reports that there is nothing to prune when no registry exists", async () => {
    await runCli(root, []);
    expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/no registry found .*nothing to prune/));
    expect(process.exitCode).toBe(0);
  });

  it("removes orphans past retention, keeps active and recent orphans, and strips stale locale keys", async () => {
    const registry: Registry = {
      version: 1,
      entries: {
        keep: entry("keep", "active", RECENT),
        recent: entry("recent", "orphaned", RECENT),
        gone: entry("gone", "orphaned", OLD)
      }
    };
    await writeFile(path.join(outDir, "registry.json"), JSON.stringify(registry));
    await writeFile(
      path.join(outDir, "locales", "de.json"),
      JSON.stringify({ messages: { keep: "A", recent: "B", gone: "C" }, sources: { gone: "C-src", keep: "A-src" } })
    );
    await writeFile(path.join(outDir, "locales", "notes.txt"), "ignored");

    await runCli(root, []);

    const saved = JSON.parse(await readFile(path.join(outDir, "registry.json"), "utf8")) as Registry;
    expect(Object.keys(saved.entries).sort()).toEqual(["keep", "recent"]);

    const locale = JSON.parse(await readFile(path.join(outDir, "locales", "de.json"), "utf8"));
    expect(locale.messages).toEqual({ keep: "A" });
    expect(locale.sources).toEqual({ keep: "A-src" });

    expect(console.log).toHaveBeenCalledWith("autoi18n: removed 1 registry entries orphaned for more than 43200 minutes.");
    expect(console.log).toHaveBeenCalledWith("autoi18n: removed stale keys from 1 locale files.");
  });

  it("does not rewrite the registry or locale files when nothing is orphaned past retention", async () => {
    const registry: Registry = { version: 1, entries: { keep: entry("keep", "active", OLD) } };
    await writeFile(path.join(outDir, "registry.json"), JSON.stringify(registry));
    await writeFile(path.join(outDir, "locales", "de.json"), JSON.stringify({ messages: { keep: "A" }, sources: {} }));

    await runCli(root, []);

    expect(console.log).toHaveBeenCalledWith("autoi18n: removed 0 registry entries orphaned for more than 43200 minutes.");
    expect(console.log).not.toHaveBeenCalledWith(expect.stringMatching(/stale keys/));
  });

  it("honours --directory and --retention-minutes", async () => {
    const custom = path.join(root, "i18n");
    await mkdir(custom, { recursive: true });
    const registry: Registry = { version: 1, entries: { gone: entry("gone", "orphaned", new Date(Date.now() - 5 * 60_000).toISOString()) } };
    await writeFile(path.join(custom, "registry.json"), JSON.stringify(registry));

    await runCli(root, ["--directory", "i18n", "--retention-minutes", "1"]);

    const saved = JSON.parse(await readFile(path.join(custom, "registry.json"), "utf8")) as Registry;
    expect(saved.entries).toEqual({});
    expect(console.log).toHaveBeenCalledWith("autoi18n: removed 1 registry entries orphaned for more than 1 minutes.");
  });

  it("logs each removed registry entry and locale key in debug mode", async () => {
    const registry: Registry = { version: 1, entries: { gone: entry("gone", "orphaned", OLD) } };
    await writeFile(path.join(outDir, "registry.json"), JSON.stringify(registry));
    await writeFile(path.join(outDir, "locales", "de.json"), JSON.stringify({ messages: { gone: "C" }, sources: {} }));

    await runCli(root, ["--debug"]);

    const output = vi.mocked(console.log).mock.calls.map(call => String(call[0]));
    expect(output.some(line => /removed gone "text gone"/.test(line))).toBe(true);
    expect(output.some(line => /removed gone from .*de\.json/.test(line))).toBe(true);
  });

  it("reports an error and sets exit code 1 for an unknown option", async () => {
    await runCli(root, ["--bogus"]);
    expect(console.error).toHaveBeenCalledWith("autoi18n: Unknown option --bogus");
    expect(process.exitCode).toBe(1);
  });

  it("reports an error when an option is missing its value", async () => {
    await runCli(root, ["--directory"]);
    expect(console.error).toHaveBeenCalledWith("autoi18n: --directory needs a value");
    expect(process.exitCode).toBe(1);
  });

  it("rejects a negative or non-numeric retention", async () => {
    await runCli(root, ["--retention-minutes", "soon"]);
    expect(console.error).toHaveBeenCalledWith("autoi18n: --retention-minutes must be a number of minutes, 0 or more");
    expect(process.exitCode).toBe(1);
  });

  it("does not create a registry when none exists", async () => {
    await runCli(root, []);
    expect(existsSync(path.join(outDir, "registry.json"))).toBe(false);
  });
});
