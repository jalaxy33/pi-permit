import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
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

  const callTool = async (toolName: string, input: Record<string, unknown>) => {
    for (const handler of handlers) {
      const result: any = await handler({ type: "tool_call", toolName, input }, ctx);
      if (result?.block) return result;
    }
    return undefined;
  };

  const call = (command: string) => callTool("bash", { command });

  return { stub, call, callTool, commands, asked, aborted: () => aborted };
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

describe("path rules", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-permit-ext-"));
  writeFileSync(join(dir, ".env"), "SECRET=1\n");
  writeFileSync(join(dir, ".env.example"), "SECRET=\n");
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("blocks reading .env through the read tool", async () => {
    const env = setup({ hasUI: true, keys: [] });
    await permit(env.stub);
    const result = await env.callTool("read", { path: join(dir, ".env") });
    expect(result?.block).toBe(true);
    expect(result?.reason).toContain(".env");
  });

  test("blocks writing .env through the edit tool", async () => {
    const env = setup({ hasUI: true, keys: [] });
    await permit(env.stub);
    const result = await env.callTool("edit", { path: join(dir, ".env"), edits: [] });
    expect(result?.block).toBe(true);
  });

  test("allows .env.example", async () => {
    const env = setup({ hasUI: true, keys: [] });
    await permit(env.stub);
    expect(await env.callTool("read", { path: join(dir, ".env.example") })).toBeUndefined();
  });

  test("blocks bash redirection into .env", async () => {
    const env = setup({ hasUI: true, keys: [] });
    await permit(env.stub);
    const result = await env.call("echo x > .env");
    expect(result?.block).toBe(true);
    expect(result?.reason).toContain(".env");
  });

  test("blocks reading .env as a bash operand", async () => {
    const env = setup({ hasUI: true, keys: [] });
    await permit(env.stub);
    expect((await env.call(`cat ${join(dir, ".env")}`))?.block).toBe(true);
  });

  test("blocks deleting .env", async () => {
    const env = setup({ hasUI: true, keys: [] });
    await permit(env.stub);
    expect((await env.call(`rm -f ${join(dir, ".env")}`))?.block).toBe(true);
  });

  test("blocks a copy into .env", async () => {
    const env = setup({ hasUI: true, keys: [] });
    await permit(env.stub);
    expect((await env.call(`cp ${join(dir, ".env.example")} ${join(dir, ".env")}`))?.block).toBe(true);
  });

  test("leaves unrelated paths alone", async () => {
    const env = setup({ hasUI: true, keys: [] });
    await permit(env.stub);
    expect(await env.callTool("read", { path: join(dir, "notes.txt") })).toBeUndefined();
  });
});

describe("outside workspace gate", () => {
  const outside = join(homedir(), "pi-permit-outside-file.txt");

  test("asks before reading outside the workspace", async () => {
    const env = setup({ hasUI: true, keys: ["n"] });
    await permit(env.stub);
    const result = await env.callTool("read", { path: outside });
    expect(result?.block).toBe(true);
    expect(result?.reason).toContain("outside workspace");
    expect(env.asked.length).toBe(1);
  });

  test("allows the same read when the prompt is approved", async () => {
    const env = setup({ hasUI: true, keys: ["y"] });
    await permit(env.stub);
    expect(await env.callTool("read", { path: outside })).toBeUndefined();
  });

  test("a session grant covers later reads of the same path", async () => {
    const env = setup({ hasUI: true, keys: ["a"] });
    await permit(env.stub);
    expect(await env.callTool("read", { path: outside })).toBeUndefined();
    expect(await env.callTool("read", { path: outside })).toBeUndefined();
    expect(env.asked.length).toBe(1);
  });

  test("does not prompt for paths inside the workspace", async () => {
    const env = setup({ hasUI: true, keys: [] });
    await permit(env.stub);
    expect(await env.callTool("read", { path: "/tmp/pi-permit-inside.txt" })).toBeUndefined();
    expect(env.asked).toEqual([]);
  });

  test("blocks without a UI", async () => {
    const env = setup({ hasUI: false });
    await permit(env.stub);
    expect((await env.callTool("read", { path: outside }))?.block).toBe(true);
  });
});
