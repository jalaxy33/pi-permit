import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig, type ResolvedConfig } from "./src/config";
import { decide } from "./src/decide";
import { collectTargets } from "./src/ops";
import { checkPath } from "./src/paths";
import { checkOutside } from "./src/outside";
import { ask, SessionGrants } from "./src/prompt";
import type { PathOp } from "./src/types";

const GATED_TOOLS = new Set(["bash", "powershell"]);
const FILE_TOOL_OPS: Record<string, PathOp> = {
  read: "read",
  grep: "read",
  find: "read",
  ls: "read",
  write: "write",
  edit: "write",
};

interface ToolTargets {
  paths: Array<{ path: string; op: PathOp; basenameOnly?: boolean }>;
  /** Human-readable subject used in the confirmation prompt. */
  label: string;
}

function toolTargets(toolName: string, input: Record<string, unknown>, cwd: string): ToolTargets | undefined {
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

/** Path rules: protected files always block, whatever the cwd. */
function blockedByRules(config: ResolvedConfig, targets: ToolTargets, cwd: string): string | undefined {
  for (const target of targets.paths) {
    const blocked = checkPath(config.paths, target.path, cwd, target.op, {
      basenameOnly: target.basenameOnly,
    });
    if (blocked) return blocked.reason;
  }
  return undefined;
}

/** Outside-cwd gate: returns a path that needs a decision, when any. */
function outsideHit(config: ResolvedConfig, targets: ToolTargets, cwd: string) {
  for (const target of targets.paths) {
    const hit = checkOutside(config.outside, target.path, cwd);
    if (hit) return hit;
  }
  return undefined;
}

export default async function permit(pi: ExtensionAPI) {
  let config: ResolvedConfig = loadConfig(process.cwd(), false);
  const sessionGrants = new SessionGrants();

  const reload = (cwd: string, trusted: boolean, notify: (message: string) => void) => {
    config = loadConfig(cwd, trusted);
    for (const warning of config.warnings) notify(`pi-permit: ${warning}`);
  };

  pi.on("session_start", (_event, ctx) => {
    sessionGrants.clear();
    reload(ctx.cwd, ctx.isProjectTrusted(), (message) => ctx.ui.notify(message, "warning"));
  });

  const confirm = (
    ctx: { hasUI: boolean; ui: any; abort: () => void },
    request: { command: string; reason: string; grantKey?: string },
  ) =>
    ask({
      ...request,
      hasUI: ctx.hasUI,
      grants: sessionGrants,
      custom: typeof ctx.ui.custom === "function" ? (factory: unknown) => ctx.ui.custom(factory) : undefined,
      select: (title, options) => ctx.ui.select(title, options),
      abort: () => ctx.abort(),
    });

  pi.on("tool_call", async (event, ctx) => {
    if (config.fatal) return { block: true, reason: config.fatal };

    const targets = toolTargets(event.toolName, event.input as Record<string, unknown>, ctx.cwd);

    if (config.enabled.paths && targets) {
      const blocked = blockedByRules(config, targets, ctx.cwd);
      if (blocked) return { block: true, reason: blocked };
    }

    const hit = targets ? outsideHit(config, targets, ctx.cwd) : undefined;
    if (hit && !sessionGrants.has(`outside:${hit.path}`)) {
      const reason = `outside workspace: ${hit.path}`;
      if (hit.mode === "block") return { block: true, reason: `pi-permit: ${reason}` };
      const outcome = await confirm(ctx, {
        command: targets?.label ?? hit.path,
        reason,
        grantKey: `outside:${hit.path}`,
      });
      if (outcome.block) return { block: true, reason: outcome.reason };
    }

    if (!config.enabled.commands) return;
    if (!GATED_TOOLS.has(event.toolName)) return;

    const command = (event.input as Record<string, unknown>).command;
    if (typeof command !== "string" || command.trim() === "") return;
    if (sessionGrants.has(command)) return;

    const verdict = decide(command, config.commands);
    if (verdict.action === "allow") return;
    const reason = verdict.reasons.join("; ") || "matched a permission rule";

    if (verdict.action === "deny") {
      return {
        block: true,
        reason: `pi-permit: ${reason}`,
        ...(verdict.terminate ? { terminate: true } : {}),
      };
    }

    const outcome = await confirm(ctx, { command, reason });
    return outcome.block ? { block: true, reason: outcome.reason } : undefined;
  });

  pi.registerCommand("permit", {
    description: "Show pi-permit config and session grants",
    handler: async (_args, ctx) => {
      const { deny, ask: askRules, allow } = config.commands;
      ctx.ui.notify(
        [
          `pi-permit: ${deny.length} deny / ${askRules.length} ask / ${allow.length} allow rules, ${config.paths.length} path rules`,
          `sources: ${config.sources.length > 0 ? config.sources.join(", ") : "defaults only"}`,
          `session grants: ${sessionGrants.size}`,
          ...(config.fatal ? [config.fatal] : []),
        ].join("\n"),
        config.fatal ? "error" : "info",
      );
    },
  });

  pi.registerCommand("permit:reload", {
    description: "Reload permit.json from disk",
    handler: async (_args, ctx) => {
      reload(ctx.cwd, ctx.isProjectTrusted(), (message) => ctx.ui.notify(message, "warning"));
      ctx.ui.notify(`pi-permit: ${config.commands.deny.length + config.commands.ask.length} rules loaded`, "info");
    },
  });
}
