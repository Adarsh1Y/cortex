import { createOpencode, type OpencodeClient } from "@opencode-ai/sdk";

export interface PromptOptions {
  sessionId: string;
  text: string;
  system?: string;
  onDelta?: (delta: string) => void;
}

export interface Brain {
  createSession(title: string): Promise<string>;
  prompt(opts: PromptOptions): Promise<string>;
  close(): void;
}

interface Collector {
  buffer: string;
  activeMsgId: string | null;
  onDelta?: (delta: string) => void;
  resolve: (text: string) => void;
  reject: (err: Error) => void;
}

export class OpenCodeBrain implements Brain {
  private collectors = new Map<string, Collector>();
  private streamStarted = false;

  private constructor(
    private client: OpencodeClient,
    private server: { url: string; close(): void },
    private timeoutMs: number,
  ) {}

  static async connect(timeoutMs = 60000): Promise<OpenCodeBrain> {
    const { client, server } = await createOpencode({ timeout: timeoutMs });
    const brain = new OpenCodeBrain(client, server, timeoutMs);
    brain.ensureStream();
    return brain;
  }

  get url(): string {
    return this.server.url;
  }

  async createSession(title: string): Promise<string> {
    const res = await this.client.session.create({ body: { title } });
    const id = res.data?.id;
    if (!id) throw new Error("failed to create opencode session");
    return id;
  }

  async prompt(opts: PromptOptions): Promise<string> {
    const { sessionId, text, system, onDelta } = opts;

    const pending = new Promise<string>((resolve, reject) => {
      this.collectors.set(sessionId, {
        buffer: "",
        activeMsgId: null,
        onDelta,
        resolve,
        reject,
      });
    });

    await this.client.session.promptAsync({
      path: { id: sessionId },
      body: {
        ...(system ? { system } : {}),
        parts: [{ type: "text", text }],
      },
    });

    return pending;
  }

  private ensureStream(): void {
    if (this.streamStarted) return;
    this.streamStarted = true;
    void (async () => {
      try {
        const events = await this.client.event.subscribe();
        for await (const event of events.stream as AsyncGenerator<Record<string, any>>) {
          this.handleEvent(event);
        }
        this.failAll(new Error("event stream ended unexpectedly"));
      } catch (err) {
        this.failAll(err as Error);
      }
    })();
  }

  private handleEvent(event: Record<string, any>): void {
    switch (event.type) {
      case "message.updated": {
        const info = event.properties?.info;
        if (info?.role !== "assistant") return;
        const col = this.collectors.get(info.sessionID);
        if (col) col.activeMsgId = info.id;
        break;
      }
      case "message.part.updated": {
        const part = event.properties?.part;
        if (part?.type !== "text") return;
        const col = this.collectors.get(part.sessionID);
        if (!col || part.messageID !== col.activeMsgId) return;
        if (part.synthetic || part.ignored) return;
        const delta = event.properties?.delta ?? part.text ?? "";
        if (delta) {
          col.buffer += delta;
          col.onDelta?.(delta);
        }
        break;
      }
      case "session.status": {
        const sessionID = event.properties?.sessionID;
        const col = this.collectors.get(sessionID);
        if (!col) return;
        if (event.properties?.status?.type === "idle") {
          this.collectors.delete(sessionID);
          col.resolve(col.buffer);
        }
        break;
      }
      case "session.error": {
        const sessionID = event.properties?.sessionID;
        const col = this.collectors.get(sessionID);
        if (!col) return;
        this.collectors.delete(sessionID);
        col.reject(new Error("opencode session error"));
        break;
      }
      case "permission.asked": {
        const sessionID = event.properties?.sessionID;
        const col = this.collectors.get(sessionID);
        if (!col) return;
        void this.client.postSessionIdPermissionsPermissionId({
          path: {
            id: sessionID,
            permissionID: event.properties.id,
          },
          body: { response: "reject" },
        });
        break;
      }
    }
  }

  private failAll(err: Error): void {
    for (const [id, col] of this.collectors) {
      this.collectors.delete(id);
      col.reject(err);
    }
  }

  close(): void {
    this.failAll(new Error("brain closed"));
    this.server.close();
  }
}
