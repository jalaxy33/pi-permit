import { describe, expect, test } from "bun:test";
import permit from "../index";

function setup(options: { hasUI: boolean; keys?: string[] }) {
  const handlers: Function[] = [];
  const commands: string[] = [];
  const asked: string[] = [];
  let aborted = 0;

  const stub: any = new Proxy(
    {
      on(event: string, fn: Function) {
        if (event === "tool_call") handlers.push(fn);
      },
      registerCommand(name: string) {
        commands.push(name);
      },
      events: { on: () => {}, emit: () => {} },
    },
    { get: (target, prop) => (prop in target ? (target as any)[prop] : () => undefined) },
  );

  const ctx: any = {
    cwd: "/tmp",
    hasUI: options.hasUI,
    isProjectTrusted: () => false,
    abort: () => {
      aborted += 1;
    },
    ui: {
      notify: () => {},
      select: async (title: string) => {
        asked.push(title);
        return undefined;
      },
      custom: async (factory: any) => {
        asked.push("prompt");
        const key = options.keys?.shift() ?? "\u001b";
        return await new Promise((resolve) => {
          const component = factory({}, {}, {}, resolve);
          component.render(80);
          component.handleInput(key);
        });
      },
    },
  };

  const call = async (command: string) => {
    for (const handler of handlers) {
      const result: any = await handler(
        { type: "tool_call", toolName: "bash", input: { command } },
        ctx,
      );
      if (result?.block) return result;
    }
    return undefined;
  };

  return { stub, call, commands, asked, aborted: () => aborted };
}

describe("extension", () => {
  test("registers commands", async () => {
    const env = setup({ hasUI: false });
    await permit(env.stub);
    expect(env.commands).toEqual(["permit", "permit:reload"]);
  });

  test("lets safe commands through without prompting", async () => {
    const env = setup({ hasUI: false });
    await permit(env.stub);
    expect(await env.call("git status")).toBeUndefined();
    expect(env.asked).toEqual([]);
  });

  test("blocks ask-tier commands when there is no UI", async () => {
    const env = setup({ hasUI: false });
    await permit(env.stub);
    const result = await env.call("git reset --hard");
    expect(result?.block).toBe(true);
    expect(result?.reason).toContain("no UI");
    expect(result?.terminate).toBeUndefined();
  });

  test("allow once executes without keeping a grant", async () => {
    const env = setup({ hasUI: true, keys: ["y", "n"] });
    await permit(env.stub);
    expect(await env.call("rm -r build")).toBeUndefined();
    const second = await env.call("rm -r build");
    expect(second?.block).toBe(true);
    expect(env.asked.length).toBe(2);
  });

  test("session grant skips later prompts for the same command", async () => {
    const env = setup({ hasUI: true, keys: ["a"] });
    await permit(env.stub);
    expect(await env.call("rm -r build")).toBeUndefined();
    expect(await env.call("rm -r build")).toBeUndefined();
    expect(env.asked.length).toBe(1);
  });

  test("deny blocks without terminating", async () => {
    const env = setup({ hasUI: true, keys: ["n"] });
    await permit(env.stub);
    const result = await env.call("npm publish");
    expect(result?.block).toBe(true);
    expect(result?.terminate).toBeUndefined();
    expect(env.aborted()).toBe(0);
  });

  test("deny and stop aborts the turn", async () => {
    const env = setup({ hasUI: true, keys: ["s"] });
    await permit(env.stub);
    const result = await env.call("npm publish");
    expect(result?.block).toBe(true);
    expect(env.aborted()).toBe(1);
  });

  test("deny rules block with terminate and without a prompt", async () => {
    const env = setup({ hasUI: true, keys: [] });
    await permit(env.stub);
    const result: any = await env.call("git filter-repo --path x");
    expect(result?.block).toBe(true);
    expect(result?.terminate).toBe(true);
    expect(env.asked).toEqual([]);
  });
});
