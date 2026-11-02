# vite-plugin-autoi18n — MVP sketch

Implicit build-time localization for JSX: author English directly, let the compiler extract user-facing copy, persist message identities, and optionally translate through an AI provider.

## Current MVP scope

- Extracts JSX text nodes and static string JSX attributes.
- Uses tag/attribute/semantic-attribute/handler context to form fingerprints; component names and file paths are excluded so ordinary moves and renames do not automatically invalidate IDs.
- Persists opaque message IDs in `.autoi18n/registry.json`.
- Marks disappeared messages as orphaned instead of deleting them.
- Supports a pluggable translation provider; includes an OpenAI-compatible implementation.
- Writes locale JSON catalogues and keeps source English as fallback.
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

Run Vite. The plugin writes `.autoi18n/registry.json` and `.autoi18n/locales/*.json`. To compile German: `AUTOI18N_LOCALE=de vite build` (on Windows use `cross-env AUTOI18N_LOCALE=de vite build`) or set `locale: "de"` in plugin options.

## Important prototype limitations

This is a compiler MVP, not production-ready localization yet:

1. The MVP compiles one locale per build. Set `locale: "de"` or `AUTOI18N_LOCALE=de` in a CI build matrix. Runtime locale negotiation / lazy switching is a follow-up integration.
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
