# 🌍 vite-plugin-autoi18n — MVP sketch 🚀

Implicit build-time localization for JSX: author English directly, let the compiler extract user-facing copy, persist message identities, and optionally translate through an AI provider.

## 🧩 Current MVP scope

- Extracts JSX text nodes and static string JSX attributes.
- Extracts string literals outside JSX only when they are marked with a leading `/* i18n */` comment.
- Uses tag/attribute/semantic-attribute/handler context to form fingerprints; component names and file paths are excluded so ordinary moves and renames do not automatically invalidate IDs.
- Persists opaque message IDs in `.autoi18n/registry.json`.
- Marks disappeared messages as orphaned and deletes them after a retention period (default 30 days, see `orphanRetentionMinutes`).
- Supports a pluggable translation provider; includes an OpenAI-compatible implementation and an Anthropic (Claude) implementation.
- Writes locale JSON catalogues and keeps source English as fallback.
- Two delivery modes: `build` (one compiled bundle per locale) and `runtime` (one bundle, locales loaded on demand through `virtual:autoi18n`).
- Re-translates a message when its source text changes, tracked in the `sources` map of `.autoi18n/locales/<locale>.json`.
- Includes a deliberately varied document-dashboard example.

## 📦 Installation

### 1️⃣ Install the package

In your React + Vite project:

```sh
npm install -D vite-plugin-ai-auto-i18n
```

Works the same with `pnpm add -D vite-plugin-ai-auto-i18n` or `yarn add -D vite-plugin-ai-auto-i18n`. It requires Vite 5 or newer (a peer dependency). For React, also keep `@vitejs/plugin-react` in your Vite config.

### 2️⃣ Add your API key

Put the key for your provider in `.env.local` and keep that file out of git. For OpenAI or any OpenAI-compatible API:

```sh
OPENAI_API_KEY=your-key-here
```

