import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import autoI18n from "../src/index";
import { buildProviders } from "./providers";

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
        componentProps: { Button: ["children"] },
        provider: buildProviders(env)
      }),
      react()
    ]
  };
});
