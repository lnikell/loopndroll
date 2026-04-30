import { describe, expect, test } from "bun:test";

import { buildSacrificialStaticCheckPlan } from "./sacrificial-static-check";

describe("buildSacrificialStaticCheckPlan", () => {
  test("requires cwd and sandboxRoot and keeps check execution inside the sacrificial lane", () => {
    const plan = buildSacrificialStaticCheckPlan({
      cwd: "/tmp/loopndroll",
      sandboxRoot: "/tmp/sandbox",
    });

    expect(plan).toEqual({
      cwd: "/tmp/loopndroll",
      sandboxRoot: "/tmp/sandbox",
      command: "pnpm run check",
      lane: "sacrificial",
      allowHostGlobalPnpmFallback: false,
      allowInstallOrMaterialization: false,
    });
  });

  test("fails closed when cwd or sandboxRoot is missing", () => {
    expect(() =>
      buildSacrificialStaticCheckPlan({
        cwd: "",
        sandboxRoot: "/tmp/sandbox",
      }),
    ).toThrow("cwd and sandboxRoot are required for the sacrificial static-check lane");

    expect(() =>
      buildSacrificialStaticCheckPlan({
        cwd: "/tmp/loopndroll",
        sandboxRoot: "",
      }),
    ).toThrow("cwd and sandboxRoot are required for the sacrificial static-check lane");
  });
});
