import { describe, expect, test } from "bun:test";
import { globalConfigPath, loadConfig, projectConfigPath } from "../src/config";

describe("config", () => {
  test("loads the shipped rule sets by default", () => {
    const config = loadConfig("/nonexistent-cwd", false);
    expect(config.warnings).toEqual([]);
    expect(config.fatal).toBeUndefined();
    expect(config.enabled.commands).toBe(true);
    expect(config.enabled.paths).toBe(false);
    expect(config.commands.deny.length).toBe(3);
    expect(config.commands.ask.length).toBeGreaterThan(30);
    expect(config.commands.allow.length).toBe(1);
    expect(config.sources[0]?.endsWith("rules/builtin.json")).toBe(true);
  });

  test("resolves config paths next to pi's own settings", () => {
    expect(globalConfigPath().endsWith("/.pi/agent/permit.json")).toBe(true);
    expect(projectConfigPath("/work")).toBe("/work/.pi/permit.json");
  });

  test("does not read project config when the project is not trusted", () => {
    const untrusted = loadConfig("/nonexistent-cwd", false);
    expect(untrusted.sources.some((path) => path.includes("/nonexistent-cwd/"))).toBe(false);
    expect(untrusted.sources.every((path) => path.includes("/rules/"))).toBe(true);
  });
});
