/**
 * What a message was extracted from: `text` for JSX text, `attribute` for a translatable attribute, `mixed` for JSX text
 * containing expressions (which become `{name}` placeholders), and `string` for a string literal marked for translation.
 */
export type MessageKind = "text" | "attribute" | "mixed" | "string";
/** A translatable string found in a source file, before it has an ID. */
export interface ExtractedMessage {
  /** The source text, with any HTML entities already decoded. */
  source: string;
  /** Whitespace that surrounded the raw text. It is re-emitted around the translation so layout is unchanged. */
  prefix?: string;
  suffix?: string;
  kind: MessageKind;
  /** For "mixed" messages: placeholder names in the order of the element's expression children. */
  placeholders?: string[];
  /** Source file the message was found in. */
  file: string;
  /** Character offsets of the message in the file. */
  start: number;
  end: number;
  /** Tag or call the message belongs to, for example `button`. */
  tag: string;
  /** Enclosing component name. Used with `fingerprint` to match a message to its registry entry. */
  component: string;
  attribute?: string;
  /** Position within the component, such as the enclosing element. Shown to translators as `Component > context`. */
  context: string;
  /** Hash of the source and its location fields (kind, tag, component, attribute, context), used to match registry entries. */
  fingerprint: string;
}
/** A message with the stable ID that the registry assigned to it. */
export type ResolvedMessage = ExtractedMessage & { id: string };
/** One message remembered in the registry. Entries are kept across builds so stable IDs survive edits. */
export type RegistryEntry = Pick<ExtractedMessage, "source" | "kind" | "tag" | "component" | "attribute" | "context" | "fingerprint"> & {
  id: string;
  location: string;
  status: "active" | "orphaned";
  firstSeen: string;
  lastSeen: string;
};
/** The persisted `registry.json`: all known messages keyed by ID. `version` allows a future format change. */
export interface Registry { version: 1; entries: Record<string, RegistryEntry> }
/** Maps message IDs to text. */
export type Catalog = Record<string, string>;
/** A message that needs a translation, as sent to a provider. */
export interface TranslationRequest { id: string; source: string; context: string; kind: MessageKind; placeholders?: string[] }
/**
 * Translates a batch of messages into one target locale. Return a catalogue with a key for each message that was
 * translated. Missing keys are left untranslated. Throw a `PartialTranslationError` to keep the keys already done.
 */
export interface TranslationProvider {
  translate(input: { sourceLocale: string; targetLocale: string; messages: TranslationRequest[] }): Promise<Catalog>;
}
/**
 * Named providers. The services listed in the README have typed keys so editors can suggest them; any other name is
 * accepted through the index signature.
 */
export interface NamedProviders {
  primary?: string;
  anthropic?: TranslationProvider;
  gemini?: TranslationProvider;
  openai?: TranslationProvider;
  mistral?: TranslationProvider;
  groq?: TranslationProvider;
  deepseek?: TranslationProvider;
  openrouter?: TranslationProvider;
  xai?: TranslationProvider;
  cerebras?: TranslationProvider;
  ollama?: TranslationProvider;
  [name: string]: TranslationProvider | string | undefined;
}
/**
 * A single provider, or named providers. In the named form, `primary` picks the provider tried first; the rest are
 * fallbacks in declaration order. Entries set to `undefined` are skipped, so unconfigured providers can stay in the map.
 */
export type ProviderConfig = TranslationProvider | NamedProviders;
