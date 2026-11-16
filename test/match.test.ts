import { describe, expect, test } from "bun:test";
import { parseArgs } from "../src/argv";
import { compileRules, matchRule } from "../src/match";
import type { Rule } from "../src/types";

function matches(rule: Rule, command: string): boolean {
  const compiled = compileRules([rule]);
  expect(compiled.warnings).toEqual([]);
  const args = parseArgs(command.split(" "));
  if (!args) throw new Error(`cannot parse ${command}`);
  return matchRule(compiled.rules[0] as any, args);
}

describe("compileRules", () => {
  test("reports bad regex instead of silently ignoring it", () => {
    const result = compileRules([{ id: "bad", program: "git", argvRegex: "(" }]);
    expect(result.rules).toEqual([]);
    expect(result.warnings[0]).toContain("bad argvRegex");
  });

  test("reports rules without program or id", () => {
    const noProgram = compileRules([{ id: "x" } as unknown as Rule]);
    expect(noProgram.warnings[0]).toContain("without program");
    const noId = compileRules([{ program: "git" } as unknown as Rule]);
    expect(noId.warnings[0]).toContain("without id");
  });
});

describe("matchRule", () => {
  test("matches program only", () => {
    expect(matches({ id: "sudo", program: ["sudo", "doas"] }, "sudo ls")).toBe(true);
    expect(matches({ id: "sudo", program: "sudo" }, "ls")).toBe(false);
  });

  test("matches any of several subcommands", () => {
    const rule: Rule = { id: "history", program: "git", args: ["filter-repo", "filter-branch"] };
    expect(matches(rule, "git filter-repo --path x")).toBe(true);
    expect(matches(rule, "git status")).toBe(false);
  });

  test("requires every allFlags entry", () => {
    const rule: Rule = { id: "reset", program: "git", args: ["reset"], allFlags: ["--hard"] };
    expect(matches(rule, "git reset --hard")).toBe(true);
    expect(matches(rule, "git reset --soft")).toBe(false);
  });

  test("rejects when unlessFlag is present", () => {
    const rule: Rule = {
      id: "discard",
      program: "git",
      args: ["restore"],
      unlessFlag: ["--staged"],
      argvRegex: "(^|\\s)(--|\\.)(\\s|$)",
    };
    expect(matches(rule, "git restore .")).toBe(true);
    expect(matches(rule, "git restore --staged .")).toBe(false);
  });
});
