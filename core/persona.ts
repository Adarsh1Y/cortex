import { existsSync, readFileSync } from "node:fs";

export interface Persona {
  name: string;
  codename?: string;
  role: string;
  voice: {
    tone: string;
    register: string;
    habits: string[];
  };
  boundaries: string[];
  memory_ethic?: string;
}

export interface Preference {
  key: string;
  value: string;
}

export interface PromptContext {
  persona: Persona;
  preferences: Preference[];
  recallBlock: string;
  factsBlock?: string;
  journalBlock?: string;
}

export function loadPersona(path: string): Persona {
  if (!existsSync(path)) {
    throw new Error(`persona file not found: ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf8")) as Persona;
}

export function buildSystemPrompt(ctx: PromptContext): string {
  const { persona, preferences } = ctx;
  const lines: string[] = [];

  lines.push(
    `You are ${persona.name}, ${persona.role}.`,
    `Voice: ${persona.voice.tone}. Register: ${persona.voice.register}.`,
  );

  if (persona.voice.habits.length > 0) {
    lines.push("Habits:", ...persona.voice.habits.map((h) => `- ${h}`));
  }
  if (persona.boundaries.length > 0) {
    lines.push("Boundaries:", ...persona.boundaries.map((b) => `- ${b}`));
  }
  if (persona.memory_ethic) {
    lines.push(`Memory: ${persona.memory_ethic}.`);
  }

  if (preferences.length > 0) {
    lines.push(
      "",
      "## Known user preferences",
      ...preferences.map((p) => `- ${p.key}: ${p.value}`),
    );
  }

  if (ctx.factsBlock?.trim()) {
    lines.push("", "## What you know (distilled memory)", ctx.factsBlock.trim());
  }

  if (ctx.journalBlock?.trim()) {
    lines.push("", "## Your life story (recent)", ctx.journalBlock.trim());
  }

  if (ctx.recallBlock.trim().length > 0) {
    lines.push("", "## Recall from your past sessions", ctx.recallBlock.trim());
  }

  return lines.join("\n");
}
