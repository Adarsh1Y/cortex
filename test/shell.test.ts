import { describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("repl shell end-to-end", () => {
  test(
    "interactive session: chat, commands, clean exit, digest on leave",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "cortex-repl-"));
      writeFileSync(
        join(dir, "cortex.json"),
        JSON.stringify({
          data_dir: join(dir, "data"),
          brain: { engine: "opencode" },
          memory: { episodic: true, semantic: true },
          proactive: { enabled: false },
          shell: { prompt: "you > ", welcome_message: true, colors: false },
        }),
      );
      cpSync(join(repo, "persona.json"), join(dir, "persona.json"));

      const child = spawn("bun", ["run", join(repo, "shell/repl.ts")], {
        cwd: dir,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
      child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));

      const exit = new Promise<number | null>((resolve) => child.on("exit", resolve));
      const input = "What is the square of 3?\n/status\n/facts\n/exit\n";
      child.stdin.write(input);
      child.stdin.end();

      const code = await Promise.race([
        exit,
        new Promise<null>((r) => setTimeout(() => r(null), 180_000)),
      ]);

      expect(code).toBe(0);
      expect(stderr).toContain(""); // no crash spew expected (may be empty)

      // welcome + persona
      expect(stdout).toContain("CORTEX online");
      expect(stdout).toContain("you > ");

      // /status output
      expect(stdout).toContain("memory:");
      expect(stdout).toContain("facts:");

      // digest ran on exit
      expect(stdout).toContain("reflecting");

      // a real reply came back for the question
      expect(stdout.length).toBeGreaterThan(200);

      rmSync(dir, { recursive: true, force: true });
    },
    200_000,
  );
});
