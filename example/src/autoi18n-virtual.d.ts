declare module "virtual:autoi18n" {
  export const locales: string[];
  export function getLocale(): string;
  export function resolveSupported(preferred: readonly string[]): string;
  export function setLocale(locale: string): Promise<void>;
  export function subscribe(listener: (locale: string) => void): () => void;
  export function t(id: string, source: string): string;
}
