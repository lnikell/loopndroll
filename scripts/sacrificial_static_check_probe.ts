import { buildSacrificialStaticCheckPlan } from "../src/bun/sacrificial-static-check";

type SacrificialStaticCheckProbeArgs = {
  mode: string;
  cwd: string | null;
  sandboxRoot: string | null;
};

function parseArgs(argv: string[]): SacrificialStaticCheckProbeArgs {
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

function getSandboxWorkspaceRoot(sandboxRoot: string) {
  return `${sandboxRoot.replace(/\/+$/, "")}/workspace`;
}

function isWithinSandboxWorkspace(cwd: string, sandboxRoot: string) {
  const workspaceRoot = getSandboxWorkspaceRoot(sandboxRoot);
  return cwd === workspaceRoot || cwd.startsWith(`${workspaceRoot}/`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  try {
    const plan = buildSacrificialStaticCheckPlan({
      cwd: args.cwd ?? "",
      sandboxRoot: args.sandboxRoot ?? "",
    });

    if (args.mode === "run-check" && !isWithinSandboxWorkspace(plan.cwd, plan.sandboxRoot)) {
      printProbeOutput({
        status: "blocked",
        mode: "run-check",
        cwd: plan.cwd,
        sandboxRoot: plan.sandboxRoot,
        lane: plan.lane,
        command: plan.command,
        reason: "repo-outside-sandbox-workspace",
        detail:
          "The repo cwd is outside the sacrificial sandbox workspace, and this lane forbids install/materialization into the sandbox.",
        allowHostGlobalPnpmFallback: plan.allowHostGlobalPnpmFallback,
        allowInstallOrMaterialization: plan.allowInstallOrMaterialization,
      });
      return;
    }

    printProbeOutput({
      status: "ready",
      mode: args.mode,
      cwd: plan.cwd,
      sandboxRoot: plan.sandboxRoot,
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
