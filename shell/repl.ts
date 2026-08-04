import { stdin, stdout } from "node:process";

import {
  Conversation,
  MarkdownStream,
  Memory,
  OpenCodeBrain,
  ProactiveEngine,
  colors,
  consolidateFacts,
  expandHome,
  loadConfig,
  loadPersona,
  paint,
  projectRoot,
  resolvePersonaPath,
} from "@cortex/core";

const HELP = `Commands:
  /recall <query>   search past conversations
  /forget <query>   forget messages matching query
  /facts            list distilled facts
  /facts del <id>   permanently delete a fact
  /dream            consolidate + dedupe stored facts
  /journal          show my life story (journal entries)
  /prefer <k> <v>   record a preference (e.g. /prefer language python)
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

function resolveUserName(memory: Memory): string {
  const prefs = memory.allPreferences();
  const namePref = prefs.find((p) => /name|call/i.test(p.key));
  if (namePref) return namePref.value;
  const facts = memory.listFacts(true, 200);
  const callFact = facts.find((f) => /call me|name is|prefers? to be called/i.test(f.text));
  if (callFact) {
    const m = callFact.text.match(/(?:call me|called)\s+([A-Za-z][\w-]*)/i);
    if (m) return m[1];
  }
  return "boss";
}

async function main(): Promise<void> {
  const config = loadConfig();
  const persona = loadPersona(resolvePersonaPath(config));
  const useColor = config.shell.colors;

  const dataDir = expandHome(config.data_dir);
  const memory = new Memory(dataDir);

  const brain = await OpenCodeBrain.connect(config.brain.server_timeout_ms);
  const convo = await Conversation.start({ config, memory, brain, persona });

  const lines = makeLineReader();
  const promptStr = config.shell.prompt;
  const render = (s: string) => (useColor ? s : "");

  const userName = resolveUserName(memory);

  const proactive = new ProactiveEngine({
    config: {
      enabled: config.proactive.enabled,
      idleMinutes: config.proactive.idle_minutes,
      cooldownMinutes: config.proactive.cooldown_minutes,
      checkIntervalMs: config.proactive.check_interval_ms,
    },
    brain,
    memory,
    persona,
    userName,
    onSpeak: (text) => {
      stdout.write(`\n${useColor ? `${colors.yellow}${text}${colors.reset}` : text}\n${promptStr}`);
    },
  });
  proactive.start();

  if (config.shell.welcome_message) {
    stdout.write(
      `\n${render(colors.bold)}  ${persona.name}${render(colors.reset)} online. I remember everything.\n` +
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
          `  memory: ${stats.messages} messages across ${stats.sessions} sessions\n` +
            `  facts: ${stats.facts} · journal: ${stats.journal} · preferences: ${stats.preferences}\n` +
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
      case "/facts": {
        if (arg.startsWith("del")) {
          const id = Number(arg.split(/\s+/)[1]);
          if (!Number.isFinite(id)) {
            stdout.write("  usage: /facts del <id>\n");
            return false;
          }
          memory.deleteFact(id);
          stdout.write(`  deleted fact #${id}.\n`);
          return false;
        }
        const facts = memory.listFacts(false, 50);
        if (facts.length === 0) {
          stdout.write("  no facts yet. They are distilled from conversations on exit.\n");
          return false;
        }
        for (const f of facts) {
          stdout.write(
            `  [${f.id}] ${f.active ? "" : "(dormant) "}[${f.category}] ${f.text}\n`,
          );
        }
        return false;
      }
      case "/dream": {
        stdout.write("  dreaming over stored facts…\n");
        const res = await consolidateFacts(brain, memory);
        stdout.write(`  done. kept ${res.kept}, retired ${res.removed}.\n`);
        return false;
      }
      case "/journal": {
        if (arg.startsWith("del")) {
          const id = Number(arg.split(/\s+/)[1]);
          if (!Number.isFinite(id)) {
            stdout.write("  usage: /journal del <id>\n");
            return false;
          }
          memory.deleteJournal(id);
          stdout.write(`  deleted journal entry #${id}.\n`);
          return false;
        }
        const entries = memory.latestJournal(20);
        if (entries.length === 0) {
          stdout.write("  no journal entries yet.\n");
          return false;
        }
        for (const e of entries) {
          const when = new Date(e.created_at).toLocaleString();
          stdout.write(`  [${e.id}] ${when}\n    ${e.summary}\n`);
        }
        return false;
      }
      case "/prefer": {
        const m = arg.match(/^(\S+)\s+([\s\S]+)$/);
        if (!m) {
          stdout.write("  usage: /prefer <key> <value>\n");
          return false;
        }
        memory.setPreference(m[1].toLowerCase(), m[2].trim());
        stdout.write(`  noted: ${m[1].toLowerCase()} = ${m[2].trim()}\n`);
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
      proactive.poke();
      if (trimmed.startsWith("/")) {
        exiting = await handleCommand(trimmed);
        continue;
      }
      stdout.write("\n");
      const md = new MarkdownStream();
      try {
        await convo.turn(trimmed, (d) => {
          proactive.poke();
          stdout.write(useColor ? md.push(d) : d);
        });
        stdout.write(useColor ? md.flush() : "");
        stdout.write("\n\n");
      } catch (err) {
        stdout.write(`\n  [error] ${(err as Error).message}\n\n`);
      }
    }
  } finally {
    proactive.stop();
    if (config.memory.semantic) {
      stdout.write("  reflecting…\n");
      try {
        const digest = await convo.digest();
        if (digest && (digest.facts.length > 0 || digest.journal)) {
          stdout.write(
            `  distilled ${digest.facts.length} fact(s)${digest.journal ? " + journal" : ""}.\n`,
          );
        }
      } catch {
        // best effort
      }
    }
    brain.close();
    memory.close();
  }
  stdout.write("  offline.\n");
  process.exit(0);
}

process.on("SIGINT", () => {
  stdout.write("\n");
  process.exit(0);
});

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
