import { AnthropicProvider, GeminiProvider, OpenAICompatibleProvider, type ProviderConfig } from "../src/index";

type Env = Record<string, string | undefined>;

/**
 * OpenAI-compatible services. Each is enabled when its key is set. `<NAME>_MODEL` overrides the default model, for
 * example `MISTRAL_MODEL`. A missing `baseURL` means OpenAI itself.
 */
const COMPATIBLE: { name: string; key: string; model: string; baseURL?: string }[] = [
  { name: "openai", key: "OPENAI_API_KEY", model: "gpt-4.1-mini" },
  { name: "mistral", key: "MISTRAL_API_KEY", model: "mistral-small-latest", baseURL: "https://api.mistral.ai/v1" },
  { name: "groq", key: "GROQ_API_KEY", model: "llama-3.3-70b-versatile", baseURL: "https://api.groq.com/openai/v1" },
  { name: "deepseek", key: "DEEPSEEK_API_KEY", model: "deepseek-chat", baseURL: "https://api.deepseek.com/v1" },
  { name: "openrouter", key: "OPENROUTER_API_KEY", model: "openai/gpt-4.1-mini", baseURL: "https://openrouter.ai/api/v1" },
  { name: "xai", key: "XAI_API_KEY", model: "grok-3-mini", baseURL: "https://api.x.ai/v1" },
  { name: "cerebras", key: "CEREBRAS_API_KEY", model: "llama-3.3-70b", baseURL: "https://api.cerebras.ai/v1" }
];

/**
 * Builds the `provider` option from environment variables. The first configured provider, in the order below, becomes
 * `primary`; the others act as fallbacks.
 */
export function buildProviders(env: Env): ProviderConfig {
  const compatible = Object.fromEntries(
    COMPATIBLE.map(({ name, key, model, baseURL }) => [
      name,
      env[key] ? new OpenAICompatibleProvider({ apiKey: env[key], baseURL, model: env[`${name.toUpperCase()}_MODEL`] ?? model }) : undefined
    ])
  );
  const providers = {
    anthropic: env.ANTHROPIC_API_KEY
      ? new AnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL ?? "claude-haiku-5-5" })
      : undefined,
    ...compatible,
    gemini: env.GEMINI_API_KEY
      ? new GeminiProvider({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL ?? "gemini-3.5-flash-lite" })
      : undefined,
    // Keyless. Enabled only when a model is named, so a server that is not running does not add a failing fallback to every build.
    ollama: env.OLLAMA_MODEL
      ? new OpenAICompatibleProvider({ baseURL: env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1", model: env.OLLAMA_MODEL })
      : undefined
  };
  const primary = Object.entries(providers).find(([, provider]) => provider)?.[0];
  return { primary, ...providers };
}
