export async function* sseData(res: Response): AsyncGenerator<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, idx).replace(/\r$/, "");
      buf = buf.slice(idx + 1);
      const trimmed = line.trim();
      if (trimmed.startsWith("data:")) yield trimmed.slice(5).trim();
      else if (trimmed) yield trimmed; // NDJSON (ollama) passes raw lines
    }
  }
}

export function parseJsonLine<T>(line: string): T | null {
  if (!line || line === "[DONE]") return null;
  try {
    return JSON.parse(line) as T;
  } catch {
    return null;
  }
}