For Claude, use `ANTHROPIC_API_KEY` instead (see [AnthropicProvider options](#anthropicprovider-options)). For Gemini, use `GEMINI_API_KEY` (see [GeminiProvider options](#geminiprovider-options)).

### 3️⃣ Configure Vite

Add the plugin to `vite.config.ts`. `loadEnv` reads `.env.local` for the config file:

```ts
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import autoI18n, { AnthropicProvider, OpenAICompatibleProvider } from "vite-plugin-ai-auto-i18n";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [
      autoI18n({
        locales: ["en", "de", "fr"],
        sourceLocale: "en",
        provider: {
          primary: "anthropic",
          anthropic: new AnthropicProvider({
            apiKey: env.ANTHROPIC_API_KEY!,
            model: "claude-haiku-5-5"
          }),
          openai: new OpenAICompatibleProvider({
            apiKey: env.OPENAI_API_KEY!,
            model: "gpt-4.1-mini"
          })
        }
      }),
      react() // in runtime delivery, keep autoI18n before the React plugin
    ]
  };
});
```

### 4️⃣ Commit the generated files

The build writes `.autoi18n/` (registry and catalogues). Commit it so existing translations are reused instead of requested again. ✅

Then write ordinary JSX:

```tsx
<button title="Save the current document">Save</button>
```

### 🧪 Try the bundled example

A React document dashboard under `example/`:

```sh
npm install
npm run example:dev     # dev server
npm run example:build   # production build into example/dist
```

Run Vite. The plugin writes `.autoi18n/registry.json` and `.autoi18n/locales/<locale>.json`. Each locale file has two parts: `messages` (the translations) and `sources` (the source text each translation was made from). If the source changes, that message is re-translated on the next build.

Upgrading from an earlier version: the old flat locale files and `*.sources.json` sidecars are not read. Every message is re-translated once on the first build, and the sidecars are deleted.

If a translation batch fails, the other batches are still stored. The failed messages fall back to the source text until the next build. If every batch for a locale fails, that locale keeps its previous file and the build reports the error after writing the other locales.

🔑 Translations require a provider. With `failOnMissingProvider: true` the build fails when a locale is missing translations and no provider is configured, instead of silently shipping English.

All built-in providers (`OpenAICompatibleProvider`, `AnthropicProvider` and `GeminiProvider`) send messages in batches (`batchSize`, default 40), run up to `concurrency` batches at once (default 4), abort a request after `timeoutMs` (default 60000), and retry network errors, timeouts, 408/409/429 and 5xx responses or malformed output up to `maxRetries` times (default 2) with exponential backoff from `retryDelayMs` (default 500). Other 4xx errors fail immediately. If the provider omits some messages, the rest are kept and the missing ones stay in the source language until the next build retries them; the build logs how many were left untranslated.

The plugin translates up to `localeConcurrency` locales at once (default 2). Total parallel requests are roughly `localeConcurrency × concurrency`, so lower one or both if your provider rate-limits your account.

Ambiguous identity matches (duplicate identical strings whose count changed) are logged as warnings. Set `onAmbiguous: "error"` to fail the build instead. When a message is paired by fingerprint, the component name is used to break ties between identical strings, so reordering or renaming components keeps existing IDs.

Provider errors report only the HTTP status (for example `Translation API failed (500)`). The response body is discarded so provider output is not written to logs.

In dev, saving an indexed source file re-reads only that file and reuses cached extractions for the rest of the project. Catalogue and registry files are written only when their content actually changes.

Messages removed from the source are kept as orphans in `registry.json` so their IDs can be reused if the text returns. Orphans not seen for `orphanRetentionMinutes` minutes (default `43200`, i.e. 30 days) are deleted on the next build, and the build logs how many were removed. Use `0` to delete them immediately or `Infinity` to keep them forever. Once deleted, a returning message gets a new ID and is translated again.

🧹 To prune without running a build, use the CLI. In this repository, `npm run prune` builds and then runs it on the example app's `example/.autoi18n/` with `--retention-minutes 0`, so every orphan is removed. Pass options after `--` to override, for example `npm run prune -- --directory .autoi18n --retention-minutes 1440 --debug`. Options: `--directory` (default `.autoi18n`, relative to the current directory), `--retention-minutes` (default `43200`, i.e. 30 days, the plugin default) and `--debug` (prints each removed entry with its source text and last-seen time). The CLI also removes any key from the `messages` and `sources` maps of `locales/*.json` that is no longer an active registry entry, so the catalogues match the registry. If no registry exists at that path, the CLI says so and changes nothing. Installed packages can run `node node_modules/vite-plugin-ai-auto-i18n/dist/cli/prune.js` with the same options.

🐞 Set `debug: true` (default `false`) to print every translation exchange to the console: each message sent to the provider (`sent`) and each translation received back (`received`), prefixed with `[autoi18n debug]` and an ISO timestamp.

🙈 To keep copy out of automatic translation, add `translate="no"` to the element (for example `<h2 translate="no">Sample code</h2>`). This is the standard HTML marker, and it also covers the element's descendants and attributes such as `title`.

🏷️ To translate copy outside JSX, put a `/* i18n */` block comment directly before the string literal, for example `const items = [{ label: /* i18n */ "Shared with your team" }];`. Marked strings are translated in both build and runtime delivery. In runtime delivery the lookup runs when the expression is evaluated, so a marked string in a module-level constant keeps the locale active at import time; put such literals inside a component or function that runs at render. Unmarked string literals are never extracted.

Corrupt `registry.json` or catalogue files are renamed to `<file>.corrupt-<timestamp>` and a warning is logged; the plugin continues with an empty state. Writes are atomic, so an interrupted build does not leave a truncated file.

### 🚚 Delivery modes

- `delivery: "build"` (default): compiles one locale per build. Use `AUTOI18N_LOCALE=de vite build` (on Windows use `cross-env AUTOI18N_LOCALE=de vite build`) or `locale: "de"` in plugin options, typically in a CI build matrix. When a locale is set explicitly, only that locale is translated during the build. Without one, all configured locales are translated. An unknown locale fails the build.
- `delivery: "runtime"`: one bundle for all locales. Text is wrapped in `t(id, source)` calls and catalogues are fetched on demand. Import the API from the virtual module:

```ts
import { locales, resolveSupported, setLocale, getLocale, subscribe, t } from "virtual:autoi18n";

setLocale(resolveSupported(navigator.languages)); // call before first render
```

`createLocaleLoader` and `resolveLocale` are available from the `vite-plugin-ai-auto-i18n/runtime` subpath, not the main entry.

`subscribe(listener)` returns an unsubscribe function. `getVersion()` changes whenever the locale or the catalogues change, so `useSyncExternalStore(subscribe, getVersion, getVersion)` re-renders components that read `t()` during render. Components wrapped in `memo` must subscribe themselves, or they keep the old text until their props change. List `autoI18n()` before `@vitejs/plugin-react` in `plugins`. The React plugin rewrites JSX in dev before other pre-transforms run, so the plugin must see the original JSX. Add a type declaration for `virtual:autoi18n` (see [example/src/autoi18n-virtual.d.ts](/home/bogdan/git/vite-plugin-ai-i18n/example/src/autoi18n-virtual.d.ts)). The example app uses this mode with a locale switcher.

In dev, saving a source file re-indexes the project, translates only new or changed messages and pushes the updated catalogues to the browser over an `autoi18n:update` event. Files added or removed are indexed as well. The page is not reloaded, so new JSX text appears once its translation is ready.

## ⚙️ Configuration reference

### Plugin options (`autoI18n({...})`)

| Option | Type | Default | Description |
|---|---|---|---|
| `locales` | `string[]` | _required_ | Locales the app ships, for example `["en", "de", "fr"]`. The source locale is never translated, so including it is harmless. |
| `sourceLocale` | `string` | `"en"` | Language the JSX is written in. Used as the fallback when a translation is missing. |
| `delivery` | `"build" \| "runtime"` | `"build"` | `build` compiles one locale per build. `runtime` ships every catalogue and switches locale in the browser with `setLocale()` from `virtual:autoi18n`. |
| `locale` | `string` | `sourceLocale` | Locale to compile in `build` delivery. Also read from the `AUTOI18N_LOCALE` environment variable, which is handy for CI matrix builds. In `build` delivery during a non-dev build, only this locale is translated. |
| `include` | `string[]` | `["src/**/*.{tsx,jsx,ts,js}"]` | Glob patterns of source files to scan, relative to the Vite root. |
| `exclude` | `string[]` | `["**/*.test.*", "**/node_modules/**"]` | Glob patterns of files to skip, relative to the Vite root. |
| `directory` | `string` | `".autoi18n"` | Folder for `registry.json` and `locales/`, relative to the Vite root. |
| `provider` | `TranslationProvider \| { primary?, [name]: TranslationProvider \| undefined }` | `undefined` | Translates missing and changed messages. Pass one provider, or named providers with a `primary` (see [Multiple providers and fallback](#multiple-providers-and-fallback)). Without one, untranslated messages fall back to the source text. |
| `failOnMissingProvider` | `boolean` | `false` | When `true`, the build fails if a locale has untranslated messages and no `provider` is set. |
| `onAmbiguous` | `"warn" \| "error"` | `"warn"` | What to do when duplicated identical texts change their occurrence count, so their IDs may have moved. `"error"` fails the build. |
| `orphanRetentionMinutes` | `number` | `43200` (30 days) | Minutes an orphaned message is kept before it is deleted. `0` deletes on the next build; `Infinity` keeps forever. |
| `localeConcurrency` | `number` | `2` | Locales translated at the same time. Values below 1 are raised to 1, and fractions are rounded down. |
| `debug` | `boolean` | `false` | Logs each message sent to the provider, each translation received, and each removed orphan, with timestamps. |
| `componentProps` | `Record<string, string[]>` | `{}` | Attributes of custom components whose string values are UI copy, keyed by component name, for example `{ Button: ["aria-label", "title"] }`. Only the listed attributes are extracted from those components. The pseudo-prop `children` also makes a component's text children translatable, including sentences with `{name}` expressions: `{ Button: ["children", "aria-label"] }` extracts `<Button>Save</Button>` and `<Button>Delete {count} files</Button>`. |

### `OpenAICompatibleProvider` options

Create the provider with `new OpenAICompatibleProvider(options)`.

| Option | Type | Default | Description |
|---|---|---|---|
| `apiKey` | `string` | _required_ | Bearer token for the endpoint. Read it from an environment variable and do not commit it. |
| `model` | `string` | _required_ | Model name sent in each request, for example `"gpt-4.1-mini"`. |
| `baseURL` | `string` | `"https://api.openai.com/v1"` | Base URL of any OpenAI-compatible API. Requests go to `${baseURL}/chat/completions`. |
| `batchSize` | `number` | `40` | Messages per request. Smaller batches keep responses within output limits. |
| `concurrency` | `number` | `4` | Batches sent in parallel for one locale. |
| `timeoutMs` | `number` | `60000` | Milliseconds before a single request is aborted. |
| `maxRetries` | `number` | `2` | Extra attempts for network errors, timeouts, 408/409/429/5xx responses and malformed output. |
| `retryDelayMs` | `number` | `500` | Delay before the first retry. It doubles on each attempt. |

### `AnthropicProvider` options

Create the provider with `new AnthropicProvider(options)`. It calls the [Anthropic Messages API](https://docs.anthropic.com/en/api/messages). The batching, concurrency and retry options are the same as for `OpenAICompatibleProvider`.

| Option | Type | Default | Description |
|---|---|---|---|
| `apiKey` | `string` | _required_ | Anthropic API key, sent as `x-api-key`. Read it from an environment variable and do not commit it. |
| `model` | `string` | _required_ | Claude model name sent in each request, for example `"claude-haiku-5-5"`. |
| `baseURL` | `string` | `"https://api.anthropic.com/v1"` | Base URL of the Messages API. Requests go to `${baseURL}/messages`. |
| `maxTokens` | `number` | `8192` | Maximum tokens the model may generate per batch. Lower it only if your model limits output. |
| `batchSize` | `number` | `40` | Messages per request. Smaller batches keep responses within output limits. |
| `concurrency` | `number` | `4` | Batches sent in parallel for one locale. |
| `timeoutMs` | `number` | `60000` | Milliseconds before a single request is aborted. |
| `maxRetries` | `number` | `2` | Extra attempts for network errors, timeouts, 408/409/429/5xx responses and malformed output. |
| `retryDelayMs` | `number` | `500` | Delay before the first retry. It doubles on each attempt. |

### `GeminiProvider` options

Create the provider with `new GeminiProvider(options)`. It calls the [Gemini API `generateContent` endpoint](https://ai.google.dev/api/generate-content) in JSON output mode. The batching, concurrency and retry options are the same as for `OpenAICompatibleProvider`.

| Option | Type | Default | Description |
|---|---|---|---|
| `apiKey` | `string` | _required_ | Gemini API key, sent as `x-goog-api-key`. Read it from an environment variable and do not commit it. |
| `model` | `string` | _required_ | Gemini model name, for example `"gemini-3.5-flash-lite"`. |
| `baseURL` | `string` | `"https://generativelanguage.googleapis.com/v1beta"` | Base URL of the Gemini API. Requests go to `${baseURL}/models/${model}:generateContent`. |
| `maxOutputTokens` | `number` | `8192` | Maximum tokens the model may generate per batch. Lower it only if your model limits output. |
| `batchSize` | `number` | `40` | Messages per request. Smaller batches keep responses within output limits. |
| `concurrency` | `number` | `4` | Batches sent in parallel for one locale. |
| `timeoutMs` | `number` | `60000` | Milliseconds before a single request is aborted. |
| `maxRetries` | `number` | `2` | Extra attempts for network errors, timeouts, 408/409/429/5xx responses and malformed output. |
| `retryDelayMs` | `number` | `500` | Delay before the first retry. It doubles on each attempt. |

### Multiple providers and fallback

Pass `provider` as an object with one entry per provider. `primary` names the one tried first. Entries set to `undefined` are skipped, so you can keep every provider in the config and enable each one by its key:

```ts
provider: {
  primary: "anthropic",
  anthropic: env.ANTHROPIC_API_KEY ? new AnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, model: "claude-haiku-5-5" }) : undefined,
  openai: env.OPENAI_API_KEY ? new OpenAICompatibleProvider({ apiKey: env.OPENAI_API_KEY, model: "gpt-4.1-mini" }) : undefined,
  gemini: env.GEMINI_API_KEY ? new GeminiProvider({ apiKey: env.GEMINI_API_KEY, model: "gemini-3.5-flash-lite" }) : undefined
}
```

If the primary fails (for example a bad key, an outage, or rate limits that survive the retries), the messages it did not translate are sent to the next configured provider, in declaration order. Fallback happens per batch: a partial result keeps the translations that did come back, and only the missing messages move on. The build logs a warning each time it falls back. If every provider fails, the locale keeps its previous file, as with a single provider.

Naming a `primary` that is not configured fails the build with a clear error. Passing a single provider instance (`provider: new AnthropicProvider(...)`) still works and needs no map.


Any object with this shape can be passed as `provider`:

```ts
interface TranslationProvider {
  translate(input: {
    sourceLocale: string;
    targetLocale: string;
    messages: TranslationRequest[];
  }): Promise<Record<string, string>>; // message ID -> translated text
}

interface TranslationRequest {
  id: string;             // opaque ID to echo back in the result
  source: string;         // English text
  context: string;        // for example "Toolbar > Save button"
  kind: "text" | "attribute" | "mixed" | "string"; // text node, static attribute, JSX with expressions, or a /* i18n */-marked string literal
  placeholders?: string[]; // {name} placeholders that must survive translation
}
```

Return only the IDs you translated. Omitted IDs stay in the source language and are requested again on the next build. If your provider can only translate some batches, throw `PartialTranslationError` (exported from the package) with the translations you have and the number of failed messages, so the successful ones are still stored. Any other error fails the whole locale, which keeps its previous file.

### Environment variables

| Variable | Effect |
|---|---|
| `AUTOI18N_LOCALE` | Same as the `locale` option. The option wins when both are set. |

### Prune CLI

The `prune` CLI options (`--directory`, `--retention-minutes`, `--debug`) are described in the orphan paragraph of [Try the bundled example](#-try-the-bundled-example).

## 🧪 Test coverage

Run the suite with coverage (V8 provider, `src/**`):

```bash
npx vitest run --coverage --coverage.include='src/**' --coverage.reporter=text
```

| Metric | Coverage |
|---|---|
| Statements | 99.4% |
| Branches | 89.4% |
| Functions | 97.6% |
| Lines | 99.4% |

Critical modules such as the plugin hooks (`src/index.ts`), translation pipeline (`src/translate.ts`), build engine (`src/engine.ts`), runtime helpers (`src/runtime/`), and prune CLI (`src/cli/prune.ts`) are all at or above 98% statements.

## ⚠️ Important prototype limitations

This is a compiler MVP, not production-ready localization yet:

1. Runtime delivery loads a catalogue per locale; a message's source text is used until its catalogue has loaded.
2. Mixed JSX sentences with simple expressions (`You have {count} documents`, where `count` is an identifier or member path) are translated as one message with named `{name}` placeholders; translations that change the placeholders, or that repeat a placeholder, are rejected. A placeholder must appear exactly once because build mode copies each source expression, so a repeat would evaluate it twice. Sentences with complex expressions (calls, JSX, computed access) are left entirely in the source language. ICU plural generation is not implemented yet.
3. Duplicate identical occurrences are paired by stable source ordering. This handles ordinary line shifts, but cannot guarantee identity if indistinguishable duplicates are reordered or moved independently. Such cases are reported through `onAmbiguous`; they are not resolved automatically.
4. Dev-server HMR re-indexes the whole project after saved or added/removed source files (debounced by 150 ms) rather than only the changed module. This is simple and correct, but may be slow in very large projects.
5. Only JSX text, and the attributes `alt`, `title`, `placeholder`, `label`, `summary`, `aria-label`, `aria-description`, `aria-placeholder`, `aria-roledescription` and `aria-valuetext` on intrinsic (lowercase) elements, are extracted automatically. String literals outside JSX are extracted only when marked with `/* i18n */`. Text inside capitalised components (for example `<Button>Save</Button>`) is extracted only when the component lists `children` in `componentProps`. Attributes of capitalised components are extracted only when listed in `componentProps`. Other attributes such as `href` are not extracted. Unmarked JS string literals, template literals, Markdown, server-rendered content and rich-text components need explicit policies.
6. The example uses a React plugin in its Vite config; install `@vitejs/plugin-react` in the consuming example.
7. The initial fingerprint is a heuristic. It excludes file and line position, but component names and nearby semantic signals can still change during refactors.

## 🧭 Design rules

- IDs are opaque and persistent; never expose semantic fingerprints as runtime keys.
- AI suggestions never silently overwrite an existing translation.
- Source English is always a valid fallback.
- Ambiguous identity matches should be surfaced, not guessed.
- Translation happens outside the render path.
