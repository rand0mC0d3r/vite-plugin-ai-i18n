import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("../../scripts/install-autoi18n.mjs", import.meta.url));

function runInstaller(dir: string, ...args: string[]) {
  const result = spawnSync(process.execPath, [SCRIPT, "--dir", dir, ...args], { encoding: "utf8" });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe("install-autoi18n script", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "autoi18n-install-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("adds .env.local to an existing .gitignore that lacks a trailing newline, and creates the env template", async () => {
    await writeFile(path.join(dir, "package.json"), JSON.stringify({ devDependencies: { vite: "^8.0.0" } }));
    await writeFile(path.join(dir, ".gitignore"), "node_modules");

    const { status } = runInstaller(dir, "--skip-install");

    expect(status).toBe(0);
    expect(await readFile(path.join(dir, ".gitignore"), "utf8")).toBe("node_modules\n.env.local\n");
    expect(await readFile(path.join(dir, ".env.local"), "utf8")).toContain("OPENAI_API_KEY=");
  });

  it("keeps an existing .env.local and does not touch .gitignore when .env files are already ignored", async () => {
    await writeFile(path.join(dir, "package.json"), JSON.stringify({ devDependencies: { vite: "^8.0.0" } }));
    await writeFile(path.join(dir, ".gitignore"), ".env*\n");
    await writeFile(path.join(dir, ".env.local"), "OPENAI_API_KEY=keep-me\n");

    runInstaller(dir, "--skip-install");

    expect(await readFile(path.join(dir, ".gitignore"), "utf8")).toBe(".env*\n");
    expect(await readFile(path.join(dir, ".env.local"), "utf8")).toBe("OPENAI_API_KEY=keep-me\n");
  });

  it("uses the packageManager field over the lockfile, and reports the install command", async () => {
    await writeFile(path.join(dir, "package.json"), JSON.stringify({ packageManager: "pnpm@9.0.0" }));
    await writeFile(path.join(dir, "bun.lock"), "");

    const { status, output } = runInstaller(dir, "--dry-run");

    expect(status).toBe(0);
    expect(output).toContain("Package manager: pnpm");
    expect(output).toContain("Running: pnpm add -D vite-plugin-ai-auto-i18n");
    expect(existsSync(path.join(dir, ".env.local"))).toBe(false);
  });

  it("skips the install when the plugin is already listed", async () => {
    await writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ devDependencies: { "vite-plugin-ai-auto-i18n": "^0.9.15" } }),
    );

    const { status, output } = runInstaller(dir);

    expect(status).toBe(0);
    expect(output).toContain("vite-plugin-ai-auto-i18n is already installed.");
    expect(output).not.toContain("Running:");
  });

  it("fails without a package.json and leaves the directory unchanged", async () => {
    const empty = path.join(dir, "missing");
    await mkdir(empty);

    const { status, output } = runInstaller(empty, "--skip-install");

    expect(status).toBe(1);
    expect(output).toContain("No package.json");
    expect(existsSync(path.join(empty, ".env.local"))).toBe(false);
  });
});
