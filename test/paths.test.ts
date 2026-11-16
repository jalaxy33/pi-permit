import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkPath, compilePathRules, globToRegExp } from "../src/paths";
import type { PathRule } from "../src/types";

const root = mkdtempSync(join(tmpdir(), "pi-permit-paths-"));
const project = join(root, "project");
mkdirSync(join(project, "config"), { recursive: true });
mkdirSync(join(project, "src"), { recursive: true });
writeFileSync(join(project, ".env"), "SECRET=1\n");
writeFileSync(join(project, ".env.example"), "SECRET=\n");
writeFileSync(join(project, "src", "app.ts"), "export {};\n");
writeFileSync(join(project, "config", "prod.yml"), "a: 1\n");
symlinkSync(join(project, ".env"), join(root, "sneaky"));

afterAll(() => rmSync(root, { recursive: true, force: true }));

const compile = (rules: PathRule[]) => {
  const result = compilePathRules(rules);
  expect(result.warnings).toEqual([]);
  return result.rules;
};

describe("globToRegExp", () => {
  test("matches basenames and nested paths", () => {
    expect(globToRegExp(".env").test(".env")).toBe(true);
    expect(globToRegExp(".env.*").test(".env.local")).toBe(true);
    expect(globToRegExp("**/*.pem").test("a/b/c.pem")).toBe(true);
    expect(globToRegExp("config/*.yml").test("config/prod.yml")).toBe(true);
    expect(globToRegExp("config/*.yml").test("config/nested/prod.yml")).toBe(false);
  });
});

describe("checkPath", () => {
  const env = compile([{ id: "env", patterns: [".env", ".env.*"], except: [".env.example"] }]);

  test("matches a basename anywhere", () => {
    expect(checkPath(env, ".env", project, "read")?.rule).toBe("env");
    expect(checkPath(env, join(project, ".env"), project, "read")?.rule).toBe("env");
  });

  test("honours exceptions", () => {
    expect(checkPath(env, ".env.example", project, "read")).toBeUndefined();
  });

  test("matches relative patterns against the project root", () => {
    const rules = compile([{ id: "prod", patterns: ["config/*.yml"] }]);
    expect(checkPath(rules, "config/prod.yml", project, "read")?.rule).toBe("prod");
    expect(checkPath(rules, "config/nested/prod.yml", project, "read")).toBeUndefined();
  });

  test("matches absolute patterns and follows symlinks", () => {
    const rules = compile([{ id: "abs", patterns: [join(project, ".env")] }]);
    expect(checkPath(rules, "sneaky", root, "read")?.rule).toBe("abs");
  });

  test("read-only rules only block writes", () => {
    const rules = compile([{ id: "ro", patterns: [".env"], protection: "read-only" }]);
    expect(checkPath(rules, ".env", project, "read")).toBeUndefined();
    expect(checkPath(rules, ".env", project, "write")?.rule).toBe("ro");
  });

  test("ops filter limits the operations", () => {
    const rules = compile([{ id: "ops", patterns: [".env"], ops: ["delete"] }]);
    expect(checkPath(rules, ".env", project, "read")).toBeUndefined();
    expect(checkPath(rules, ".env", project, "delete")?.rule).toBe("ops");
  });

  test("onlyIfExists skips missing files", () => {
    const rules = compile([{ id: "existing", patterns: ["*.env"], onlyIfExists: true }]);
    expect(checkPath(rules, "missing.env", project, "read")).toBeUndefined();
    expect(checkPath(rules, ".env", project, "read")?.rule).toBe("existing");
  });

  test("uses the rule message when present", () => {
    const rules = compile([{ id: "msg", patterns: [".env"], message: "hands off" }]);
    expect(checkPath(rules, ".env", project, "read")?.reason).toBe("hands off");
  });
});
