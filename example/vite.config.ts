import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import autoI18n, { AnthropicProvider, GeminiProvider, OpenAICompatibleProvider } from "../src/index";

export default defineConfig(({ mode }) => {
  // Reads provider keys from the repo-root .env.local (git-ignored) as well as the process environment.
  const env = { ...loadEnv(mode, fileURLToPath(new URL("..", import.meta.url)), ""), ...process.env };

  // OpenAI-compatible hosted services: [name, key variable, default model, base URL]. `<NAME>_MODEL` overrides the model.
  // A missing base URL means OpenAI itself.
  const compatible: [string, string, string, string?][] = [
    ["openai", "OPENAI_API_KEY", "gpt-4.1-mini"],
    ["mistral", "MISTRAL_API_KEY", "mistral-small-latest", "https://api.mistral.ai/v1"],
    ["groq", "GROQ_API_KEY", "llama-3.3-70b-versatile", "https://api.groq.com/openai/v1"],
    ["deepseek", "DEEPSEEK_API_KEY", "deepseek-chat", "https://api.deepseek.com/v1"],
    ["openrouter", "OPENROUTER_API_KEY", "openai/gpt-4.1-mini", "https://openrouter.ai/api/v1"],
    ["xai", "XAI_API_KEY", "grok-3-mini", "https://api.x.ai/v1"],
    ["cerebras", "CEREBRAS_API_KEY", "llama-3.3-70b", "https://api.cerebras.ai/v1"],
    ["perplexity", "PERPLEXITY_API_KEY", "sonar", "https://api.perplexity.ai"],
    ["together", "TOGETHER_API_KEY", "meta-llama/Llama-3.3-70B-Instruct-Turbo", "https://api.together.xyz/v1"],
    ["fireworks", "FIREWORKS_API_KEY", "accounts/fireworks/models/llama-v3p3-70b-instruct", "https://api.fireworks.ai/inference/v1"],
    ["huggingface", "HUGGINGFACE_API_KEY", "meta-llama/Llama-3.3-70B-Instruct", "https://router.huggingface.co/v1"],
    ["deepinfra", "DEEPINFRA_API_KEY", "meta-llama/Meta-Llama-3.1-70B-Instruct", "https://api.deepinfra.com/v1/openai"],
    ["sambanova", "SAMBANOVA_API_KEY", "Meta-Llama-3.3-70B-Instruct", "https://api.sambanova.ai/v1"],
    ["moonshot", "MOONSHOT_API_KEY", "moonshot-v1-8k", "https://api.moonshot.ai/v1"]
  ];

  // Local runtimes: [name, default base URL]. They need no key, so each is enabled by `<NAME>_MODEL` (a model you have loaded),
  // and `<NAME>_BASE_URL` overrides the server address. LocalAI and llama.cpp both default to port 8080; set one of them.
  const local: [string, string][] = [
    ["ollama", "http://localhost:11434/v1"],
    ["lmstudio", "http://localhost:1234/v1"],
    ["llamacpp", "http://localhost:8080/v1"],
    ["vllm", "http://localhost:8000/v1"],
    ["localai", "http://localhost:8080/v1"],
    ["dockermodelrunner", "http://localhost:12434/engines/v1"]
  ];

  return {
    plugins: [
      // Must precede react(): @vitejs/plugin-react transforms JSX first in dev, removing the text nodes autoI18n extracts.
      autoI18n({
        locales: ["en", "de"],
        sourceLocale: "en",
        delivery: "runtime",
        failOnMissingProvider: true,
        debug: true,
        componentProps: { Button: ["children"] },
        provider: {
          // Set PRIMARY_PROVIDER to a configured name to choose the first provider tried. Otherwise the order below applies.
          primary: env.PRIMARY_PROVIDER || undefined,
          ...Object.fromEntries(
            compatible.map(([name, key, model, baseURL]) => [
              name,
              env[key] ? new OpenAICompatibleProvider({ apiKey: env[key], baseURL, model: env[`${name.toUpperCase()}_MODEL`] ?? model }) : undefined
            ])
          ),
          ...Object.fromEntries(
            local.map(([name, defaultBaseURL]) => {
              const model = env[`${name.toUpperCase()}_MODEL`];
              return [name, model ? new OpenAICompatibleProvider({ baseURL: env[`${name.toUpperCase()}_BASE_URL`] ?? defaultBaseURL, model }) : undefined];
            })
          ),
          anthropic: env.ANTHROPIC_API_KEY
            ? new AnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL ?? "claude-haiku-5-5" })
            : undefined,
          gemini: env.GEMINI_API_KEY
            ? new GeminiProvider({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL ?? "gemini-3.5-flash-lite" })
            : undefined
        }
      }),
      react()
    ]
  };
});
