import { describe, expect, test } from "bun:test";
import { loadConfig } from "../config";
import { decide } from "../decide";
import { tokenize } from "../tokenize";

const config = loadConfig("/nonexistent-cwd", false);

function action(command: string): string {
  return decide(command, config.commands).action;
}

describe("tokenize", () => {
  test("splits on separators", () => {
    const commands = tokenize("git add -A && git commit -m x; ls | wc -l");
    expect(commands.map((c) => c.argv[0])).toEqual(["git", "git", "ls", "wc"]);
  });

  test("keeps quoted words whole", () => {
    expect(tokenize(`echo 'a b' "c d"`)[0]?.argv).toEqual(["echo", "a b", "c d"]);
  });

  test("records redirects outside argv", () => {
    const [first] = tokenize("printf x > /tmp/f");
    expect(first?.argv).toEqual(["printf", "x"]);
    expect(first?.redirects).toEqual([{ op: ">", target: "/tmp/f" }]);
  });

  test("skips heredoc bodies", () => {
    const commands = tokenize("cat > /tmp/x.sh <<'EOF'\ngit reset --hard\nEOF\necho done");
    expect(commands.map((c) => c.argv.join(" "))).toEqual(["cat", "echo done"]);
  });

  test("tokenizes command substitution", () => {
    const commands = tokenize("echo $(git clean -fdx)");
    expect(commands.map((c) => c.argv.join(" "))).toEqual(["echo", "git clean -fdx"]);
  });

  test("drops comments", () => {
    expect(tokenize("ls # git push").map((c) => c.argv.join(" "))).toEqual(["ls"]);
  });
});

describe("decide", () => {
  test("denies history rewriting", () => {
    expect(action("git filter-repo --path secrets.txt")).toBe("deny");
    expect(action("git reflog expire --all")).toBe("deny");
    expect(action("git gc --prune=now")).toBe("deny");
    expect(action("echo $(git gc --prune=now)")).toBe("deny");
  });

  test("asks before git writes", () => {
    for (const command of [
      "git add -A",
      "git commit -m x",
      "cd repo && git commit -m x",
      "git push origin main",
      "git push --force",
      "git -C /repo reset --hard",
      "git restore .",
      "git checkout -- src/a.ts",
      "git clean -fdx",
      "git branch -D feat",
      "git tag -d v1",
      "git stash clear",
      "git worktree remove x",
      "git merge feature",
    ]) {
      expect([command, action(command)]).toEqual([command, "ask"]);
    }
  });

  test("asks before destructive shell commands", () => {
    for (const command of [
      "rm -r build",
      "rm -rf node_modules",
      "rsync -a --delete a/ b/",
      "find . -delete",
      "find . -name x -exec rm -f {} +",
      "ls | xargs rm",
      "truncate -s 0 db.sqlite",
      "sudo ls",
      "dropdb prod",
      "redis-cli flushall",
      "psql -c 'DROP TABLE users'",
      "terraform destroy",
      "kubectl delete ns x",
      "helm uninstall x",
      "docker volume prune -a",
      "npm publish",
      "gh release delete v1",
    ]) {
      expect([command, action(command)]).toEqual([command, "ask"]);
    }
  });

  test("allows harmless variants", () => {
    for (const command of [
      "git status",
      "git checkout main",
      "git checkout -b feature",
      "git restore --staged .",
      "git clean -n",
      "git reset HEAD file.ts",
      "git stash list",
      "git branch feature",
      "git push --force-with-lease",
      "rm a.txt",
      "rm -f lockfile",
      "rsync -av a/ b/",
      "kubectl get pods",
      "docker compose down",
      "SELECT * FROM users",
    ]) {
      expect([command, action(command)]).toEqual([command, "allow"]);
    }
  });

  test("ignores text that is not a command", () => {
    for (const command of [
      `echo 'git reset --hard'`,
      "cat > /tmp/x.sh <<'EOF'\n#!/bin/sh\ngit reset --hard\ngit clean -fdx\nEOF",
      "grep -r 'rm -rf' docs/",
      "# git push --force",
    ]) {
      expect([command, action(command)]).toEqual([command, "allow"]);
    }
  });

  test("reports reasons and terminate for deny rules", () => {
    const verdict = decide("git filter-branch --all", config.commands);
    expect(verdict.reasons.length).toBeGreaterThan(0);
    expect(verdict.terminate).toBe(true);
  });
});

describe("config", () => {
  test("compiles defaults without warnings", () => {
    expect(config.warnings).toEqual([]);
    expect(config.commands.deny.length).toBeGreaterThan(0);
    expect(config.enabled.commands).toBe(true);
    expect(config.enabled.paths).toBe(false);
  });
});
