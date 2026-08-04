import { stdin, stdout } from "node:process";

import {
  Conversation,
  Memory,
  OpenCodeBrain,
  expandHome,
  loadConfig,
  loadPersona,
  projectRoot,
  resolvePersonaPath,
} from "@cortex/core";

const HELP = `Commands:
  /recall <query>   search past conversations
  /forget <query>   forget messages matching query
  /clear            reset the current conversation history
  /whoami           show my persona
  /status           show memory stats
  /help             show this help
  /exit             leave`;

function makeLineReader() {
  stdin.setEncoding("utf8");
  let buffer = "";
  let waiter: ((line: string) => void) | null = null;

  function drain(): void {
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).replace(/\r$/, "");
      buffer = buffer.slice(nl + 1);
      if (waiter) {
        const w = waiter;
        waiter = null;
        w(line);
        return;
      }
    }
  }

  stdin.on("data", (chunk: string | Uint8Array) => {
    buffer += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    drain();
  });

  return {
    ask(prompt: string): Promise<string> {
      stdout.write(prompt);
      return new Promise((resolve) => {
        waiter = resolve;
        drain();
      });
    },
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const persona = loadPersona(resolvePersonaPath(config));

  const dataDir = expandHome(config.data_dir);
  const memory = new Memory(dataDir);

  const brain = await OpenCodeBrain.connect(config.brain.server_timeout_ms);
  const convo = await Conversation.start({ config, memory, brain, persona });

  const lines = makeLineReader();

  const personaName = persona.name;
  const promptStr = config.shell.prompt;

  if (config.shell.welcome_message) {
    stdout.write(
      `\n  ${personaName} online. I remember everything.\n` +
        `  Type /help for commands, /exit to leave.\n` +
        `  (cwd: ${projectRoot()})\n\n`,
    );
  }

  const handleCommand = async (line: string): Promise<boolean> => {
    const [cmd, ...rest] = line.split(/\s+/);
    const arg = rest.join(" ").trim();
    switch (cmd) {
      case "/exit":
      case "/quit":
        return true;
      case "/help":
        stdout.write(`${HELP}\n`);
        return false;
      case "/whoami":
        stdout.write(
          `  ${persona.name} — ${persona.role}\n` +
            `  voice: ${persona.voice.tone}; ${persona.voice.register}\n` +
            `  memory: ${persona.memory_ethic ?? "remembers everything unless asked to forget"}\n`,
        );
        return false;
      case "/status": {
        const stats = memory.stats();
        stdout.write(
          `  memory: ${stats.messages} messages across ${stats.sessions} sessions, ${stats.preferences} preferences\n` +
            `  brain: ${brain.url}\n`,
        );
        return false;
      }
      case "/recall": {
        if (!arg) {
          stdout.write("  usage: /recall <query>\n");
          return false;
        }
        const hits = memory.searchMessages(arg, 10);
        if (hits.length === 0) {
          stdout.write("  nothing found.\n");
          return false;
        }
        for (const m of hits) {
          const when = new Date(m.created_at).toLocaleString();
          const who = m.role === "user" ? "you" : persona.name;
          stdout.write(`  [${m.id}] ${when} ${who}: ${m.content.slice(0, 200)}\n`);
        }
        return false;
      }
      case "/forget": {
        if (!arg) {
          stdout.write("  usage: /forget <query>\n");
          return false;
        }
        const hits = memory.searchMessages(arg, 20);
        if (hits.length === 0) {
          stdout.write("  nothing to forget.\n");
          return false;
        }
        const removed = memory.deleteMessages(hits.map((m) => m.id));
        stdout.write(`  forgot ${removed} message(s).\n`);
        return false;
      }
      case "/clear": {
        const removed = await convo.clear();
        stdout.write(`  cleared current conversation (${removed} messages).\n`);
        return false;
      }
      default:
        stdout.write(`  unknown command: ${cmd} (try /help)\n`);
        return false;
    }
  };

  let exiting = false;
  try {
    while (!exiting) {
      const line = await lines.ask(promptStr);
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith("/")) {
        exiting = await handleCommand(trimmed);
        continue;
      }
      stdout.write("\n");
      try {
        await convo.turn(trimmed, (d) => stdout.write(d));
        stdout.write("\n\n");
      } catch (err) {
        stdout.write(`\n  [error] ${(err as Error).message}\n\n`);
      }
    }
  } finally {
    brain.close();
    memory.close();
  }
  stdout.write("  offline.\n");
}

process.on("SIGINT", () => {
  stdout.write("\n");
  process.exit(0);
});

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
