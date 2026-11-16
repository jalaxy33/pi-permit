/** Rule files: shipped defaults, user sets, and set resolution order. */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CommandsSection, PathRule, Rule, RuleFile, Section } from "./types";

export interface Contribution {
  /** Logical name from `defaultRules` (set name or the path entry itself). */
  set: string;
  section: Section;
  rule: Rule;
  /** File the rule was loaded from, when known. */
  source?: string;
}

export interface ResolvedRules {
  deny: Rule[];
  ask: Rule[];
  allow: Rule[];
}

export interface PathContribution {
  set: string;
  rule: PathRule;
  source?: string;
}

export interface CollectedRules {
  commands: Contribution[];
  paths: PathContribution[];
}

const SECTIONS: Section[] = ["deny", "ask", "allow"];

export function defaultConfigPath(): string {
  return fileURLToPath(new URL("../policy/manifest.json", import.meta.url));
}

export function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
  return path;
}

export function resolveRulePath(entry: string, baseDir: string): string {
  const expanded = expandHome(entry);
  return isAbsolute(expanded) ? expanded : resolve(baseDir, expanded);
}

export function readJson(path: string, warnings: string[]): RuleFile | undefined {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
  try {
    return JSON.parse(raw) as RuleFile;
  } catch (error) {
    warnings.push(`${path}: invalid JSON (${(error as Error).message})`);
    return undefined;
  }
}

function fromFile(
  entry: string,
  baseDir: string,
  warnings: string[],
): { commands?: CommandsSection; paths?: PathRule[]; path: string } | undefined {
  const path = resolveRulePath(entry, baseDir);
  const file = readJson(path, warnings);
  if (!file) {
    warnings.push(`rule file not found or invalid: ${path}`);
    return undefined;
  }
  if (!file.commands && !file.paths) {
    warnings.push(`${path}: expected "commands" or "paths", nothing loaded`);
    return undefined;
  }
  return { commands: file.commands, paths: file.paths, path };
}

function push(
  collected: CollectedRules,
  set: string,
  rules: { commands?: CommandsSection; paths?: PathRule[] },
  source: string | undefined,
): void {
  for (const section of SECTIONS) {
    for (const rule of rules.commands?.[section] ?? []) {
      collected.commands.push({ set, section, rule, source });
    }
  }
  for (const rule of rules.paths ?? []) collected.paths.push({ set, rule, source });
}

/**
 * Expands `defaultRules` entries into ordered contributions.
 * `name` adds a set, `-name` removes one, `+name` is the same as `name`,
 * and `*.json` loads a rule file that uses the `commands` shape.
 */
export function collectContributions(
  entries: string[],
  manifest: RuleFile,
  manifestPath: string,
  warnings: string[],
): CollectedRules {
  const baseDir = dirname(manifestPath);
  const collected: CollectedRules = { commands: [], paths: [] };
  const drop = (set: string) => {
    for (let i = collected.commands.length - 1; i >= 0; i--) {
      if (collected.commands[i]?.set === set) collected.commands.splice(i, 1);
    }
    for (let i = collected.paths.length - 1; i >= 0; i--) {
      if (collected.paths[i]?.set === set) collected.paths.splice(i, 1);
    }
  };

  for (const raw of entries) {
    if (typeof raw !== "string" || raw.trim() === "") {
      warnings.push(`ignore empty defaultRules entry: ${JSON.stringify(raw)}`);
      continue;
    }
    const remove = raw.startsWith("-");
    const name = (remove ? raw.slice(1) : raw.replace(/^\+/, "")).trim();

    if (name.endsWith(".json")) {
      if (remove) {
        drop(name);
        continue;
      }
      const loaded = fromFile(name, baseDir, warnings);
      if (loaded) push(collected, name, loaded, loaded.path);
      continue;
    }

    const ref = manifest.sets?.[name];
    if (!ref) {
      warnings.push(`unknown rule set: ${name}`);
      continue;
    }
    if (remove) {
      drop(name);
      continue;
    }
    drop(name);
    if (typeof ref === "string") {
      const loaded = fromFile(ref, baseDir, warnings);
      if (loaded) push(collected, name, loaded, loaded.path);
      continue;
    }
    push(collected, name, ref, manifestPath);
  }

  return collected;
}

function addSource(sources: string[], source: string | undefined): void {
  if (source && !sources.includes(source)) sources.push(source);
}

/** Path rules: later ones win by id. */
export function resolvePathContributions(contributions: PathContribution[]): {
  rules: PathRule[];
  warnings: string[];
  sources: string[];
} {
  const warnings: string[] = [];
  const sources: string[] = [];
  const byId = new Map<string, PathRule>();

  for (const contribution of contributions) {
    addSource(sources, contribution.source);
    const id = contribution.rule?.id;
    if (!id) {
      warnings.push(`ignore rule without id from ${contribution.set}`);
      continue;
    }
    byId.set(id, contribution.rule);
  }

  return { rules: [...byId.values()], warnings, sources };
}

/** Command rules: later ones win by id, across sections. */
export function resolveContributions(contributions: Contribution[]): {
  rules: ResolvedRules;
  warnings: string[];
  sources: string[];
} {
  const warnings: string[] = [];
  const sources: string[] = [];
  const byId = new Map<string, { section: Section; rule: Rule }>();

  for (const contribution of contributions) {
    addSource(sources, contribution.source);
    const id = contribution.rule?.id;
    if (!id) {
      warnings.push(`ignore rule without id from ${contribution.set}`);
      continue;
    }
    const previous = byId.get(id);
    if (previous?.section === "deny" && contribution.section !== "deny") {
      warnings.push(`rule ${id} dropped from deny by ${contribution.set}`);
    }
    byId.set(id, { section: contribution.section, rule: contribution.rule });
  }

  const rules: ResolvedRules = { deny: [], ask: [], allow: [] };
  for (const entry of byId.values()) rules[entry.section].push(entry.rule);
  return { rules, warnings, sources };
}
