import { describe, it, expect } from "vitest";
import { GraphMailSource, type GraphMailClient, type GraphMessage } from "./graphMail.js";

/** In-memory Graph client: canned messages, records which messages were marked read. */
class FakeClient implements GraphMailClient {
  read: string[] = [];
  constructor(
    private messages: GraphMessage[],
    private bytes: Record<string, Buffer> = {},
  ) {}
  async list(): Promise<GraphMessage[]> {
    return this.messages;
  }
  async download(messageId: string, attachmentId: string): Promise<Buffer> {
    return this.bytes[`${messageId}|${attachmentId}`] ?? Buffer.from(`bytes:${messageId}:${attachmentId}`);
  }
  async markRead(messageId: string): Promise<void> {
    this.read.push(messageId);
  }
}

describe("GraphMailSource", () => {
  it("emits one artifact per REPORT attachment, ignoring non-report files", async () => {
    const client = new FakeClient([
      {
        id: "m1",
        subject: "EFS Transaction Detail",
        attachments: [
          { id: "a1", name: "transactions.csv" },
          { id: "a2", name: "logo.png" }, // ignored
        ],
      },
      { id: "m2", subject: "EFS Reject", attachments: [{ id: "b1", name: "rejects.xlsx" }] },
    ]);
    const arts = await new GraphMailSource(client, "org1").list();

    expect(arts.map((a) => a.name)).toEqual(["transactions.csv", "rejects.xlsx"]);
    expect(arts[0]).toMatchObject({ id: "m1|a1", orgId: "org1" });
    expect(arts[1]).toMatchObject({ id: "m2|b1", orgId: "org1" });
  });

  it("fetches an attachment by combined message|attachment id", async () => {
    const client = new FakeClient(
      [{ id: "m1", subject: "x", attachments: [{ id: "a1", name: "t.csv" }] }],
      { "m1|a1": Buffer.from("DATA") },
    );
    const src = new GraphMailSource(client, "org1");
    const [a] = await src.list();
    expect((await src.fetch(a!)).toString()).toBe("DATA");
  });

  it("markDone and quarantine both mark the message read (the exclusion mechanism)", async () => {
    const client = new FakeClient([{ id: "m1", subject: "x", attachments: [{ id: "a1", name: "t.csv" }] }]);
    const src = new GraphMailSource(client, "org1");
    const [a] = await src.list();
    await src.markDone(a!);
    await src.quarantine(a!, "bad");
    expect(client.read).toEqual(["m1", "m1"]); // idempotent — marking read twice is harmless
  });
});
