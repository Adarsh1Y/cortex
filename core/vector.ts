import type { Database } from "bun:sqlite";

export function cosine(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export function float32ToBlob(v: Float32Array): Uint8Array {
  return new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
}

export function blobToFloat32(buf: Uint8Array): Float32Array {
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

export interface VectorHit {
  id: number;
  similarity: number;
}

interface VecRow {
  id: number;
  vector: Uint8Array;
}

/**
 * Embedding index for messages and facts, stored as float32 BLOBs in SQLite.
 * Queries scan the full index in-memory with cosine similarity — fine for a
 * personal memory store (tens of thousands of vectors at most).
 */
export class VectorStore {
  constructor(private db: Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS message_embeddings (
        message_id INTEGER PRIMARY KEY,
        vector BLOB NOT NULL,
        dim INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS fact_embeddings (
        fact_id INTEGER PRIMARY KEY,
        vector BLOB NOT NULL,
        dim INTEGER NOT NULL
      );
    `);
  }

  upsertMessage(messageId: number, vec: Float32Array): void {
    this.db
      .query(
        "INSERT INTO message_embeddings (message_id, vector, dim) VALUES (?, ?, ?) ON CONFLICT(message_id) DO UPDATE SET vector = excluded.vector, dim = excluded.dim",
      )
      .run(messageId, float32ToBlob(vec), vec.length);
  }

  upsertFact(factId: number, vec: Float32Array): void {
    this.db
      .query(
        "INSERT INTO fact_embeddings (fact_id, vector, dim) VALUES (?, ?, ?) ON CONFLICT(fact_id) DO UPDATE SET vector = excluded.vector, dim = excluded.dim",
      )
      .run(factId, float32ToBlob(vec), vec.length);
  }

  deleteMessage(messageId: number): void {
    this.db.query("DELETE FROM message_embeddings WHERE message_id = ?").run(messageId);
  }

  deleteFact(factId: number): void {
    this.db.query("DELETE FROM fact_embeddings WHERE fact_id = ?").run(factId);
  }

  removeMessages(ids: number[]): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => "?").join(",");
    this.db.query(`DELETE FROM message_embeddings WHERE message_id IN (${placeholders})`).run(...ids);
  }

  removeFacts(ids: number[]): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => "?").join(",");
    this.db.query(`DELETE FROM fact_embeddings WHERE fact_id IN (${placeholders})`).run(...ids);
  }

  searchMessages(vec: Float32Array, limit = 10, excludeIds: number[] = []): VectorHit[] {
    const excluded = new Set(excludeIds);
    const rows = this.db.query("SELECT message_id AS id, vector FROM message_embeddings").all() as VecRow[];
    return rank(rows, vec, limit, excluded);
  }

  searchFacts(vec: Float32Array, limit = 10, excludeIds: number[] = []): VectorHit[] {
    const excluded = new Set(excludeIds);
    const rows = this.db.query("SELECT fact_id AS id, vector FROM fact_embeddings").all() as VecRow[];
    return rank(rows, vec, limit, excluded);
  }

  countMessages(): number {
    return (this.db.query("SELECT COUNT(*) AS c FROM message_embeddings").get() as { c: number }).c;
  }

  countFacts(): number {
    return (this.db.query("SELECT COUNT(*) AS c FROM fact_embeddings").get() as { c: number }).c;
  }
}

function rank(rows: VecRow[], query: Float32Array, limit: number, excluded: Set<number>): VectorHit[] {
  const hits: VectorHit[] = [];
  for (const r of rows) {
    if (excluded.has(r.id)) continue;
    const sim = cosine(query, blobToFloat32(r.vector));
    if (sim <= 0) continue;
    hits.push({ id: r.id, similarity: sim });
  }
  hits.sort((a, b) => b.similarity - a.similarity);
  return hits.slice(0, limit);
}
