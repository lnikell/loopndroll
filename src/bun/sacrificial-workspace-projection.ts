export type SacrificialWorkspaceProjectionPlan = {
  cwd: string;
  sandboxRoot: string;
  workspacePath: string;
  command: "pnpm run check";
  lane: "sacrificial";
  allowHostGlobalPnpmFallback: false;
  allowInstallOrMaterialization: false;
};

type BuildSacrificialWorkspaceProjectionPlanInput = {
  cwd: string;
  sandboxRoot: string;
};

const REQUIRED_PROJECTION_ERROR =
  "cwd and sandboxRoot are required for the sacrificial workspace projection lane";

function normalizeRequiredPath(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function deriveWorkspaceLeafName(cwd: string) {
  const segments = cwd.split("/").filter((segment) => segment.length > 0);
  return segments.at(-1) ?? "workspace";
}

export function buildSacrificialWorkspaceProjectionPlan(
  input: BuildSacrificialWorkspaceProjectionPlanInput,
): SacrificialWorkspaceProjectionPlan {
  const cwd = normalizeRequiredPath(input.cwd);
  const sandboxRoot = normalizeRequiredPath(input.sandboxRoot);

  if (cwd.length === 0 || sandboxRoot.length === 0) {
    throw new Error(REQUIRED_PROJECTION_ERROR);
  }

  return {
    cwd,
    sandboxRoot,
    workspacePath: `${sandboxRoot}/workspace/${deriveWorkspaceLeafName(cwd)}`,
    command: "pnpm run check",
    lane: "sacrificial",
    allowHostGlobalPnpmFallback: false,
    allowInstallOrMaterialization: false,
  };
}
