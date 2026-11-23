import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { parseArgs, type ParseArgsOptionsConfig } from "node:util";

/**
 * Parses `--flag` options from a CLI argument list. The flags and their kinds come from `defaults`: a boolean becomes a
 * switch, a number takes a value converted with `Number`, and a string takes the value as given. The flag name is the
 * key in kebab-case, so `retentionMinutes` is `--retention-minutes`.
 *
 * @throws If an option is unknown, lacks its value, or is given a value that looks like another option. The error is
 *   the one thrown by `node:util`'s `parseArgs`.
 */
export function parseCliArgs<T extends Record<string, boolean | number | string>>(argv: string[], defaults: T): T {
  const keys = Object.keys(defaults) as (keyof T & string)[];
  const options: ParseArgsOptionsConfig = {};
  for (const key of keys) {
    options[toFlagName(key)] = { type: typeof defaults[key] === "boolean" ? "boolean" : "string" };
  }
  const { values } = parseArgs({ args: argv, options, strict: true, allowPositionals: false });
  const args: Record<string, boolean | number | string> = { ...defaults };
  for (const key of keys) {
    const value = values[toFlagName(key)];
    if (value === undefined) continue;
    if (typeof defaults[key] === "boolean") args[key] = true;
    else args[key] = typeof defaults[key] === "number" ? Number(value) : String(value);
  }
  return args as T;
}

function toFlagName(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/** Lists the `*.json` file names in a locale directory, or an empty array if the directory does not exist. */
export async function listLocaleFiles(localesDir: string): Promise<string[]> {
  if (!existsSync(localesDir)) return [];
  return (await readdir(localesDir)).filter((name) => name.endsWith(".json"));
}
