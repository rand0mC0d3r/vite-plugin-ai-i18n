import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import autoI18n, { OpenAICompatibleProvider } from "../src/index";

export default defineConfig({
  plugins: [
    react(),
    autoI18n({
      locales: ["en", "de", "fr"],
      sourceLocale: "en",
      provider: process.env.OPENAI_API_KEY
        ? new OpenAICompatibleProvider({ apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini" })
        : undefined
    })
  ]
});
