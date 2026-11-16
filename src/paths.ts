/** File path rules: glob matching against resolved absolute paths. */

import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, normalize, relative, resolve } from "node:path";
import type { CompiledPathRule, PathOp, PathRule } from "./types";

const ALL_OPS: PathOp[] = ["read", "write", "delete"];

export function expandTilde(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
  return path;
}

export function globToRegExp(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i] as string;
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        out += ".*";
        i += 1;
      } else {
        out += "[^/]*";
      }
      continue;
    }
    if (ch === "?") {
      out += "[^/]";
      continue;
    }
    out += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
}

function kindOf(pattern: string): "base" | "abs" | "rel" {
  if (!pattern.includes("/")) return "base";
  if (pattern.startsWith("~") || isAbsolute(pattern)) return "abs";
  return "rel";
}

function compilePattern(pattern: string): CompiledPathRule["compiled"][number] {
  return { value: pattern, kind: kindOf(pattern), re: globToRegExp(expandTilde(pattern)) };
}

export function compilePathRules(rules: PathRule[]): { rules: CompiledPathRule[]; warnings: string[] } {
  const warnings: string[] = [];
  const compiled: CompiledPathRule[] = [];

  for (const rule of rules) {
    if (!rule || typeof rule.id !== "string" || !rule.id.trim()) {
      warnings.push(`ignore path rule without id: ${JSON.stringify(rule)}`);
      continue;
    }
    if (!Array.isArray(rule.patterns) || rule.patterns.length === 0) {
      warnings.push(`path rule ${rule.id}: no patterns, ignored`);
      continue;
    }
    compiled.push({
      ...rule,
      compiled: rule.patterns.map(compilePattern),
      compiledExcept: (rule.except ?? []).map(compilePattern),
    });
  }

  return { rules: compiled, warnings };
}

interface Candidate {
  abs: string;
  real?: string;
  rel: string;
  relReal?: string;
  base: string;
  baseReal?: string;
  exists: boolean;
}

export function resolveCandidate(rawPath: string, cwd: string): Candidate {
  const expanded = expandTilde(rawPath);
  const abs = normalize(isAbsolute(expanded) ? expanded : resolve(cwd, expanded));
  const exists = existsSync(abs);
  let real: string | undefined;
  if (exists) {
    try {
      real = realpathSync(abs);
    } catch {
      real = undefined;
    }
  }
  return {
    abs,
    real,
    rel: relative(cwd, abs),
    relReal: real ? relative(cwd, real) : undefined,
    base: abs.split("/").pop() ?? abs,
    baseReal: real?.split("/").pop(),
    exists: exists || real !== undefined,
  };
}

function patternMatches(
  pattern: { value: string; kind: "base" | "abs" | "rel"; re: RegExp },
  candidate: Candidate,
): boolean {
  const paths =
    pattern.kind === "base"
      ? [candidate.base, candidate.baseReal]
      : pattern.kind === "abs"
        ? [candidate.abs, candidate.real]
        : [candidate.rel, candidate.relReal];
  return paths.some((value) => typeof value === "string" && pattern.re.test(value));
}

export interface PathBlock {
  rule: string;
  reason: string;
  path: string;
}

/** Returns the first matching rule that blocks the operation. */
export function checkPath(
  rules: CompiledPathRule[],
  rawPath: string,
  cwd: string,
  op: PathOp,
): PathBlock | undefined {
  const candidate = resolveCandidate(rawPath, cwd);

  for (const rule of rules) {
    const ops = rule.ops ?? ALL_OPS;
    if (!ops.includes(op)) continue;
    if (rule.onlyIfExists && !candidate.exists) continue;
    if (rule.compiledExcept.some((pattern) => patternMatches(pattern, candidate))) continue;
    if (!rule.compiled.some((pattern) => patternMatches(pattern, candidate))) continue;
    if ((rule.protection ?? "block") === "read-only" && op === "read") continue;
    return {
      rule: rule.id,
      path: candidate.abs,
      reason: rule.message ?? `pi-permit: ${rule.id} protects ${candidate.abs}`,
    };
  }

  return undefined;
}
