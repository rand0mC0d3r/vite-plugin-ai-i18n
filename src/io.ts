import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

type Warn = (message: string) => void;

export const toJson = (value: unknown): string => JSON.stringify(value, null, 2) + "\n";
export const hashContent = (text: string): string => createHash("sha256").update(text).digest("hex");

/**
 * Reads a JSON file. A missing file yields the fallback silently. A corrupt file is moved aside
 * (so its contents are not lost when it is overwritten) and the fallback is returned with a warning.
 */
export async function readJsonFile<T>(file: string, fallback: T, warn?: Warn): Promise<T> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    warn?.(`autoi18n: could not read ${file}: ${(error as Error).message}`);
    return fallback;
  }
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    const backup = `${file}.corrupt-${Date.now()}`;
    await rename(file, backup).catch(() => undefined);
    warn?.(`autoi18n: ${file} is not valid JSON (${(error as Error).message}); moved to ${backup} and starting fresh.`);
    return fallback;
  }
}

/** Writes through a uniquely named temp file so concurrent builds never share an intermediate file. */
export async function writeFileAtomic(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, content, "utf8");
  await rename(temp, file);
}

/** Like writeFileAtomic, but leaves the file alone when it already holds this content, so watchers see no change. */
export async function writeFileIfChanged(file: string, content: string): Promise<void> {
  const existing = await readFile(file, "utf8").catch(() => undefined);
  if (existing === content) return;
  await writeFileAtomic(file, content);
}
