import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import autoI18n from "./index.js";
import { extractMessages } from "./compiler/extract.js";
import { readJsonFile } from "./io.js";
import { loadRegistry, pruneOrphans, reconcile } from "./identity/registry.js";
import { readLocaleFile } from "./catalog.js";
import { OpenAICompatibleProvider } from "./ai/openai.js";
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

  it("does not include the response body in the error message", async () => {
    fetchMock.mockResolvedValue(new Response("invalid key sk-test-SECRET echoing the source text", { status: 401 }));
    const error = await provider().translate(input([request("a")])).catch((e: unknown) => e as Error);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("Translation API failed (401)");
    expect(error.message).not.toContain("sk-test-SECRET");
  });

  it("honours Retry-After on a rate limit instead of the backoff delay", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("slow down", { status: 429, headers: { "retry-after": "0" } }))
      .mockResolvedValueOnce(jsonResponse({ a: "Speichern" }));
    const result = await provider({ retryDelayMs: 10_000 }).translate(input([request("a")]));
    expect(result).toEqual({ a: "Speichern" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 2_000);

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
    const first = reconcile({ version: 1, entries: {} }, initial);
    const originalIds = first.messages.map(m => m.id);
    const shifted = [message(105), message(200)];
    const second = reconcile(first.registry, shifted);
    expect(second.messages.map(m => m.id)).toEqual(originalIds);
    expect(second.ambiguous).toEqual([]);
  });

  it("reports ambiguity when the number of duplicates changes", () => {
    const registry = reconcile({ version: 1, entries: {} }, [message(1), message(50)]).registry;
    const result = reconcile(registry, [message(1)]);
    expect(result.ambiguous).toEqual(["Save"]);
  });

  it("keeps a message's ID when its component is renamed and the component order changes", () => {
    const first = reconcile({ version: 1, entries: {} }, [message(1, "Save", "fp-save"), { ...message(50, "Save", "fp-save"), component: "Footer" }]);
    const renamed = [{ ...message(1, "Save", "fp-save"), component: "Toolbar" }, { ...message(50, "Save", "fp-save"), component: "Footer" }];
    const second = reconcile(first.registry, renamed);
    expect(second.messages.map(m => m.id)).toEqual(first.messages.map(m => m.id));
    expect(second.ambiguous).toEqual([]);
  });

  it("pairs by component when the duplicates are reordered", () => {
    const first = reconcile({ version: 1, entries: {} }, [{ ...message(1), component: "A" }, { ...message(50), component: "B" }]);
    const reordered = [{ ...message(1), component: "B" }, { ...message(50), component: "A" }];
    const second = reconcile(first.registry, reordered);
    expect(second.messages[0].id).toBe(first.messages[1].id);
    expect(second.messages[1].id).toBe(first.messages[0].id);
  });

  it("keeps the fingerprint stable when a handler is renamed", () => {
    const code = (handler: string) => `export const A = () => <button onClick={${handler}}>Save</button>;\n`;
    const [before] = extractMessages(code("save"), "A.tsx");
    const [after] = extractMessages(code("submit"), "A.tsx");
    expect(after.fingerprint).toBe(before.fingerprint);
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

  it("keeps valid registry entries and drops invalid ones", async () => {
    const file = path.join(dir, "registry.json");
    const valid = { id: "msg_a", source: "Save", kind: "text", tag: "button", component: "App", context: "", fingerprint: "fp", location: "App.tsx:1", status: "active", firstSeen: "2026-01-01T00:00:00.000Z", lastSeen: "2026-01-01T00:00:00.000Z" };
    await writeFile(file, JSON.stringify({ version: 1, entries: { msg_a: valid, msg_b: { id: "msg_b" } } }));
    const warn = vi.fn();
    const registry = await loadRegistry(file, warn);
    expect(Object.keys(registry.entries)).toEqual(["msg_a"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("msg_b"));
  });

  it("drops non-text values from a locale file", async () => {
    const file = path.join(dir, "de.json");
    await writeFile(file, JSON.stringify({ messages: { a: "Speichern", b: 3 }, sources: { a: "Save" } }));
    const warn = vi.fn();
    expect(await readLocaleFile(file, warn)).toEqual({ messages: { a: "Speichern" }, sources: { a: "Save" } });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"b"'));
  });
});

describe("locale configuration", () => {
  it("rejects a locale that is not configured", () => {
    const plugin = autoI18n({ locales: ["en", "de"], locale: "fr", provider: { translate: async () => ({}) } }) as unknown as {
      configResolved: (c: { root: string; command: string }) => void;
    };
    expect(() => plugin.configResolved({ root: process.cwd(), command: "build" })).toThrow(/"fr"/);
  });

  it("rejects malformed options when the plugin is created", () => {
    expect(() => autoI18n({ locales: ["de"], localeConcurrency: NaN })).toThrow(/invalid options.*localeConcurrency/);
    expect(() => autoI18n({ locales: "de" } as never)).toThrow(/invalid options.*locales/);
  });
});
