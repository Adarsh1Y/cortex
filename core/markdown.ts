export const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  gray: "\x1b[90m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
} as const;

type Mode = "normal" | "bold" | "code" | "codeblock";

/**
 * Streaming markdown renderer. Re-renders the full buffer on every push and
 * returns only the newly-produced ANSI suffix, so mid-stream delimiters are
 * handled correctly and output stays deterministic.
 */
export class MarkdownStream {
  private buffer = "";
  private emitted = 0;

  push(chunk: string): string {
    this.buffer += chunk;
    return this.delta(this.render(this.buffer, true));
  }

  flush(): string {
    return this.delta(this.render(this.buffer, false));
  }

  private delta(full: string): string {
    const out = full.slice(this.emitted);
    this.emitted = full.length;
    return out;
  }

  private render(s: string, holdTail: boolean): string {
    let out = "";
    let mode: Mode = "normal";
    let lineStart = true;
    let heading = false;
    let list = false;
    let i = 0;
    const n = s.length;

    const at = (j: number, token: string) => s.startsWith(token, j);
    const hold = (j: number, ch: string): boolean => {
      if (!holdTail || j !== n - 1) return false;
      if (mode === "normal") return ch === "*" || ch === "`" || ch === "#";
      if (mode === "bold") return ch === "*";
      if (mode === "code") return ch === "`";
      if (mode === "codeblock") return ch === "`";
      return false;
    };

    while (i < n) {
      const ch = s[i];

      if (mode === "codeblock") {
        if (at(i, "```")) {
          out += colors.reset;
          mode = "normal";
          i += 3;
          continue;
        }
        if (hold(i, ch)) break;
        out += ch === "\n" ? "\n" : `${colors.green}${ch}`;
        i++;
        continue;
      }

      if (mode === "code") {
        if (ch === "`") {
          out += colors.reset;
          mode = "normal";
          i += 1;
          continue;
        }
        if (hold(i, ch)) break;
        out += ch === "\n" ? "\n" : `${colors.green}${ch}`;
        i++;
        continue;
      }

      if (mode === "bold") {
        if (at(i, "**")) {
          out += colors.reset;
          mode = "normal";
          i += 2;
          continue;
        }
        if (hold(i, ch)) break;
        out += ch;
        i++;
        continue;
      }

      // normal mode
      if (ch === "\n") {
        out += "\n";
        if (heading || list) {
          out += colors.reset;
          heading = false;
          list = false;
        }
        lineStart = true;
        i++;
        continue;
      }
      if (at(i, "```")) {
        out += `${colors.dim}${colors.green}`;
        mode = "codeblock";
        i += 3;
        continue;
      }
      if (ch === "`") {
        out += colors.green;
        mode = "code";
        i += 1;
        continue;
      }
      if (at(i, "**")) {
        out += `${colors.bold}${colors.cyan}`;
        mode = "bold";
        i += 2;
        continue;
      }
      if (lineStart && ch === "#") {
        if (hold(i, ch)) break;
        out += `${colors.bold}${colors.yellow}`;
        heading = true;
        i += 1;
        continue;
      }
      if (lineStart && (at(i, "- ") || at(i, "* ") || at(i, "> "))) {
        out += colors.dim;
        list = true;
        i += 2;
        continue;
      }
      if (lineStart && /^\d/.test(ch) && s[i + 1] === ".") {
        out += colors.dim;
        list = true;
        i += 2;
        continue;
      }
      if (hold(i, ch)) break;
      out += ch;
      i++;
    }

    return out;
  }
}

export function paint(text: string, color: keyof typeof colors): string {
  return `${colors[color]}${text}${colors.reset}`;
}
