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
import type { ConfigFile, PathRule, ResolvedConfig, Section } from "./types";

export function globalConfigPath(): string {
  return join(homedir(), ".pi", "agent", "permit.json");
}

export function projectConfigPath(cwd: string): string {
  return join(cwd, ".pi", "permit.json");
}

const SECTIONS: Section[] = ["deny", "ask", "allow"];

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

  const collected: CollectedRules = collectContributions(builtin.defaultRules ?? [], builtin, builtinPath, warnings);

  const scopes: Array<{ path: string; config: ConfigFile | undefined }> = [
    { path: globalConfigPath(), config: readJson(globalConfigPath(), warnings) },
  ];
  if (trusted) {
    scopes.push({ path: projectConfigPath(cwd), config: readJson(projectConfigPath(cwd), warnings) });
  }

  const userScopes: ConfigFile[] = [];
  for (const scope of scopes) {
    if (!scope.config) continue;
    userScopes.push(scope.config);
    sources.push(scope.path);
    const scopeCollected = collectContributions(scope.config.defaultRules ?? [], scope.config, scope.path, warnings);
    collected.commands.push(...scopeCollected.commands);
    collected.paths.push(...scopeCollected.paths);
    for (const section of SECTIONS) {
      for (const rule of scope.config.commands?.[section] ?? []) {
        collected.commands.push({ set: scope.path, section, rule, source: scope.path });
      }
    }
    for (const rule of pathRulesOf(scope.config)) {
      collected.paths.push({ set: scope.path, rule, source: scope.path });
    }
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
