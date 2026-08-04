import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Memory } from "./memory";
import type { VectorStore } from "./vector";
import { ReminderStore } from "./reminders";
import { float32ToBlob, blobToFloat32 } from "./vector";

export interface ExportBundle {
  version: 1;
  exported_at: string;
  sessions: { id: string; title: string; created_at: number }[];
  messages: { id: number; session_id: string; role: string; content: string; created_at: number }[];
  preferences: { key: string; value: string; updated_at: number }[];
  facts: { id: number; category: string; text: string; source_session: string | null; created_at: number; updated_at: number; active: number }[];
  journal: { id: number; summary: string; session_id: string | null; created_at: number }[];
  reminders: { id: number; text: string; due_at: number; created_at: number; fired: number; repeat: string }[];
  embeddings?: {
    messages: [number, string][];
    facts: [number, string][];
  };
}

/** Build the export object without writing it to disk (used by the API). */
export function buildExportBundle(
  memory: Memory,
  opts: { vectors?: VectorStore } = {},
): ExportBundle {
  const reminders = new ReminderStore(memory.database);
  const bundle: ExportBundle = {
    version: 1,
    exported_at: new Date().toISOString(),
    sessions: memory.listSessions(1_000_000).map((s) => ({ id: s.id, title: s.title, created_at: s.created_at })),
    messages: memory.getMessagesByIds(memory.allMessageIds()),
    preferences: memory.allPreferences().map((p) => ({
      key: p.key,
      value: p.value,
      updated_at: memory.preferenceUpdatedAt(p.key),
    })),
    facts: memory.listFacts(false, 1_000_000).map((f) => ({
      id: f.id,
      category: f.category,
      text: f.text,
      source_session: f.source_session,
      created_at: f.created_at,
      updated_at: f.updated_at,
      active: f.active,
    })),
    journal: memory.latestJournal(1_000_000),
    reminders: reminders.list(false, 1_000_000),
  };

  if (opts.vectors) {
    const msgRows = memory.database.query("SELECT message_id AS id, vector FROM message_embeddings").all() as { id: number; vector: Uint8Array }[];
    const factRows = memory.database.query("SELECT fact_id AS id, vector FROM fact_embeddings").all() as { id: number; vector: Uint8Array }[];
    bundle.embeddings = {
      messages: msgRows.map((r) => [r.id, Buffer.from(r.vector).toString("base64")]),
      facts: factRows.map((r) => [r.id, Buffer.from(r.vector).toString("base64")]),
    };
  }

  return bundle;
}

/** Dump all memory (and optionally the vector index) to a JSON file. */
export function exportMemory(
  memory: Memory,
  opts: { vectors?: VectorStore; dir?: string } = {},
): string {
  const bundle = buildExportBundle(memory, opts);
  const dir = opts.dir ?? "";
  const file = join(dir, `cortex-export-${Date.now()}.json`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(bundle, null, 2));
  return resolve(file);
}

export interface ImportStats {
  sessions: number;
  messages: number;
  preferences: number;
  facts: number;
  journal: number;
  reminders: number;
  embeddings: number;
}

/** Merge a previously exported bundle back into memory. Returns counts added. */
export function importMemory(memory: Memory, file: string, opts: { vectors?: VectorStore } = {}): ImportStats {
  const raw = readFileSync(file, "utf8");
  const bundle = JSON.parse(raw) as ExportBundle;
  const stats: ImportStats = {
    sessions: 0,
    messages: 0,
    preferences: 0,
    facts: 0,
    journal: 0,
    reminders: 0,
    embeddings: 0,
  };

  const sessionMap = new Map<string, string>();
  for (const s of bundle.sessions ?? []) {
    const id = memory.createSession(s.title);
    sessionMap.set(s.id, id);
    memory.setSessionCreatedAt(id, s.created_at);
    stats.sessions++;
  }

  const messageIdMap = new Map<number, number>();
  for (const m of bundle.messages ?? []) {
    const newId = memory.addMessage(
      sessionMap.get(m.session_id) ?? m.session_id,
      m.role as "user" | "assistant",
      m.content,
    );
    memory.setMessageCreatedAt(newId, m.created_at);
    messageIdMap.set(m.id, newId);
    stats.messages++;
  }

  for (const p of bundle.preferences ?? []) {
    memory.setPreference(p.key, p.value);
    stats.preferences++;
  }

  const factIdMap = new Map<number, number>();
  for (const f of bundle.facts ?? []) {
    const id = memory.addFact(f.text, f.category, f.source_session ? (sessionMap.get(f.source_session) ?? f.source_session) : undefined);
    memory.setFactMeta(id, f.created_at, f.updated_at, f.active);
    factIdMap.set(f.id, id);
    stats.facts++;
  }

  for (const j of bundle.journal ?? []) {
    const id = memory.addJournal(j.summary, j.session_id ? (sessionMap.get(j.session_id) ?? j.session_id) : undefined);
    memory.setJournalCreatedAt(id, j.created_at);
    stats.journal++;
  }

  const reminders = new ReminderStore(memory.database);
  for (const r of bundle.reminders ?? []) {
    reminders.add(r.text, r.due_at, r.repeat);
    stats.reminders++;
  }

  if (opts.vectors && bundle.embeddings) {
    for (const [oldId, b64] of bundle.embeddings.messages) {
      const newId = messageIdMap.get(oldId);
      if (newId === undefined) continue;
      opts.vectors.upsertMessage(newId, blobToFloat32(new Uint8Array(Buffer.from(b64, "base64"))));
      stats.embeddings++;
    }
    for (const [oldId, b64] of bundle.embeddings.facts) {
      const newId = factIdMap.get(oldId);
      if (newId === undefined) continue;
      opts.vectors.upsertFact(newId, blobToFloat32(new Uint8Array(Buffer.from(b64, "base64"))));
      stats.embeddings++;
    }
  }

  return stats;
}

/** Snapshot the SQLite database to a timestamped backup file. */
export function backupMemory(dataDir: string, opts: { db?: Memory } = {}): string | null {
  const src = join(dataDir, "cortex.db");
  if (!existsSync(src)) return null;
  try {
    if (opts.db) opts.db.database.query("PRAGMA wal_checkpoint(TRUNCATE)").all();
  } catch {
    // checkpoint is best-effort
  }
  const file = join(dataDir, `backup-${Date.now()}.db`);
  writeFileSync(file, readFileSync(src));
  return resolve(file);
}
