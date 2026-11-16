import { describe, expect, it } from "vitest";

import { parseSource } from "../../src/compiler/ast.js";
import { decodeJsxEntities } from "../../src/compiler/entities.js";
import { extractMessages } from "../../src/compiler/extract.js";

const extract = (code: string, options = {}) => extractMessages(code, "App.tsx", options);
const sources = (code: string, options = {}) => extract(code, options).map((message) => message.source);

describe("parsing", () => {
  it("reports a syntax error with the file name", () => {
    expect(() => parseSource("export const = ;", "Broken.tsx")).toThrow(/^Broken\.tsx: /);
  });
});

describe("decodeJsxEntities", () => {
  it("decodes named, decimal and hexadecimal character references", () => {
    expect(decodeJsxEntities("Tom &amp; Jerry &copy; &#65;&#x42;")).toBe("Tom & Jerry © AB");
  });

  it("leaves unknown names and out-of-range code points as written", () => {
    expect(decodeJsxEntities("&notAnEntity; &#x110000; &#99999999;")).toBe("&notAnEntity; &#x110000; &#99999999;");
  });

  it("returns text without references unchanged", () => {
    expect(decodeJsxEntities("plain text")).toBe("plain text");
  });
});

describe("JSX text and attributes with character references", () => {
  it("decodes references in text and attribute values before they become sources", () => {
    expect(sources(`export const A = () => <p title="A &amp; B">Save &amp; close</p>;`)).toEqual(
      expect.arrayContaining(["Save & close", "A & B"]),
    );
  });
});

describe("mixed-content elements", () => {
  it("suffixes repeated expressions and sanitises dotted names into unique ICU arguments", () => {
    const [message] = extract(`export const A = ({ user, a, a_b }) => <p>Hi {user} {user}, {a.b} and {a_b}</p>;`);
    expect(message.kind).toBe("mixed");
    expect(message.placeholders).toEqual(["user", "user_2", "a_b", "a_b_2"]);
    expect(message.source).toBe("Hi {user} {user_2}, {a_b} and {a_b_2}");
  });

  it("does not extract elements whose expressions are not plain references", () => {
    expect(sources(`export const A = ({ f }) => <p>Total: {f()}</p>;`)).toEqual([]);
  });

  it("does not extract the mixed element when it contains child elements, but still extracts the child text", () => {
    expect(sources(`export const A = ({ n }) => <p>Count {n}<b>bold</b></p>;`)).toEqual(["bold"]);
  });

  it("does not extract elements whose text has no letters", () => {
    expect(sources(`export const A = ({ n }) => <p>{n} - 42</p>;`)).toEqual([]);
  });

  it("does not extract mixed content on components unless their children prop is configured", () => {
    const code = `export const A = ({ n }) => <Card>Hello {n}</Card>;`;
    expect(sources(code)).toEqual([]);
    expect(sources(code, { componentProps: { Card: ["children"] } })).toEqual(["Hello {n}"]);
  });

  it("skips mixed content whose text normalises to nothing", () => {
    expect(sources(`export const A = ({ n }) => <p>  {n}  </p>;`)).toEqual([]);
  });
});

describe("plain text", () => {
  it("does not extract text outside a translatable element", () => {
    expect(sources(`export const A = () => <Card>Hello</Card>;`)).toEqual([]);
  });

  it("does not extract text of an ignored intrinsic element such as a script", () => {
    expect(sources(`export const A = () => <script>Hello</script>;`)).toEqual([]);
  });

  it("does not extract text that has no enclosing element", () => {
    expect(sources(`export const A = () => <>Hello</>;`)).toEqual([]);
  });

  it("does not extract whitespace-only text", () => {
    expect(sources(`export const A = () => <p>   </p>;`)).toEqual([]);
  });
});

describe("translatable attributes", () => {
  it("extracts translatable intrinsic attributes and ignores other string attributes", () => {
    const messages = extract(`export const A = () => <input placeholder="Search" data-id="Hidden" />;`);
    expect(messages.map((m) => [m.attribute, m.source])).toEqual([["placeholder", "Search"]]);
  });

  it("ignores namespaced attribute names and expression values", () => {
    expect(sources(`export const A = ({ t }) => <svg xlink:title="Ns" title={t} />;`)).toEqual([]);
  });

  it("ignores attributes whose value has no letters", () => {
    expect(sources(`export const A = () => <input title="123" />;`)).toEqual([]);
  });

  it("only extracts component attributes that are configured in componentProps", () => {
    const code = `export const A = () => <Dialog heading="Welcome" title="Other" />;`;
    expect(sources(code)).toEqual([]);
    expect(sources(code, { componentProps: { Dialog: ["heading"] } })).toEqual(["Welcome"]);
  });

  it("does not extract attributes on member-expression elements such as Ui.Button", () => {
    expect(
      sources(`export const A = () => <Ui.Button aria-label="Close" />;`, {
        componentProps: { "Ui.Button": ["aria-label"] },
      }),
    ).toEqual([]);
  });

  it('skips attributes inside a translate="no" subtree', () => {
    expect(sources(`export const A = () => <div translate="no"><input title="Hidden" /></div>;`)).toEqual([]);
  });

  it("skips a marked attribute on an element with a non-identifier translate value", () => {
    expect(sources(`export const A = ({ t }) => <input translate={t} title="Shown" />;`)).toEqual(["Shown"]);
  });
});

describe("t() calls", () => {
  it("extracts the string passed to t imported from the runtime module, once", () => {
    const code = `import { t } from "virtual:autoi18n";\nexport const A = () => <p>{t("Save")}</p>;`;
    expect(sources(code)).toEqual(["Save"]);
  });

  it("records the enclosing component name for a t() call inside a function", () => {
    const [message] = extract(`import { t } from "virtual:autoi18n";\nexport function Panel() { return t("Inside"); }`);
    expect(message).toMatchObject({ source: "Inside", kind: "string", component: "Panel", tag: "", context: "" });
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
    const calls = [`t(name)`, `t("Save", 1)`, `t()`, `t("123")`, "t(`Save`)", `i18n.t("Save")`];
    for (const call of calls) {
      expect(sources(`import { t } from "virtual:autoi18n";\nexport const A = () => ${call};`)).toEqual([]);
    }
  });
});

describe("component names", () => {
  it("names messages after a variable-assigned arrow function", () => {
    const [message] = extract(`export const Header = () => <h1>Welcome</h1>;`);
    expect(message.component).toBe("Header");
  });

  it("names messages after a function declaration", () => {
    const [message] = extract(`export function Footer() { return <footer>Bye</footer>; }`);
    expect(message.component).toBe("Footer");
  });

  it("uses <anonymous> for an unnamed function and <module> outside any function", () => {
    const [anonymous] = extract(`export default function () { return <p>Anon</p>; }`);
    expect(anonymous.component).toBe("<anonymous>");
    const [moduleLevel] = extract(`export const El = <p>Top</p>;`);
    expect(moduleLevel.component).toBe("<module>");
  });

  it("names messages in a method by the enclosing function instead of the method", () => {
    const [message] = extract(`class View { render() { return <p>Method</p>; } }`);
    expect(message.component).toBe("<module>");
  });
});
