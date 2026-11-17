import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv/dist/2020";
import { FIELDS } from "../src/validate";

const root = new URL("..", import.meta.url).pathname;
const schema = JSON.parse(readFileSync(join(root, "schema.json"), "utf8"));
const ajv = new Ajv({ allErrors: true, strict: false });

describe("schema", () => {
  test("it compiles", () => {
    expect(() => ajv.compile(schema)).not.toThrow();
  });

  test("every shipped policy file validates", () => {
    const validate = ajv.compile(schema);
    for (const file of readdirSync(join(root, "policy"))) {
      if (!file.endsWith(".json")) continue;
      const doc = JSON.parse(readFileSync(join(root, "policy", file), "utf8"));
      const ok = validate(doc);
      expect([file, ok, ok ? [] : validate.errors]).toEqual([file, true, []]);
    }
  });

  test("accepts a full user config", () => {
    const validate = ajv.compile(schema);
    const doc = {
      enabled: { commands: true, paths: true },
      defaultRules: ["deny", "basic", "-strict", "./rules/mine.json"],
      sets: { mine: "./rules/mine.json", inline: { description: "x", ask: [{ id: "a", program: "a" }], paths: [{ id: "p", patterns: [".env"] }] } },
      commands: { ask: [{ id: "git-push", program: "git", args: ["push"], reason: "x", terminate: false }] },
      paths: [{ id: "env", patterns: [".env"], except: [".env.example"], protection: "read-only", ops: ["write"] }],
      outsideCwd: { mode: "ask", allowPaths: ["~/work/**"] },
    };
    expect([validate(doc), validate.errors]).toEqual([true, null]);
  });

  test("runtime field lists match the schema", () => {
    const keys = (value: { properties?: object }) => Object.keys(value.properties ?? {}).sort();
    expect([...FIELDS.root].sort()).toEqual(Object.keys(schema.properties).sort());
    expect([...FIELDS.enabled].sort()).toEqual(keys(schema.properties.enabled));
    expect([...FIELDS.outside].sort()).toEqual(keys(schema.$defs.outsideCwd));
    expect([...FIELDS.commands].sort()).toEqual(keys(schema.$defs.commands));
    expect([...FIELDS.rule].sort()).toEqual(keys(schema.$defs.commandRule));
    expect([...FIELDS.pathRule].sort()).toEqual(keys(schema.$defs.pathRule));
    expect([...FIELDS.set].sort()).toEqual(keys(schema.$defs.setInline));
  });

  test("rejects typos and wrong values", () => {
    const validate = ajv.compile(schema);
    expect(validate({ commands: { ask: [{ id: "x", progam: "git" }] } })).toBe(false);
    expect(validate({ paths: [{ id: "x", patterns: [".env"], protection: "deny" }] })).toBe(false);
    expect(validate({ outsideCwd: { mode: "maybe" } })).toBe(false);
    expect(validate({ unknownKey: true })).toBe(false);
  });
});
