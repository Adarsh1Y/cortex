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

export interface MemoryStats {
  sessions: number;
  messages: number;
  preferences: number;
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

  stats(): MemoryStats {
    const sessions = this.db.query("SELECT COUNT(*) AS c FROM sessions").get() as { c: number };
    const messages = this.db.query("SELECT COUNT(*) AS c FROM messages").get() as { c: number };
    const preferences = this.db.query("SELECT COUNT(*) AS c FROM preferences").get() as { c: number };
    return { sessions: sessions.c, messages: messages.c, preferences: preferences.c };
  }

  close(): void {
    this.db.close();
  }
}

export interface PreferenceRow {
  key: string;
  value: string;
}
