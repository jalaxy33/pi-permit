/** Gate for paths outside the session working directory. */

import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, normalize, relative, resolve, sep } from "node:path";
import { expandTilde, globToRegExp } from "./paths";
import type { OutsideCwdConfig } from "./types";

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
  const mode = config?.mode ?? "ask";
  const patterns = [...DEFAULT_ALLOW_PATHS, ...(config?.allowPaths ?? [])];
  const allow: CompiledPattern[] = patterns.map((pattern) => ({
    kind: pattern.startsWith("~") || isAbsolute(pattern) ? "abs" : "rel",
    re: globToRegExp(expandTilde(pattern)),
  }));
  return { mode, allow };
}

function insideCwd(abs: string, cwd: string): boolean {
  if (abs === cwd) return true;
  return abs.startsWith(cwd.endsWith(sep) ? cwd : `${cwd}${sep}`);
}

function allowedBy(rule: OutsideRule, abs: string, real: string | undefined, cwd: string): boolean {
  const rel = relative(cwd, abs);
  const relReal = real ? relative(cwd, real) : undefined;
  return rule.allow.some((pattern) => {
    if (pattern.kind === "abs") return pattern.re.test(abs) || (real ? pattern.re.test(real) : false);
    return pattern.re.test(rel) || (relReal ? pattern.re.test(relReal) : false);
  });
}

export interface OutsideHit {
  path: string;
  mode: OutsideMode;
}

/** Returns a hit when the path is outside the workspace and not explicitly allowed. */
export function checkOutside(rule: OutsideRule, rawPath: string, cwd: string): OutsideHit | undefined {
  if (rule.mode === "allow") return undefined;

  const expanded = expandTilde(rawPath);
  const abs = normalize(isAbsolute(expanded) ? expanded : resolve(cwd, expanded));
  const real = existsSync(abs) ? safeRealpath(abs) : undefined;

  const outside = !insideCwd(abs, cwd) && (real ? !insideCwd(real, cwd) : true);
  if (!outside) return undefined;
  if (allowedBy(rule, abs, real, cwd)) return undefined;

  return { path: abs, mode: rule.mode };
}

function safeRealpath(path: string): string | undefined {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}
