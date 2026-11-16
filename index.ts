import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig, type ResolvedConfig } from "./config";
import { decide } from "./decide";

const GATED_TOOLS = new Set(["bash", "powershell"]);
const OPTIONS = ["Allow once", "Allow for this session", "Deny", "Deny and stop"] as const;

export default async function permit(pi: ExtensionAPI) {
  let config: ResolvedConfig = loadConfig(process.cwd(), false);
  const sessionGrants = new Set<string>();

  const reload = (cwd: string, trusted: boolean, notify: (message: string) => void) => {
    config = loadConfig(cwd, trusted);
    for (const warning of config.warnings) notify(`pi-permit: ${warning}`);
  };

  pi.on("session_start", (_event, ctx) => {
    sessionGrants.clear();
    reload(ctx.cwd, ctx.isProjectTrusted(), (message) => ctx.ui.notify(message, "warning"));
  });

  pi.on("tool_call", async (event, ctx) => {
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

    if (!ctx.hasUI) {
      return { block: true, reason: `pi-permit (no UI to confirm): ${reason}` };
    }

    const body = command.replace(/\n/g, "\n    ");
    const choice = await ctx.ui.select(`pi-permit: ${reason}\n\n    ${body}`, [...OPTIONS]);
    if (choice === OPTIONS[0]) return;
    if (choice === OPTIONS[1]) {
      sessionGrants.add(command);
      return;
    }
    if (choice === OPTIONS[3]) {
      ctx.abort();
      return { block: true, reason: `pi-permit: denied and stopped (${reason})` };
    }
    return { block: true, reason: `pi-permit: denied (${reason})` };
  });

  pi.registerCommand("permit", {
    description: "Show pi-permit config and session grants",
    handler: async (_args, ctx) => {
      const { deny, ask, allow } = config.commands;
      const grants = sessionGrants.size;
      ctx.ui.notify(
        [
          `pi-permit: ${deny.length} deny / ${ask.length} ask / ${allow.length} allow rules`,
          `sources: ${config.sources.length > 0 ? config.sources.join(", ") : "defaults only"}`,
          `session grants: ${grants}`,
        ].join("\n"),
        "info",
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
