import { describe, expect, test } from "bun:test";
import { ask, chooseFromKey, SessionGrants } from "../src/prompt";

describe("chooseFromKey", () => {
  test("maps single keys to choices", () => {
    expect(chooseFromKey("y")).toBe("allow");
    expect(chooseFromKey("a")).toBe("allow-session");
    expect(chooseFromKey("n")).toBe("deny");
    expect(chooseFromKey("s")).toBe("stop");
    expect(chooseFromKey("Y")).toBe("allow");
    expect(chooseFromKey("q")).toBeUndefined();
    expect(chooseFromKey("\r")).toBeUndefined();
  });
});

function harness(key: string, command = "rm -r build", reason = "recursive delete") {
  const grants = new SessionGrants();
  let aborted = 0;
  const request = {
    command,
    reason,
    hasUI: true,
    grants,
    abort: () => {
      aborted += 1;
    },
    custom: async (factory: any) => {
      return await new Promise((resolve) => {
        const component = factory({}, {}, {}, resolve);
        const lines = component.render(80);
        expect(lines.join("\n")).toContain("allow");
        expect(lines.join("\n")).toContain("recursive delete");
        component.handleInput(key);
      });
    },
  };
  return { request, grants, aborted: () => aborted };
}

describe("ask", () => {
  test("y allows once without a grant", async () => {
    const env = harness("y");
    expect(await ask(env.request)).toEqual({ block: false });
    expect(env.grants.size).toBe(0);
  });

  test("a allows and records a grant", async () => {
    const env = harness("a");
    expect(await ask(env.request)).toEqual({ block: false });
    expect(env.grants.has("rm -r build")).toBe(true);
  });

  test("n denies without aborting", async () => {
    const env = harness("n");
    const outcome = await ask(env.request);
    expect(outcome.block).toBe(true);
    expect(env.aborted()).toBe(0);
  });

  test("s denies and aborts", async () => {
    const env = harness("s");
    expect((await ask(env.request)).block).toBe(true);
    expect(env.aborted()).toBe(1);
  });

  test("escape denies", async () => {
    const env = harness("\u001b");
    expect((await ask(env.request)).block).toBe(true);
    expect(env.aborted()).toBe(0);
  });

  test("blocks when there is no UI", async () => {
    const grants = new SessionGrants();
    const outcome = await ask({
      command: "rm -r build",
      reason: "recursive delete",
      hasUI: false,
      grants,
      abort: () => {},
    });
    expect(outcome.block).toBe(true);
    expect(outcome.block && outcome.reason).toContain("no UI");
  });

  test("falls back to select when custom is unavailable", async () => {
    const grants = new SessionGrants();
    const outcome = await ask({
      command: "npm publish",
      reason: "publishes a package",
      hasUI: true,
      grants,
      select: async () => "Deny",
      abort: () => {},
    });
    expect(outcome.block).toBe(true);
  });
});

