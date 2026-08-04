import type { CortexConfig } from "./config";

export interface Embedder {
  readonly name: string;
  readonly dim: number;
  /** Embed one or many texts. Resolves to row-major Float32 vectors. */
  embed(texts: string[]): Promise<Float32Array[]>;
  /** True once the backend is ready to serve embeddings. */
  ready(): Promise<boolean>;
  close(): void;
}

/** Deterministic pseudo-embedder for tests and offline fallback tooling. */
export class MockEmbedder implements Embedder {
  readonly name = "mock";
  readonly dim: number;
  private counter = 0;

  constructor(dim = 384) {
    this.dim = dim;
  }

  embed(texts: string[]): Promise<Float32Array[]> {
    const rows = texts.map((t) => {
      const v = new Float32Array(this.dim);
      const seed = this.hash(t);
      let x = seed;
      for (let i = 0; i < this.dim; i++) {
        x = (x * 1103515245 + 12345) & 0x7fffffff;
        v[i] = (x / 0x7fffffff) * 2 - 1;
      }
      this.normalize(v);
      this.counter++;
      return v;
    });
    return Promise.resolve(rows);
  }

  ready(): Promise<boolean> {
    return Promise.resolve(true);
  }

  close(): void {}

  private hash(s: string): number {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  private normalize(v: Float32Array): void {
    let sum = 0;
    for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
    const norm = Math.sqrt(sum) || 1;
    for (let i = 0; i < v.length; i++) v[i] /= norm;
  }
}

/**
 * Offline embeddings via transformers.js (onnxruntime). The model is
 * downloaded on first use and cached locally afterwards, so recall works
 * with no API key and no network beyond the initial fetch.
 */
export class TransformersEmbedder implements Embedder {
  readonly name: string;
  readonly dim = 384;
  private pipe: any = null;
  private failed = false;

  constructor(
    readonly model: string,
    private readonly batchSize: number,
  ) {
    this.name = `transformers:${model}`;
  }

  async ready(): Promise<boolean> {
    if (this.failed) return false;
    if (this.pipe) return true;
    try {
      await this.init();
      return true;
    } catch {
      this.failed = true;
      return false;
    }
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const pipe = await this.ensure();
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      const tensor = await pipe(batch, {
        pooling: "mean",
        normalize: true,
      });
      out.push(...toRows(tensor));
    }
    return out;
  }

  close(): void {
    this.pipe = null;
  }

  private ensure(): Promise<any> {
    if (this.pipe) return Promise.resolve(this.pipe);
    return this.init();
  }

  private async init(): Promise<void> {
    const mod = await import("@huggingface/transformers");
    mod.env.allowRemoteModels = true;
    mod.env.allowLocalModels = true;
    const p = await mod.pipeline("feature-extraction", this.model, {
      dtype: "fp32",
    });
    this.pipe = p;
  }
}

function toRows(tensor: any): Float32Array[] {
  const arr = Float32Array.from(tensor.data as ArrayLike<number>);
  const dims: number[] = tensor.dims ?? [];
  if (dims.length === 1) {
    return [arr];
  }
  const rows = dims[0] ?? 1;
  const cols = dims[1] ?? Math.floor(arr.length / rows);
  const out: Float32Array[] = [];
  for (let i = 0; i < rows; i++) {
    out.push(arr.slice(i * cols, i * cols + cols));
  }
  return out;
}

interface OllamaEmbedResponse {
  embeddings?: number[][];
  error?: string;
}

export class OllamaEmbedder implements Embedder {
  readonly name: string;
  readonly dim = 0;

  constructor(
    private readonly url: string,
    readonly model: string,
  ) {
    this.name = `ollama:${model}`;
  }

  async ready(): Promise<boolean> {
    try {
      const res = await fetch(`${this.url}/api/tags`, { signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const res = await fetch(`${this.url}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: this.model, input: texts }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`ollama embed failed: ${res.status}`);
    const data = (await res.json()) as OllamaEmbedResponse;
    if (data.error) throw new Error(`ollama embed error: ${data.error}`);
    const rows = (data.embeddings ?? []).map((r) => Float32Array.from(r));
    if (rows.length === 0) throw new Error("ollama embed returned no vectors");
    return rows;
  }

  close(): void {}
}

interface OpenAIEmbedResponse {
  data?: { embedding: number[] }[];
  error?: { message?: string };
}

export class OpenAIEmbedder implements Embedder {
  readonly name: string;
  readonly dim = 0;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    readonly model: string,
  ) {
    this.name = `openai:${model}`;
  }

  async ready(): Promise<boolean> {
    return Boolean(this.apiKey);
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/embeddings`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: texts }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`openai embed failed: ${res.status}`);
    const data = (await res.json()) as OpenAIEmbedResponse;
    if (data.error?.message) throw new Error(`openai embed error: ${data.error.message}`);
    const rows = (data.data ?? []).map((d) => Float32Array.from(d.embedding));
    return rows;
  }

  close(): void {}
}

export interface EmbedderFactoryOptions {
  config: CortexConfig;
  /** Resolve API keys from env when not present in config. */
  env?: Record<string, string | undefined>;
}

export function createEmbedder(opts: EmbedderFactoryOptions): Embedder | null {
  const c = opts.config.embeddings;
  if (!c.enabled || c.engine === "off") return null;
  switch (c.engine) {
    case "transformers":
      return new TransformersEmbedder(c.model, c.batch_size);
    case "ollama":
      return new OllamaEmbedder(c.ollama_url, c.model);
    case "openai": {
      const env = opts.env ?? process.env;
      const key = c.openai_api_key || env.OPENAI_API_KEY || "";
      return new OpenAIEmbedder(c.openai_base_url, key, c.openai_model);
    }
    default:
      return null;
  }
}
