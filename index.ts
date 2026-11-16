import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig, type ResolvedConfig } from "./src/config";
import { decide } from "./src/decide";
import { ask, SessionGrants } from "./src/prompt";

const GATED_TOOLS = new Set(["bash", "powershell"]);

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
    if (!config.enabled.commands) return;
    if (!GATED_TOOLS.has(event.toolName)) return;
    if (config.fatal) return { block: true, reason: config.fatal };

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
          `pi-permit: ${deny.length} deny / ${askRules.length} ask / ${allow.length} allow rules`,
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
