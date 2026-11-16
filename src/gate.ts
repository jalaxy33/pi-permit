/**
 * Decision layer: what should happen to one tool call.
 * Pure: no prompting, no session state — the caller acts on the verdict.
 */

import { decide } from "./decide";
import { collectTargets } from "./ops";
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

export interface GateTarget {
  path: string;
  op: PathOp;
  basenameOnly?: boolean;
}

export type GateDecision =
  | { kind: "allow" }
  | { kind: "block"; reason: string; terminate?: boolean }
  | { kind: "prompt"; reason: string; label: string; grantKey?: string };

function toolTargets(
  toolName: string,
  input: Record<string, unknown>,
  cwd: string,
): { paths: GateTarget[]; label: string } | undefined {
  const fileOp = FILE_TOOL_OPS[toolName];
  if (fileOp) {
    const raw = String(input.path ?? input.file_path ?? "").trim();
    if (!raw) return undefined;
    return { paths: [{ path: raw, op: fileOp }], label: `${toolName} ${raw}` };
  }

  if (!GATED_TOOLS.has(toolName)) return undefined;
  const command = input.command;
  if (typeof command !== "string" || command.trim() === "") return undefined;
  return { paths: collectTargets(command, cwd), label: command };
}

function command(toolName: string, input: Record<string, unknown>): string | undefined {
  if (!GATED_TOOLS.has(toolName)) return undefined;
  const value = input.command;
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
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
      const hit = checkOutside(config.outside, target.path, cwd);
      if (!hit) continue;
      const grantKey = `outside:${hit.path}`;
      if (hasGrant(grantKey)) break;
      const reason = `outside workspace: ${hit.path}`;
      if (hit.mode === "block") return { kind: "block", reason: `pi-permit: ${reason}` };
      return { kind: "prompt", reason, label: targets.label, grantKey };
    }
  }

  if (!config.enabled.commands) return { kind: "allow" };
  const text = command(toolName, input);
  if (!text || hasGrant(text)) return { kind: "allow" };

  const verdict = decide(text, config.commands);
  if (verdict.action === "allow") return { kind: "allow" };

  const reason = verdict.reasons.join("; ") || "matched a permission rule";
  if (verdict.action === "deny") {
    return { kind: "block", reason: `pi-permit: ${reason}`, terminate: verdict.terminate };
  }
  return { kind: "prompt", reason, label: text };
}
