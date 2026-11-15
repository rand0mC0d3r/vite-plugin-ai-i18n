#!/usr/bin/env node
// Installs vite-plugin-ai-auto-i18n into the project in the current directory.
// Self-contained (Node.js built-ins only) so it can be copied into any repository or handed to an AI agent.
//
// Usage:
//   node install-autoi18n.mjs [--dir <path>] [--dry-run] [--skip-install]
//
// Steps:
//   1. Detects the package manager from the packageManager field or the lockfile.
//   2. Adds the plugin as a dev dependency, unless it is already listed.
//   3. Makes sure .gitignore ignores .env.local, and creates a template .env.local if missing.
//   4. Prints the vite.config.ts snippet to apply. The config is not edited automatically.

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PACKAGE_NAME = "vite-plugin-ai-auto-i18n";
const ENV_FILE = ".env.local";
const ENV_TEMPLATE = `# Provider keys for ${PACKAGE_NAME}. Keep this file out of git.
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
`;
// Patterns that already keep .env.local out of git.
const ENV_IGNORE_PATTERNS = [".env.local", ".env*", ".env.*"];
const INSTALL_COMMANDS = {
  bun: ["bun", ["add", "-D", PACKAGE_NAME]],
  pnpm: ["pnpm", ["add", "-D", PACKAGE_NAME]],
  yarn: ["yarn", ["add", "-D", PACKAGE_NAME]],
  npm: ["npm", ["install", "-D", PACKAGE_NAME]],
};
const LOCKFILES = [
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
];

const NEXT_STEPS = `
Next steps (for you or your AI agent):
  1. Add the plugin to vite.config.ts, before react(), reading keys from .env.local:

       import react from "@vitejs/plugin-react";
       import { defineConfig, loadEnv } from "vite";
       import autoI18n, { hosted, HostedService } from "${PACKAGE_NAME}";

       export default defineConfig(({ mode }) => {
         const env = loadEnv(mode, process.cwd(), "");
         return {
           plugins: [
             autoI18n({
               locales: ["en", "de"],
               sourceLocale: "en",
               provider: { openai: hosted(HostedService.OpenAI, env.OPENAI_API_KEY) },
             }),
             react(),
           ],
         };
       });

  2. Fill in a key in .env.local, then run "vite build" to generate .autoi18n/.
  3. Commit .autoi18n/ so existing translations are reused.
  Full reference: node_modules/${PACKAGE_NAME}/llms.txt
`;

/** Returns the package manager named by the packageManager field, else the one whose lockfile exists, else npm. */
export function detectPackageManager(pkg, fileNames) {
  const declared = typeof pkg.packageManager === "string" ? pkg.packageManager.split("@")[0] : undefined;
  if (declared !== undefined && Object.hasOwn(INSTALL_COMMANDS, declared)) return declared;
  const lockfile = LOCKFILES.find(([file]) => fileNames.includes(file));
  return lockfile ? lockfile[1] : "npm";
}

/** True when the plugin or Vite is listed in dependencies or devDependencies. */
function hasDependency(pkg, name) {
  return [pkg.dependencies, pkg.devDependencies].some((deps) => deps !== undefined && Object.hasOwn(deps, name));
}

/** Parses the command-line options. Unknown options and a missing --dir value are errors. */
function parseArgs(argv) {
  const options = { dir: undefined, dryRun: false, skipInstall: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--skip-install") options.skipInstall = true;
    else if (arg === "--dir" && argv[i + 1] !== undefined) options.dir = argv[++i];
    else throw new Error(`Unknown or incomplete option: ${arg}`);
  }
  return options;
}

/**
 * Installs the plugin into the project at `options.dir` (default: the current directory).
 *
 * @returns The process exit code: 0 on success, 1 on failure.
 */
export function main(argv, { log = console.log, error = console.error } = {}) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (caught) {
    error(caught.message);
    return 1;
  }
  const root = path.resolve(options.dir ?? ".");
  const pkgPath = path.join(root, "package.json");
  if (!existsSync(pkgPath)) {
    error(`No package.json in ${root}. Run this from the project root or pass --dir <path>.`);
    return 1;
  }
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const packageManager = detectPackageManager(pkg, readdirSync(root));
  const install = INSTALL_COMMANDS[packageManager];
  log(`Project: ${root}`);
  log(`Package manager: ${packageManager}`);
  if (!hasDependency(pkg, "vite")) log("Warning: vite is not in package.json. The plugin needs Vite 7 or newer.");

  if (hasDependency(pkg, PACKAGE_NAME)) {
    log(`${PACKAGE_NAME} is already installed.`);
  } else if (options.skipInstall) {
    log("Skipping install (--skip-install).");
  } else {
    log(`Running: ${install[0]} ${install[1].join(" ")}`);
    if (!options.dryRun) {
      const result = spawnSync(install[0], install[1], {
        cwd: root,
        stdio: "inherit",
        shell: process.platform === "win32",
      });
      if (result.status !== 0) {
        error(`Install failed (${result.error?.message ?? `exit ${result.status}`}).`);
        return 1;
      }
    }
  }

  const gitignorePath = path.join(root, ".gitignore");
  const gitignore = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf8") : "";
  const ignoresEnv = gitignore.split(/\r?\n/).some((line) => ENV_IGNORE_PATTERNS.includes(line.trim()));
  if (ignoresEnv) {
    log(".gitignore already ignores .env files.");
  } else {
    log(`Adding ${ENV_FILE} to .gitignore`);
    if (!options.dryRun) {
      const separator = gitignore === "" || gitignore.endsWith("\n") ? "" : "\n";
      appendFileSync(gitignorePath, `${separator}${ENV_FILE}\n`);
    }
  }

  const envPath = path.join(root, ENV_FILE);
  if (existsSync(envPath)) {
    log(`${ENV_FILE} exists and is left unchanged.`);
  } else {
    log(`Creating ${ENV_FILE} with empty key variables`);
    if (!options.dryRun) writeFileSync(envPath, ENV_TEMPLATE, { mode: 0o600 });
  }

  log(options.dryRun ? "Dry run: no changes were made." : "Done.");
  log(NEXT_STEPS);
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
