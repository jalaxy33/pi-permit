import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { checkOutside, compileOutside } from "../src/outside";

const root = mkdtempSync(join(tmpdir(), "pi-permit-outside-"));
const inside = join(root, "project");
// Under $HOME but outside both the workspace and the default allow list.
const other = join(homedir(), "pi-permit-not-allowed");
writeFileSync(join(root, "outside.txt"), "x");
afterAll(() => rmSync(root, { recursive: true, force: true }));

const ask = compileOutside({ mode: "ask" });

describe("checkOutside", () => {
  test("ignores paths inside the workspace", () => {
    expect(checkOutside(ask, "src/app.ts", inside)).toBeUndefined();
    expect(checkOutside(ask, ".", inside)).toBeUndefined();
  });

  test("flags paths outside the workspace", () => {
    expect(checkOutside(ask, other, inside)?.path).toBe(other);
    expect(checkOutside(ask, join(other, "outside.txt"), inside)?.mode).toBe("ask");
  });

  test("mode allow disables the gate", () => {
    expect(checkOutside(compileOutside({ mode: "allow" }), other, inside)).toBeUndefined();
  });

  test("mode block reports a hit", () => {
    expect(checkOutside(compileOutside({ mode: "block" }), other, inside)?.mode).toBe("block");
  });

  test("default allow list covers tmp and agent dirs", () => {
    expect(checkOutside(ask, "/tmp/anything/x", inside)).toBeUndefined();
    expect(checkOutside(ask, "~/.pi/agent/permit.json", inside)).toBeUndefined();
    expect(checkOutside(ask, "~/.cache/x", inside)).toBeUndefined();
  });

  test("user allowPaths extend the list", () => {
    const custom = compileOutside({ mode: "ask", allowPaths: [join(homedir(), "pi-permit-vendor/**")] });
    expect(checkOutside(custom, join(homedir(), "pi-permit-vendor", "lib.js"), inside)).toBeUndefined();
    expect(checkOutside(custom, other, inside)?.mode).toBe("ask");
  });
});
