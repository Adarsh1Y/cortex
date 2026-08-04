import type { Memory, MessageRow } from "./memory";

export function formatMessagesForRecall(messages: MessageRow[]): string {
  return messages
    .map((m) => {
      const date = new Date(m.created_at);
      const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
      const speaker = m.role === "user" ? "user" : "you";
      const content = m.content.length > 300 ? `${m.content.slice(0, 300)}...` : m.content;
      return `[${stamp}] ${speaker}: ${content}`;
    })
    .join("\n");
}

export function buildRecallBlock(
  memory: Memory,
  opts: {
    recallMessages: number;
    maxChars: number;
    excludeSessionId?: string;
  },
): string {
  const recent = memory.recentMessages(opts.recallMessages, opts.excludeSessionId);
  if (recent.length === 0) return "";
  let block = formatMessagesForRecall(recent);
  if (block.length > opts.maxChars) {
    block = block.slice(-opts.maxChars);
    block = `...(truncated)\n${block}`;
  }
  return block;
}
