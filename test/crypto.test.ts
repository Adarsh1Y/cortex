import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCipherFromKey, loadOrCreateKey, Memory } from "../core/index.ts";

describe("cipher", () => {
  const key = Buffer.from("0123456789abcdef0123456789abcdef");
  const c = createCipherFromKey(key);

  test("roundtrip", () => {
    const enc = c.encrypt("hello world");
    expect(enc).toMatch(/^enc:/);
    expect(c.decrypt(enc)).toBe("hello world");
  });

  test("distinct ciphertexts for identical plaintext (nonce)", () => {
    expect(c.encrypt("same")).not.toBe(c.encrypt("same"));
  });

  test("plain strings pass through", () => {
    expect(c.decrypt("not encrypted")).toBe("not encrypted");
  });

  test("tampered ciphertext throws", () => {
    const enc = c.encrypt("secret");
    const tampered = enc.slice(0, -2) + (enc.endsWith("AA") ? "BB" : "AA");
    expect(() => c.decrypt(tampered)).toThrow();
  });

  test("wrong key fails to decrypt", () => {
    const other = createCipherFromKey(Buffer.from("ffffffffffffffffffffffffffffffff"));
    expect(() => other.decrypt(c.encrypt("hi"))).toThrow();
  });
});

describe("key loading", () => {
  test("env var wins", () => {
    const dir = mkdtempSync(join(tmpdir(), "cortex-keyenv-"));
    const file = join(dir, "key");
    const prev = process.env.CORTEX_TEST_KEY;
    process.env.CORTEX_TEST_KEY = "env-key-material";
    const key = loadOrCreateKey(file, "CORTEX_TEST_KEY");
    expect(key!.toString()).toBe("env-key-material");
    expect(existsSync(file)).toBe(false);
    process.env.CORTEX_TEST_KEY = prev;
    rmSync(dir, { recursive: true, force: true });
  });

  test("creates keyfile on first use with 0600 perms", () => {
    const dir = mkdtempSync(join(tmpdir(), "cortex-keyfile-"));
    const file = join(dir, "key");
    const key1 = loadOrCreateKey(file, "CORTEX_TEST_KEY_NOPE");
    const key2 = loadOrCreateKey(file, "CORTEX_TEST_KEY_NOPE");
    expect(key1).not.toBeNull();
    expect(key1!.equals(key2!)).toBe(true);
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, "utf8").trim()).toBe(key1!.toString());
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("encrypted Memory", () => {
  test("content is encrypted at rest and transparent to reads", () => {
    const dir = mkdtempSync(join(tmpdir(), "cortex-encmem-"));
    const key = Buffer.from("0123456789abcdef0123456789abcdef");
    const mem = new Memory(dir, { key });
    const s = mem.createSession("enc");
    mem.addMessage(s, "user", "top secret plan");
    mem.setPreference("name", "zypher");
    const factId = mem.addFact("user dislikes celery", "preference");
    mem.addJournal("we hatched a secret plan");

    const msgs = mem.getMessages(s);
    expect(msgs[0].content).toBe("top secret plan");
    expect(mem.searchMessages("secret")[0].content).toBe("top secret plan");
    expect(mem.allPreferences()[0].value).toBe("zypher");
    expect(mem.searchFacts("celery")[0].text).toBe("user dislikes celery");
    expect(mem.latestJournal()[0].summary).toContain("secret plan");

    // raw bytes must not contain plaintext
    const buf = readFileSync(join(dir, "cortex.db"));
    const text = buf.toString("utf8");
    expect(text).not.toContain("top secret");
    expect(text).not.toContain("zypher");
    expect(text).not.toContain("celery");

    mem.close();
    rmSync(dir, { recursive: true, force: true });
    void factId;
  });

  test("plain Memory cannot read encrypted data", () => {
    const dir = mkdtempSync(join(tmpdir(), "cortex-encmem2-"));
    const key = Buffer.from("0123456789abcdef0123456789abcdef");
    const mem = new Memory(dir, { key });
    const s = mem.createSession("enc2");
    mem.addMessage(s, "user", "hidden value");
    mem.close();

    const plain = new Memory(dir);
    const msgs = plain.getMessages(s);
    expect(msgs[0].content).not.toBe("hidden value");
    expect(plain.searchMessages("hidden").length).toBe(0);
    plain.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