describe("prompt rendering", () => {
  test("caps long commands and lists the shortcuts", async () => {
    const grants = new SessionGrants();
    const long = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
    let captured: string[] = [];
    await ask({
      command: long,
      reason: "many lines",
      hasUI: true,
      grants,
      abort: () => {},
      custom: async (factory: any) =>
        await new Promise((resolve) => {
          const component = factory({}, {}, {}, resolve);
          captured = component.render(80).map((line: string) => line.replace(/\u001b\[[0-9;]*m/g, ""));
          component.handleInput("n");
        }),
    });
    const text = captured.join("\n");
    expect(text).toContain("↓ 18 more");
    expect(text).toContain("n deny");
    expect(text).toContain("esc cancel");
  });

  test("arrows do not deny by accident", async () => {
    const grants = new SessionGrants();
    let resolved: unknown = "unset";
    await ask({
      command: "rm -r build",
      reason: "recursive delete",
      hasUI: true,
      grants,
      abort: () => {},
      custom: async (factory: any) =>
        await new Promise<void>((resolve) => {
          const component = factory({}, {}, {}, (value: unknown) => {
            resolved = value;
            resolve();
          });
          component.handleInput("\u001b[A");
          component.handleInput("n");
        }),
    });
    expect(resolved).toBe("deny");
  });
});

describe("key handling", () => {
  function feed(keys: string[]) {
    const grants = new SessionGrants();
    const result: { value: unknown } = { value: "unset" };
    const done = ask({
      command: "rm -r build",
      reason: "recursive delete",
      hasUI: true,
      grants,
      abort: () => {},
      custom: async (factory: any) =>
        await new Promise<void>((resolve) => {
          const component = factory({}, {}, {}, (value: unknown) => {
            result.value = value;
            resolve();
          });
          for (const key of keys) component.handleInput(key);
        }),
    });
    return { result, done };
  }

  test("enter does nothing, so a later key still decides", async () => {
    const env = feed(["\r", "\n", "n"]);
    await env.done;
    expect(env.result.value).toBe("deny");
  });

  test("ctrl+c denies", async () => {
    const env = feed(["\u0003"]);
    await env.done;
    expect(env.result.value).toBe("deny");
  });
});

describe("layout", () => {
  const ansi = (name: string, text: string) => `\u001b[${name === "accent" ? "36" : "2"}m${text}\u001b[0m`;
  const plainWidth = (line: string) => line.replace(/\u001b\[[0-9;]*m/g, "").length;

  test("never exceeds the terminal width, even with colors", async () => {
    for (const width of [30, 40, 60, 80, 120]) {
      await ask({
        command: "x".repeat(200),
        reason: "very long command",
        hasUI: true,
        grants: new SessionGrants(),
        abort: () => {},
        custom: async (factory: any) =>
          await new Promise<void>((resolve) => {
            const component = factory({}, { fg: ansi }, {}, resolve);
            for (const line of component.render(width)) {
              expect(plainWidth(line)).toBeLessThanOrEqual(width);
            }
            component.handleInput("n");
          }),
      });
    }
  });

  test("keeps every option on the hint line", async () => {
    const lines: string[] = [];
    await ask({
      command: "rm -r build",
      reason: "recursive delete",
      hasUI: true,
      grants: new SessionGrants(),
      abort: () => {},
      custom: async (factory: any) =>
        await new Promise<void>((resolve) => {
          const component = factory({}, { fg: ansi }, {}, resolve);
          lines.push(...component.render(120).map((line: string) => line.replace(/\u001b\[[0-9;]*m/g, "")));
          component.handleInput("n");
        }),
    });
    const hint = lines.find((line) => line.includes("esc cancel")) ?? "";
    for (const key of ["y allow", "a session", "n deny", "s stop"]) {
      expect(hint).toContain(key);
    }
  });
});

describe("long commands", () => {
  const ansi = (name: string, text: string) => `\u001b[${name === "accent" ? "36" : "2"}m${text}\u001b[0m`;
  const strip = (line: string) => line.replace(/\u001b\[[0-9;]*m/g, "");

  async function renderWith(keys: string[], command: string, width = 80) {
    const frames: string[][] = [];
    await ask({
      command,
      reason: "long command",
      hasUI: true,
      grants: new SessionGrants(),
      abort: () => {},
      custom: async (factory: any) =>
        await new Promise<void>((resolve) => {
          const component = factory({}, { fg: ansi }, {}, resolve);
          frames.push(component.render(width).map(strip));
          for (const key of keys) {
            component.handleInput(key);
            frames.push(component.render(width).map(strip));
            if (key !== "o") break;
          }
          component.handleInput("n");
        }),
    });
    return frames;
  }

  test("wraps a long single line instead of clipping it", async () => {
    const long = `echo ${"abcdefghij".repeat(12)}`;
    const [first] = await renderWith([], long);
    expect(first?.join("\n")).not.toContain("…");
    expect(first?.length).toBeGreaterThan(6);
  });

  test("o expands the row cap", async () => {
    const many = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
    const frames = await renderWith(["o"], many);
    const collapsed = frames[0] ?? [];
    const expanded = frames[1] ?? [];
    expect(collapsed.join("\n")).toContain("more");
    expect(collapsed.length).toBeLessThan(expanded.length);
    expect(expanded.join("\n")).toContain("line 29");
  });
});
