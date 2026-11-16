import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig, type ResolvedConfig } from "./src/config";
import { evaluate } from "./src/gate";
import { ask, SessionGrants } from "./src/prompt";

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
    const decision = evaluate(
      config,
      event.toolName,
      event.input as Record<string, unknown>,
      ctx.cwd,
      (key) => sessionGrants.has(key),
    );

    if (decision.kind === "allow") return;
    if (decision.kind === "block") {
      return {
        block: true,
        reason: decision.reason,
        ...(decision.terminate ? { terminate: true } : {}),
      };
    }

    const outcome = await confirm(ctx, {
      command: decision.label,
      reason: decision.reason,
      grantKey: decision.grantKey,
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
