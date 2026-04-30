import { readFile } from "node:fs/promises";
import { describe, expect, test } from "bun:test";
import type { AppRpcSchema } from "../shared/app-rpc";

type LoopndrollSetupRequestName = keyof Pick<
  AppRpcSchema["bun"]["requests"],
  "ensureLoopndrollSetup" | "getLoopndrollState"
>;

const LOOPNDROLL_SETUP_REQUEST_NAMES = [
  "ensureLoopndrollSetup",
  "getLoopndrollState",
] satisfies LoopndrollSetupRequestName[];

describe("loopndroll product RPC setup surface", () => {
  test("keeps the setup request names in the RPC schema", () => {
    const requestNames: LoopndrollSetupRequestName[] = [...LOOPNDROLL_SETUP_REQUEST_NAMES];

    expect(requestNames).toEqual(["ensureLoopndrollSetup", "getLoopndrollState"]);
  });

  test("wires the setup request handlers in the product RPC entrypoint", async () => {
    const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");

    expect(source).toContain("ensureLoopndrollSetup,");
    expect(source).toContain("getLoopndrollState: getLoopndrollSnapshot,");
  });
});
