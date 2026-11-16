import path from "node:path";

import { ArkErrors } from "arktype";

import { emptyRegistry } from "../identity/registry.js";
import { LOCALE_TAG, localeFileSchema, registryEntrySchema, registryFileSchema } from "../schemas.js";
import type { Catalog, Registry, RegistryEntry } from "../types.js";
import { readJsonFile, toJson, writeFileIfChanged } from "./files.js";

/**
 * One locale's file on disk (`locales/<locale>.json`). `messages` is what the runtime and build read, and `sources`
 * records the source text each translation was made from, so a changed source is re-translated.
 */
export interface LocaleFile {
  messages: Catalog;
  sources: Catalog;
}

/** A locale file with no translations, used for a locale that has never been written. */
export const emptyLocaleFile = (): LocaleFile => ({ messages: {}, sources: {} });

/** Path of a locale's file inside the output directory, e.g. `<outDir>/de.json`. */
export function localeFilePath(outDir: string, locale: string): string {
  if (!LOCALE_TAG.test(locale)) throw new Error(`autoi18n: "${locale}" is not a valid locale tag.`);
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
 * A file without the `messages`/`sources` wrapper (the pre-merge format) is treated as empty and rebuilt. Non-string
 * values inside a valid wrapper are dropped, so they are translated again.
 */
export async function readLocaleFile(file: string, warn?: (message: string) => void): Promise<LocaleFile> {
  const parsed = await readJsonFile<unknown>(file, null, warn);
  const result = localeFileSchema(parsed);
  if (result instanceof ArkErrors) return emptyLocaleFile();
  return { messages: stringValues(result.messages, warn, file), sources: stringValues(result.sources, warn, file) };
}

/** Writes a locale file, leaving it untouched when its content has not changed. */
export const writeLocaleFile = (file: string, content: LocaleFile): Promise<void> =>
  writeFileIfChanged(file, toJson(content));

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
  return {
    file: { messages: messages.catalog, sources: sources.catalog },
    removed: [...new Set([...messages.removed, ...sources.removed])],
  };
}

/**
 * Loads the registry. Invalid entries are dropped individually so the IDs of the valid ones stay stable; a file with
 * the wrong top-level shape is replaced by an empty registry.
 */
export async function loadRegistry(file: string, warn?: (message: string) => void): Promise<Registry> {
  const parsed = await readJsonFile<unknown>(file, null, warn);
  if (parsed === null) return emptyRegistry();
  const header = registryFileSchema(parsed);
  if (header instanceof ArkErrors) {
    warn?.(`autoi18n: ${file} has an unsupported format; message IDs will be regenerated.`);
    return emptyRegistry();
  }
  const entries: Record<string, RegistryEntry> = {};
  for (const [key, value] of Object.entries(header.entries)) {
    const entry = registryEntrySchema(value);
    if (!(entry instanceof ArkErrors)) entries[key] = entry;
    else warn?.(`autoi18n: dropped invalid registry entry "${key}" in ${file}.`);
  }
  return { version: 1, entries };
}

/** Writes the registry to `file`, skipping the write when the content has not changed. */
export async function saveRegistry(file: string, registry: Registry): Promise<void> {
  await writeFileIfChanged(file, toJson(registry));
}
