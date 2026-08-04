import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { platform } from "node:os";

export interface VoiceConfig {
  tts_engine: "off" | "auto" | "espeak" | "edge-tts" | "command";
  tts_command?: string;
  stt_engine: "off" | "openai" | "command";
  stt_command?: string;
  openai_api_key?: string;
}

export interface DetectedTTS {
  kind: "espeak" | "edge-tts" | "command" | "say";
  binary: string;
}

export function detectTTS(config: VoiceConfig): DetectedTTS | null {
  if (config.tts_engine === "off") return null;
  if (config.tts_engine === "command") {
    return config.tts_command ? { kind: "command", binary: config.tts_command } : null;
  }
  if (config.tts_engine === "espeak") {
    const bin = pick(["espeak-ng", "espeak"]);
    return bin ? { kind: "espeak", binary: bin } : null;
  }
  if (config.tts_engine === "edge-tts") {
    return pick(["edge-tts"]) ? { kind: "edge-tts", binary: "edge-tts" } : null;
  }
  // auto
  if (pick(["espeak-ng"])) return { kind: "espeak", binary: "espeak-ng" };
  if (pick(["espeak"])) return { kind: "espeak", binary: "espeak" };
  if (pick(["edge-tts"])) return { kind: "edge-tts", binary: "edge-tts" };
  if (platform() === "darwin" && pick(["say"])) return { kind: "say", binary: "say" };
  return null;
}

export function ttsAvailable(config: VoiceConfig): boolean {
  return detectTTS(config) !== null;
}

/** Speak text aloud through the configured engine. Resolves false when unsupported. */
export async function speak(text: string, config: VoiceConfig): Promise<boolean> {
  const tts = detectTTS(config);
  if (!tts) return false;
  try {
    if (tts.kind === "espeak") {
      const proc = Bun.spawn([tts.binary, "-s", "160", text], {
        stdout: "ignore",
        stderr: "ignore",
      });
      await proc.exited;
      return proc.exitCode === 0;
    }
    if (tts.kind === "say") {
      const proc = Bun.spawn([tts.binary, text], { stdout: "ignore", stderr: "ignore" });
      await proc.exited;
      return proc.exitCode === 0;
    }
    if (tts.kind === "command") {
      const proc = Bun.spawn([tts.binary, text], { stdout: "ignore", stderr: "ignore" });
      await proc.exited;
      return proc.exitCode === 0;
    }
    if (tts.kind === "edge-tts") {
      const dir = mkdtempSync(join(tmpdir(), "cortex-tts-"));
      const out = join(dir, "speech.mp3");
      const gen = Bun.spawn(["edge-tts", "--text", text, "--write-media", out], {
        stdout: "ignore",
        stderr: "ignore",
      });
      await gen.exited;
      if (gen.exitCode !== 0) {
        rmSync(dir, { recursive: true, force: true });
        return false;
      }
      const played = await playAudio(out);
      rmSync(dir, { recursive: true, force: true });
      return played;
    }
    return false;
  } catch {
    return false;
  }
}

async function playAudio(path: string): Promise<boolean> {
  for (const player of ["ffplay", "aplay", "paplay", "afplay"]) {
    const bin = Bun.which(player);
    if (!bin) continue;
    const args = player === "ffplay" ? ["-nodisp", "-autoexit", "-loglevel", "quiet", path] : [path];
    const proc = Bun.spawn([bin, ...args], { stdout: "ignore", stderr: "ignore" });
    await proc.exited;
    return proc.exitCode === 0;
  }
  return false;
}

export function sttAvailable(config: VoiceConfig): boolean {
  if (config.stt_engine === "off") return false;
  if (config.stt_engine === "command") return Boolean(config.stt_command);
  if (config.stt_engine === "openai") return Boolean(config.openai_api_key || process.env.OPENAI_API_KEY);
  return false;
}

/** Transcribe an audio file to text. Resolves null on failure. */
export async function transcribe(
  audioPath: string,
  config: VoiceConfig,
): Promise<string | null> {
  if (config.stt_engine === "command" && config.stt_command) {
    const proc = Bun.spawn([config.stt_command, audioPath], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    return out.trim() || null;
  }
  if (config.stt_engine === "openai") {
    const key = config.openai_api_key || process.env.OPENAI_API_KEY;
    if (!key) return null;
    const file = Bun.file(audioPath);
    const form = new FormData();
    form.append("file", file, "audio.wav");
    form.append("model", "whisper-1");
    try {
      const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { authorization: `Bearer ${key}` },
        body: form,
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { text?: string };
      return data.text?.trim() ?? null;
    } catch {
      return null;
    }
  }
  return null;
}

function pick(binaries: string[]): string | null {
  for (const b of binaries) {
    try {
      if (Bun.which(b)) return b;
    } catch {
      // continue
    }
  }
  return null;
}
