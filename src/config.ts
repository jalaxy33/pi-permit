import { homedir } from "node:os";
import { join } from "node:path";
import { compileOutside } from "./outside";
import { compilePathRules } from "./paths";
import { compileRules } from "./match";
import {
  defaultConfigPath,
  collectContributions,
  type CollectedRules,
  readJson,
  resolveContributions,
  resolvePathContributions,
} from "./rulesets";
import { SECTIONS, type ConfigFile, type PathRule, type ResolvedConfig } from "./types";

export function globalConfigPath(): string {
  return join(homedir(), ".pi", "agent", "permit.json");
}

export function projectConfigPath(cwd: string): string {
  return join(cwd, ".pi", "permit.json");
}

/** Later scopes win field by field. */
function pickOutside(scopes: ConfigFile[]) {
  const merged: { mode?: "allow" | "ask" | "block"; allowPaths?: string[] } = {};
  for (const scope of scopes) {
    if (scope.outsideCwd?.mode) merged.mode = scope.outsideCwd.mode;
    if (scope.outsideCwd?.allowPaths) merged.allowPaths = scope.outsideCwd.allowPaths;
  }
  return merged.mode || merged.allowPaths ? merged : undefined;
}

function pathRulesOf(config: ConfigFile): PathRule[] {
  return Array.isArray(config.paths) ? config.paths : [];
}

/** Adds the rules a config file contributes: its `defaultRules` first, then its own rules. */
function collectFrom(
  collected: CollectedRules,
  file: ConfigFile,
  path: string,
  warnings: string[],
): void {
  const nested = collectContributions(file.defaultRules ?? [], file, path, warnings);
  collected.commands.push(...nested.commands);
  collected.paths.push(...nested.paths);
  for (const section of SECTIONS) {
    for (const rule of file.commands?.[section] ?? []) {
      collected.commands.push({ set: path, section, rule, source: path });
    }
  }
  for (const rule of pathRulesOf(file)) collected.paths.push({ set: path, rule, source: path });
}

export function loadConfig(cwd: string, trusted: boolean): ResolvedConfig {
  const warnings: string[] = [];
  const sources: string[] = [];

  const builtinPath = defaultConfigPath();
  const builtin = readJson(builtinPath, warnings);
  if (!builtin) {
    return {
      enabled: { commands: true, paths: false },
      commands: { deny: [], ask: [], allow: [] },
      paths: [],
      outside: compileOutside(undefined),
      fatal: `pi-permit: cannot read ${builtinPath}`,
      warnings,
      sources,
    };
  }
  sources.push(builtinPath);

  const collected: CollectedRules = { commands: [], paths: [] };
  collectFrom(collected, builtin, builtinPath, warnings);

  const userScopes: ConfigFile[] = [];
  const scopePaths = [globalConfigPath()];
  if (trusted) scopePaths.push(projectConfigPath(cwd));

  for (const path of scopePaths) {
    const file = readJson(path, warnings);
    if (!file) continue;
    userScopes.push(file);
    sources.push(path);
    collectFrom(collected, file, path, warnings);
  }

  const resolvedPaths = resolvePathContributions(collected.paths);
  const compiledPaths = compilePathRules(resolvedPaths.rules);
  warnings.push(...resolvedPaths.warnings, ...compiledPaths.warnings);

  const resolved = resolveContributions(collected.commands);
  warnings.push(...resolved.warnings);
  for (const source of [...resolved.sources, ...resolvedPaths.sources]) {
    if (!sources.includes(source)) sources.push(source);
  }

  const compile = (rules: typeof resolved.rules.deny) => {
    const result = compileRules(rules);
    warnings.push(...result.warnings);
    return result.rules;
  };

  const pick = (key: "commands" | "paths") =>
    userScopes.map((config) => config.enabled?.[key]).filter((value) => value !== undefined).pop();

  return {
    enabled: {
      commands: pick("commands") ?? true,
      paths: pick("paths") ?? true,
    },
    commands: {
      deny: compile(resolved.rules.deny),
      ask: compile(resolved.rules.ask),
      allow: compile(resolved.rules.allow),
    },
    paths: compiledPaths.rules,
    outside: compileOutside(pickOutside(userScopes)),
    warnings,
    sources,
  };
}
