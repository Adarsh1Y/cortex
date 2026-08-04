import {
  createEmbedder,
  expandHome,
  loadConfig,
  loadPersona,
  Memory,
  resolvePersonaPath,
  VectorStore,
} from "@cortex/core";
import { ProactiveEngine } from "@cortex/core/proactive";
import { ReminderEngine } from "@cortex/core/reminders";
import { OpenCodeBrain } from "@cortex/core/brain";
import { startWebServer } from "./web";
import type { CortexConfig } from "@cortex/core";
import { mkdirSync, writeFileSync, appendFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

function pidPath(): string {
  return join(expandHome("~/.consciousness"), "daemon.pid");
}

function logPath(): string {
  return join(expandHome("~/.consciousness"), "daemon.log");
}

function log(msg: string): void {
  const ts = new Date().toISOString();
  appendFileSync(logPath(), `[${ts}] ${msg}\n`);
}

function writePidFile(): void {
  const dir = join(expandHome("~/.consciousness"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(pidPath(), `${process.pid}\n`);
}

function removePidFile(): void {
  try { unlinkSync(pidPath()); } catch { /* already gone */ }
}

function resolveUserName(): string {
  return (
    process.env.CORTEX_USER ??
    process.env.USER ??
    process.env.LOGNAME ??
    "cortex"
  );
}

async function main(): Promise<void> {
  const config = loadConfig();
  const dataDir = expandHome(config.data_dir);
  mkdirSync(dataDir, { recursive: true });

  const memory = new Memory(dataDir);
  const vectors = new VectorStore(memory.database);
  const embedder = config.embeddings.enabled ? createEmbedder({ config }) : null;
  if (embedder) {
    void embedder.ready().then((ok) => {
      if (!ok) log("embeddings unavailable — falling back to keyword recall");
    });
  }

  const brain = await OpenCodeBrain.connect({ timeoutMs: config.brain.server_timeout_ms });
  const persona = loadPersona(resolvePersonaPath(config));
  const userName = resolveUserName();

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
      log(`proactive: ${text}`);
    },
  });
  proactive.start();

  const reminders = new ReminderEngine({
    database: memory.database,
    checkIntervalMs: config.reminders.check_interval_ms,
    onFire: (reminder) => {
      log(`reminder fired: ${reminder.text}`);
    },
  });
  reminders.start();

  const server = startWebServer(config, memory, dataDir, {
    vectors,
    embedder: embedder ?? undefined,
  });

  const shutdown = (): void => {
    log("shutdown signal received");
    proactive.stop();
    reminders.stop();
    embedder?.close();
    memory.close();
    server.close();
    brain.close();
    removePidFile();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  writePidFile();
  log(`daemon started — pid ${process.pid}, web on :${server.port}`);
  console.log(`CORTEX daemon running (pid ${process.pid})`);
  console.log(`  dashboard: http://127.0.0.1:${server.port}`);
  console.log(`  log: ${logPath()}`);
}

if (import.meta.main) {
  void main();
}