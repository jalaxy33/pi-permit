/** Gate for paths outside the session working directory. */

import { isAbsolute, sep } from "node:path";
import { expandTilde, globToRegExp, resolveCandidate } from "./paths";
import type { OutsideCwdConfig, PathOp } from "./types";

export type OutsideMode = "allow" | "ask" | "block";

interface CompiledPattern {
  kind: "abs" | "rel";
  re: RegExp;
}

export interface OutsideRule {
  mode: OutsideMode;
  allow: CompiledPattern[];
}

export const DEFAULT_ALLOW_PATHS = [
  "/tmp/**",
  "/dev/**",
  "~/.pi/agent/**",
  "~/.cache/**",
  "~/.bun/**",
  "~/.npm/**",
  "~/.local/share/**",
];

export function compileOutside(config?: OutsideCwdConfig): OutsideRule {
  const patterns = [...DEFAULT_ALLOW_PATHS, ...(config?.allowPaths ?? [])];
  return {
    mode: config?.mode ?? "ask",
    allow: patterns.map((pattern) => ({
      kind: pattern.startsWith("~") || isAbsolute(pattern) ? "abs" : "rel",
      re: globToRegExp(expandTilde(pattern)),
    })),
  };
}

function insideCwd(abs: string, cwd: string): boolean {
  return abs === cwd || abs.startsWith(cwd.endsWith(sep) ? cwd : `${cwd}${sep}`);
}

export interface OutsideHit {
  path: string;
  mode: OutsideMode;
}

/**
 * Returns a hit when the path is outside the workspace and not explicitly allowed.
 * Reads are not gated here; path rules cover files that must never be read.
 */
export function checkOutside(
  rule: OutsideRule,
  rawPath: string,
  cwd: string,
  op: PathOp,
): OutsideHit | undefined {
  if (rule.mode === "allow" || op === "read") return undefined;

  const candidate = resolveCandidate(rawPath, cwd);
  const outside = !insideCwd(candidate.abs, cwd) && (candidate.real ? !insideCwd(candidate.real, cwd) : true);
  if (!outside) return undefined;

  const allowed = rule.allow.some((pattern) => {
    const targets = pattern.kind === "abs" ? [candidate.abs, candidate.real] : [candidate.rel, candidate.relReal];
    return targets.some((value) => typeof value === "string" && pattern.re.test(value));
  });

  return allowed ? undefined : { path: candidate.abs, mode: rule.mode };
}
