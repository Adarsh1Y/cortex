import type { CortexConfig } from "./config";
import type { Memory } from "./memory";
import type { Persona } from "./persona";
import { buildSystemPrompt, type PromptContext } from "./persona";
import { buildRecallBlock, buildSemanticRecallBlock } from "./recall";
import type { Brain } from "./brain";
import type { Embedder } from "./embeddings";
import type { VectorStore } from "./vector";
import { consolidateFacts, extractDigest, factsToContext, journalToContext, type SessionDigest } from "./semantic";

export interface ConversationOptions {
  config: CortexConfig;
  memory: Memory;
  brain: Brain;
  persona: Persona;
  embedder?: Embedder;
  vectors?: VectorStore;
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
    let recallBlock = "";
    let factsBlock = "";

    if (config.memory.semantic_recall && this.opts.embedder && this.opts.vectors) {
      const semantic = await this.semanticRecall(text);
      recallBlock = semantic.recall;
      factsBlock = semantic.facts;
    }

    if (!recallBlock) {
      recallBlock = buildRecallBlock(memory, {
        recallMessages: config.memory.recall_messages,
        maxChars: config.memory.max_recall_chars,
        excludeSessionId: this.sessionId,
      });
    }
    if (!factsBlock && config.memory.semantic) {
      factsBlock = factsToContext(memory.searchFacts(text), config.memory.max_fact_chars);
    }
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

  /**
   * Semantic recall: embed the user's message and pull the most similar facts
   * and past messages. Falls back to keyword recall when the index is empty.
   */
  private async semanticRecall(text: string): Promise<{ recall: string; facts: string }> {
    const { embedder, vectors, memory, config } = this.opts;
    if (!embedder || !vectors) return { recall: "", facts: "" };
    try {
      const [q] = await embedder.embed([text]);
      const factHits = vectors.searchFacts(q, 8);
      const msgHits = vectors.searchMessages(
        q,
        config.memory.recall_messages,
        this.currentMessageIds(),
      );

      let facts = "";
      if (factHits.length > 0) {
        const factRows = memory
          .getFactsByIds(factHits.map((h) => h.id))
          .filter((f) => f.active)
          .sort((a, b) => {
            const ha = factHits.find((h) => h.id === a.id)!.similarity;
            const hb = factHits.find((h) => h.id === b.id)!.similarity;
            return hb - ha;
          });
        facts = factsToContext(factRows, config.memory.max_fact_chars);
      }

      let recall = "";
      if (msgHits.length > 0) {
        const byId = new Map(memory.getMessagesByIds(msgHits.map((h) => h.id)).map((m) => [m.id, m]));
        const ordered = msgHits
          .map((h) => byId.get(h.id))
          .filter((m): m is NonNullable<typeof m> => Boolean(m));
        recall = buildSemanticRecallBlock(ordered, config.memory.max_recall_chars);
      }
      return { recall, facts };
    } catch {
      return { recall: "", facts: "" };
    }
  }

  private currentMessageIds(): number[] {
    return this.opts.memory
      .getMessages(this.sessionId)
      .map((m) => m.id);
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
      const id = memory.addFact(fact.text, fact.category, this.sessionId);
      this.embedFact(id, fact.text);
      learned++;
    }
    if (digest.journal) {
      memory.addJournal(digest.journal, this.sessionId);
    }

    if (config.memory.embed_on_digest) {
      for (const m of messages) {
        this.embedMessage(m.id, m.content);
      }
    }

    const total = memory.stats().facts;
    if (total >= 25) {
      await consolidateFacts(brain, memory);
    }
    return digest;
  }

  private async embedFact(id: number, text: string): Promise<void> {
    const { embedder, vectors } = this.opts;
    if (!embedder || !vectors || !text.trim()) return;
    try {
      const [v] = await embedder.embed([text]);
      vectors.upsertFact(id, v);
    } catch {
      // embedding is best-effort
    }
  }

  private async embedMessage(id: number, content: string): Promise<void> {
    const { embedder, vectors } = this.opts;
    if (!embedder || !vectors || !content.trim()) return;
    try {
      const [v] = await embedder.embed([content]);
      vectors.upsertMessage(id, v);
    } catch {
      // embedding is best-effort
    }
  }
}
