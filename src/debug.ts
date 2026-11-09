/** Prints a timestamped line for `debug: true` output. */
export const debugLog = (message: string): void => console.log(`[autoi18n debug] ${new Date().toISOString()} ${message}`);
