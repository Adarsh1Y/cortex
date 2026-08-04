import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { stdin, stdout } from "node:process";

export class HistoryFile {
  private entries: string[] = [];
  constructor(
    private file: string,
    private max: number,
  ) {
    this.load();
  }

  private load(): void {
    if (!existsSync(this.file)) return;
    try {
      this.entries = readFileSync(this.file, "utf8")
        .split("\n")
        .map((s) => s.replace(/\r$/, ""))
        .filter((s) => s.length > 0);
    } catch {
      this.entries = [];
    }
  }

  add(line: string): void {
    if (!line.trim()) return;
    const idx = this.entries.indexOf(line);
    if (idx !== -1) this.entries.splice(idx, 1);
    this.entries.push(line);
    if (this.entries.length > this.max) {
      this.entries.splice(0, this.entries.length - this.max);
    }
    this.save();
  }

  save(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, this.entries.join("\n"));
    } catch {
      // history is best-effort
    }
  }

  get all(): string[] {
    return [...this.entries];
  }
}

export type TuiKey =
  | { type: "char"; ch: string }
  | { type: "enter" }
  | { type: "backspace" }
  | { type: "delete" }
  | { type: "left" }
  | { type: "right" }
  | { type: "up" }
  | { type: "down" }
  | { type: "home" }
  | { type: "end" }
  | { type: "ctrl-a" }
  | { type: "ctrl-e" }
  | { type: "ctrl-k" }
  | { type: "ctrl-u" }
  | { type: "ctrl-w" }
  | { type: "ctrl-c" }
  | { type: "ctrl-d" }
  | { type: "ctrl-l" }
  | { type: "tab" }
  | { type: "ctrl-r" }
  | { type: "escape" };

/** Parse a raw byte chunk into TUI keys (handles ANSI escape sequences). */
export function parseKeys(chunk: Uint8Array): TuiKey[] {
  const keys: TuiKey[] = [];
  const s = new TextDecoder().decode(chunk);
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "\x1b") {
      const rest = s.slice(i + 1);
      if (rest.startsWith("[A")) {
        keys.push({ type: "up" });
        i += 3;
      } else if (rest.startsWith("[B")) {
        keys.push({ type: "down" });
        i += 3;
      } else if (rest.startsWith("[C")) {
        keys.push({ type: "right" });
        i += 3;
      } else if (rest.startsWith("[D")) {
        keys.push({ type: "left" });
        i += 3;
      } else if (rest.startsWith("[H")) {
        keys.push({ type: "home" });
        i += 3;
      } else if (rest.startsWith("[F")) {
        keys.push({ type: "end" });
        i += 3;
      } else if (rest.startsWith("[3~")) {
        keys.push({ type: "delete" });
        i += 4;
      } else {
        keys.push({ type: "escape" });
        i += 1;
      }
    } else if (c === "\r" || c === "\n") {
      keys.push({ type: "enter" });
      i += 1;
    } else if (c === "\x7f") {
      keys.push({ type: "backspace" });
      i += 1;
    } else if (c === "\t") {
      keys.push({ type: "tab" });
      i += 1;
    } else if (c === "\x01") {
      keys.push({ type: "ctrl-a" });
      i += 1;
    } else if (c === "\x05") {
      keys.push({ type: "ctrl-e" });
      i += 1;
    } else if (c === "\x0b") {
      keys.push({ type: "ctrl-k" });
      i += 1;
    } else if (c === "\x15") {
      keys.push({ type: "ctrl-u" });
      i += 1;
    } else if (c === "\x17") {
      keys.push({ type: "ctrl-w" });
      i += 1;
    } else if (c === "\x03") {
      keys.push({ type: "ctrl-c" });
      i += 1;
    } else if (c === "\x04") {
      keys.push({ type: "ctrl-d" });
      i += 1;
    } else if (c === "\x0c") {
      keys.push({ type: "ctrl-l" });
      i += 1;
    } else if (c === "\x12") {
      keys.push({ type: "ctrl-r" });
      i += 1;
    } else {
      keys.push({ type: "char", ch: c });
      i += 1;
    }
  }
  return keys;
}

export interface EditorOptions {
  prompt: string;
  history?: HistoryFile;
  autocomplete?: (line: string) => string[];
  /** Rendered prompt decoration (e.g. color codes). */
  renderPrompt?: string;
}

