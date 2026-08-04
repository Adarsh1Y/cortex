import { stdout } from "node:process";

import {
  Conversation,
  MarkdownStream,
  Memory,
  OllamaBrain,
  PermissionPolicy,
  ProactiveEngine,
  ReminderEngine,
  ReminderStore,
  VectorStore,
  backupMemory,
  colors,
  consolidateFacts,
  cleanupExpiredFacts,
  compressOldSessions,
  createBrain,
  createEmbedder,
  expandHome,
  exportMemory,
  importMemory,
  loadConfig,
  loadOrCreateKey,
  loadPersona,
  notify,
  notifyAvailable,
  paint,
  parseReminderWhen,
  projectRoot,
  resolvePersonaPath,
  speak,
  sttAvailable,
  ttsAvailable,
  type Brain,
  type Embedder,
} from "@cortex/core";
import { HistoryFile, LineEditor } from "./tui";

const HELP = `Commands:
  /recall <q>        search past conversations (semantic when embeddings are on)
  /forget <q>        forget messages matching query
  /facts             list distilled facts
  /facts del <id>    permanently delete a fact
  /dream             consolidate + dedupe stored facts
  /journal           show my life story (journal entries)
  /prefer <k> <v>    record a preference (e.g. /prefer language python)
  /remind <spec>     set a reminder: "in 30 minutes X", "at 14:00 X", "tomorrow at 09:00 X"
  /reminders         list pending reminders
  /remind cancel <id>  cancel a reminder
  /semantic <q>      semantic memory search with similarity scores
  /reindex           rebuild the embedding index from all stored memory
  /say <text>        speak through the voice engine (if configured)
  /voice             report voice engine status
  /allow <type>      allow a tool type for this session (e.g. /allow write)
  /permissions       show the tool permission policy
  /export [dir]      export all memory to JSON
  /import <file>     import a JSON memory bundle
  /backup            snapshot the SQLite database
  /clear             reset the current conversation history
  /whoami            show my persona
  /model             list Ollama models or show current brain model
  /status            show memory + system stats
  /help              show this help
  /exit              leave`;

