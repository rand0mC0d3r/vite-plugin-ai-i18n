import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";

/**
 * Parses `--flag` options from a CLI argument list. The flags and their kinds come from `defaults`: a boolean becomes a
 * switch, a number takes a value converted with `Number`, and a string takes the value as given. The flag name is the
 * key in kebab-case, so `retentionMinutes` is `--retention-minutes`.
 *
 * @throws If an option is unknown, lacks its value, or its value starts with `--`.
 */
export function parseCliArgs<T extends Record<string, boolean | number | string>>(argv: string[], defaults: T): T {
  const flags = new Map(
    Object.keys(defaults).map((key) => [`--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`, key]),
  );
  const args: Record<string, boolean | number | string> = { ...defaults };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const key = flags.get(arg);
    if (key === undefined) throw new Error(`Unknown option ${arg}`);
    if (typeof defaults[key] === "boolean") {
      args[key] = true;
      continue;
    }
    const value = argv.at(++i);
    if (value === undefined || value.startsWith("--")) throw new Error(`${arg} needs a value`);
    args[key] = typeof defaults[key] === "number" ? Number(value) : value;
  }
  return args as T;
}

/** Lists the `*.json` file names in a locale directory, or an empty array if the directory does not exist. */
export async function listLocaleFiles(localesDir: string): Promise<string[]> {
  if (!existsSync(localesDir)) return [];
  return (await readdir(localesDir)).filter((name) => name.endsWith(".json"));
}
