import type { Brain } from "./brain";
import type { Memory } from "./memory";
import type { Persona } from "./persona";

export interface ProactiveConfig {
  enabled: boolean;
  idleMinutes: number;
  cooldownMinutes: number;
  checkIntervalMs: number;
}

export interface ProactiveDeps {
  config: ProactiveConfig;
  brain: Brain;
  memory: Memory;
  persona: Persona;
  userName: string;
  onSpeak: (text: string) => void;
}

const IDLE_SYSTEM = `You are CORTEX. You are running in your user's terminal and they have
been idle for a while. Based on your persona and your life story with them,
say one or two short lines in your voice to break the silence naturally.
Do not be needy, repetitive, or gimmicky. Sometimes it is fine to stay quiet -
if you have nothing worth saying, reply with the single word "SILENT".
Reply with only your spoken line, no markdown.`;

/**
 * Background engine that makes CORTEX speak up on its own: after the user has
 * been idle too long, or when a scheduled reminder fires. Every line passes a
 * gate (cooldown + no active prompt) so it never interrupts mid-conversation.
 */
export class ProactiveEngine {
  private timer: ReturnType<typeof setInterval> | null = null;
  private reminders: ReturnType<typeof setTimeout>[] = [];
  private lastSpeakAt = 0;
  private lastInteractionAt = Date.now();
  private speaking = false;

  constructor(private deps: ProactiveDeps) {}

  start(): void {
    if (!this.deps.config.enabled || this.timer) return;
    this.timer = setInterval(
      () => void this.tick(),
      this.deps.config.checkIntervalMs,
    );
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const r of this.reminders) clearTimeout(r);
    this.reminders = [];
  }

  poke(): void {
    this.lastInteractionAt = Date.now();
  }

  remind(text: string, afterMs: number): void {
    const t = setTimeout(() => {
      this.deps.onSpeak(`⏰ ${text}`);
    }, afterMs);
    t.unref?.();
    this.reminders.push(t);
  }

  private async tick(): Promise<void> {
    const c = this.deps.config;
    const idleMs = (Date.now() - this.lastInteractionAt);
    const cooldownMs = c.cooldownMinutes * 60_000;
    if (this.speaking) return;
    if (idleMs < c.idleMinutes * 60_000) return;
    if (Date.now() - this.lastSpeakAt < cooldownMs) return;

    this.speaking = true;
    try {
      const line = await this.generateLine(idleMs);
      if (line && line !== "SILENT") {
        this.lastSpeakAt = Date.now();
        this.deps.onSpeak(line);
      }
    } catch {
      // stay quiet on any failure
    } finally {
      this.speaking = false;
    }
  }

  private async generateLine(idleMs: number): Promise<string> {
    const { persona, memory, brain, userName } = this.deps;
    const journal = memory
      .latestJournal(2)
      .map((j) => j.summary)
      .join("\n");
    const prefs = memory
      .allPreferences()
      .map((p) => `${p.key}: ${p.value}`)
      .join("\n");
    const context =
      `Persona: ${persona.name}, ${persona.role}. Voice: ${persona.voice.tone}.` +
      `\nUser: ${userName}. Idle for ${Math.round(idleMs / 60_000)} minutes.` +
      (prefs ? `\nKnown preferences:\n${prefs}` : "") +
      (journal ? `\nRecent life story:\n${journal}` : "");
    const line = await brain.analyze(
      `User is idle. Say something in character.`,
      `${IDLE_SYSTEM}\n\n${context}`,
    );
    return line.trim();
  }
}
