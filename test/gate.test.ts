import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { loadConfig } from "../src/config";
import { evaluate } from "../src/gate";

const dir = mkdtempSync(join(tmpdir(), "pi-permit-gate-"));
writeFileSync(join(dir, ".env"), "SECRET=1\n");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const config = loadConfig(dir, false);
const outside = join(homedir(), "pi-permit-gate-outside.txt");
const outsideDir = dirname(outside);

const run = (toolName: string, input: Record<string, unknown>, grants: string[] = []) =>
  evaluate(config, toolName, input, dir, (key) => grants.includes(key));

describe("command gate", () => {
  test("allows safe commands", () => {
    expect(run("bash", { command: "git status" })).toEqual({ kind: "allow" });
  });

  test("blocks history rewriting and asks to terminate", () => {
    const decision = run("bash", { command: "git filter-repo --path x" });
    expect(decision.kind).toBe("block");
    expect(decision).toMatchObject({ terminate: true });
  });

  test("prompts for ask-tier commands", () => {
    const decision = run("bash", { command: "git push origin main" });
    expect(decision).toMatchObject({ kind: "prompt", label: "git push origin main" });
  });

  test("session grants skip the prompt", () => {
    expect(run("bash", { command: "git push origin main" }, ["rule:git-push:"])).toEqual({
      kind: "allow",
    });
  });

  test("a grant covers the same rule and flags only", () => {
    expect(run("bash", { command: "git push --force origin main" }, ["rule:git-push:"])).toMatchObject({
      kind: "prompt",
    });
  });

  test("prompts carry the grant keys of the matched rules", () => {
    const decision = run("bash", { command: "rm -r build" });
    expect(decision).toMatchObject({ kind: "prompt", grantKeys: ["rule:rm-recursive:-r"] });
  });

  test("a granted ask rule does not lift a deny rule elsewhere in the chain", () => {
    expect(run("bash", { command: "git push && git filter-repo --force" }, ["rule:git-push:"])).toMatchObject({
      kind: "block",
    });
  });

  test("commands can be disabled wholesale", () => {
    const off = { ...config, enabled: { ...config.enabled, commands: false } };
    expect(evaluate(off, "bash", { command: "git push" }, dir)).toEqual({ kind: "allow" });
  });
});

describe("path rules", () => {
  test("blocks protected files", () => {
    const decision = run("read", { path: join(dir, ".env") });
    expect(decision.kind).toBe("block");
    expect(decision).toMatchObject({ reason: expect.stringContaining(".env") });
  });

  test("blocks bash operands too", () => {
    expect(run("bash", { command: "cat .env" }).kind).toBe("block");
  });

  test("ignores protected files when the feature is off", () => {
    const off = { ...config, enabled: { ...config.enabled, paths: false } };
    expect(evaluate(off, "read", { path: join(dir, ".env") }, dir)).toEqual({ kind: "allow" });
  });
});

describe("outside workspace", () => {
  test("prompts with a grant key", () => {
    const decision = run("write", { path: outside });
    expect(decision).toEqual({
      kind: "prompt",
      reason: `outside workspace: ${outside}`,
      label: `write ${outside}`,
      grantKeys: [`outside:${outsideDir}`],
    });
  });

  test("reads outside the workspace pass", () => {
    expect(run("read", { path: outside })).toEqual({ kind: "allow" });
  });

  test("an outside grant allows the directory and below it", () => {
    expect(run("write", { path: outside }, [`outside:${outsideDir}`])).toEqual({ kind: "allow" });
    expect(run("write", { path: join(outsideDir, "sibling.txt") }, [`outside:${outsideDir}`])).toEqual({
      kind: "allow",
    });
    expect(run("write", { path: join(outsideDir, "nested", "deeper.txt") }, [`outside:${outsideDir}`])).toEqual({
      kind: "allow",
    });
  });

  test("mode block rejects without prompting", () => {
    const strict = { ...config, outside: { ...config.outside, mode: "block" as const } };
    expect(evaluate(strict, "write", { path: outside }, dir).kind).toBe("block");
  });

  test("paths inside the workspace pass", () => {
    expect(run("read", { path: join(dir, "notes.txt") })).toEqual({ kind: "allow" });
  });
});

describe("order", () => {
  test("path rules win over the outside prompt", () => {
    const decision = run("bash", { command: `cat ${outside}/../pi-permit-gate-outside.txt/.env` });
    expect(decision.kind).toBe("block");
  });
});
