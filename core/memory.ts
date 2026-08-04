import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { Database } from "bun:sqlite";
import { createCipherFromKey, type Cipher } from "./crypto";

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
  expires_at: number | null;
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

export interface MemoryHooks {
  onMessagesDeleted?: (ids: number[]) => void;
  onSessionReset?: (sessionId: string) => void;
  onFactDeleted?: (id: number) => void;
}

export interface MemoryOptions {
  key?: Buffer;
  hooks?: MemoryHooks;
}

export class Memory {
  private db: Database;
  private cipher: Cipher | null;
  private hooks: MemoryHooks;

  constructor(dataDir: string, opts: MemoryOptions = {}) {
    this.cipher = opts.key ? createCipherFromKey(opts.key) : null;
    this.hooks = opts.hooks ?? {};
    mkdirSync(dataDir, { recursive: true });
    this.db = new Database(resolve(dataDir, "cortex.db"));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        compressed_summary TEXT
      );
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        summarized INTEGER NOT NULL DEFAULT 0
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
        active INTEGER NOT NULL DEFAULT 1,
        expires_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_facts_category ON facts(category);
      CREATE INDEX IF NOT EXISTS idx_facts_active ON facts(active);
      CREATE INDEX IF NOT EXISTS idx_facts_expires ON facts(expires_at);
      CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts USING fts5(fact_id, text, tokenize='porter');
      CREATE TABLE IF NOT EXISTS journal (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        summary TEXT NOT NULL,
        session_id TEXT,
        created_at INTEGER NOT NULL
      );
    `);
  }

  get database(): Database {
    return this.db;
  }

  get encrypted(): boolean {
    return this.cipher !== null;
  }

  private enc(v: string): string {
    return this.cipher ? this.cipher.encrypt(v) : v;
  }

  private dec(v: string): string {
    return this.cipher ? this.cipher.decrypt(v) : v;
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
      .run(sessionId, role, this.enc(content), Date.now());
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
    let rows: MessageRow[];
    if (limit !== undefined) {
      rows = this.db
        .query(
          "SELECT * FROM (SELECT * FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id ASC",
        )
        .all(sessionId, limit) as MessageRow[];
    } else {
      rows = this.db
        .query("SELECT * FROM messages WHERE session_id = ? ORDER BY id ASC")
        .all(sessionId) as MessageRow[];
    }
    return rows.map((m) => ({ ...m, content: this.dec(m.content) }));
  }

  recentMessages(limit: number, excludeSessionId?: string): MessageRow[] {
    let rows: MessageRow[];
    if (excludeSessionId !== undefined) {
      rows = this.db
        .query(
          "SELECT * FROM (SELECT * FROM messages WHERE session_id != ? ORDER BY id DESC LIMIT ?) ORDER BY id ASC",
        )
        .all(excludeSessionId, limit) as MessageRow[];
    } else {
      rows = this.db
        .query("SELECT * FROM (SELECT * FROM messages ORDER BY id DESC LIMIT ?) ORDER BY id ASC")
        .all(limit) as MessageRow[];
    }
    return rows.map((m) => ({ ...m, content: this.dec(m.content) }));
  }

  getMessagesByIds(ids: number[]): MessageRow[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(",");
    const rows = this.db
      .query(`SELECT * FROM messages WHERE id IN (${placeholders})`)
      .all(...ids) as MessageRow[];
    return rows.map((m) => ({ ...m, content: this.dec(m.content) }));
  }

  allMessageIds(): number[] {
    return (this.db.query("SELECT id FROM messages ORDER BY id ASC").all() as { id: number }[]).map(
      (r) => r.id,
    );
  }

  setSessionCreatedAt(id: string, ts: number): void {
    this.db.query("UPDATE sessions SET created_at = ? WHERE id = ?").run(ts, id);
  }

  setMessageCreatedAt(id: number, ts: number): void {
    this.db.query("UPDATE messages SET created_at = ? WHERE id = ?").run(ts, id);
  }

  setFactMeta(id: number, created: number, updated: number, active: number): void {
    this.db.query("UPDATE facts SET created_at = ?, updated_at = ?, active = ? WHERE id = ?").run(created, updated, active, id);
  }

  setJournalCreatedAt(id: number, ts: number): void {
    this.db.query("UPDATE journal SET created_at = ? WHERE id = ?").run(ts, id);
  }

  preferenceUpdatedAt(key: string): number {
    const row = this.db.query("SELECT updated_at FROM preferences WHERE key = ?").get(key) as { updated_at: number } | null;
    return row?.updated_at ?? 0;
  }

  getFactsByIds(ids: number[]): FactRow[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(",");
    const rows = this.db
      .query(`SELECT * FROM facts WHERE id IN (${placeholders})`)
      .all(...ids) as FactRow[];
    return rows.map((f) => ({ ...f, text: this.dec(f.text) }));
  }

  searchMessages(query: string, limit = 10): MessageRow[] {
    if (this.cipher) {
      const rows = this.db
        .query("SELECT * FROM messages ORDER BY id DESC")
        .all() as MessageRow[];
      const out: MessageRow[] = [];
      for (const m of rows) {
        if (out.length >= limit) break;
        const content = this.dec(m.content);
        if (content.includes(query)) out.push({ ...m, content });
      }
      return out;
    }
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
    this.hooks.onMessagesDeleted?.(ids);
    return Number(res.changes);
  }

  resetSession(sessionId: string): number {
    const rows = this.db
      .query("SELECT id FROM messages WHERE session_id = ?")
      .all(sessionId) as { id: number }[];
    const res = this.db
      .query("DELETE FROM messages WHERE session_id = ?")
      .run(sessionId);
    this.hooks.onSessionReset?.(sessionId);
    if (rows.length > 0) {
      this.hooks.onMessagesDeleted?.(rows.map((r) => r.id));
    }
    return Number(res.changes);
  }

  allPreferences(): PreferenceRow[] {
    return (
      this.db
        .query("SELECT key, value FROM preferences ORDER BY key ASC")
        .all() as PreferenceRow[]
    ).map((p) => ({ ...p, value: this.dec(p.value) }));
  }

  setPreference(key: string, value: string): void {
    this.db
      .query(
        "INSERT INTO preferences (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      )
      .run(key, this.enc(value), Date.now());
  }

  // ---------- facts (semantic memory) ----------

  addFact(text: string, category = "fact", sourceSession?: string, expiresAt?: number): number {
    const now = Date.now();
    const stored = this.enc(text);
    const res = this.db
      .query(
        "INSERT INTO facts (category, text, source_session, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(category, stored, sourceSession ?? null, now, now, expiresAt ?? null);
    const id = Number(res.lastInsertRowid);
    if (!this.cipher) {
      this.db.query("INSERT INTO facts_fts (fact_id, text) VALUES (?, ?)").run(id, stored);
    }
    return id;
  }

  updateFact(id: number, text: string, category?: string): void {
    const now = Date.now();
    const stored = this.enc(text);
    if (category) {
      this.db
        .query("UPDATE facts SET text = ?, category = ?, updated_at = ? WHERE id = ?")
        .run(stored, category, now, id);
    } else {
      this.db
        .query("UPDATE facts SET text = ?, updated_at = ? WHERE id = ?")
        .run(stored, now, id);
    }
    if (!this.cipher) {
      this.db.query("UPDATE facts_fts SET text = ? WHERE fact_id = ?").run(stored, id);
    }
  }

  setFactActive(id: number, active: boolean): void {
    this.db
      .query("UPDATE facts SET active = ?, updated_at = ? WHERE id = ?")
      .run(active ? 1 : 0, Date.now(), id);
  }

  deleteFact(id: number): void {
    this.db.query("DELETE FROM facts_fts WHERE fact_id = ?").run(id);
    this.db.query("DELETE FROM facts WHERE id = ?").run(id);
    this.hooks.onFactDeleted?.(id);
  }

  listFacts(activeOnly = true, limit = 200): FactRow[] {
    const where = activeOnly ? "WHERE active = 1" : "";
    const rows = this.db
      .query(`SELECT * FROM facts ${where} ORDER BY updated_at DESC LIMIT ?`)
      .all(limit) as FactRow[];
    return rows.map((f) => ({ ...f, text: this.dec(f.text) }));
  }

  searchFacts(query: string, limit = 5): FactRow[] {
    if (this.cipher) {
      const rows = this.db
        .query("SELECT * FROM facts WHERE active = 1 ORDER BY updated_at DESC")
        .all() as FactRow[];
      const out: FactRow[] = [];
      for (const f of rows) {
        if (out.length >= limit) break;
        const text = this.dec(f.text);
        if (text.toLowerCase().includes(query.toLowerCase())) {
          out.push({ ...f, text });
        }
      }
      return out;
    }
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
      .run(this.enc(summary), sessionId ?? null, Date.now());
    return Number(res.lastInsertRowid);
  }

  latestJournal(limit = 5): JournalRow[] {
    const rows = this.db
      .query("SELECT * FROM journal ORDER BY id DESC LIMIT ?")
      .all(limit) as JournalRow[];
    return rows.map((j) => ({ ...j, summary: this.dec(j.summary) }));
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

  /** Compress old messages in a session into a summary. */
  compressSession(sessionId: string, summary: string): number {
    const res = this.db
      .query("UPDATE messages SET summarized = 1 WHERE session_id = ?")
      .run(sessionId);
    this.db
      .query("UPDATE sessions SET compressed_summary = ? WHERE id = ?")
      .run(summary, sessionId);
    return Number(res.changes);
  }

  /** Get sessions that are candidates for compression (older than threshold, not yet compressed). */
  getCompressibleSessions(olderThanMs: number, limit = 10): SessionRow[] {
    const threshold = Date.now() - olderThanMs;
    return this.db
      .query(
        "SELECT id, title, created_at FROM sessions WHERE created_at < ? AND (compressed_summary IS NULL OR compressed_summary = '') ORDER BY created_at ASC LIMIT ?",
      )
      .all(threshold, limit) as SessionRow[];
  }

  /** Get messages for a session that haven't been summarized yet. */
  getUnsummarizedMessages(sessionId: string): MessageRow[] {
    return this.db
      .query(
        "SELECT * FROM messages WHERE session_id = ? AND summarized = 0 ORDER BY id ASC",
      )
      .all(sessionId) as MessageRow[];
  }

  /** Set fact expiration (TTL). Pass null to remove expiration. */
  setFactExpiresAt(id: number, expiresAt: number | null): void {
    this.db
      .query("UPDATE facts SET expires_at = ?, updated_at = ? WHERE id = ?")
      .run(expiresAt, Date.now(), id);
  }

  /** Remove expired facts (deactivate them). Returns count of deactivated facts. */
  cleanupExpiredFacts(): number {
    const now = Date.now();
    const res = this.db
      .query(
        "UPDATE facts SET active = 0, updated_at = ? WHERE expires_at IS NOT NULL AND expires_at < ? AND active = 1",
      )
      .run(now, now);
    return Number(res.changes);
  }

  /** Get all active facts with expiration info. */
  getExpiringFacts(limit = 100): FactRow[] {
    const rows = this.db
      .query(
        "SELECT * FROM facts WHERE active = 1 AND expires_at IS NOT NULL ORDER BY expires_at ASC LIMIT ?",
      )
      .all(limit) as FactRow[];
    return rows.map((f) => ({ ...f, text: this.dec(f.text) }));
  }

  close(): void {
    this.db.close();
  }
}

export interface PreferenceRow {
  key: string;
  value: string;
}