const CLEAR_LINE = "\r\x1b[K";

/**
 * Raw-mode single-line editor with history, cursor movement, kill/yank-ish
 * edits, reverse search, and tab completion. Pasted multi-line text is queued
 * so the surplus lines become the next input instead of being dropped.
 */
export class LineEditor {
  private buffer = "";
  private cursor = 0;
  private pending = "";
  private histIdx = -1;
  private draft = "";
  private searching = false;
  private searchBuf = "";
  private searchMatch = -1;
  private closed = false;
  private queue: TuiKey[] = [];
  private resolveAsk: ((v: string | null) => void) | null = null;
  private restoredRaw = false;

  constructor(private opts: EditorOptions) {
    const wasRaw = Boolean((stdin as { isRaw?: boolean }).isRaw);
    try {
      if (stdin.isTTY) {
        (stdin as { setRawMode?: (b: boolean) => void }).setRawMode?.(true);
        this.restoredRaw = !wasRaw;
      }
    } catch {
      // non-TTY stdin: leave as-is
    }
    stdin.on("data", this.feed);
  }

  private drain(): void {
    const resolve = this.resolveAsk;
    if (!resolve) return;
    while (this.queue.length > 0) {
      const key = this.queue.shift()!;
      if (this.handle(key, resolve) === "done") {
        this.resolveAsk = null;
        return;
      }
    }
  }

  /** Print an external message (e.g. proactive line) then re-render the prompt. */
  externalWrite(text: string): void {
    stdout.write(`${CLEAR_LINE}${text}\n`);
    this.render();
  }

  /** Read one line from the user. Resolves null on exit (ctrl-d or ctrl-c). */
  ask(): Promise<string | null> {
    if (this.pending) {
      const nl = this.pending.indexOf("\n");
      if (nl !== -1) {
        const line = this.pending.slice(0, nl).replace(/\r$/, "");
        this.pending = this.pending.slice(nl + 1);
        return Promise.resolve(line);
      }
      const line = this.pending;
      this.pending = "";
      return Promise.resolve(line);
    }

    return new Promise<string | null>((resolve) => {
      this.buffer = "";
      this.cursor = 0;
      this.histIdx = this.opts.history ? this.opts.history.all.length : -1;
      this.draft = "";
      this.resolveAsk = resolve;
      this.render();
      this.drain();
    });
  }

  private handle(key: TuiKey, resolve: (v: string | null) => void): "continue" | "done" {
    switch (key.type) {
      case "char":
        this.insert(key.ch);
        break;
      case "enter":
        if (this.searching) {
          const all = this.opts.history?.all ?? [];
          if (this.searchMatch >= 0) {
            this.buffer = all[this.searchMatch];
            this.cursor = this.buffer.length;
          }
          this.searching = false;
          this.render();
          return "continue";
        }
        if (this.buffer.trim() === "") {
          this.render();
          return "continue";
        }
        {
          const line = this.buffer;
          this.endLine(line);
          resolve(line);
        }
        return "done";
      case "backspace":
        if (this.cursor > 0) {
          this.buffer = this.buffer.slice(0, this.cursor - 1) + this.buffer.slice(this.cursor);
          this.cursor--;
        }
        break;
      case "delete":
        if (this.cursor < this.buffer.length) {
          this.buffer = this.buffer.slice(0, this.cursor) + this.buffer.slice(this.cursor + 1);
        }
        break;
      case "left":
        if (this.cursor > 0) this.cursor--;
        break;
      case "right":
        if (this.cursor < this.buffer.length) this.cursor++;
        break;
      case "home":
      case "ctrl-a":
        this.cursor = 0;
        break;
      case "end":
      case "ctrl-e":
        this.cursor = this.buffer.length;
        break;
      case "ctrl-u":
        this.buffer = this.buffer.slice(this.cursor);
        this.cursor = 0;
        break;
      case "ctrl-k":
        this.buffer = this.buffer.slice(0, this.cursor);
        break;
      case "ctrl-w": {
        const before = this.buffer.slice(0, this.cursor);
        const stripped = before.replace(/\S*\s*$/, "");
        this.buffer = stripped + this.buffer.slice(this.cursor);
        this.cursor = stripped.length;
        break;
      }
      case "up":
        this.historyMove(-1);
        break;
      case "down":
        this.historyMove(1);
        break;
      case "tab":
        this.complete();
        break;
      case "ctrl-r":
        this.startSearch();
        break;
      case "ctrl-l":
        stdout.write("\x1b[2J\x1b[H");
        break;
      case "ctrl-c":
        if (this.buffer === "" && !this.searching) {
          resolve(null);
          return "done";
        }
        this.buffer = "";
        this.cursor = 0;
        break;
      case "ctrl-d":
        resolve(null);
        return "done";
      case "escape":
        if (this.searching) this.stopSearch();
        break;
      default:
        break;
    }
    this.render();
    return "continue";
  }

