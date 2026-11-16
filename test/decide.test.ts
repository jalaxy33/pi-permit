import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config";
import { decide } from "../src/decide";

const config = loadConfig("/nonexistent-cwd", false);

function action(command: string): string {
  return decide(command, config.commands).action;
}

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

  test("asks before disk and container escalation", () => {
    for (const command of [
      "dd if=/dev/zero of=/dev/sda",
      "mkfs.ext4 /dev/sdb1",
      "wipefs -a /dev/sdb",
      "blkdiscard /dev/nvme0n1",
      "fdisk /dev/sda",
      "parted /dev/sdb mklabel gpt",
      "shred -u secrets.txt",
      "chmod -R 777 /var/www",
      "chown -R nobody /srv",
      "docker run --privileged img",
      "docker run --pid=host img",
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
      "chmod 755 script.sh",
      "chmod -R 755 www",
      "chown alice file.txt",
      "mkfs-tool --version",
      "docker run img",
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
