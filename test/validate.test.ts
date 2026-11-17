import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config";
import { checkFields } from "../src/validate";

const path = "/home/user/.pi/agent/permit.json";

const warningsFor = (file: unknown) => {
  const warnings: string[] = [];
  checkFields(file, path, warnings);
  return warnings;
};

describe("checkFields", () => {
  test("accepts a full config", () => {
    const warnings = warningsFor({
      $schema: "./schema.json",
      description: "mine",
      enabled: { commands: true, paths: false },
      defaultRules: ["deny", "basic"],
      sets: { mine: { description: "x", deny: [{ id: "a", program: "a" }], paths: [{ id: "p", patterns: ["x"] }] } },
      commands: { allow: [{ id: "git-add", program: "git", args: ["add"] }] },
      paths: [{ id: "p", patterns: [".env"], except: ["x"], protection: "read-only", ops: ["read"], onlyIfExists: true, message: "no" }],
      outsideCwd: { mode: "ask", allowPaths: ["~/shared/**"] },
    });
    expect(warnings).toEqual([]);
  });

  test("names the file and the field that is wrong", () => {
    expect(warningsFor({ alow: [] })).toEqual([`${path}: unknown field "alow"`]);
    expect(warningsFor({ enabled: { path: false } })).toEqual([`${path}: unknown field "enabled.path"`]);
    expect(warningsFor({ outsideCwd: { modes: "ask" } })).toEqual([`${path}: unknown field "outsideCwd.modes"`]);
  });

  test("descends into command and path rules", () => {
    expect(warningsFor({ commands: { alow: [] } })).toEqual([`${path}: unknown field "commands.alow"`]);
    expect(warningsFor({ commands: { allow: [{ id: "a", program: "a", argz: [] }] } })).toEqual([
      `${path}: unknown field "commands.allow[0].argz"`,
    ]);
    expect(warningsFor({ paths: [{ id: "p", patterns: ["x"], protect: true }] })).toEqual([
      `${path}: unknown field "paths[0].protect"`,
    ]);
  });

  test("descends into inline sets", () => {
    expect(warningsFor({ sets: { mine: { alow: [] } } })).toEqual([`${path}: unknown field "sets.mine.alow"`]);
    expect(warningsFor({ sets: { mine: { allow: [{ id: "a", program: "a", arg: [] }] } } })).toEqual([
      `${path}: unknown field "sets.mine.allow[0].arg"`,
    ]);
  });

  test("ignores set references and non-objects", () => {
    expect(warningsFor({ sets: { mine: "./mine.json" } })).toEqual([]);
    expect(warningsFor([])).toEqual([]);
  });
});

describe("warnings reach the user", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-permit-fields-"));
  mkdirSync(join(dir, ".pi"));
  const configPath = join(dir, ".pi", "permit.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      $schema: "./schema.json",
      commands: { alow: [], allow: [{ id: "git-add", program: "git", args: ["add"] }] },
    }),
  );
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("loadConfig reports a misspelled section as a warning", () => {
    const config = loadConfig(dir, true);
    expect(config.fatal).toBeUndefined();
    expect(config.warnings).toContain(`${configPath}: unknown field "commands.alow"`);
    expect(config.commands.allow.length).toBe(2);
  });
});
