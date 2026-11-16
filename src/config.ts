import { homedir } from "node:os";
import { join } from "node:path";
import { compileRules } from "./match";
import {
  builtinRulesPath,
  collectContributions,
  type Contribution,
  readJson,
  resolveContributions,
} from "./rules";
import type { ConfigFile, ResolvedConfig, Section } from "./types";

export function globalConfigPath(): string {
  return join(homedir(), ".pi", "agent", "permit.json");
}

export function projectConfigPath(cwd: string): string {
  return join(cwd, ".pi", "permit.json");
}

const SECTIONS: Section[] = ["deny", "ask", "allow"];

export function loadConfig(cwd: string, trusted: boolean): ResolvedConfig {
  const warnings: string[] = [];
  const sources: string[] = [];

  const builtinPath = builtinRulesPath();
  const builtin = readJson(builtinPath, warnings);
  if (!builtin) {
    return {
      enabled: { commands: true, paths: false },
      commands: { deny: [], ask: [], allow: [] },
      fatal: `pi-permit: cannot read ${builtinPath}`,
      warnings,
      sources,
    };
  }
  sources.push(builtinPath);

  const contributions: Contribution[] = collectContributions(
    builtin.defaultRules ?? [],
    builtin,
    builtinPath,
    warnings,
  );

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
    contributions.push(
      ...collectContributions(scope.config.defaultRules ?? [], scope.config, scope.path, warnings),
    );
    for (const section of SECTIONS) {
      for (const rule of scope.config.commands?.[section] ?? []) {
        contributions.push({ set: scope.path, section, rule, source: scope.path });
      }
    }
  }

  const resolved = resolveContributions(contributions);
  warnings.push(...resolved.warnings);
  for (const source of resolved.sources) {
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
      paths: pick("paths") ?? false,
    },
    commands: {
      deny: compile(resolved.rules.deny),
      ask: compile(resolved.rules.ask),
      allow: compile(resolved.rules.allow),
    },
    warnings,
    sources,
  };
}
