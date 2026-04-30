import { buildSacrificialWorkspaceProjectionPlan } from "../src/bun/sacrificial-workspace-projection";
import { stat } from "node:fs/promises";

type SacrificialWorkspaceProjectionProbeArgs = {
  mode: string;
  cwd: string | null;
  sandboxRoot: string | null;
};

function parseArgs(argv: string[]): SacrificialWorkspaceProjectionProbeArgs {
  let mode = "readiness";
  let cwd: string | null = null;
  let sandboxRoot: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--mode") {
      mode = argv[index + 1] ?? mode;
      index += 1;
      continue;
    }

    if (token === "--cwd") {
      cwd = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (token === "--sandbox-root") {
      sandboxRoot = argv[index + 1] ?? null;
      index += 1;
    }
  }

  return { mode, cwd, sandboxRoot };
}

function printProbeOutput(payload: Record<string, unknown>) {
  console.log(JSON.stringify(payload, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  try {
    const plan = buildSacrificialWorkspaceProjectionPlan({
      cwd: args.cwd ?? "",
      sandboxRoot: args.sandboxRoot ?? "",
    });

    if (args.mode === "run-check") {
      const workspaceExists = await stat(plan.workspacePath)
        .then(() => true)
        .catch(() => false);

      if (!workspaceExists) {
        printProbeOutput({
          status: "blocked",
          mode: "run-check",
          cwd: plan.cwd,
          sandboxRoot: plan.sandboxRoot,
          workspacePath: plan.workspacePath,
          lane: plan.lane,
          command: plan.command,
          reason: "projected-workspace-missing",
          detail:
            "The projected sandbox workspace path does not exist, and this lane forbids install/materialization into the sandbox.",
          allowHostGlobalPnpmFallback: plan.allowHostGlobalPnpmFallback,
          allowInstallOrMaterialization: plan.allowInstallOrMaterialization,
        });
        return;
      }
    }

    printProbeOutput({
      status: "ready",
      mode: args.mode,
      cwd: plan.cwd,
      sandboxRoot: plan.sandboxRoot,
      workspacePath: plan.workspacePath,
      lane: plan.lane,
      command: plan.command,
      allowHostGlobalPnpmFallback: plan.allowHostGlobalPnpmFallback,
      allowInstallOrMaterialization: plan.allowInstallOrMaterialization,
    });
  } catch (error) {
    printProbeOutput({
      status: "blocked",
      cwd: args.cwd,
      sandboxRoot: args.sandboxRoot,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

await main();
