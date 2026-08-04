import type { CortexConfig } from "./config";
import type { Memory } from "./memory";
import type { Persona } from "./persona";
import { buildSystemPrompt } from "./persona";
import { buildRecallBlock } from "./recall";
import type { Brain } from "./brain";

export interface ConversationOptions {
  config: CortexConfig;
  memory: Memory;
  brain: Brain;
  persona: Persona;
}

export class Conversation {
  readonly sessionId: string;
  readonly openCodeSessionId: string;

  private constructor(
    private opts: ConversationOptions,
    sessionId: string,
    openCodeSessionId: string,
  ) {
    this.sessionId = sessionId;
    this.openCodeSessionId = openCodeSessionId;
  }

  static async start(opts: ConversationOptions): Promise<Conversation> {
    const title = new Date().toISOString().slice(0, 16).replace("T", " ");
    const sessionId = opts.memory.createSession(title);
    const openCodeSessionId = await opts.brain.createSession(title);
    return new Conversation(opts, sessionId, openCodeSessionId);
  }

  async turn(text: string, onDelta?: (delta: string) => void): Promise<string> {
    const { memory, brain, config, persona } = this.opts;

    memory.addMessage(this.sessionId, "user", text);

    const preferences = memory.allPreferences();
    const recallBlock = buildRecallBlock(memory, {
      recallMessages: config.memory.recall_messages,
      maxChars: config.memory.max_recall_chars,
      excludeSessionId: this.sessionId,
    });
    const system = buildSystemPrompt(persona, preferences, recallBlock);

    const reply = await brain.prompt({
      sessionId: this.openCodeSessionId,
      text,
      system,
      onDelta,
    });

    memory.addMessage(this.sessionId, "assistant", reply);
    return reply;
  }

  async clear(): Promise<number> {
    return this.opts.memory.resetSession(this.sessionId);
  }
}
