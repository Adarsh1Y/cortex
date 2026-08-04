import type { Database } from "bun:sqlite";

export interface ReminderRow {
  id: number;
  text: string;
  due_at: number;
  created_at: number;
  fired: number;
  repeat: string;
}

export interface ReminderDeps {
  database: Database;
  /** Called when a reminder comes due. */
  onFire: (reminder: ReminderRow) => void;
  checkIntervalMs?: number;
}

const UNIT_MS: Record<string, number> = {
  second: 1000,
  sec: 1000,
  s: 1000,
  minute: 60_000,
  min: 60_000,
  m: 60_000,
  hour: 3_600_000,
  hr: 3_600_000,
  h: 3_600_000,
  day: 86_400_000,
  d: 86_400_000,
  week: 604_800_000,
  w: 604_800_000,
};

const REPEAT_MS: Record<string, number> = {
  hourly: 3_600_000,
  daily: 86_400_000,
  weekly: 604_800_000,
};

/**
 * Parse natural-language scheduling prefixes into a due timestamp.
 * Supports: "in 30 minutes", "at 14:30", "tomorrow at 09:00", ISO timestamps.
 * Returns null when no time expression is found.
 */
export function parseReminderWhen(input: string): { dueAt: number; text: string } | null {
  const trimmed = input.trim();

  const iso = trimmed.match(/^(\d{4}-\d{2}-\d{2}[T ][0-9:.]+)/);
  if (iso) {
    const dueAt = new Date(iso[1].replace(" ", "T")).getTime();
    if (!Number.isNaN(dueAt)) {
      return { dueAt, text: trimmed.slice(iso[1].length).trim() };
    }
  }

  const inMatch = trimmed.match(/^in\s+(\d+)\s*(second|sec|s|minute|min|m|hour|hr|h|day|d|week|w)s?\b/i);
  if (inMatch) {
    const n = Number(inMatch[1]);
    const unit = inMatch[2].toLowerCase();
    const dueAt = Date.now() + n * UNIT_MS[unit];
    return { dueAt, text: trimmed.slice(inMatch[0].length).trim() };
  }

  const tomorrow = trimmed.match(/^tomorrow\s+(?:at\s+)?(\d{1,2}):(\d{2})\b/);
  if (tomorrow) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(Number(tomorrow[1]), Number(tomorrow[2]), 0, 0);
    return { dueAt: d.getTime(), text: trimmed.slice(tomorrow[0].length).trim() };
  }

  const at = trimmed.match(/^at\s+(\d{1,2}):(\d{2})\b/);
  if (at) {
    const d = new Date();
    d.setHours(Number(at[1]), Number(at[2]), 0, 0);
    let dueAt = d.getTime();
    if (dueAt <= Date.now()) dueAt += 86_400_000; // past today -> tomorrow
    return { dueAt, text: trimmed.slice(at[0].length).trim() };
  }

  return null;
}

export class ReminderStore {
  constructor(private db: Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS reminders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        text TEXT NOT NULL,
        due_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        fired INTEGER NOT NULL DEFAULT 0,
        repeat TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(fired, due_at);
    `);
  }

  add(text: string, dueAt: number, repeat = ""): number {
    const res = this.db
      .query(
        "INSERT INTO reminders (text, due_at, created_at, repeat) VALUES (?, ?, ?, ?)",
      )
      .run(text, dueAt, Date.now(), repeat);
    return Number(res.lastInsertRowid);
  }

  /** Reminders that are due right now and have not fired. */
  due(now = Date.now()): ReminderRow[] {
    return this.db
      .query("SELECT * FROM reminders WHERE fired = 0 AND due_at <= ? ORDER BY due_at ASC")
      .all(now) as ReminderRow[];
  }

  list(activeOnly = true, limit = 100): ReminderRow[] {
    const where = activeOnly ? "WHERE fired = 0" : "";
    return this.db
      .query(`SELECT * FROM reminders ${where} ORDER BY due_at ASC LIMIT ?`)
      .all(limit) as ReminderRow[];
  }

  markFired(id: number): void {
    this.db.query("UPDATE reminders SET fired = 1 WHERE id = ?").run(id);
  }

  cancel(id: number): void {
    this.db.query("DELETE FROM reminders WHERE id = ?").run(id);
  }

  /** Fire a reminder: mark fired, or reschedule repeating ones. */
  fire(row: ReminderRow): void {
    if (row.repeat && REPEAT_MS[row.repeat]) {
      this.db
        .query("UPDATE reminders SET due_at = ? WHERE id = ?")
        .run(Date.now() + REPEAT_MS[row.repeat], row.id);
    } else {
      this.markFired(row.id);
    }
  }
}

/**
 * Background scheduler that polls the store and fires due reminders. Survives
 * restarts because state lives in SQLite. Each fired reminder also creates a
 * journal entry so CORTEX remembers doing it.
 */
export class ReminderEngine {
  private timer: ReturnType<typeof setInterval> | null = null;
  private store: ReminderStore;
  private checkIntervalMs: number;
  private firing = false;

  constructor(
    private deps: ReminderDeps,
  ) {
    this.store = new ReminderStore(deps.database);
    this.checkIntervalMs = deps.checkIntervalMs ?? 15_000;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.checkIntervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get store_(): ReminderStore {
    return this.store;
  }

  private async tick(): Promise<void> {
    if (this.firing) return;
    this.firing = true;
    try {
      const due = this.store.due();
      for (const row of due) {
        this.store.fire(row);
        try {
          this.deps.onFire(row);
        } catch {
          // keep scheduler alive on handler failure
        }
      }
    } finally {
      this.firing = false;
    }
  }
}
