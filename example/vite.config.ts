import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import autoI18n, { AnthropicProvider, OpenAICompatibleProvider } from "../src/index";

export default defineConfig(({ mode }) => {
  // Reads provider keys from the repo-root .env.local (git-ignored) as well as the process environment.
  const env = { ...loadEnv(mode, fileURLToPath(new URL("..", import.meta.url)), ""), ...process.env };
  return {
    plugins: [
      // Must precede react(): @vitejs/plugin-react transforms JSX first in dev, removing the text nodes autoI18n extracts.
      autoI18n({
        locales: ["en", "de"],
        sourceLocale: "en",
        delivery: "runtime",
        failOnMissingProvider: true,
        debug: true,
        provider: env.OPENAI_API_KEY
          ? new OpenAICompatibleProvider({ apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL ?? "gpt-4.1-mini" })
          : env.ANTHROPIC_API_KEY
            ? new AnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL ?? "claude-haiku-5-5" })
            : undefined
      }),
      react()
    ]
  };
});