  private insert(ch: string): void {
    if (this.searching) {
      this.searchBuf += ch;
      this.runSearch();
      this.render();
      return;
    }
    if (ch === "\n" || ch === "\r") {
      this.pending += ch;
      return;
    }
    if (ch === "\x1b" || ch === "\x7f") return;
    this.buffer = this.buffer.slice(0, this.cursor) + ch + this.buffer.slice(this.cursor);
    this.cursor += ch.length;
  }

  private historyMove(dir: number): void {
    const hist = this.opts.history;
    if (!hist) return;
    const all = hist.all;
    if (all.length === 0) return;
    if (this.histIdx === all.length && this.buffer) this.draft = this.buffer;
    const next = Math.min(all.length, Math.max(0, this.histIdx + dir));
    this.histIdx = next;
    if (next < all.length) {
      this.buffer = all[next];
      this.cursor = this.buffer.length;
    } else {
      this.buffer = this.draft;
      this.cursor = this.buffer.length;
    }
  }

  private complete(): void {
    const line = this.buffer.slice(0, this.cursor);
    if (!this.opts.autocomplete) return;
    const suggs = this.opts.autocomplete(line);
    if (suggs.length === 0) return;
    const common = longestCommonPrefix(suggs);
    if (common.length > line.length) {
      const tail = common.slice(line.length);
      this.insert(tail);
    } else if (suggs.length === 1 && suggs[0] === line) {
      this.insert(" ");
    } else {
      // show candidate list above the prompt
      stdout.write("\n  " + suggs.join("  ") + "\n");
      this.render();
    }
  }

  private startSearch(): void {
    this.searching = true;
    this.searchBuf = "";
    this.searchMatch = -1;
    this.render();
  }

  private stopSearch(): void {
    this.searching = false;
    this.render();
  }

  private runSearch(): void {
    const all = this.opts.history?.all ?? [];
    const q = this.searchBuf.toLowerCase();
    if (!q) {
      this.searchMatch = -1;
      return;
    }
    for (let i = all.length - 1; i >= 0; i--) {
      if (all[i].toLowerCase().includes(q)) {
        this.searchMatch = i;
        return;
      }
    }
    this.searchMatch = -1;
  }

  private render(): void {
    const prompt = this.opts.renderPrompt ?? this.opts.prompt;
    if (this.searching) {
      const all = this.opts.history?.all ?? [];
      const match = this.searchMatch >= 0 ? all[this.searchMatch] : "";
      stdout.write(`${CLEAR_LINE}\x1b[33m(reverse-i-search)\x1b[0m\`${this.searchBuf}\`: ${match}`);
      return;
    }
    const text = this.buffer;
    stdout.write(`${CLEAR_LINE}${prompt}${text}`);
    const moveBack = text.length - this.cursor;
    if (moveBack > 0) stdout.write(`\x1b[${moveBack}D`);
  }

  private endLine(line: string): void {
    stdout.write(CLEAR_LINE + (this.opts.renderPrompt ?? this.opts.prompt));
    stdout.write("\n");
    if (line) this.opts.history?.add(line);
  }

  close(): void {
    this.closed = true;
    stdin.off("data", this.feed);
    if (this.restoredRaw) {
      try {
        (stdin as { setRawMode?: (b: boolean) => void }).setRawMode?.(false);
      } catch {
        // ignore
      }
    }
  }

  private feed = (chunk: Uint8Array | string): void => {
    const bytes = typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
    for (const k of parseKeys(bytes)) this.queue.push(k);
    this.drain();
  };
}

function longestCommonPrefix(strings: string[]): string {
  if (strings.length === 0) return "";
  let prefix = strings[0];
  for (const s of strings) {
    while (!s.startsWith(prefix)) prefix = prefix.slice(0, -1);
  }
  return prefix;
}
