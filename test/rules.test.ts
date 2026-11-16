import { describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { builtinRulesPath, collectContributions, readJson, resolveContributions, resolveRulePath } from "../src/rules";
import type { RuleFile } from "../src/types";

const builtinPath = builtinRulesPath();
const builtin = readJson(builtinPath, [])!;
const rulesDir = dirname(builtinPath);
const fixtureDir = fileURLToPath(new URL("./fixtures/", import.meta.url));

function resolve(entries: string[], manifest: RuleFile = builtin, manifestPath = builtinPath) {
  const warnings: string[] = [];
  const contributions = collectContributions(entries, manifest, manifestPath, warnings);
  const resolved = resolveContributions(contributions);
  return {
    ...resolved.rules,
    ids: {
      deny: resolved.rules.deny.map((rule) => rule.id),
      ask: resolved.rules.ask.map((rule) => rule.id),
      allow: resolved.rules.allow.map((rule) => rule.id),
    },
    sources: resolved.sources,
    warnings: [...warnings, ...resolved.warnings],
  };
}

describe("builtin manifest", () => {
  test("lists the default sets in order", () => {
    expect(builtin.defaultRules).toEqual(["deny", "basic", "strict"]);
    expect(Object.keys(builtin.sets ?? {})).toEqual(["deny", "basic", "strict"]);
  });

  test("set entries point at rule files under sets/", () => {
    const rules = resolve(["deny", "basic", "strict"]);
    expect(rules.warnings).toEqual([]);
    expect(rules.sources).toEqual([
      join(rulesDir, "sets", "deny.json"),
      join(rulesDir, "sets", "basic.json"),
      join(rulesDir, "sets", "strict.json"),
    ]);
  });

  test("defaults cover deny, ask and allow", () => {
    const rules = resolve(builtin.defaultRules ?? []);
    expect(rules.ids.deny).toEqual(["git-history", "git-reflog", "git-gc-prune"]);
    expect(rules.ids.ask).toContain("rm-recursive");
    expect(rules.ids.ask).toContain("git-push");
    expect(rules.ids.allow).toEqual(["git-push-lease"]);
  });
});

describe("set resolution", () => {
  test("basic alone has no git workflow prompts", () => {
    const rules = resolve(["basic"]);
    expect(rules.ids.ask).toContain("rm-recursive");
    expect(rules.ids.ask).not.toContain("git-push");
  });

  test("deny floor is its own set", () => {
    const rules = resolve(["deny"]);
    expect(rules.ids.deny).toEqual(["git-history", "git-reflog", "git-gc-prune"]);
    expect(rules.ids.ask).toEqual([]);
  });

  test("removing a set removes only its rules", () => {
    const rules = resolve(["deny", "basic", "strict", "-basic"]);
    expect(rules.ids.ask).not.toContain("rm-recursive");
    expect(rules.ids.ask).toContain("git-push");
    expect(rules.ids.deny).toEqual(["git-history", "git-reflog", "git-gc-prune"]);
  });

  test("removing the floor leaves no deny rules", () => {
    const rules = resolve(["deny", "-deny", "basic"]);
    expect(rules.ids.deny).toEqual([]);
  });

  test("plus prefix is the same as a plain name", () => {
    expect(resolve(["+basic"]).ids.ask).toEqual(resolve(["basic"]).ids.ask);
  });

  test("unknown set warns instead of failing", () => {
    const rules = resolve(["basic", "nope"]);
    expect(rules.warnings).toContain("unknown rule set: nope");
    expect(rules.ids.ask).toContain("rm-recursive");
  });
});

describe("rule files", () => {
  test("loads a file referenced by path relative to the manifest", () => {
    const rules = resolve(["basic", "./extra-rules.json"], { sets: {} }, join(fixtureDir, "manifest.json"));
    expect(rules.ids.deny).toContain("my-wipe");
    expect(rules.ids.ask).toContain("git-status");
  });

  test("loads a set that points at a file", () => {
    const manifest: RuleFile = { sets: { extra: "./extra-rules.json" } };
    const rules = resolve(["extra"], manifest, join(fixtureDir, "manifest.json"));
    expect(rules.ids.deny).toContain("my-wipe");
    expect(rules.sources).toEqual([join(fixtureDir, "extra-rules.json")]);
  });

  test("missing file warns and keeps the rest", () => {
    const rules = resolve(["basic", join(fixtureDir, "missing.json")]);
    expect(rules.warnings.some((warning) => warning.includes("not found"))).toBe(true);
    expect(rules.ids.ask).toContain("rm-recursive");
  });

  test("later entries win by rule id and warn on deny downgrade", () => {
    const rules = resolve(["deny", "basic", join(fixtureDir, "downgrade.json")]);
    expect(rules.ids.ask).toContain("git-history");
    expect(rules.ids.deny).not.toContain("git-history");
    expect(rules.warnings.some((warning) => warning.includes("dropped from deny"))).toBe(true);
  });

  test("resolves absolute and home paths", () => {
    expect(resolveRulePath("/tmp/x.json", rulesDir)).toBe("/tmp/x.json");
    expect(resolveRulePath("~/x.json", rulesDir).startsWith("/")).toBe(true);
  });
});
