export { loadConfig, projectRoot, expandHome, resolvePersonaPath } from "./config";
export type { CortexConfig } from "./config";
export { Memory } from "./memory";
export type { MessageRow, SessionRow, MemoryStats, Role, MemoryHooks } from "./memory";
export { createCipherFromKey, loadOrCreateKey } from "./crypto";
export type { Cipher } from "./crypto";
export {
  MockEmbedder,
  TransformersEmbedder,
  OllamaEmbedder,
  OpenAIEmbedder,
  createEmbedder,
} from "./embeddings";
export type { Embedder } from "./embeddings";
export { VectorStore, cosine, float32ToBlob, blobToFloat32 } from "./vector";
export type { VectorHit } from "./vector";
export { loadPersona, buildSystemPrompt } from "./persona";
export type { Persona, Preference, PromptContext } from "./persona";
export { OpenCodeBrain } from "./brain";
export type { Brain, PromptOptions, BrainOptions } from "./brain";
export { createBrain, OpenAIBrain, AnthropicBrain, OllamaBrain, MockBrain } from "./brain/factory";
export type { AnyBrain, CreateBrainOptions } from "./brain/factory";
export type { OpenAIBrainOptions } from "./brain/openai";
export type { AnthropicBrainOptions } from "./brain/anthropic";
export type { OllamaBrainOptions } from "./brain/ollama";
export type { MockBrainOptions } from "./brain/mock";
export { buildRecallBlock, formatMessagesForRecall, buildSemanticRecallBlock } from "./recall";
export { Conversation } from "./conversation";
export {
  extractDigest,
  consolidateFacts,
  parseJsonObject,
  factsToContext,
  journalToContext,
} from "./semantic";
export type { ExtractedFact, SessionDigest, ConsolidatedFact } from "./semantic";
export { ProactiveEngine } from "./proactive";
export type { ProactiveConfig, ProactiveDeps } from "./proactive";
export { ReminderStore, ReminderEngine, parseReminderWhen } from "./reminders";
export type { ReminderRow, ReminderDeps } from "./reminders";
export { PermissionPolicy } from "./permission";
export type { PermissionDecision, PermissionRequest, PermissionPolicyConfig } from "./permission";
export { notify, notifyAvailable } from "./notify";
export type { Notifier, NotifyOptions } from "./notify";
export { detectTTS, ttsAvailable, speak, sttAvailable, transcribe } from "./voice";
export type { VoiceConfig, DetectedTTS } from "./voice";
export { exportMemory, importMemory, backupMemory, buildExportBundle } from "./export";
export type { ExportBundle, ImportStats } from "./export";
export { MarkdownStream, paint, colors } from "./markdown";
