import type { Brain } from "./brain";
import type { Memory, FactRow, JournalRow } from "./memory";

export interface ExtractedFact {
  text: string;
  category: string;
}

export interface SessionDigest {
  facts: ExtractedFact[];
  journal: string;
}

const EXTRACT_SYSTEM = `You are the memory subsystem of CORTEX, a personal AI assistant.
From the conversation transcript below, extract:
1. facts - durable, reusable information worth remembering across sessions.
   Categories (choose exactly one per fact):
   - preference: how the user likes things done (names, tone, tools)
   - fact: durable info about the user or their world
   - decision: a choice made and its reason
   - error: something that failed and the lesson learned
   - people: about people in the user's life
   Write each fact as one concise, standalone sentence. Skip small talk and
   anything already obvious or temporary.
2. journal - 1-3 sentences in first person, from CORTEX's perspective, describing
   what happened in this session. This becomes part of CORTEX's life story.

Respond with ONLY valid JSON (no markdown, no commentary):
{"facts":[{"text":"...","category":"preference"}],"journal":"..."}`;

const CONSOLIDATE_SYSTEM = `You are the consolidation engine ("dream") for CORTEX's memory.
Below is the current set of stored facts. Merge duplicates, drop stale or
contradicted entries, keep important ones, and rewrite vague facts to be precise.
Return a NEW list where each item keeps or refreshes the original:
- keep the same "id" when you keep/refresh a fact
- when merging two facts into one, keep the id of the more recent one
- drop stale/unimportant facts by omitting them
Respond with ONLY valid JSON (no markdown, no commentary):
{"facts":[{"id":1,"text":"...","category":"preference"}]}`;

export function parseJsonObject(raw: string): Record<string, any> | null {
  const trimmed = raw.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  const candidate = trimmed.slice(start, end + 1);
  try {
    const parsed = JSON.parse(candidate);
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

export async function extractDigest(
  brain: Brain,
  transcript: string,
): Promise<SessionDigest> {
  try {
    const raw = await brain.analyze(transcript, EXTRACT_SYSTEM);
    const parsed = parseJsonObject(raw);
    if (!parsed) {
      return { facts: [], journal: "" };
    }
    const facts: ExtractedFact[] = Array.isArray(parsed.facts)
      ? parsed.facts
          .filter((f: any) => f && typeof f.text === "string" && f.text.trim())
          .map((f: any) => ({
            text: f.text.trim(),
            category: typeof f.category === "string" ? f.category : "fact",
          }))
      : [];
    const journal =
      typeof parsed.journal === "string" ? parsed.journal.trim() : "";
    return { facts, journal };
  } catch {
    return { facts: [], journal: "" };
  }
}

export interface ConsolidatedFact {
  id: number;
  text: string;
  category: string;
}

export async function consolidateFacts(
  brain: Brain,
  memory: Memory,
): Promise<{ kept: number; removed: number }> {
  const facts = memory.listFacts(true, 200);
  if (facts.length === 0) return { kept: 0, removed: 0 };

  const payload = facts
    .map((f) => `- id=${f.id} [${f.category}] ${f.text}`)
    .join("\n");

  let consolidated: ConsolidatedFact[] = [];
  try {
    const raw = await brain.analyze(payload, CONSOLIDATE_SYSTEM);
    const parsed = parseJsonObject(raw);
    if (parsed && Array.isArray(parsed.facts)) {
      consolidated = parsed.facts.filter(
        (f: any) =>
          f &&
          typeof f.id === "number" &&
          typeof f.text === "string" &&
          f.text.trim(),
      );
    }
  } catch {
    return { kept: 0, removed: 0 };
  }

  if (consolidated.length === 0) return { kept: 0, removed: 0 };

  const keepIds = new Set(consolidated.map((c) => c.id));
  let removed = 0;
  for (const f of facts) {
    if (!keepIds.has(f.id)) {
      memory.setFactActive(f.id, false);
      removed++;
    }
  }
  for (const c of consolidated) {
    const existing = facts.find((f) => f.id === c.id);
    if (existing && (existing.text !== c.text.trim() || existing.category !== c.category)) {
      memory.updateFact(c.id, c.text.trim(), c.category);
    }
  }
  return { kept: consolidated.length, removed };
}

export function factsToContext(facts: FactRow[], maxChars = 1500): string {
  if (facts.length === 0) return "";
  const lines = facts
    .slice(0, 12)
    .map((f) => `- [${f.category}] ${f.text}`);
  let block = lines.join("\n");
  if (block.length > maxChars) block = block.slice(0, maxChars) + "...";
  return block;
}

export function journalToContext(journal: JournalRow[], maxEntries = 3): string {
  if (journal.length === 0) return "";
  return journal
    .slice(0, maxEntries)
    .reverse()
    .map((j) => {
      const date = new Date(j.created_at).toISOString().slice(0, 10);
      return `[${date}] ${j.summary}`;
    })
    .join("\n");
}
