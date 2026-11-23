import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

import autoI18n, { hosted, HostedService, local, LocalService } from "../src/index.ts";

export default defineConfig(({ mode }) => {
  // Reads provider keys from the repo-root .env.local (git-ignored) as well as the process environment.
  const env = { ...loadEnv(mode, fileURLToPath(new URL("..", import.meta.url)), ""), ...process.env };

  return {
    resolve: {
      alias: [
        // The generated module imports the package's runtime subpath. Use the source so the example runs without a build.
        {
          find: /^vite-plugin-ai-auto-i18n\/runtime$/,
          replacement: fileURLToPath(new URL("../src/runtime/index.ts", import.meta.url)),
        },
      ],
    },
    plugins: [
      autoI18n({
        locales: ["en", "de"],
        sourceLocale: "en",
        delivery: "runtime",
        failOnMissingProvider: true,
        debug: true,
        provider: {
          // Set PRIMARY_PROVIDER to a configured name to choose the first provider tried. Otherwise the order below applies.
          primary: env.PRIMARY_PROVIDER === "" ? undefined : env.PRIMARY_PROVIDER,

          // Hosted providers
          openai: hosted(HostedService.OpenAI, env.OPENAI_API_KEY, env.OPENAI_MODEL),
          mistral: hosted(HostedService.Mistral, env.MISTRAL_API_KEY, env.MISTRAL_MODEL),
          groq: hosted(HostedService.Groq, env.GROQ_API_KEY, env.GROQ_MODEL),
          deepseek: hosted(HostedService.DeepSeek, env.DEEPSEEK_API_KEY, env.DEEPSEEK_MODEL),
          openrouter: hosted(HostedService.OpenRouter, env.OPENROUTER_API_KEY, env.OPENROUTER_MODEL),
          xai: hosted(HostedService.XAI, env.XAI_API_KEY, env.XAI_MODEL),
          cerebras: hosted(HostedService.Cerebras, env.CEREBRAS_API_KEY, env.CEREBRAS_MODEL),
          perplexity: hosted(HostedService.Perplexity, env.PERPLEXITY_API_KEY, env.PERPLEXITY_MODEL),
          together: hosted(HostedService.Together, env.TOGETHER_API_KEY, env.TOGETHER_MODEL),
          fireworks: hosted(HostedService.Fireworks, env.FIREWORKS_API_KEY, env.FIREWORKS_MODEL),
          huggingface: hosted(HostedService.HuggingFace, env.HUGGINGFACE_API_KEY, env.HUGGINGFACE_MODEL),
          deepinfra: hosted(HostedService.DeepInfra, env.DEEPINFRA_API_KEY, env.DEEPINFRA_MODEL),
          sambanova: hosted(HostedService.SambaNova, env.SAMBANOVA_API_KEY, env.SAMBANOVA_MODEL),
          moonshot: hosted(HostedService.Moonshot, env.MOONSHOT_API_KEY, env.MOONSHOT_MODEL),
          ollama: local(LocalService.Ollama, env.OLLAMA_MODEL, env.OLLAMA_BASE_URL),
          lmstudio: local(LocalService.LMStudio, env.LMSTUDIO_MODEL, env.LMSTUDIO_BASE_URL),
          anthropic: hosted(HostedService.Anthropic, env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL),
          gemini: hosted(HostedService.Gemini, env.GEMINI_API_KEY, env.GEMINI_MODEL),

          // LocalAI and llama.cpp both default to port 8080; set the base URL of whichever one you run.
          llamacpp: local(LocalService.LlamaCpp, env.LLAMACPP_MODEL, env.LLAMACPP_BASE_URL),
          vllm: local(LocalService.VLLM, env.VLLM_MODEL, env.VLLM_BASE_URL),
          localai: local(LocalService.LocalAI, env.LOCALAI_MODEL, env.LOCALAI_BASE_URL),
          dockermodelrunner: local(
            LocalService.DockerModelRunner,
            env.DOCKERMODELRUNNER_MODEL,
            env.DOCKERMODELRUNNER_BASE_URL,
          ),
        },
      }),
      react(),
    ],
  };
});
