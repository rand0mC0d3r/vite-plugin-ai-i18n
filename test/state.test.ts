import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IndexState } from "../src/state.js";

describe("IndexState.writeLocale", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "autoi18n-state-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes the content and skips a repeat write of the same content", async () => {
    const state = new IndexState();
    const file = path.join(dir, "de.json");
    const content = { messages: { a: "A" }, sources: { a: "src" } };
    await state.writeLocale(file, content);
    await state.writeLocale(file, { messages: { a: "A" }, sources: { a: "src" } });
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(content);
  });

  it("rewrites the file when it was edited outside the plugin", async () => {
    const state = new IndexState();
    const file = path.join(dir, "de.json");
    const content = { messages: { a: "A" }, sources: { a: "src" } };
    await state.writeLocale(file, content);
    await writeFile(file, JSON.stringify({ messages: { a: "edited by hand" }, sources: {} }));
    await state.writeLocale(file, content);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(content);
  });
});
