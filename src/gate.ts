/**
 * Decision layer: what should happen to one tool call.
 * Pure: no prompting, no session state — the caller acts on the verdict.
 */

import { statSync } from "node:fs";
import { dirname } from "node:path";
import { decide } from "./decide";
import { collectTargets, type PathTarget } from "./ops";
import { checkOutside } from "./outside";
import { checkPath } from "./paths";
import type { PathOp, ResolvedConfig } from "./types";

export const GATED_TOOLS = new Set(["bash", "powershell"]);

const FILE_TOOL_OPS: Record<string, PathOp> = {
  read: "read",
  grep: "read",
  find: "read",
  ls: "read",
  write: "write",
  edit: "write",
};

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** The session grant for an outside path covers its directory: a file one level up. */
function outsideGrantKey(path: string): string {
  return `outside:${isDirectory(path) ? path : dirname(path)}`;
}

/** A granted directory also covers everything below it. */
function grantedOutside(path: string, hasGrant: (key: string) => boolean): boolean {
  let dir = path;
  while (true) {
    if (hasGrant(`outside:${dir}`)) return true;
    const parent = dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

export type GateDecision =
  | { kind: "allow" }
  | { kind: "block"; reason: string; terminate?: boolean }
  | { kind: "prompt"; reason: string; label: string; grantKeys: string[] };

function toolTargets(
  toolName: string,
  input: Record<string, unknown>,
  cwd: string,
): { paths: PathTarget[]; label: string; text?: string } | undefined {
  const fileOp = FILE_TOOL_OPS[toolName];
  if (fileOp) {
    const raw = String(input.path ?? input.file_path ?? "").trim();
    if (!raw) return undefined;
    return { paths: [{ path: raw, op: fileOp }], label: `${toolName} ${raw}` };
  }

  if (!GATED_TOOLS.has(toolName)) return undefined;
  const command = input.command;
  if (typeof command !== "string" || command.trim() === "") return undefined;
  return { paths: collectTargets(command, cwd), label: command, text: command };
}

export function evaluate(
  config: ResolvedConfig,
  toolName: string,
  input: Record<string, unknown>,
  cwd: string,
  hasGrant: (key: string) => boolean = () => false,
): GateDecision {
  if (config.fatal) return { kind: "block", reason: config.fatal };

  const targets = toolTargets(toolName, input, cwd);

  if (config.enabled.paths && targets) {
    for (const target of targets.paths) {
      const blocked = checkPath(config.paths, target.path, cwd, target.op, {
        basenameOnly: target.basenameOnly,
      });
      if (blocked) return { kind: "block", reason: blocked.reason };
    }
  }

  if (targets) {
    for (const target of targets.paths) {
      const hit = checkOutside(config.outside, target.path, cwd, target.op);
      if (!hit || grantedOutside(hit.path, hasGrant)) continue;
      const reason = `outside workspace: ${hit.path}`;
      if (hit.mode === "block") return { kind: "block", reason: `pi-permit: ${reason}` };
      return { kind: "prompt", reason, label: targets.label, grantKeys: [outsideGrantKey(hit.path)] };
    }
  }

  if (!config.enabled.commands) return { kind: "allow" };
  const text = targets?.text;
  if (!text) return { kind: "allow" };

  const verdict = decide(text, config.commands);
  if (verdict.action === "allow") return { kind: "allow" };
  if (verdict.action === "ask" && verdict.grants.length > 0 && verdict.grants.every(hasGrant)) {
    return { kind: "allow" };
  }

  const reason = verdict.reasons.join("; ") || "matched a permission rule";
  if (verdict.action === "deny") {
    const hint = verdict.terminate ? "" : " Ask the user instead of retrying.";
    return { kind: "block", reason: `pi-permit: ${reason}.${hint}`, terminate: verdict.terminate };
  }
  return { kind: "prompt", reason, label: text, grantKeys: verdict.grants };
}
