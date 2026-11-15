import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import autoI18n, {
    AnthropicProvider,
    DeepLProvider,
    GeminiProvider,
    GoogleTranslateProvider,
    OpenAICompatibleProvider
} from "../src/index";

export default defineConfig(({ mode }) => {
  // Reads provider keys from the repo-root .env.local (git-ignored) as well as the process environment.
  const env = { ...loadEnv(mode, fileURLToPath(new URL("..", import.meta.url)), ""), ...process.env };

  // Reads `<NAME>_<suffix>` for a service, for example variable("ollama", "MODEL") reads OLLAMA_MODEL.
  const variable = (name: string, suffix: string) => env[`${name.toUpperCase()}_${suffix}`];

  // Hosted service, enabled by its API key. `<NAME>_MODEL` overrides the default model.
  const keyed = <T>(name: string, apiKey: string | undefined, defaultModel: string, create: (apiKey: string, model: string) => T): T | undefined =>
    apiKey ? create(apiKey, variable(name, "MODEL") ?? defaultModel) : undefined;

  // Machine-translation API, enabled by its key. It has no model to choose.
  const machine = <T>(apiKey: string | undefined, create: (apiKey: string) => T): T | undefined => (apiKey ? create(apiKey) : undefined);

  // OpenAI-compatible hosted service. A missing base URL means OpenAI itself.
  const hosted = (name: string, apiKey: string | undefined, defaultModel: string, baseURL?: string) =>
    keyed(name, apiKey, defaultModel, (key, model) => new OpenAICompatibleProvider({ apiKey: key, baseURL, model }));

  // Local runtime, enabled by a loaded model since it needs no key. `<NAME>_BASE_URL` overrides the server address.
  const localRuntime = (name: string, defaultBaseURL: string) => {
    const model = variable(name, "MODEL");
    return model ? new OpenAICompatibleProvider({ baseURL: variable(name, "BASE_URL") ?? defaultBaseURL, model }) : undefined;
  };

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

          // Hosted providers
          openai: hosted("openai", env.OPENAI_API_KEY, "gpt-4.1-mini"),
          mistral: hosted("mistral", env.MISTRAL_API_KEY, "mistral-small-latest", "https://api.mistral.ai/v1"),
          groq: hosted("groq", env.GROQ_API_KEY, "llama-3.3-70b-versatile", "https://api.groq.com/openai/v1"),
          deepseek: hosted("deepseek", env.DEEPSEEK_API_KEY, "deepseek-chat", "https://api.deepseek.com/v1"),
          openrouter: hosted("openrouter", env.OPENROUTER_API_KEY, "openai/gpt-4.1-mini", "https://openrouter.ai/api/v1"),
          xai: hosted("xai", env.XAI_API_KEY, "grok-3-mini", "https://api.x.ai/v1"),
          cerebras: hosted("cerebras", env.CEREBRAS_API_KEY, "llama-3.3-70b", "https://api.cerebras.ai/v1"),
          perplexity: hosted("perplexity", env.PERPLEXITY_API_KEY, "sonar", "https://api.perplexity.ai"),
          together: hosted("together", env.TOGETHER_API_KEY, "meta-llama/Llama-3.3-70B-Instruct-Turbo", "https://api.together.xyz/v1"),
          fireworks: hosted("fireworks", env.FIREWORKS_API_KEY, "accounts/fireworks/models/llama-v3p3-70b-instruct", "https://api.fireworks.ai/inference/v1"),
          huggingface: hosted("huggingface", env.HUGGINGFACE_API_KEY, "meta-llama/Llama-3.3-70B-Instruct", "https://router.huggingface.co/v1"),
          deepinfra: hosted("deepinfra", env.DEEPINFRA_API_KEY, "meta-llama/Meta-Llama-3.1-70B-Instruct", "https://api.deepinfra.com/v1/openai"),
          sambanova: hosted("sambanova", env.SAMBANOVA_API_KEY, "Meta-Llama-3.3-70B-Instruct", "https://api.sambanova.ai/v1"),
          moonshot: hosted("moonshot", env.MOONSHOT_API_KEY, "moonshot-v1-8k", "https://api.moonshot.ai/v1"),
          ollama: localRuntime("ollama", "http://localhost:11434/v1"),
          lmstudio: localRuntime("lmstudio", "http://localhost:1234/v1"),

          // LocalAI and llama.cpp both default to port 8080; set the base URL of whichever one you run.
          llamacpp: localRuntime("llamacpp", "http://localhost:8080/v1"),
          vllm: localRuntime("vllm", "http://localhost:8000/v1"),
          localai: localRuntime("localai", "http://localhost:8080/v1"),
          dockermodelrunner: localRuntime("dockermodelrunner", "http://localhost:12434/engines/v1"),

          // Add any additional local runtime providers here if needed.
          anthropic: keyed("anthropic", env.ANTHROPIC_API_KEY, "claude-haiku-5-5", (apiKey, model) => new AnthropicProvider({ apiKey, model })),
          gemini: keyed("gemini", env.GEMINI_API_KEY, "gemini-3.5-flash-lite", (apiKey, model) => new GeminiProvider({ apiKey, model })),

          // Dedicated machine-translation APIs. Each is enabled by its own credentials.
          deepl: machine(env.DEEPL_API_KEY, (apiKey) => new DeepLProvider({ apiKey })),
          google: machine(env.GOOGLE_TRANSLATE_API_KEY, (apiKey) => new GoogleTranslateProvider({ apiKey }))
        }
      }),
      react()
    ]
  };
});
