import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { Database } from "bun:sqlite";

export type Role = "user" | "assistant";

export interface MessageRow {
  id: number;
  session_id: string;
  role: Role;
  content: string;
  created_at: number;
}

export interface SessionRow {
  id: string;
  title: string;
  created_at: number;
}

export interface FactRow {
  id: number;
  category: string;
  text: string;
  source_session: string | null;
  created_at: number;
  updated_at: number;
  active: number;
}

export interface JournalRow {
  id: number;
  summary: string;
  session_id: string | null;
  created_at: number;
}

export interface MemoryStats {
  sessions: number;
  messages: number;
  preferences: number;
  facts: number;
  journal: number;
}

export class Memory {
  private db: Database;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new Database(resolve(dataDir, "cortex.db"));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id);
      CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
      CREATE TABLE IF NOT EXISTS preferences (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS facts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL DEFAULT 'fact',
        text TEXT NOT NULL,
        source_session TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        active INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS idx_facts_category ON facts(category);
      CREATE INDEX IF NOT EXISTS idx_facts_active ON facts(active);
      CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts USING fts5(fact_id, text, tokenize='porter');
      CREATE TABLE IF NOT EXISTS journal (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        summary TEXT NOT NULL,
        session_id TEXT,
        created_at INTEGER NOT NULL
      );
    `);
  }

  createSession(title: string): string {
    const id = crypto.randomUUID();
    this.db
      .query(
        "INSERT INTO sessions (id, title, created_at) VALUES (?, ?, ?)",
      )
      .run(id, title, Date.now());
    return id;
  }

  addMessage(sessionId: string, role: Role, content: string): number {
    const res = this.db
      .query(
        "INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(sessionId, role, content, Date.now());
    return Number(res.lastInsertRowid);
  }

  listSessions(limit = 100): SessionRow[] {
    return this.db
      .query("SELECT * FROM sessions ORDER BY created_at DESC LIMIT ?")
      .all(limit) as SessionRow[];
  }

  countMessages(sessionId: string): number {
    const row = this.db
      .query("SELECT COUNT(*) AS c FROM messages WHERE session_id = ?")
      .get(sessionId) as { c: number };
    return row.c;
  }

  getMessages(sessionId: string, limit?: number): MessageRow[] {
    if (limit !== undefined) {
      return this.db
        .query(
          "SELECT * FROM (SELECT * FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id ASC",
        )
        .all(sessionId, limit) as MessageRow[];
    }
    return this.db
      .query("SELECT * FROM messages WHERE session_id = ? ORDER BY id ASC")
      .all(sessionId) as MessageRow[];
  }

  recentMessages(limit: number, excludeSessionId?: string): MessageRow[] {
    if (excludeSessionId !== undefined) {
      return this.db
        .query(
          "SELECT * FROM (SELECT * FROM messages WHERE session_id != ? ORDER BY id DESC LIMIT ?) ORDER BY id ASC",
        )
        .all(excludeSessionId, limit) as MessageRow[];
    }
    return this.db
      .query("SELECT * FROM (SELECT * FROM messages ORDER BY id DESC LIMIT ?) ORDER BY id ASC")
      .all(limit) as MessageRow[];
  }

  searchMessages(query: string, limit = 10): MessageRow[] {
    return this.db
      .query(
        "SELECT * FROM messages WHERE content LIKE ? ORDER BY id DESC LIMIT ?",
      )
      .all(`%${query}%`, limit) as MessageRow[];
  }

  deleteMessages(ids: number[]): number {
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => "?").join(",");
    const res = this.db
      .query(`DELETE FROM messages WHERE id IN (${placeholders})`)
      .run(...ids);
    return Number(res.changes);
  }

  resetSession(sessionId: string): number {
    const res = this.db
      .query("DELETE FROM messages WHERE session_id = ?")
      .run(sessionId);
    return Number(res.changes);
  }

  allPreferences(): PreferenceRow[] {
    return this.db
      .query("SELECT key, value FROM preferences ORDER BY key ASC")
      .all() as PreferenceRow[];
  }

  setPreference(key: string, value: string): void {
    this.db
      .query(
        "INSERT INTO preferences (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      )
      .run(key, value, Date.now());
  }

  // ---------- facts (semantic memory) ----------

  addFact(text: string, category = "fact", sourceSession?: string): number {
    const now = Date.now();
    const res = this.db
      .query(
        "INSERT INTO facts (category, text, source_session, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(category, text, sourceSession ?? null, now, now);
    const id = Number(res.lastInsertRowid);
    this.db.query("INSERT INTO facts_fts (fact_id, text) VALUES (?, ?)").run(id, text);
    return id;
  }

  updateFact(id: number, text: string, category?: string): void {
    const now = Date.now();
    if (category) {
      this.db
        .query("UPDATE facts SET text = ?, category = ?, updated_at = ? WHERE id = ?")
        .run(text, category, now, id);
    } else {
      this.db
        .query("UPDATE facts SET text = ?, updated_at = ? WHERE id = ?")
        .run(text, now, id);
    }
    this.db.query("UPDATE facts_fts SET text = ? WHERE fact_id = ?").run(text, id);
  }

  setFactActive(id: number, active: boolean): void {
    this.db
      .query("UPDATE facts SET active = ?, updated_at = ? WHERE id = ?")
      .run(active ? 1 : 0, Date.now(), id);
  }

  deleteFact(id: number): void {
    this.db.query("DELETE FROM facts_fts WHERE fact_id = ?").run(id);
    this.db.query("DELETE FROM facts WHERE id = ?").run(id);
  }

  listFacts(activeOnly = true, limit = 200): FactRow[] {
    const where = activeOnly ? "WHERE active = 1" : "";
    return this.db
      .query(`SELECT * FROM facts ${where} ORDER BY updated_at DESC LIMIT ?`)
      .all(limit) as FactRow[];
  }

  searchFacts(query: string, limit = 5): FactRow[] {
    const words = (query.match(/[a-zA-Z0-9_]{2,}/g) ?? []).slice(0, 8);
    if (words.length === 0) return this.listFacts(true, limit);
    try {
      const rows = this.db
        .query(
          `SELECT f.id, f.category, f.text, f.source_session, f.created_at, f.updated_at, f.active
           FROM facts_fts JOIN facts f ON f.id = facts_fts.fact_id
           WHERE facts_fts MATCH ? AND f.active = 1
           ORDER BY rank LIMIT ?`,
        )
        .all(words.join(" OR "), limit) as FactRow[];
      if (rows.length > 0) return rows;
    } catch {
      // FTS query rejected; fall through to a LIKE scan
    }
    return this.db
      .query(
        "SELECT * FROM facts WHERE active = 1 AND text LIKE ? ORDER BY updated_at DESC LIMIT ?",
      )
      .all(`%${words[0]}%`, limit) as FactRow[];
  }

  // ---------- journal (life story / self-model) ----------

  addJournal(summary: string, sessionId?: string): number {
    const res = this.db
      .query(
        "INSERT INTO journal (summary, session_id, created_at) VALUES (?, ?, ?)",
      )
      .run(summary, sessionId ?? null, Date.now());
    return Number(res.lastInsertRowid);
  }

  latestJournal(limit = 5): JournalRow[] {
    return this.db
      .query("SELECT * FROM journal ORDER BY id DESC LIMIT ?")
      .all(limit) as JournalRow[];
  }

  deleteJournal(id: number): void {
    this.db.query("DELETE FROM journal WHERE id = ?").run(id);
  }

  stats(): MemoryStats {
    const count = (t: string) =>
      (this.db.query(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number }).c;
    return {
      sessions: count("sessions"),
      messages: count("messages"),
      preferences: count("preferences"),
      facts: count("facts"),
      journal: count("journal"),
    };
  }

  close(): void {
    this.db.close();
  }
}

export interface PreferenceRow {
  key: string;
  value: string;
}
