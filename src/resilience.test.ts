import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import autoI18n from "./index.js";
import { extractMessages } from "./compiler/extract.js";
import { readJsonFile } from "./io.js";
import { loadRegistry, pruneOrphans, reconcile } from "./identity/registry.js";
import { OpenAICompatibleProvider } from "./ai/provider.js";
import type { ExtractedMessage, Registry, TranslationRequest } from "./types.js";

const request = (id: string, source = "Save"): TranslationRequest => ({ id, source, context: "", kind: "text" });

const jsonResponse = (content: unknown, status = 200) =>
  new Response(JSON.stringify({ choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }] }), { status });

describe("extractMessages scope", () => {
  it("skips non-translatable attributes and component children", () => {
    const source = `export function A() { return (<div><a href="/home" title="Home page">Go</a><Button>Save</Button></div>); }\n`;
    const sources = extractMessages(source, "A.tsx").map(m => m.source);
    expect(sources).toContain("Go");
    expect(sources).toContain("Home page");
    expect(sources).not.toContain("/home");
    expect(sources).not.toContain("Save");
  });
});

describe("OpenAICompatibleProvider", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const provider = (extra = {}) => new OpenAICompatibleProvider({ apiKey: "k", model: "m", retryDelayMs: 0, ...extra });
  const input = (messages: TranslationRequest[]) => ({ sourceLocale: "en", targetLocale: "de", messages });

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("splits requests into batches of batchSize", async () => {
    fetchMock.mockImplementation(async (_url: string, init: { body: string }) => {
      const sent = JSON.parse(JSON.parse(init.body).messages[1].content) as { id: string; text: string }[];
      return jsonResponse(Object.fromEntries(sent.map(m => [m.id, `DE:${m.text}`])));
    });
    const result = await provider({ batchSize: 2 }).translate(input([request("a"), request("b"), request("c")]));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ a: "DE:Save", b: "DE:Save", c: "DE:Save" });
  });

  it("returns partial results instead of throwing when an ID is missing", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ a: "Speichern", unrequested: "x", b: "   " }));
    const result = await provider().translate(input([request("a"), request("b")]));
    expect(result).toEqual({ a: "Speichern" });
  });

  it("retries a server error and then succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("busy", { status: 500 }))
      .mockResolvedValueOnce(jsonResponse({ a: "Speichern" }));
    const result = await provider().translate(input([request("a")]));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ a: "Speichern" });
  });

  it("does not retry client errors", async () => {
    fetchMock.mockResolvedValue(new Response("bad key", { status: 401 }));
    await expect(provider().translate(input([request("a")]))).rejects.toThrow(/401/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries malformed JSON content", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse("not json"))
      .mockResolvedValueOnce(jsonResponse({ a: "Speichern" }));
    const result = await provider().translate(input([request("a")]));
    expect(result).toEqual({ a: "Speichern" });
  });

  it("gives up after maxRetries", async () => {
    fetchMock.mockImplementation(async () => new Response("down", { status: 503 }));
    await expect(provider({ maxRetries: 1 }).translate(input([request("a")]))).rejects.toThrow(/503/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("registry identity", () => {
  const message = (start: number, source = "Save", fingerprint = "fp-save"): ExtractedMessage => ({
    source, kind: "text", file: "App.tsx", start, end: start + 4, tag: "button", component: "App", context: "", fingerprint
  });

  it("keeps IDs in order when offsets cross a digit boundary", () => {
    const initial = [message(9), message(100)];
    const registry = reconcile({ version: 1, entries: {} }, initial).registry;
    const originalIds = initial.map(m => m.id);
    const shifted = [message(105), message(200)];
    const second = reconcile(registry, shifted);
    expect(shifted.map(m => m.id)).toEqual(originalIds);
    expect(second.ambiguous).toEqual([]);
  });

  it("reports ambiguity when the number of duplicates changes", () => {
    const registry = reconcile({ version: 1, entries: {} }, [message(1), message(50)]).registry;
    const result = reconcile(registry, [message(1)]);
    expect(result.ambiguous).toEqual(["Save"]);
  });

  it("prunes only orphans that have been missing longer than the retention window", () => {
    const now = Date.parse("2026-11-09T00:00:00.000Z");
    const registry = reconcile({ version: 1, entries: {} }, [message(1), message(20, "Cancel", "fp-cancel")]).registry;
    reconcile(registry, [message(1)]);
    const [cancel] = Object.values(registry.entries).filter(e => e.source === "Cancel");
    expect(cancel.status).toBe("orphaned");
    cancel.lastSeen = new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString();
    expect(pruneOrphans(registry, 30 * 24 * 60, now)).toEqual([]);
    cancel.lastSeen = new Date(now - 31 * 24 * 60 * 60 * 1000).toISOString();
    const removed = pruneOrphans(registry, 30 * 24 * 60, now);
    expect(removed.map(e => e.source)).toEqual(["Cancel"]);
    expect(Object.values(registry.entries).map(e => e.source)).toEqual(["Save"]);
    expect(pruneOrphans(registry, Infinity, now)).toEqual([]);
  });
});

describe("corrupt file handling", () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(path.join(os.tmpdir(), "autoi18n-io-")); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("returns the fallback and keeps a backup of a corrupt JSON file", async () => {
    const file = path.join(dir, "catalog.json");
    await writeFile(file, "{not json");
    const warn = vi.fn();
    const value = await readJsonFile(file, { fallback: true }, warn);
    expect(value).toEqual({ fallback: true });
    expect(warn).toHaveBeenCalledTimes(1);
    const files = await readdir(dir);
    expect(files.some(f => f.startsWith("catalog.json.corrupt-"))).toBe(true);
    expect(files).not.toContain("catalog.json");
  });

  it("loads an empty registry when the registry file is corrupt", async () => {
    const file = path.join(dir, "registry.json");
    await writeFile(file, "{bad");
    const warn = vi.fn();
    const registry: Registry = await loadRegistry(file, warn);
    expect(registry).toEqual({ version: 1, entries: {} });
    expect(warn).toHaveBeenCalled();
    expect((await readdir(dir)).some(f => f.startsWith("registry.json.corrupt-"))).toBe(true);
  });
});

describe("locale configuration", () => {
  it("rejects a locale that is not configured", () => {
    const plugin = autoI18n({ locales: ["en", "de"], locale: "fr", provider: { translate: async () => ({}) } }) as unknown as {
      configResolved: (c: { root: string; command: string }) => void;
    };
    expect(() => plugin.configResolved({ root: process.cwd(), command: "build" })).toThrow(/"fr"/);
  });
});
