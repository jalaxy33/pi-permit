import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cwdAfter, extractTargets, looksLikePath } from "../src/ops";
import { tokenize } from "../src/tokenize";

const root = mkdtempSync(join(tmpdir(), "pi-permit-ops-"));
const project = join(root, "project");
mkdirSync(join(project, "src"), { recursive: true });
mkdirSync(join(project, "build"), { recursive: true });
writeFileSync(join(project, ".env"), "SECRET=1\n");
writeFileSync(join(project, "src", "app.ts"), "export {};\n");
writeFileSync(join(project, "notes"), "text\n");

afterAll(() => rmSync(root, { recursive: true, force: true }));

function targets(command: string, cwd = project) {
  const found: Array<{ path: string; op: string }> = [];
  let current = cwd;
  for (const simple of tokenize(command)) {
    found.push(...extractTargets(simple, current));
    current = cwdAfter(simple, current);
  }
  return found;
}

describe("looksLikePath", () => {
  test("accepts paths and rejects plain words", () => {
    expect(looksLikePath(".env", project)).toBe(true);
    expect(looksLikePath("src/app.ts", project)).toBe(true);
    expect(looksLikePath("notes", project)).toBe(true); // exists on disk
    expect(looksLikePath("--force", project)).toBe(false);
    expect(looksLikePath("*.env", project)).toBe(false);
    expect(looksLikePath("$HOME/.env", project)).toBe(false);
  });
});

describe("extractTargets", () => {
  test("reads operands of read commands", () => {
    expect(targets("cat .env")).toEqual([{ path: ".env", op: "read" }]);
    expect(targets("grep -rn TODO src/app.ts")).toEqual([{ path: "src/app.ts", op: "read" }]);
  });

  test("marks deletes", () => {
    expect(targets("rm -rf .env")).toEqual([{ path: ".env", op: "delete" }]);
  });

  test("splits copy sources and destinations", () => {
    expect(targets("cp src/app.ts .env")).toEqual([
      { path: "src/app.ts", op: "read" },
      { path: ".env", op: "write" },
    ]);
  });

  test("handles sed in place", () => {
    expect(targets("sed -i 's/a/b/' .env")).toEqual([{ path: ".env", op: "write" }]);
    expect(targets("sed 's/a/b/' .env")).toEqual([{ path: ".env", op: "read" }]);
  });

  test("includes redirection targets", () => {
    expect(targets("echo x > .env")).toEqual([{ path: ".env", op: "write" }]);
    expect(targets("wc -l < .env")).toEqual([{ path: ".env", op: "read" }]);
  });

  test("unknown programs fall back to treating operands as reads", () => {
    expect(targets("mytool .env")).toEqual([{ path: ".env", op: "read" }]);
  });

  test("follows cd for later commands", () => {
    expect(targets("cd build && cat ../.env")).toEqual([{ path: "../.env", op: "read" }]);
  });
});

describe("cwdAfter", () => {
  test("tracks relative and absolute cd", () => {
    const [first] = tokenize("cd build");
    expect(cwdAfter(first!, project)).toBe(join(project, "build"));
    const [second] = tokenize(`cd ${root}`);
    expect(cwdAfter(second!, project)).toBe(root);
  });

  test("leaves cwd alone for other commands", () => {
    const [only] = tokenize("cat .env");
    expect(cwdAfter(only!, project)).toBe(project);
  });
});
