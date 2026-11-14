import { ArkErrors } from "arktype";
import path from "node:path";
import { readJsonFile, toJson, writeFileAtomic, writeFileIfChanged } from "./io.js";
import { localeFileSchema } from "./schemas.js";
import type { Catalog } from "./types.js";

/**
 * One locale's file on disk (`locales/<locale>.json`). `messages` is what the runtime and build read,
 * and `sources` records the source text each translation was made from, so a changed source is re-translated.
 */
export interface LocaleFile {
  messages: Catalog;
  sources: Catalog;
}

/** A locale file with no translations, used for a locale that has never been written. */
export const emptyLocaleFile = (): LocaleFile => ({ messages: {}, sources: {} });

/** Path of a locale's file inside the output directory, e.g. `<outDir>/de.json`. */
export function localeFilePath(outDir: string, locale: string): string {
  return path.join(outDir, `${locale}.json`);
}

/** Keeps only the string-valued entries of a parsed JSON object, warning about each one that is dropped. */
const stringValues = (record: Record<string, unknown>, warn?: (message: string) => void, file?: string): Catalog => {
  const catalog: Catalog = {};
  for (const [id, value] of Object.entries(record)) {
    if (typeof value === "string") catalog[id] = value;
    else warn?.(`autoi18n: dropped non-text value for "${id}" in ${file}.`);
  }
  return catalog;
};

/**
 * A file without the `messages`/`sources` wrapper (the pre-merge format) is treated as empty and rebuilt.
 * Non-string values inside a valid wrapper are dropped, so they are translated again.
 */
export async function readLocaleFile(file: string, warn?: (message: string) => void): Promise<LocaleFile> {
  const parsed = await readJsonFile<unknown>(file, null, warn);
  const result = localeFileSchema(parsed);
  if (result instanceof ArkErrors) return emptyLocaleFile();
  return { messages: stringValues(result.messages, warn, file), sources: stringValues(result.sources, warn, file) };
}

/** Writes a locale file, leaving it untouched when its content has not changed. */
export const writeLocaleFile = (file: string, content: LocaleFile): Promise<void> => writeFileIfChanged(file, toJson(content));

/** Returns a copy of `catalog` that keeps only `keep`, plus the keys that were dropped. */
export function pruneCatalog(catalog: Catalog, keep: ReadonlySet<string>): { catalog: Catalog; removed: string[] } {
  const kept: Catalog = {};
  const removed: string[] = [];
  for (const [id, text] of Object.entries(catalog)) {
    if (keep.has(id)) kept[id] = text;
    else removed.push(id);
  }
  return { catalog: kept, removed };
}

/** Prunes both `messages` and `sources` of a locale file to `keep`. `removed` lists each dropped ID once. */
export function pruneLocaleFile(file: LocaleFile, keep: ReadonlySet<string>): { file: LocaleFile; removed: string[] } {
  const messages = pruneCatalog(file.messages, keep);
  const sources = pruneCatalog(file.sources, keep);
  return { file: { messages: messages.catalog, sources: sources.catalog }, removed: [...new Set([...messages.removed, ...sources.removed])] };
}
