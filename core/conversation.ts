import type { CortexConfig } from "./config";
import type { Memory } from "./memory";
import type { Persona } from "./persona";
import { buildSystemPrompt, type PromptContext } from "./persona";
import { buildRecallBlock } from "./recall";
import type { Brain } from "./brain";
import { consolidateFacts, extractDigest, factsToContext, journalToContext, type SessionDigest } from "./semantic";

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
    const factsBlock = config.memory.semantic
      ? factsToContext(memory.searchFacts(text), config.memory.max_fact_chars)
      : "";
    const journalBlock = config.memory.semantic
      ? journalToContext(memory.latestJournal(3))
      : "";

    const context: PromptContext = {
      persona,
      preferences,
      recallBlock,
      factsBlock,
      journalBlock,
    };
    const system = buildSystemPrompt(context);

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

  /**
   * End-of-session reflection: distill the conversation into durable facts and
   * a journal entry for CORTEX's life story. Best-effort; never throws.
   */
  async digest(): Promise<SessionDigest | null> {
    const { memory, brain, config } = this.opts;
    if (!config.memory.semantic) return null;

    const messages = memory.getMessages(this.sessionId);
    if (messages.length === 0) return null;

    const transcript = messages
      .map((m) => `${m.role === "user" ? "USER" : "CORTEX"}: ${m.content}`)
      .join("\n");

    const digest = await extractDigest(brain, transcript);
    let learned = 0;
    for (const fact of digest.facts) {
      memory.addFact(fact.text, fact.category, this.sessionId);
      learned++;
    }
    if (digest.journal) {
      memory.addJournal(digest.journal, this.sessionId);
    }

    const total = memory.stats().facts;
    if (total >= 25) {
      await consolidateFacts(brain, memory);
    }
    return digest;
  }
}
