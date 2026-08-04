import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { notify, notifyAvailable, speak, sttAvailable, transcribe, ttsAvailable, type VoiceConfig } from "../core/index.ts";

afterAll(() => {
  // restore nothing; all stubs are local
});

describe("notify", () => {
  test("custom command receives title and body", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cortex-notify-"));
    const log = join(dir, "log.txt");
    const stub = join(dir, "notifier.sh");
    writeFileSync(stub, `#!/bin/sh\necho "$1|$2" >> ${log}\n`);
    // mark executable
    Bun.spawnSync(["chmod", "+x", stub]);

    const ok = await notify("Title", "Body", { command: stub });
    expect(ok).toBe(true);
    const content = (await Bun.file(log).text()).trim();
    expect(content).toBe("Title|Body");
    rmSync(dir, { recursive: true, force: true });
  });

  test("notifyAvailable detects missing binary", () => {
    expect(notifyAvailable({ command: "definitely-not-a-real-bin-xyz" })).toBe(false);
  });
});

describe("voice", () => {
  const config: VoiceConfig = {
    tts_engine: "off",
    tts_command: "",
    stt_engine: "off",
    stt_command: "",
    openai_api_key: "",
  };

  test("tts off reports unavailable and speaks nothing", async () => {
    expect(ttsAvailable(config)).toBe(false);
    expect(await speak("hi", config)).toBe(false);
  });

  test("command TTS is used when configured", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cortex-tts-"));
    const log = join(dir, "said.txt");
    const stub = join(dir, "say.sh");
    writeFileSync(stub, `#!/bin/sh\necho "$@" >> ${log}\n`);
    Bun.spawnSync(["chmod", "+x", stub]);
    const cfg = { ...config, tts_engine: "command" as const, tts_command: stub };
    expect(ttsAvailable(cfg)).toBe(true);
    expect(await speak("hello world", cfg)).toBe(true);
    expect((await Bun.file(log).text()).trim()).toBe("hello world");
    rmSync(dir, { recursive: true, force: true });
  });

  test("command STT transcribes from file path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cortex-stt-"));
    const stub = join(dir, "stt.sh");
    writeFileSync(stub, `#!/bin/sh\necho "transcribed from $1"\n`);
    Bun.spawnSync(["chmod", "+x", stub]);
    const cfg = { ...config, stt_engine: "command" as const, stt_command: stub };
    const text = await transcribe("/tmp/audio.wav", cfg);
    expect(text).toBe("transcribed from /tmp/audio.wav");
    rmSync(dir, { recursive: true, force: true });
  });

  test("openai STT without key is unavailable", () => {
    const cfg = { ...config, stt_engine: "openai" as const, openai_api_key: "" };
    expect(sttAvailable(cfg)).toBe(false);
  });
});
