import { describe, expect, test } from "bun:test";

import { buildSacrificialWorkspaceProjectionPlan } from "./sacrificial-workspace-projection";

describe("buildSacrificialWorkspaceProjectionPlan", () => {
  test("requires cwd and sandboxRoot and derives a deterministic sandbox workspace path", () => {
    const plan = buildSacrificialWorkspaceProjectionPlan({
      cwd: "/tmp/loopndroll-threadmark",
      sandboxRoot: "/tmp/sandbox",
    });

    expect(plan).toEqual({
      cwd: "/tmp/loopndroll-threadmark",
      sandboxRoot: "/tmp/sandbox",
      workspacePath: "/tmp/sandbox/workspace/loopndroll-threadmark",
      command: "pnpm run check",
      lane: "sacrificial",
      allowHostGlobalPnpmFallback: false,
      allowInstallOrMaterialization: false,
    });
  });

  test("fails closed when cwd or sandboxRoot is missing", () => {
    expect(() =>
      buildSacrificialWorkspaceProjectionPlan({
        cwd: "",
        sandboxRoot: "/tmp/sandbox",
      }),
    ).toThrow("cwd and sandboxRoot are required for the sacrificial workspace projection lane");

    expect(() =>
      buildSacrificialWorkspaceProjectionPlan({
        cwd: "/tmp/loopndroll-threadmark",
        sandboxRoot: "",
      }),
    ).toThrow("cwd and sandboxRoot are required for the sacrificial workspace projection lane");
  });
});
