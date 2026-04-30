import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

export type CodexAppServerTransport = {
  sent: unknown[];
  readMessage: () => Promise<unknown>;
  writeMessage: (message: unknown) => Promise<void>;
  close: () => Promise<void>;
};

export type CanonicalThreadDiscoveryRecord = {
  threadId: string;
  threadName: string | null;
  cwd: string | null;
};

export type CodexRuntimeActivityInspection = {
  status: "idle" | "active" | "unknown";
  loadedThreadIds: string[];
  activeThreadIds: string[];
  reason: string | null;
};

export type CodexAppServerNotification = {
  method: string;
  params?: unknown;
};

type LocalCodexAppServerChild = {
  stdin: Writable;
  stdout: Readable;
  kill: () => void;
};

function failClosedTransportStartup(
  child: Pick<LocalCodexAppServerChild, "kill">,
  message: string,
): never {
  child.kill();
  throw new Error(message);
}

function createReadMessage(lines: string[]) {
  return async () => {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const line = lines.shift();
      if (line) {
        return JSON.parse(line);
      }
      await Bun.sleep(25);
    }
    throw new Error("app-server-timeout");
  };
}

export function createCodexAppServerTransportFromChild(
  child: LocalCodexAppServerChild,
): CodexAppServerTransport {
  if (!child.stdin) {
    failClosedTransportStartup(child, "app-server-stdin-missing");
  }
  if (!child.stdout) {
    failClosedTransportStartup(child, "app-server-stdout-missing");
  }

  const sent: unknown[] = [];
  const lines: string[] = [];
  let readline;
  try {
    readline = createInterface({ input: child.stdout });
  } catch {
    failClosedTransportStartup(child, "app-server-transport-setup-failed");
  }
  readline.on("line", (line) => lines.push(line));

  return {
    sent,
    readMessage: createReadMessage(lines),
    async writeMessage(message) {
      sent.push(message);
      child.stdin.write(`${JSON.stringify(message)}\n`);
    },
    async close() {
      readline.close();
      child.kill();
    },
  };
}

export async function createSpawnedCodexAppServerTransport(): Promise<CodexAppServerTransport> {
  const child = spawn("codex", ["app-server"], {
    stdio: ["pipe", "pipe", "ignore"],
  });

  if (!child.stdin || !child.stdout) {
    child.kill();
    throw new Error("app-server-transport-setup-failed");
  }

  return createCodexAppServerTransportFromChild({
    stdin: child.stdin,
    stdout: child.stdout,
    kill() {
      child.kill();
    },
  });
}

async function rpcCall(
  transport: CodexAppServerTransport,
  id: number,
  method: string,
  params: Record<string, unknown>,
  onNotification?: (notification: CodexAppServerNotification) => void | Promise<void>,
) {
  await transport.writeMessage({ id, method, params });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const message = (await transport.readMessage()) as
      | {
          id?: number;
          method?: string;
          params?: unknown;
          result?: Record<string, unknown>;
          error?: { message?: string };
        }
      | undefined;
    if (typeof message?.method === "string") {
      await onNotification?.({ method: message.method, params: message.params });
      continue;
    }
    if (message?.id === id) {
      return message as
        | {
            id: number;
            result?: Record<string, unknown>;
            error?: { message?: string };
          }
        | undefined;
    }
  }

  throw new Error(`app-server-response-timeout:${method}`);
}

async function initializeCodexAppServerConnection(transport: CodexAppServerTransport) {
  const init = await rpcCall(transport, 1, "initialize", {
    clientInfo: {
      name: "loopndroll",
      title: "Loopndroll",
      version: "1.1.5",
    },
  });
  if (!init?.result) {
    return false;
  }

  await transport.writeMessage({ method: "initialized", params: {} });
  return true;
}

function getThreadStatusType(thread: unknown) {
  if (typeof thread !== "object" || thread === null || !("status" in thread)) {
    return null;
  }

  const status = thread.status;
  return typeof status === "object" &&
    status !== null &&
    "type" in status &&
    typeof status.type === "string"
    ? status.type
    : null;
}

export async function inspectCodexRuntimeActivity(
  transport: CodexAppServerTransport,
): Promise<CodexRuntimeActivityInspection> {
  try {
    if (!(await initializeCodexAppServerConnection(transport))) {
      return {
        status: "unknown",
        loadedThreadIds: [],
        activeThreadIds: [],
        reason: "initialize-failed",
      };
    }

    const listed = await rpcCall(transport, 2, "thread/loaded/list", {});
    const loadedThreadIds = Array.isArray(listed?.result?.data)
      ? listed.result.data.filter((threadId): threadId is string => typeof threadId === "string")
      : [];

    if (!listed?.result || loadedThreadIds.length === 0) {
      return {
        status: listed?.result ? "idle" : "unknown",
        loadedThreadIds,
        activeThreadIds: [],
        reason: listed?.result ? null : (listed?.error?.message ?? "loaded-list-failed"),
      };
    }

    const activeThreadIds: string[] = [];
    for (const [index, threadId] of loadedThreadIds.entries()) {
      const read = await rpcCall(transport, 3 + index, "thread/read", {
        threadId,
        includeTurns: false,
      });
      const statusType = getThreadStatusType(read?.result?.thread);
      if (statusType === "active") {
        activeThreadIds.push(threadId);
      }
      if (!read?.result || statusType === null) {
        return {
          status: "unknown",
          loadedThreadIds,
          activeThreadIds,
          reason: read?.error?.message ?? "thread-status-unknown",
        };
      }
    }

    return {
      status: activeThreadIds.length > 0 ? "active" : "idle",
      loadedThreadIds,
      activeThreadIds,
      reason: activeThreadIds.length > 0 ? "active-thread-status" : null,
    };
  } catch (error) {
    return {
      status: "unknown",
      loadedThreadIds: [],
      activeThreadIds: [],
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function listThreadsForCwdViaCodexAppServer(
  transport: CodexAppServerTransport,
  cwd: string,
): Promise<CanonicalThreadDiscoveryRecord[]> {
  const trimmedCwd = cwd.trim();
  if (trimmedCwd.length === 0) {
    return [];
  }

  if (!(await initializeCodexAppServerConnection(transport))) {
    return [];
  }

  const listed = await rpcCall(transport, 2, "thread/list", {
    cwd: trimmedCwd,
  });

  const rows = Array.isArray(listed?.result?.data) ? listed.result.data : [];
  return rows.flatMap((row) => {
    if (typeof row !== "object" || row === null || !("id" in row) || typeof row.id !== "string") {
      return [];
    }

    const threadName =
      "name" in row && typeof row.name === "string"
        ? row.name
        : "name" in row && row.name === null
          ? null
          : null;

    const resolvedCwd =
      "cwd" in row && typeof row.cwd === "string"
        ? row.cwd
        : "cwd" in row && row.cwd === null
          ? null
          : trimmedCwd;

    return [
      {
        threadId: row.id,
        threadName,
        cwd: resolvedCwd,
      } satisfies CanonicalThreadDiscoveryRecord,
    ];
  });
}
