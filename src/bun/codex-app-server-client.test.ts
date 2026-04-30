import { PassThrough } from "node:stream";

import { describe, expect, test } from "bun:test";

import {
  createCodexAppServerTransportFromChild,
  inspectCodexRuntimeActivity,
  listThreadsForCwdViaCodexAppServer,
} from "./codex-app-server-client";

function createMemoryTransport(messages: unknown[], sent: unknown[] = []) {
  return {
    sent,
    async readMessage() {
      return messages.shift();
    },
    async writeMessage(message: unknown) {
      sent.push(message);
    },
    async close() {},
  };
}

describe("createCodexAppServerTransportFromChild", () => {
  test("writes newline-delimited JSON, reads one parsed line, and closes the child", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const written: string[] = [];
    let killed = false;

    stdin.on("data", (chunk) => {
      written.push(chunk.toString("utf8"));
    });

    const transport = createCodexAppServerTransportFromChild({
      stdin,
      stdout,
      kill() {
        killed = true;
      },
    });

    await transport.writeMessage({ id: 9, method: "ping", params: { ok: true } });
    stdout.write(`${JSON.stringify({ id: 9, result: { pong: true } })}\n`);

    await expect(transport.readMessage()).resolves.toEqual({
      id: 9,
      result: { pong: true },
    });
    expect(written).toEqual(['{"id":9,"method":"ping","params":{"ok":true}}\n']);

    await transport.close();

    expect(killed).toBe(true);
  });

  test("fails closed and kills the child when stdout is missing during setup", () => {
    const stdin = new PassThrough();
    let killed = false;

    expect(() =>
      createCodexAppServerTransportFromChild({
        stdin,
        stdout: undefined as never,
        kill() {
          killed = true;
        },
      }),
    ).toThrow();

    expect(killed).toBe(true);
  });
});

describe("listThreadsForCwdViaCodexAppServer", () => {
  test("parses canonical discovery records from thread/list", async () => {
    const sent: unknown[] = [];
    const messages = [
      { id: 1, result: { serverInfo: { name: "codex-app-server" } } },
      {
        id: 2,
        result: {
          data: [
            {
              id: "thr_123",
              name: "Fix hook lifecycle",
              cwd: "/tmp/project",
            },
            {
              id: "thr_999",
              name: null,
              cwd: "/tmp/project",
            },
          ],
        },
      },
    ];

    const result = await listThreadsForCwdViaCodexAppServer(
      createMemoryTransport(messages, sent),
      "/tmp/project",
    );

    expect(result).toEqual([
      {
        threadId: "thr_123",
        threadName: "Fix hook lifecycle",
        cwd: "/tmp/project",
      },
      {
        threadId: "thr_999",
        threadName: null,
        cwd: "/tmp/project",
      },
    ]);
  });
});

describe("inspectCodexRuntimeActivity", () => {
  test("reports idle when no threads are loaded", async () => {
    const sent: unknown[] = [];
    const messages = [
      { id: 1, result: { serverInfo: { name: "codex-app-server" } } },
      { id: 2, result: { data: [] } },
    ];

    const result = await inspectCodexRuntimeActivity(createMemoryTransport(messages, sent));

    expect(result).toEqual({
      status: "idle",
      loadedThreadIds: [],
      activeThreadIds: [],
      reason: null,
    });
  });

  test("reports active when any loaded thread has active runtime status", async () => {
    const sent: unknown[] = [];
    const messages = [
      { id: 1, result: { serverInfo: { name: "codex-app-server" } } },
      { id: 2, result: { data: ["thr_idle", "thr_active"] } },
      { id: 3, result: { thread: { id: "thr_idle", status: { type: "idle" } } } },
      {
        id: 4,
        result: {
          thread: {
            id: "thr_active",
            status: { type: "active", activeFlags: ["waitingOnApproval"] },
          },
        },
      },
    ];

    const result = await inspectCodexRuntimeActivity(createMemoryTransport(messages, sent));

    expect(result).toEqual({
      status: "active",
      loadedThreadIds: ["thr_idle", "thr_active"],
      activeThreadIds: ["thr_active"],
      reason: "active-thread-status",
    });
  });
});
