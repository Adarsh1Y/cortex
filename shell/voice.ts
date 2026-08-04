import {
  createEmbedder,
  expandHome,
  loadConfig,
  loadPersona,
  Memory,
  resolvePersonaPath,
  VectorStore,
  speak,
  sttAvailable,
  ttsAvailable,
  transcribe,
  VoiceConfig,
} from "@cortex/core";
import { OpenCodeBrain } from "@cortex/core/brain";
import { ProactiveEngine } from "@cortex/core/proactive";
import { ReminderEngine } from "@cortex/core/reminders";
import { Conversation } from "@cortex/core";
import type { CortexConfig } from "@cortex/core";
import { mkdirSync, writeFileSync, appendFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";

const VOICE_DIR = join(expandHome("~/.consciousness"), "voice");
const VOICE_PID = join(VOICE_DIR, "voice.pid");
const VOICE_LOG = join(VOICE_DIR, "voice.log");

function log(msg: string): void {
  const ts = new Date().toISOString();
  appendFileSync(VOICE_LOG, `[${ts}] ${msg}\n`);
}

function writePidFile(): void {
  mkdirSync(VOICE_DIR, { recursive: true });
  writeFileSync(VOICE_PID, `${process.pid}\n`);
}

function removePidFile(): void {
  try { unlinkSync(VOICE_PID); } catch { /* already gone */ }
}

function resolveUserName(): string {
  return (
    process.env.CORTEX_USER ??
    process.env.USER ??
    process.env.LOGNAME ??
    "cortex"
  );
}

function recordAudio(durationMs: number, outPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = Bun.spawn([
      "ffmpeg",
      "-f", "alsa",
      "-i", "default",
      "-t", String(durationMs / 1000),
      "-ac", "1",
      "-ar", "16000",
      "-c:a", "pcm_s16le",
      "-y",
      outPath,
    ], { stdout: "ignore", stderr: "ignore" });
    proc.exited.then((code) => resolve(code === 0));
  });
}

async function voiceLoop(): Promise<void> {
  const config = loadConfig();
  if (!sttAvailable(config.voice)) {
    console.log("STT engine not configured — set voice.stt_engine in cortex.json");
    process.exit(1);
  }
  if (!ttsAvailable(config.voice)) {
    console.log("TTS engine not configured — set voice.tts_engine in cortex.json");
    process.exit(1);
  }

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
      log(`proactive speak: ${text}`);
      void speak(text, config.voice);
    },
  });
  proactive.start();

  const reminders = new ReminderEngine({
    database: memory.database,
    checkIntervalMs: config.reminders.check_interval_ms,
    onFire: (reminder) => {
      log(`reminder fired: ${reminder.text}`);
      void speak(`Reminder: ${reminder.text}`, config.voice);
    },
  });
  reminders.start();

  const convo = await Conversation.start({
    config,
    memory,
    brain,
    persona,
    embedder: embedder ?? undefined,
    vectors,
  });

  log("voice loop started");
  console.log("CORTEX voice mode — speak to interact. Press Ctrl+C to stop.");

  let running = true;
  const shutdown = (): void => {
    running = false;
    log("voice loop shutting down");
    proactive.stop();
    reminders.stop();
    embedder?.close();
    memory.close();
    brain.close();
    removePidFile();
    console.log("\nVoice mode stopped.");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  writePidFile();

  while (running) {
    const tmpWav = join(VOICE_DIR, `input-${Date.now()}.wav`);
    const listenDuration = 5000;

    const recorded = await recordAudio(listenDuration, tmpWav);
    if (!recorded) {
      log("recording failed, retrying...");
      continue;
    }

    const transcript = await transcribe(tmpWav, config.voice);
    try { unlinkSync(tmpWav); } catch { /* ignore */ }

    if (!transcript || transcript.trim().length === 0) {
      continue;
    }

    log(`heard: ${transcript}`);
    console.log(`\n  you: ${transcript}`);

    try {
      const reply = await convo.turn(transcript, (delta: string) => {
        process.stdout.write(delta);
      });
      console.log(`\n  CORTEX: ${reply}`);
      log(`replied: ${reply}`);
      void speak(reply, config.voice);
    } catch (e) {
      log(`error processing turn: ${(e as Error).message}`);
      console.log("  Sorry, something went wrong.");
    }
  }
}

if (import.meta.main) {
  void voiceLoop();
}