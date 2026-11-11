import { afterEach, describe, expect, it, vi } from "vitest";
import { translateLocale } from "./translate.js";
import { PartialTranslationError } from "./errors.js";
import { emptyLocaleFile } from "./catalog.js";
import type { TranslationProvider, TranslationRequest } from "./types.js";

const text = (id: string, source = "Save"): TranslationRequest => ({ id, source, context: "", kind: "text" });
const mixed = (id: string, source: string, placeholders: string[]): TranslationRequest => ({ id, source, context: "", kind: "mixed", placeholders });

const provider = (result: Record<string, string>): TranslationProvider & { translate: ReturnType<typeof vi.fn> } => ({
  translate: vi.fn(async () => result)
});

const base = { sourceLocale: "en", locale: "de" };

describe("translateLocale", () => {
  afterEach(() => vi.restoreAllMocks());

  it("requests every message when the previous file is empty and stores the results with their sources", async () => {
    const p = provider({ a: "Speichern", b: "Abbrechen" });
    const result = await translateLocale({ ...base, provider: p, requests: [text("a"), text("b", "Cancel")], previous: emptyLocaleFile() });
    expect(p.translate).toHaveBeenCalledWith({ sourceLocale: "en", targetLocale: "de", messages: [text("a"), text("b", "Cancel")] });
    expect(result.file).toEqual({ messages: { a: "Speichern", b: "Abbrechen" }, sources: { a: "Save", b: "Cancel" } });
    expect(result).toMatchObject({ untranslated: 0, rejected: 0, requested: 2, failed: 0, failure: undefined });
  });

  it("does not call the provider when every message is already translated from the same source", async () => {
    const p = provider({});
    const previous = { messages: { a: "Speichern" }, sources: { a: "Save" } };
    const result = await translateLocale({ ...base, provider: p, requests: [text("a")], previous });
    expect(p.translate).not.toHaveBeenCalled();
    expect(result).toMatchObject({ requested: 0, untranslated: 0, file: { messages: { a: "Speichern" }, sources: { a: "Save" } } });
  });

  it("re-requests a message whose recorded source no longer matches", async () => {
    const p = provider({ a: "Neu" });
    const previous = { messages: { a: "Alt" }, sources: { a: "Old text" } };
    const result = await translateLocale({ ...base, provider: p, requests: [text("a")], previous });
    expect(p.translate.mock.calls[0][0].messages).toEqual([text("a")]);
    expect(result.file.messages).toEqual({ a: "Neu" });
    expect(result.file.sources).toEqual({ a: "Save" });
  });

  it("prunes keys for messages that are no longer active", async () => {
    const previous = { messages: { keep: "Behalten", gone: "Weg" }, sources: { keep: "Keep", gone: "Gone" } };
    const result = await translateLocale({ ...base, provider: provider({}), requests: [text("keep", "Keep")], previous });
    expect(result.file).toEqual({ messages: { keep: "Behalten" }, sources: { keep: "Keep" } });
  });

  it("leaves messages untranslated when there is no provider, keeping the source as the fallback", async () => {
    const result = await translateLocale({ ...base, requests: [text("a")], previous: emptyLocaleFile() });
    expect(result).toMatchObject({ requested: 1, untranslated: 1, file: { messages: {}, sources: {} } });
  });

  it("drops blank and non-string translations so they are requested again later", async () => {
    const p = provider({ a: "   ", b: 42 as unknown as string });
    const result = await translateLocale({ ...base, provider: p, requests: [text("a"), text("b")], previous: emptyLocaleFile() });
    expect(result.file.messages).toEqual({});
    expect(result.untranslated).toBe(2);
  });

  it("rejects mixed-content translations that change placeholders", async () => {
    const source = "You have {count} documents";
    const p = provider({ a: "Viele Dokumente", b: "Du hast {count} Dokumente" });
    const requests = [mixed("a", source, ["count"]), mixed("b", source, ["count"])];
    const result = await translateLocale({ ...base, provider: p, requests, previous: emptyLocaleFile() });
    expect(result.rejected).toBe(1);
    expect(result.untranslated).toBe(1);
    expect(result.file.messages).toEqual({ b: "Du hast {count} Dokumente" });
  });

  it("rejects mixed-content translations that repeat a placeholder", async () => {
    const source = "{count} documents";
    const p = provider({ a: "{count} Dokumente, {count} gesamt" });
    const result = await translateLocale({ ...base, provider: p, requests: [mixed("a", source, ["count"])], previous: emptyLocaleFile() });
    expect(result.rejected).toBe(1);
    expect(result.file.messages).toEqual({});
  });

  it("keeps the partial translations and reports failed batches when the provider throws PartialTranslationError", async () => {
    const error = new PartialTranslationError("1 messages failed to translate: busy", { a: "Speichern" }, 1);
    const p: TranslationProvider = { translate: vi.fn(async () => { throw error; }) };
    const result = await translateLocale({ ...base, provider: p, requests: [text("a"), text("b")], previous: emptyLocaleFile() });
    expect(result.file.messages).toEqual({ a: "Speichern" });
    expect(result).toMatchObject({ failed: 1, failure: error.message, untranslated: 1 });
  });

  it("rethrows errors that are not partial failures", async () => {
    const p: TranslationProvider = { translate: vi.fn(async () => { throw new Error("offline"); }) };
    await expect(translateLocale({ ...base, provider: p, requests: [text("a")], previous: emptyLocaleFile() })).rejects.toThrow("offline");
  });

  it("logs sent and received messages when debug is enabled", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const p = provider({ a: "Speichern" });
    await translateLocale({ ...base, provider: p, requests: [text("a"), text("b")], previous: emptyLocaleFile(), debug: true });
    const lines = log.mock.calls.map(call => String(call[0]));
    expect(lines).toEqual([
      expect.stringMatching(/sent en -> de a: "Save" \(context: \)$/),
      expect.stringMatching(/sent en -> de b: "Save" \(context: \)$/),
      expect.stringMatching(/received en -> de a: "Speichern"$/),
      expect.stringMatching(/received en -> de b: \(no translation\)$/)
    ]);
    expect(lines[0]).toMatch(/^\[autoi18n debug\] \d{4}-\d{2}-\d{2}T/);
  });

  it("does not log anything when debug is disabled", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await translateLocale({ ...base, provider: provider({ a: "Speichern" }), requests: [text("a")], previous: emptyLocaleFile() });
    expect(log).not.toHaveBeenCalled();
  });
});
