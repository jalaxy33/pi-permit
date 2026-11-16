/** Confirmation prompt built from pi-tui components, plus per-session grants. */

import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { Container, Key, matchesKey, Spacer, Text, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

export type Choice = "allow" | "allow-session" | "deny" | "stop";

export type Outcome = { block: false } | { block: true; reason: string };

const KEYS: Record<string, Choice> = {
  y: "allow",
  Y: "allow",
  a: "allow-session",
  A: "allow-session",
  n: "deny",
  N: "deny",
  s: "stop",
  S: "stop",
};

const TOGGLE_KEYS = new Set(["o", "O", "\u000f"]);
const VIEWPORT_ROWS = 12;
const EXPANDED_ROWS = 40;

export function chooseFromKey(key: string): Choice | undefined {
  return KEYS[key];
}

export interface PromptComponent {
  render(width: number): string[];
  handleInput(data: string): void;
  invalidate(): void;
}

type Done = (value: unknown) => void;

export interface CustomPromptOptions {
  blocked?: { kind: string; message: string };
}

export type CustomPrompt = (
  factory: (tui: unknown, theme: unknown, keybindings: unknown, done: Done) => PromptComponent,
  options?: CustomPromptOptions,
) => Promise<unknown>;

export type SelectPrompt = (title: string, options: string[]) => Promise<string | undefined>;

export class SessionGrants {
  private granted = new Set<string>();

  has(command: string): boolean {
    return this.granted.has(command);
  }

  add(command: string): void {
    this.granted.add(command);
  }

  clear(): void {
    this.granted.clear();
  }

  get size(): number {
    return this.granted.size;
  }
}

interface Theme {
  fg?: (name: string, text: string) => string;
  bold?: (text: string) => string;
}

/** Theme colors, with raw ANSI fallbacks for themes that return text unchanged. */
function paint(theme: unknown) {
  const api = (theme ?? {}) as Theme;
  const raw: Record<string, string> = { error: "\u001b[91m", warning: "\u001b[93m", dim: "\u001b[90m" };

  const fg = (name: string, text: string): string => {
    if (typeof api.fg === "function") {
      try {
        const themed = api.fg(name, text);
        if (themed !== text) return themed;
      } catch {
        // fall through to raw
      }
    }
    const code = raw[name];
    return code ? `${code}${text}\u001b[39m` : text;
  };

  const bold = (text: string): string => {
    if (typeof api.bold === "function") {
      try {
        const themed = api.bold(text);
        if (themed !== text) return themed;
      } catch {
        // fall through to raw
      }
    }
    return `\u001b[1m${text}\u001b[22m`;
  };

  return { fg, bold };
}

function numberedRows(command: string, textWidth: number, dim: (text: string) => string) {
  const logical = command.split("\n");
  const numberWidth = Math.max(2, String(logical.length).length);
  const rows: string[] = [];
  for (const [index, line] of logical.entries()) {
    const label = dim(String(index + 1).padStart(numberWidth));
    const wrapped = wrapTextWithAnsi(line, Math.max(4, textWidth - numberWidth - 1));
    for (const chunk of wrapped.length > 0 ? wrapped : [""]) rows.push(`${label} ${chunk}`);
  }
  return rows;
}

function rule(width: number, label: string, dim: (text: string) => string): string {
  const clipped = truncateToWidth(label, width);
  const used = width - clipped.length;
  return dim(`${"─".repeat(Math.max(0, used))}${clipped}`);
}

function createPromptComponent(
  command: string,
  reason: string,
  theme: unknown,
  tui: unknown,
  done: Done,
): PromptComponent {
  const { fg, bold } = paint(theme);
  const dim = (text: string) => fg("dim", text);

  let expanded = false;
  let scroll = 0;

  const container = new Container();
  const topBorder = new Text("", 0, 0);
  const body = new Text("", 1, 0);
  const bottomBorder = new Text("", 0, 0);

  container.addChild(new DynamicBorder((text: string) => fg("error", text)));
  container.addChild(new Text(fg("error", bold("pi-permit · Dangerous command")), 1, 0));
  container.addChild(new Spacer(1));
  container.addChild(new Text(fg("warning", `Reason: ${reason}`), 1, 0));
  container.addChild(new Spacer(1));
  container.addChild(topBorder);
  container.addChild(body);
  container.addChild(bottomBorder);
  container.addChild(new Spacer(1));
  container.addChild(new Text(" Allow execution?", 0, 0));
  container.addChild(new Spacer(1));
  container.addChild(
    new Text(dim(" y allow · a session · n deny · s stop · esc cancel · j/k scroll · o all"), 0, 0),
  );
  container.addChild(new DynamicBorder((text: string) => fg("error", text)));

  const requestRender = () => (tui as { requestRender?: () => void } | undefined)?.requestRender?.();
  const terminalWidth = () => {
    const columns = (tui as { terminal?: { columns?: number } } | undefined)?.terminal?.columns;
    return typeof columns === "number" && columns > 0 ? columns : 80;
  };

  return {
    render(width: number): string[] {
      const w = Math.max(28, width || terminalWidth());
      const inner = Math.max(10, w - 4);
      const rows = numberedRows(command, inner, dim);
      const viewport = expanded ? EXPANDED_ROWS : VIEWPORT_ROWS;
      const maxScroll = Math.max(0, rows.length - viewport);
      if (scroll > maxScroll) scroll = maxScroll;

      const visible = rows.slice(scroll, scroll + viewport);
      const above = scroll;
      const below = rows.length - scroll - visible.length;

      topBorder.setText(rule(w, above > 0 ? ` ↑ ${above} more ` : "", dim));
      body.setText(visible.join("\n"));
      bottomBorder.setText(rule(w, below > 0 ? ` ↓ ${below} more ` : "", dim));

      return container.render(w);
    },

    handleInput(data: string): void {
      if (TOGGLE_KEYS.has(data)) {
        expanded = !expanded;
        scroll = 0;
        requestRender();
        return;
      }
      if (matchesKey(data, Key.up) || data === "k") {
        if (scroll > 0) {
          scroll -= 1;
          requestRender();
        }
        return;
      }
      if (matchesKey(data, Key.down) || data === "j") {
        scroll += 1;
        requestRender();
        return;
      }
      if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
        done("deny");
        return;
      }
      const choice = chooseFromKey(data);
      if (choice) done(choice);
    },

    invalidate(): void {
      container.invalidate();
    },
  };
}

