import { describe, expect, it } from "vitest";

import { parseSource } from "../../src/compiler/ast.js";
import { extractMessages } from "../../src/compiler/extract.js";
import { createFingerprint } from "../../src/identity/fingerprint.js";

const RUNTIME = `import { t } from "virtual:autoi18n";\n`;
const extract = (code: string) => extractMessages(code, "App.tsx");
const sources = (code: string) => extract(code).map((message) => message.source);

describe("parsing", () => {
  it("reports a syntax error with the file name", () => {
    expect(() => parseSource("export const = ;", "Broken.tsx")).toThrow(/^Broken\.tsx: /);
  });
});

describe("t() calls", () => {
  it("extracts the string passed to t imported from the runtime module", () => {
    expect(sources(`${RUNTIME}export const A = () => <p>{t("Save")}</p>;`)).toEqual(["Save"]);
  });

  it("normalises the source text and records the whole call range", () => {
    const code = `${RUNTIME}export const A = () => t("  Save   changes ");`;
    const [message] = extract(code);
    expect(message).toMatchObject({
      source: "Save changes",
      file: "App.tsx",
      start: code.indexOf('t("'),
      end: code.indexOf('")') + 2,
      fingerprint: createFingerprint({ source: "Save changes" }),
    });
  });

  it("follows an aliased import and an import placed after the call", () => {
    const code = `export const A = () => tr("Save");\nimport { t as tr } from "virtual:autoi18n";`;
    expect(sources(code)).toEqual(["Save"]);
  });

  it("ignores a t() call whose function is not imported from the runtime module", () => {
    expect(sources(`import { t } from "i18next";\nexport const A = () => t("Save");`)).toEqual([]);
    expect(sources(`export const A = () => t("Save");`)).toEqual([]);
  });

  it("ignores calls that are not a single string literal with letters", () => {
    const calls = [`t(name)`, `t()`, `t("123")`, "t(`Save`)", `i18n.t("Save")`];
    for (const call of calls) {
      expect(sources(`${RUNTIME}export const A = () => ${call};`)).toEqual([]);
    }
  });

  it("accepts a second argument of values and records where it starts", () => {
    const code = `${RUNTIME}export const A = () => t("{count, plural, one {# file} other {# files}}", { count });`;
    const [message] = extract(code);
    expect(message.source).toBe("{count, plural, one {# file} other {# files}}");
    expect(message.valuesStart).toBe(code.indexOf("{ count"));
  });

  it("extracts aliased tt() calls as auto-plural messages", () => {
    const code = `import { tt as countItems } from "virtual:autoi18n";\nexport const A = () => countItems("{count} items", { count: 5 });`;
    const [message] = extract(code);
    expect(message.source).toBe("{count} items");
    expect(message.autoPlural).toBe(true);
  });

  it("skips a call whose values are a spread, since its arguments are not known statically", () => {
    expect(sources(`${RUNTIME}export const A = (v) => t("Hello {name}", ...[v]);`)).toEqual([]);
  });

  it("rejects a message with values that is not valid ICU, naming the file", () => {
    expect(() => extract(`${RUNTIME}export const A = () => t("Use {", { a: 1 });`)).toThrow(
      /App\.tsx: t\(\) message is not valid ICU MessageFormat/,
    );
  });

  it("ignores JSX text and attributes, which are no longer extracted", () => {
    expect(sources(`export const A = () => <button title="Close">Save</button>;`)).toEqual([]);
  });
});

describe("component names", () => {
  it("names messages after a variable-assigned arrow function", () => {
    const [message] = extract(`${RUNTIME}export const Header = () => t("Welcome");`);
    expect(message.component).toBe("Header");
  });

  it("names messages after a function declaration", () => {
    const [message] = extract(`${RUNTIME}export function Footer() { return t("Bye"); }`);
    expect(message.component).toBe("Footer");
  });

  it("uses <anonymous> for an unnamed function and <module> outside any function", () => {
    const [anonymous] = extract(`${RUNTIME}export default function () { return t("Anon"); }`);
    expect(anonymous.component).toBe("<anonymous>");
    const [moduleLevel] = extract(`${RUNTIME}export const label = t("Top");`);
    expect(moduleLevel.component).toBe("<module>");
  });

  it("names messages in a class method by the enclosing module, not the method", () => {
    const [message] = extract(`${RUNTIME}class View { render() { return t("Method"); } }`);
    expect(message.component).toBe("<module>");
  });
});
