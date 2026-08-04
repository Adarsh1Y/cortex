import { platform } from "node:os";

export interface Notifier {
  cmd: string;
  args: (title: string, body: string) => string[];
}

export interface NotifyOptions {
  /** Override notifier binary; called as `command <title> <body>`. */
  command?: string;
}

function detectNotifier(opts: NotifyOptions): Notifier | null {
  if (opts.command) {
    return {
      cmd: opts.command,
      args: (title, body) => [title, body],
    };
  }
  switch (platform()) {
    case "darwin":
      return {
        cmd: "osascript",
        args: (title, body) => [
          "-e",
          `display notification "${escapeApple(body)}" with title "${escapeApple(title)}"`,
        ],
      };
    case "win32":
      return {
        cmd: "powershell",
        args: (title, body) => [
          "-NoProfile",
          "-Command",
          `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.NotifyIcon]::new().BalloonTipTitle='${escapeWin(title)}'; [System.Windows.Forms.NotifyIcon]::new().BalloonTipText='${escapeWin(body)}'; (New-Object System.Windows.Forms.NotifyIcon) | ForEach-Object { $_.Icon=[System.Drawing.SystemIcons]::Information; $_.Visible=$true; $_.ShowBalloonTip(5000) }`,
        ],
      };
    case "linux":
    default:
      return { cmd: "notify-send", args: (title, body) => [title, body] };
  }
}

function escapeApple(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function escapeWin(s: string): string {
  return s.replace(/'/g, "''").replace(/[\\"]/g, "");
}

/** True if a usable notifier binary is on PATH. */
export function notifyAvailable(opts: NotifyOptions = {}): boolean {
  const n = detectNotifier(opts);
  if (!n) return false;
  try {
    return Boolean(Bun.which(n.cmd));
  } catch {
    return false;
  }
}

/** Fire a desktop notification. Resolves false when no notifier exists. */
export async function notify(
  title: string,
  body: string,
  opts: NotifyOptions = {},
): Promise<boolean> {
  const n = detectNotifier(opts);
  if (!n) return false;
  const path = Bun.which(n.cmd);
  if (!path) return false;
  try {
    const proc = Bun.spawn([path, ...n.args(title, body)], {
      stdout: "ignore",
      stderr: "ignore",
    });
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}
