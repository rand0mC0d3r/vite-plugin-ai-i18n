import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyLocaleFile, pruneCatalog, readLocaleFile, writeLocaleFile } from "./catalog.js";
import { readJsonFile, writeFileAtomic } from "./io.js";

describe("io and catalog helpers", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "autoi18n-io-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  describe("readJsonFile", () => {
    it("returns the fallback silently when the file is missing", async () => {
      const warn = vi.fn();
      expect(await readJsonFile(path.join(dir, "missing.json"), { a: 1 }, warn)).toEqual({ a: 1 });
      expect(warn).not.toHaveBeenCalled();
    });

    it("parses valid JSON", async () => {
      const file = path.join(dir, "ok.json");
      await writeFile(file, '{"a":2}');
      expect(await readJsonFile(file, null)).toEqual({ a: 2 });
    });

    it("warns and returns the fallback when the file cannot be read for another reason", async () => {
      const warn = vi.fn();
      expect(await readJsonFile(dir, "fallback", warn)).toBe("fallback");
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/could not read .*EISDIR/));
    });

    it("moves a corrupt file aside, warns, and returns the fallback", async () => {
      const file = path.join(dir, "bad.json");
      await writeFile(file, "{not json");
      const warn = vi.fn();
      expect(await readJsonFile(file, [], warn)).toEqual([]);
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/is not valid JSON .* moved to .*bad\.json\.corrupt-/));
      const backups = (await readdir(dir)).filter(name => name.startsWith("bad.json.corrupt-"));
      expect(backups).toHaveLength(1);
      expect(await readFile(path.join(dir, backups[0]), "utf8")).toBe("{not json");
    });

  });

  describe("writeFileAtomic", () => {
    it("creates missing parent directories and leaves no temp files behind", async () => {
      const file = path.join(dir, "nested", "deep", "out.json");
      await writeFileAtomic(file, "hello");
      expect(await readFile(file, "utf8")).toBe("hello");
      expect(await readdir(path.dirname(file))).toEqual(["out.json"]);
    });

    it("replaces existing content", async () => {
      const file = path.join(dir, "out.json");
      await writeFileAtomic(file, "first");
      await writeFileAtomic(file, "second");
      expect(await readFile(file, "utf8")).toBe("second");
    });
  });

  describe("readLocaleFile and writeLocaleFile", () => {
    it("returns an empty locale for a missing file", async () => {
      expect(await readLocaleFile(path.join(dir, "de.json"))).toEqual(emptyLocaleFile());
    });

    it("treats the legacy flat format as empty so it is rebuilt", async () => {
      const file = path.join(dir, "de.json");
      await writeFile(file, JSON.stringify({ save: "Speichern" }));
      expect(await readLocaleFile(file)).toEqual(emptyLocaleFile());
    });

    it("round-trips messages and sources", async () => {
      const file = path.join(dir, "fr.json");
      await writeLocaleFile(file, { messages: { a: "A" }, sources: { a: "src" } });
      expect(await readLocaleFile(file)).toEqual({ messages: { a: "A" }, sources: { a: "src" } });
    });
  });

  describe("pruneCatalog", () => {
    it("keeps only the requested keys and reports the dropped ones", () => {
      const result = pruneCatalog({ a: "1", b: "2", c: "3" }, new Set(["a", "c"]));
      expect(result.catalog).toEqual({ a: "1", c: "3" });
      expect(result.removed).toEqual(["b"]);
    });

    it("does not mutate the input catalog", () => {
      const input = { a: "1", b: "2" };
      pruneCatalog(input, new Set(["a"]));
      expect(input).toEqual({ a: "1", b: "2" });
    });
  });
});