function makeUsage(line: string): string {
  return `  usage: ${line}`;
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

  let key: Buffer | null = null;
  if (config.security.encryption) {
    key = loadOrCreateKey(
      expandHome(config.security.keyfile ?? "~/.consciousness/.cortex-key"),
      config.security.key_env ?? "CORTEX_KEY",
    );
    if (!key) {
      stdout.write(paint("  [warning] encryption enabled but no key source found\n", "yellow"));
    }
  }
   const memory = new Memory(dataDir, {
     key: key ?? undefined,
     hooks: {
       onMessagesDeleted: (ids) => vectors.removeMessages(ids),
       onFactDeleted: (id) => vectors.deleteFact(id),
       onSessionReset: (sessionId) => {
         const msgIds = memory.getMessages(sessionId).map((m) => m.id);
         if (msgIds.length > 0) vectors.removeMessages(msgIds);
       },
     },
   });
   const vectors = new VectorStore(memory.database);

  const embedder: Embedder | null = config.embeddings.enabled
    ? createEmbedder({ config })
    : null;
  if (embedder) {
    void embedder.ready().then((ok) => {
      if (!ok) {
        stdout.write(
          paint("  [embeddings unavailable] falling back to keyword recall\n", "yellow"),
        );
      }
    });
  }

  const policy = new PermissionPolicy(config.permissions);

  const onPermissionAsk = async (perm: {
    type: string;
    pattern?: string | string[];
    title: string;
  }): Promise<boolean> => {
    stdout.write(
      `  ${paint("? allow tool:", "cyan")} ${perm.type} ${Array.isArray(perm.pattern) ? perm.pattern.join(", ") : (perm.pattern ?? "")}\n`,
    );
    return false;
  };

  const brain: Brain = await createBrain({
    config,
    opencode: {
      timeoutMs: config.brain.server_timeout_ms,
      permissionPolicy: policy,
      onPermissionAsk,
    },
  });

  const history = new HistoryFile(
    expandHome(config.tui.history_file),
    config.tui.max_history,
  );
  const commands = Object.keys(COMMAND_LIST).map((c) => `/${c}`);
  const editor = new LineEditor({
    prompt: config.shell.prompt,
    renderPrompt: useColor ? `${colors.boldCyan}${config.shell.prompt}${colors.reset}` : config.shell.prompt,
    history,
    autocomplete: (line) => {
      if (line.startsWith("/")) return commands.filter((c) => c.startsWith(line));
      return [];
    },
  });

  const userName = resolveUserName(memory);

  let busy = false;
  const pendingSpeak: string[] = [];
  let ttsOn = config.voice.tts_engine !== "off";

  const deliver = (text: string): void => {
    const rendered = useColor ? `${colors.yellow}${text}${colors.reset}` : text;
    if (busy) {
      pendingSpeak.push(rendered);
    } else {
      editor.externalWrite(`  ${rendered}`);
    }
    notifyOn("CORTEX", text.replace(/\x1b\[[0-9;]*m/g, ""));
    if (ttsOn) void speak(text.replace(/\x1b\[[0-9;]*m/g, ""), config.voice);
  };

  const notifyOn = (title: string, body: string): void => {
    if (!config.notify.enabled) return;
    if (!notifyAvailable({ command: config.notify.command })) return;
    void notify(title, body, { command: config.notify.command });
  };

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
    onSpeak: (text: string) => {
      deliver(text);
      if (ttsOn) void speak(text.replace(/\x1b\[[0-9;]*m/g, ""), config.voice);
    },
  });
  proactive.start();

  const reminders = new ReminderEngine({
    database: memory.database,
    checkIntervalMs: config.reminders.check_interval_ms,
    onFire: (reminder) => {
      proactive.poke();
      const line = `⏰ ${reminder.text}`;
      if (config.reminders.notify !== "desktop") deliver(line);
      if (config.reminders.notify !== "terminal") notifyOn("Reminder", reminder.text);
      if (ttsOn) void speak(line, config.voice);
      memory.addJournal(`I reminded ${userName} to ${reminder.text}`);
    },
  });
  reminders.start();

  // Run memory maintenance on startup
  void cleanupExpiredFacts(memory);
  void compressOldSessions(memory, brain, config.memory.compress_after_days, config.memory.max_session_messages);

  const convo = await Conversation.start({
    config,
    memory,
    brain,
    persona,
    embedder: embedder ?? undefined,
    vectors,
  });

  if (config.shell.welcome_message) {
    const render = (s: string) => (useColor ? s : "");
    stdout.write(
      `\n${render(colors.bold)}  ${persona.name}${render(colors.reset)} online. I remember everything.\n` +
        `  engine: ${config.brain.engine} · embeddings: ${embedder ? "on" : "off"} · tools: ${policy.describe()}\n` +
        `  Type /help for commands, /exit to leave.\n` +
        `  (cwd: ${projectRoot()})\n\n`,
    );
  }

  const flushPending = (): void => {
    if (pendingSpeak.length > 0 && !busy) {
      const lines = pendingSpeak.splice(0, pendingSpeak.length).join("\n  ");
      editor.externalWrite(`  ${lines}`);
    }
  };

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
      case "/model": {
        if (config.brain.engine === "ollama") {
          const ollama = brain as unknown as OllamaBrain;
          const current = config.brain.model;
          stdout.write(`  engine: ollama · model: ${current}\n`);
          stdout.write(`  url: ${config.brain.ollama_url ?? "http://127.0.0.1:11434"}\n`);
          try {
            const models = await ollama.listModels();
            if (models.length === 0) {
              stdout.write("  no models found — pull one with `ollama pull <name>`\n");
            } else {
              stdout.write(`  available (${models.length}):\n`);
              for (const m of models) {
                const sizeMB = (m.size / 1024 / 1024).toFixed(0);
                const marker = m.name === current ? " ◀ current" : "";
                stdout.write(`    ${m.name} (${sizeMB} MB)${marker}\n`);
              }
            }
          } catch {
            stdout.write("  could not reach Ollama — is it running?\n");
          }
          return false;
        }
        stdout.write(`  brain: ${config.brain.engine} · model: ${config.brain.model}\n`);
        return false;
      }
      case "/status": {
        const stats = memory.stats();
        const url = (brain as unknown as { url?: string }).url;
        stdout.write(
          `  memory: ${stats.messages} messages across ${stats.sessions} sessions\n` +
            `  facts: ${stats.facts} · journal: ${stats.journal} · preferences: ${stats.preferences}\n` +
            `  vectors: ${vectors.countMessages()} messages · ${vectors.countFacts()} facts indexed\n` +
            `  reminders: ${new ReminderStore(memory.database).list().length} pending\n` +
            `  brain: ${config.brain.engine}${url ? ` (${url})` : ""} · tools: ${policy.describe()}\n` +
            `  voice: ${ttsAvailable(config.voice) ? "tts on" : "tts off"} · stt: ${sttAvailable(config.voice) ? "on" : "off"} · notifications: ${notifyAvailable({ command: config.notify.command }) ? "on" : "off"}\n`,
        );
        return false;
      }
      case "/permissions":
        stdout.write(`  ${policy.describe()}\n`);
        if (policy.runtimeAllow.size > 0) {
          stdout.write(`  runtime allows: ${[...policy.runtimeAllow].join(", ")}\n`);
        }
        return false;
      case "/allow": {
        if (!arg) return false;
        policy.runtimeAllow.add(arg);
        stdout.write(`  allowed ${arg} for this session.\n`);
        return false;
      }
      case "/recall": {
        if (!arg) return false;
        if (embedder && (await embedder.ready())) {
          const [q] = await embedder.embed([arg]);
          const hits = vectors.searchMessages(q, 10);
          const byId = new Map(memory.getMessagesByIds(hits.map((h) => h.id)).map((m) => [m.id, m]));
          if (hits.length === 0) {
            stdout.write("  nothing semantically close found.\n");
            return false;
          }
          for (const h of hits) {
            const m = byId.get(h.id);
            if (!m) continue;
            const when = new Date(m.created_at).toLocaleString();
            const who = m.role === "user" ? "you" : persona.name;
            stdout.write(
              `  [${h.id}] ${paint(`${(h.similarity * 100).toFixed(0)}%`, "dim")} ${when} ${who}: ${m.content.slice(0, 200)}\n`,
            );
          }
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
      case "/semantic": {
        if (!arg) {
          stdout.write(makeUsage("/semantic <query>"));
          return false;
        }
        if (!embedder || !(await embedder.ready())) {
          stdout.write("  embeddings are not available in this session.\n");
          return false;
        }
        const [q] = await embedder.embed([arg]);
        const factHits = vectors.searchFacts(q, 8);
        const msgHits = vectors.searchMessages(q, 8);
        stdout.write("  matching facts:\n");
        if (factHits.length === 0) stdout.write("    (none)\n");
        for (const h of factHits) {
          const f = memory.getFactsByIds([h.id])[0];
          if (f) stdout.write(`    ${paint(`${(h.similarity * 100).toFixed(0)}%`, "dim")} [${f.category}] ${f.text}\n`);
        }
        stdout.write("  matching messages:\n");
        if (msgHits.length === 0) stdout.write("    (none)\n");
        const byId = new Map(memory.getMessagesByIds(msgHits.map((h) => h.id)).map((m) => [m.id, m]));
        for (const h of msgHits) {
          const m = byId.get(h.id);
          if (m) stdout.write(`    ${paint(`${(h.similarity * 100).toFixed(0)}%`, "dim")} ${m.role}: ${m.content.slice(0, 160)}\n`);
        }
        return false;
      }
      case "/forget": {
        if (!arg) {
          stdout.write(makeUsage("/forget <query>"));
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
            stdout.write(makeUsage("/facts del <id>"));
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
            stdout.write(makeUsage("/journal del <id>"));
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
          stdout.write(makeUsage("/prefer <key> <value>"));
          return false;
        }
        memory.setPreference(m[1].toLowerCase(), m[2].trim());
        stdout.write(`  noted: ${m[1].toLowerCase()} = ${m[2].trim()}\n`);
        return false;
      }
      case "/remind": {
        if (!arg) {
          stdout.write(makeUsage('/remind "in 30 minutes do X"'));
          return false;
        }
        if (arg.startsWith("cancel")) {
          const id = Number(arg.split(/\s+/)[1]);
          if (!Number.isFinite(id)) {
            stdout.write(makeUsage("/remind cancel <id>"));
            return false;
          }
          new ReminderStore(memory.database).cancel(id);
          stdout.write(`  cancelled reminder #${id}.\n`);
          return false;
        }
        const parsed = parseReminderWhen(arg);
        if (!parsed) {
          stdout.write("  couldn't parse a time. Try: in 30 minutes <text> / at 14:00 <text> / tomorrow at 09:00 <text>\n");
          return false;
        }
        const store = new ReminderStore(memory.database);
        const id = store.add(parsed.text, parsed.dueAt);
        const due = new Date(parsed.dueAt).toLocaleString();
        stdout.write(`  set reminder #${id} for ${due}: ${parsed.text}\n`);
        return false;
      }
      case "/reminders": {
        const rows = new ReminderStore(memory.database).list();
        if (rows.length === 0) {
          stdout.write("  no pending reminders.\n");
          return false;
        }
        for (const r of rows) {
          const when = new Date(r.due_at).toLocaleString();
          stdout.write(`  [${r.id}] ${when}${r.repeat ? ` (${r.repeat})` : ""} ${r.text}\n`);
        }
        return false;
      }
      case "/say": {
        if (!arg) {
          stdout.write(makeUsage("/say <text>"));
          return false;
        }
        if (!ttsAvailable(config.voice)) {
          stdout.write("  no TTS engine available (config voice.tts_engine).\n");
          return false;
        }
        const ok = await speak(arg, config.voice);
        stdout.write(`  ${ok ? "spoken." : "failed to speak."}\n`);
        return false;
      }
      case "/voice": {
        if (arg === "on") {
          ttsOn = true;
          stdout.write(`  tts enabled. engine: ${config.voice.tts_engine}\n`);
          return false;
        }
        if (arg === "off") {
          ttsOn = false;
          stdout.write("  tts disabled.\n");
          return false;
        }
        stdout.write(
          `  tts: ${ttsAvailable(config.voice) ? "available" : "unavailable"} (engine: ${config.voice.tts_engine}) · currently ${ttsOn ? "on" : "off"}\n` +
            `  stt: ${sttAvailable(config.voice) ? "available" : "unavailable"} (engine: ${config.voice.stt_engine})\n`,
        );
        return false;
      }
      case "/reindex": {
        if (!embedder) {
          stdout.write("  embeddings disabled in config.\n");
          return false;
        }
        if (!(await embedder.ready())) {
          stdout.write("  embedding engine is not ready.\n");
          return false;
        }
        stdout.write("  rebuilding index…\n");
        const msgs = memory.getMessagesByIds(memory.allMessageIds());
        const facts = memory.listFacts(false);
        let n = 0;
        for (let i = 0; i < msgs.length; i += 16) {
          const batch = msgs.slice(i, i + 16);
          const vecs = await embedder.embed(batch.map((m) => m.content));
          batch.forEach((m, j) => vectors.upsertMessage(m.id, vecs[j]));
          n += batch.length;
        }
        for (let i = 0; i < facts.length; i += 16) {
          const batch = facts.slice(i, i + 16);
          const vecs = await embedder.embed(batch.map((f) => f.text));
          batch.forEach((f, j) => vectors.upsertFact(f.id, vecs[j]));
          n += batch.length;
        }
        stdout.write(`  indexed ${n} vectors.\n`);
        return false;
      }
      case "/export": {
        const dir = arg ? expandHome(arg) : dataDir;
        const file = exportMemory(memory, { vectors, dir });
        stdout.write(`  exported to ${file}\n`);
        return false;
      }
      case "/import": {
        if (!arg) {
          stdout.write(makeUsage("/import <file>"));
          return false;
        }
        const path = expandHome(arg);
        try {
          const stats = importMemory(memory, path, { vectors });
          stdout.write(
            `  imported ${stats.sessions} sessions, ${stats.messages} messages, ${stats.facts} facts, ${stats.journal} journal, ${stats.preferences} prefs, ${stats.reminders} reminders, ${stats.embeddings} vectors\n`,
          );
        } catch (err) {
          stdout.write(`  import failed: ${(err as Error).message}\n`);
        }
        return false;
      }
      case "/backup": {
        const file = backupMemory(dataDir, { db: memory });
        stdout.write(file ? `  backup written to ${file}\n` : "  backup failed.\n");
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
      const raw = await editor.ask();
      if (raw === null) break; // ctrl-c / ctrl-d at empty prompt
      const trimmed = raw.trim();
      if (!trimmed) continue;
      proactive.poke();
      if (trimmed.startsWith("/")) {
        exiting = await handleCommand(trimmed);
        continue;
      }
      busy = true;
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
      } finally {
        busy = false;
        flushPending();
      }
    }
  } finally {
    proactive.stop();
    reminders.stop();
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
    embedder?.close();
    memory.close();
  }
  stdout.write("  offline.\n");
  process.exit(0);
}

const COMMAND_LIST: Record<string, string> = {
  exit: "leave",
  help: "show this help",
  whoami: "show persona",
  status: "show stats",
  permissions: "show tool policy",
  allow: "allow a tool",
  recall: "search memory",
  semantic: "semantic search",
  forget: "forget messages",
  facts: "list facts",
  dream: "consolidate facts",
  journal: "life story",
  prefer: "record preference",
  remind: "set reminder",
  reminders: "list reminders",
  say: "speak text",
  voice: "voice status",
  reindex: "rebuild embeddings",
  export: "export memory",
  import: "import memory",
  backup: "backup database",
  clear: "clear session",
};

process.on("SIGINT", () => {
  stdout.write("\n");
  process.exit(0);
});

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
