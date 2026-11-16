import { describe, expect, test } from "bun:test";
import { parseArgs } from "../src/argv";

describe("parseArgs", () => {
  test("keeps positionals and expands short flags", () => {
    const args = parseArgs(["rm", "-rf", "build"]);
    expect(args?.program).toBe("rm");
    expect(args?.positional).toEqual(["build"]);
    expect([...(args?.flags ?? [])].sort()).toEqual(["-f", "-r", "-rf"]);
  });

  test("keeps long flags in both forms", () => {
    const args = parseArgs(["git", "reset", "--hard"]);
    expect(args?.positional).toEqual(["reset"]);
    expect(args?.flags.has("--hard")).toBe(true);
    expect(args?.flags.has("hard")).toBe(true);
  });

  test("keeps non-letter flags", () => {
    const args = parseArgs(["find", ".", "-delete"]);
    expect(args?.flags.has("-delete")).toBe(true);
  });

  test("stops parsing flags after double dash", () => {
    const args = parseArgs(["rm", "--", "-weird-name"]);
    expect(args?.positional).toEqual(["-weird-name"]);
    expect(args?.flags.size).toBe(0);
  });

  test("skips env assignments and strips program path", () => {
    const args = parseArgs(["DEBUG=1", "/usr/bin/rm", "-r", "x"]);
    expect(args?.program).toBe("rm");
    expect(args?.positional).toEqual(["x"]);
  });

  test("keeps global options before subcommands as positionals", () => {
    const args = parseArgs(["git", "-C", "/repo", "reset", "--hard"]);
    expect(args?.positional).toContain("reset");
  });
});
