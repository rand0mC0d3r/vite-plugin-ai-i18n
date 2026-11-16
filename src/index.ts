import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Plugin, ResolvedConfig, ViteDevServer } from "vite";

import { FORMAT_MODULE, RUNTIME_MODULE, transformSource } from "./compiler/transform.js";
import { hashContent } from "./io/files.js";
import { type AutoI18nOptions, validateOptions } from "./options.js";
import { reporterFor, Syncer } from "./sync.js";
import { createFormatModule, FORMAT_LIBRARY } from "./virtual/format.js";
import { createRuntimeModule } from "./virtual/runtime.js";

/** HMR event name that carries updated catalogues to the browser in dev. */
const UPDATE_EVENT = "autoi18n:update";
/** Delay before a burst of file add/remove events triggers one re-index. */
const WATCH_DEBOUNCE_MS = 150;

export type { AutoI18nOptions } from "./options.js";

/**
 * Vite plugin that extracts translatable strings from source files, translates them and serves the catalogues. Options
 * are validated and the provider is resolved immediately, so a bad configuration throws before the build starts.
 *
 * @example
 *   import autoI18n from "vite-plugin-ai-i18n";
 *   export default defineConfig({ plugins: [autoI18n({ locales: ["en", "de"] })] });
 */
export default function autoI18n(options: AutoI18nOptions): Plugin {
  validateOptions(options);
  const syncer = new Syncer(options);
  const { state } = syncer;
  const sourceLocale = syncer.sourceLocale;
  let config: ResolvedConfig;

  let server: ViteDevServer | undefined;
  let watchTimer: ReturnType<typeof setTimeout> | undefined;

  /** Sends the catalogues that changed to the browser over HMR, so a dev page updates without a reload. */
  function pushCatalogs(locales: string[]): void {
    if (!locales.length) return;
    server?.ws.send({
      type: "custom",
      event: UPDATE_EVENT,
      data: { catalogs: Object.fromEntries(locales.map((locale) => [locale, state.catalogs.get(locale)])) },
    });
  }

  /** Runs a sync and pushes the result to the browser. Errors are logged, not thrown, because this runs from a watcher. */
  async function retranslate(changedFile?: string): Promise<void> {
    try {
      pushCatalogs(await syncer.runSync(reporterFor(config.logger), changedFile));
    } catch (error) {
      config.logger.error(`autoi18n: re-translation failed: ${(error as Error).message}`);
    }
  }

  // A burst of added or removed files (for example a git checkout) causes one re-index instead of one per file.
  function scheduleRetranslate(): void {
    clearTimeout(watchTimer);
    watchTimer = setTimeout(() => void retranslate(), WATCH_DEBOUNCE_MS);
  }

  return {
    name: "vite-plugin-autoi18n",
    enforce: "pre",
    configResolved(resolved) {
      config = resolved;
      syncer.attach(resolved);
      const selected = syncer.selectedLocale();
      if (selected !== sourceLocale && !options.locales.includes(selected)) {
        throw new Error(
          `autoi18n: locale "${selected}" is not one of the configured locales (${options.locales.join(", ")}).`,
        );
      }
    },
    resolveId(id, importer) {
      if (id === RUNTIME_MODULE) return `\0${RUNTIME_MODULE}`;
      if (id === FORMAT_MODULE) return `\0${FORMAT_MODULE}`;
      // The app does not install the formatting library, so it is resolved from this plugin's dependencies.
      if (importer === `\0${FORMAT_MODULE}` && id === FORMAT_LIBRARY)
        return this.resolve(id, fileURLToPath(import.meta.url), { skipSelf: true });
      return undefined;
    },
    load(id) {
      if (id === `\0${RUNTIME_MODULE}`) return createRuntimeModule(state.catalogFiles, sourceLocale);
      if (id === `\0${FORMAT_MODULE}`) return createFormatModule();
      return undefined;
    },
    configureServer(devServer) {
      server = devServer;
      // Adding or removing a file cannot go through handleHotUpdate, so re-index here.
      devServer.watcher.on("add", (file) => {
        if (syncer.isSourceCandidate(file)) scheduleRetranslate();
      });
      devServer.watcher.on("unlink", (file) => {
        if (state.fileMessages.has(file)) scheduleRetranslate();
      });
    },
    closeBundle() {
      clearTimeout(watchTimer);
    },
    async buildStart() {
      await syncer.sync({ info: (m) => this.info(m), warn: (m) => this.warn(m), error: (m) => this.error(m) });
    },
    async transform(code, id) {
      const file = id.split("?")[0];
      if (!state.fileMessages.has(file)) return null;
      // Hashed once: the same hash decides whether the index is stale and whether the messages still fit this code.
      const codeHash = hashContent(code);
      if (codeHash !== state.hashOf(file)) {
        // The file changed after it was indexed, e.g. the watcher has not fired yet; re-index once.
        await syncer.runSync(reporterFor(config.logger), file);
      }
      const messages = state.fileMessages.get(file);
      if (!messages || codeHash !== state.hashOf(file)) {
        if (!state.warnedFiles.has(file)) {
          state.warnedFiles.add(file);
          this.warn(`autoi18n: ${file} changed while it was being indexed; its messages are left untranslated.`);
        }
        return null;
      }
      const locale = syncer.isServing() ? sourceLocale : syncer.selectedLocale();
      // The AST is only reused while the code still matches the indexed hash, so it describes the same text.
      const parsed = state.parsedSources.get(file);
      state.parsedSources.delete(file);
      const result = transformSource(
        code,
        file,
        messages,
        locale,
        state.catalogs.get(locale) ?? {},
        syncer.delivery === "runtime",
        sourceLocale,
        parsed,
      );
      return { code: result.code, map: result.map };
    },
    async handleHotUpdate({ file }) {
      // Catalogue writes must not trigger a reload; the new data is pushed over the custom event instead.
      if (file.startsWith(syncer.localesDir() + path.sep)) return [];
      if (!state.fileMessages.has(file)) return undefined;
      await retranslate(file);
      return undefined;
    },
  };
}

export { PartialTranslationError } from "./errors.js";
export { FallbackProvider, resolveProvider } from "./ai/fallback.js";
export { OpenAICompatibleProvider } from "./ai/openai.js";
export type { OpenAICompatibleOptions } from "./ai/openai.js";
export { AnthropicProvider } from "./ai/anthropic.js";
export type { AnthropicOptions } from "./ai/anthropic.js";
export { GeminiProvider } from "./ai/gemini.js";
export type { GeminiOptions } from "./ai/gemini.js";
export { DeepLProvider } from "./ai/deepl.js";
export type { DeepLOptions } from "./ai/deepl.js";
export { GoogleTranslateProvider } from "./ai/google.js";
export type { GoogleTranslateOptions } from "./ai/google.js";
export { HostedService, LocalService, MachineService, hosted, local, machine } from "./ai/presets.js";
export * from "./locales.js";
export type * from "./types.js";
