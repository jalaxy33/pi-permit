import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig, type ResolvedConfig } from "./src/config";
import { decide } from "./src/decide";
import { checkPath } from "./src/paths";
import { ask, SessionGrants } from "./src/prompt";
import { tokenize } from "./src/tokenize";
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

/** Path rules for file tools and for bash redirections (`> file`, `< file`). */
function checkToolPaths(
  config: ResolvedConfig,
  toolName: string,
  input: Record<string, unknown>,
  cwd: string,
): string | undefined {
  const fileOp = FILE_TOOL_OPS[toolName];
  if (fileOp) {
    const raw = String(input.path ?? input.file_path ?? "").trim();
    if (!raw) return undefined;
    return checkPath(config.paths, raw, cwd, fileOp)?.reason;
  }

  if (!GATED_TOOLS.has(toolName)) return undefined;
  const command = input.command;
  if (typeof command !== "string" || command.trim() === "") return undefined;

  for (const simple of tokenize(command)) {
    for (const redirect of simple.redirects) {
      const op: PathOp = redirect.op === "<" ? "read" : "write";
      const blocked = checkPath(config.paths, redirect.target, cwd, op);
      if (blocked) return blocked.reason;
    }
  }
  return undefined;
}

export default async function permit(pi: ExtensionAPI) {
  let config: ResolvedConfig = loadConfig(process.cwd(), false);
  const grants = new SessionGrants();

  const reload = (cwd: string, trusted: boolean, notify: (message: string) => void) => {
    config = loadConfig(cwd, trusted);
    for (const warning of config.warnings) notify(`pi-permit: ${warning}`);
  };

  pi.on("session_start", (_event, ctx) => {
    grants.clear();
    reload(ctx.cwd, ctx.isProjectTrusted(), (message) => ctx.ui.notify(message, "warning"));
  });

  pi.on("tool_call", async (event, ctx) => {
    if (config.fatal) return { block: true, reason: config.fatal };

    if (config.enabled.paths) {
      const blocked = checkToolPaths(config, event.toolName, event.input as Record<string, unknown>, ctx.cwd);
      if (blocked) return { block: true, reason: blocked };
    }

    if (!config.enabled.commands) return;
    if (!GATED_TOOLS.has(event.toolName)) return;

    const command = (event.input as Record<string, unknown>).command;
    if (typeof command !== "string" || command.trim() === "") return;
    if (grants.has(command)) return;

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

    const outcome = await ask({
      command,
      reason,
      hasUI: ctx.hasUI,
      grants,
      custom: typeof ctx.ui.custom === "function" ? (factory) => ctx.ui.custom(factory) : undefined,
      select: (title, options) => ctx.ui.select(title, options),
      abort: () => ctx.abort(),
    });
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
          `session grants: ${grants.size}`,
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
