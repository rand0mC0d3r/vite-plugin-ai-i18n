# vite-plugin-autoi18n — MVP sketch

Implicit build-time localization for JSX: author English directly, let the compiler extract user-facing copy, persist message identities, and optionally translate through an AI provider.

## Current MVP scope

- Extracts JSX text nodes and static string JSX attributes.
- Uses tag/attribute/semantic-attribute/handler context to form fingerprints; component names and file paths are excluded so ordinary moves and renames do not automatically invalidate IDs.
- Persists opaque message IDs in `.autoi18n/registry.json`.
- Marks disappeared messages as orphaned instead of deleting them.
- Supports a pluggable translation provider; includes an OpenAI-compatible implementation.
- Writes locale JSON catalogues and keeps source English as fallback.
- Two delivery modes: `build` (one compiled bundle per locale) and `runtime` (one bundle, locales loaded on demand through `virtual:autoi18n`).
- Re-translates a message when its source text changes, tracked in `.autoi18n/locales/<locale>.sources.json`.
- Includes a deliberately varied document-dashboard example.

## Install / try

This repository is a plugin prototype. Add dependencies from `package.json`, then configure it in Vite:

```ts
import autoI18n, { OpenAICompatibleProvider } from "vite-plugin-autoi18n";

export default defineConfig({
  plugins: [
    autoI18n({
      locales: ["en", "de", "fr"],
      sourceLocale: "en",
      provider: new OpenAICompatibleProvider({
        apiKey: process.env.OPENAI_API_KEY!,
        model: "gpt-4.1-mini"
      })
    })
  ]
});
```

Then write ordinary JSX:

```tsx
<button title="Save the current document">Save</button>
```

To try the bundled example (a React document dashboard under `example/`):

```sh
npm install
npm run example:dev     # dev server
npm run example:build   # production build into example/dist
```

Run Vite. The plugin writes `.autoi18n/registry.json`, `.autoi18n/locales/<locale>.json` and `.autoi18n/locales/<locale>.sources.json`. The sidecar records the source text each translation was made from; if the source changes, that message is re-translated on the next build.

Translations require a provider. With `failOnMissingProvider: true` the build fails when a locale is missing translations and no provider is configured, instead of silently shipping English.

### Delivery modes

- `delivery: "build"` (default): compiles one locale per build. Use `AUTOI18N_LOCALE=de vite build` (on Windows use `cross-env AUTOI18N_LOCALE=de vite build`) or `locale: "de"` in plugin options, typically in a CI build matrix.
- `delivery: "runtime"`: one bundle for all locales. Text is wrapped in `t(id, source)` calls and catalogues are fetched on demand. Import the API from the virtual module:

```ts
import { locales, resolveSupported, setLocale, getLocale, subscribe, t } from "virtual:autoi18n";

setLocale(resolveSupported(navigator.languages)); // call before first render
```

`subscribe(listener)` returns an unsubscribe function and is suitable for `useSyncExternalStore`. List `autoI18n()` before `@vitejs/plugin-react` in `plugins`. The React plugin rewrites JSX in dev before other pre-transforms run, so the plugin must see the original JSX. Add a type declaration for `virtual:autoi18n` (see [example/src/autoi18n-virtual.d.ts](/home/bogdan/git/vite-plugin-ai-i18n/example/src/autoi18n-virtual.d.ts)). The example app uses this mode with a locale switcher.

## Important prototype limitations

This is a compiler MVP, not production-ready localization yet:

1. Runtime delivery loads a catalogue per locale; a message's source text is used until its catalogue has loaded.
2. Mixed JSX sentences containing expressions (`You have {count} documents`) are intentionally left entirely in the source language. Expression-aware message grouping and ICU plural generation are not implemented yet; this avoids producing broken translations by translating sentence fragments independently.
3. Duplicate identical occurrences are paired by stable source ordering. This handles ordinary line shifts, but cannot guarantee identity if indistinguishable duplicates are reordered or moved independently. A reviewable ambiguity queue is needed for that case.
4. Dev-server HMR currently requests a full reload; it does not yet re-run the full extraction pipeline per changed module.
5. Only static JSX text and static string attributes are extracted. JS string literals, template literals, Markdown, server-rendered content and rich-text components need explicit policies.
6. The example uses a React plugin in its Vite config; install `@vitejs/plugin-react` in the consuming example.
7. The initial fingerprint is a heuristic. It excludes file and line position, but component names and nearby semantic signals can still change during refactors.

## Design rules

- IDs are opaque and persistent; never expose semantic fingerprints as runtime keys.
- AI suggestions never silently overwrite an existing translation.
- Source English is always a valid fallback.
- Ambiguous identity matches should be surfaced, not guessed.
- Translation happens outside the render path.
