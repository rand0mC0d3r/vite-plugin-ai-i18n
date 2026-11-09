import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import autoI18n, { OpenAICompatibleProvider } from "../src/index";

export default defineConfig(({ mode }) => {
  // Reads OPENAI_API_KEY from the repo-root .env.local (git-ignored) as well as the process environment.
  const env = { ...loadEnv(mode, fileURLToPath(new URL("..", import.meta.url)), ""), ...process.env };
  return {
    plugins: [
      react(),
      autoI18n({
        locales: ["en", "de", "fr"],
        sourceLocale: "en",
        delivery: "runtime",
        failOnMissingProvider: true,
        provider: env.OPENAI_API_KEY
          ? new OpenAICompatibleProvider({ apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL ?? "gpt-4.1-mini" })
          : undefined
      })
    ]
  };
});
