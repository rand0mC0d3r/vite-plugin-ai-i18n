export type MessageKind = "text" | "attribute";
export interface ExtractedMessage {
  source: string;
  prefix?: string;
  suffix?: string;
  kind: MessageKind;
  file: string;
  start: number;
  end: number;
  tag: string;
  component: string;
  attribute?: string;
  context: string;
  fingerprint: string;
  id?: string;
}
export interface RegistryEntry {
  id: string;
  source: string;
  kind: MessageKind;
  tag: string;
  component: string;
  attribute?: string;
  context: string;
  fingerprint: string;
  location: string;
  status: "active" | "orphaned";
  firstSeen: string;
  lastSeen: string;
}
export interface Registry { version: 1; entries: Record<string, RegistryEntry> }
export type Catalog = Record<string, string>;
export interface TranslationRequest { id: string; source: string; context: string; kind: MessageKind }
export interface TranslationProvider {
  translate(input: { sourceLocale: string; targetLocale: string; messages: TranslationRequest[] }): Promise<Catalog>;
}
