export type SacrificialStaticCheckPlan = {
  cwd: string;
  sandboxRoot: string;
  command: "pnpm run check";
  lane: "sacrificial";
  allowHostGlobalPnpmFallback: false;
  allowInstallOrMaterialization: false;
};

type BuildSacrificialStaticCheckPlanInput = {
  cwd: string;
  sandboxRoot: string;
};

const REQUIRED_LANE_ERROR =
  "cwd and sandboxRoot are required for the sacrificial static-check lane";

function normalizeRequiredPath(value: string) {
  return value.trim();
}

export function buildSacrificialStaticCheckPlan(
  input: BuildSacrificialStaticCheckPlanInput,
): SacrificialStaticCheckPlan {
  const cwd = normalizeRequiredPath(input.cwd);
  const sandboxRoot = normalizeRequiredPath(input.sandboxRoot);

  if (cwd.length === 0 || sandboxRoot.length === 0) {
    throw new Error(REQUIRED_LANE_ERROR);
  }

  return {
    cwd,
    sandboxRoot,
    command: "pnpm run check",
    lane: "sacrificial",
    allowHostGlobalPnpmFallback: false,
    allowInstallOrMaterialization: false,
  };
}