const OPTIONS = ["Allow once", "Allow for this session", "Deny", "Deny and stop"];

export interface PromptRequest {
  command: string;
  reason: string;
  hasUI: boolean;
  grants: SessionGrants;
  custom?: CustomPrompt;
  select?: SelectPrompt;
  abort: () => void;
}

function resolveChoice(choice: Choice | undefined, request: PromptRequest): Outcome {
  const { command, reason } = request;
  if (choice === "allow") return { block: false };
  if (choice === "allow-session") {
    request.grants.add(command);
    return { block: false };
  }
  if (choice === "stop") {
    request.abort();
    return { block: true, reason: `pi-permit: denied and stopped (${reason})` };
  }
  return { block: true, reason: `pi-permit: denied (${reason})` };
}

export async function ask(request: PromptRequest): Promise<Outcome> {
  const { command, reason } = request;

  if (!request.hasUI) {
    return { block: true, reason: `pi-permit (no UI to confirm): ${reason}` };
  }

  if (request.custom) {
    const choice = (await request.custom(
      (tui, theme, _keybindings, done) => createPromptComponent(command, reason, theme, tui, done),
      { blocked: { kind: "permission", message: `pi-permit: ${reason}` } },
    )) as Choice | undefined;
    return resolveChoice(choice, request);
  }

  if (request.select) {
    const body = command.replace(/\n/g, "\n    ");
    const picked = await request.select(`pi-permit: ${reason}\n\n    ${body}`, [...OPTIONS]);
    const index = OPTIONS.indexOf(picked ?? "");
    const byIndex: Choice[] = ["allow", "allow-session", "deny", "stop"];
    return resolveChoice(index >= 0 ? byIndex[index] : undefined, request);
  }

  return { block: true, reason: `pi-permit (no UI to confirm): ${reason}` };
}
