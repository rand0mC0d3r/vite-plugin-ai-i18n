import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranslationRequest } from "../../src/types.js";
import { AnthropicProvider } from "../../src/ai/anthropic.js";
import { DeepLProvider } from "../../src/ai/deepl.js";
import { GeminiProvider } from "../../src/ai/gemini.js";
import { GoogleTranslateProvider } from "../../src/ai/google.js";
import { OpenAICompatibleProvider } from "../../src/ai/openai.js";
import { HostedService, LocalService, MachineService, hosted, local, machine } from "../../src/ai/presets.js";

const request: TranslationRequest = { id: "a", source: "Save", context: "", kind: "text" };
const input = { sourceLocale: "en", targetLocale: "de", messages: [request] };
const chatResponse = () =>
  new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: JSON.stringify({ a: "Speichern" }) }, finish_reason: "stop" }] }));

describe("provider presets", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockImplementation(async () => chatResponse());
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("skips hosted and machine services without a key", () => {
    expect(hosted(HostedService.Mistral, undefined)).toBeUndefined();
    expect(hosted(HostedService.Gemini, "")).toBeUndefined();
    expect(machine(MachineService.DeepL, undefined)).toBeUndefined();
    expect(local(LocalService.Ollama, undefined)).toBeUndefined();
  });

  it("sends hosted requests to the service endpoint with its default model unless overridden", async () => {
    await hosted(HostedService.Mistral, "key")!.translate(input);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.mistral.ai/v1/chat/completions");
    expect(JSON.parse(init.body as string).model).toBe("mistral-small-latest");

    fetchMock.mockClear();
    await hosted(HostedService.Mistral, "key", "mistral-large-latest")!.translate(input);
    expect(JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string).model).toBe("mistral-large-latest");
  });

  it("uses the local runtime's default address, or the given override", async () => {
    await local(LocalService.Ollama, "qwen2.5:7b")!.translate(input);
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe("http://localhost:11434/v1/chat/completions");

    fetchMock.mockClear();
    await local(LocalService.Ollama, "qwen2.5:7b", "http://gpu-box:11434/v1")!.translate(input);
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe("http://gpu-box:11434/v1/chat/completions");
  });

  it("returns the provider class for each hosted and machine service", () => {
    expect(hosted(HostedService.Anthropic, "key")).toBeInstanceOf(AnthropicProvider);
    expect(hosted(HostedService.Gemini, "key", "gemini-test")).toBeInstanceOf(GeminiProvider);
    expect(hosted(HostedService.Mistral, "key")).toBeInstanceOf(OpenAICompatibleProvider);
    expect(machine(MachineService.DeepL, "key")).toBeInstanceOf(DeepLProvider);
    expect(machine(MachineService.Google, "key")).toBeInstanceOf(GoogleTranslateProvider);
  });
});
