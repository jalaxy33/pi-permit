import { describe, expect, test } from "bun:test";
import { tokenize } from "../src/tokenize";

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

  test("appends redirect operator", () => {
    const [first] = tokenize("printf x >> /tmp/f");
    expect(first?.redirects).toEqual([{ op: ">>", target: "/tmp/f" }]);
  });

  test("skips heredoc bodies", () => {
    const commands = tokenize("cat > /tmp/x.sh <<'EOF'\ngit reset --hard\nEOF\necho done");
    expect(commands.map((c) => c.argv.join(" "))).toEqual(["cat", "echo done"]);
  });

  test("tokenizes command substitution", () => {
    const commands = tokenize("echo $(git clean -fdx)");
    expect(commands.map((c) => c.argv.join(" "))).toEqual(["echo", "git clean -fdx"]);
  });

  test("tokenizes backtick substitution", () => {
    const commands = tokenize("echo `git clean -fdx`");
    expect(commands.map((c) => c.argv.join(" "))).toEqual(["echo", "git clean -fdx"]);
  });

  test("drops comments", () => {
    expect(tokenize("ls # git push").map((c) => c.argv.join(" "))).toEqual(["ls"]);
  });
});
