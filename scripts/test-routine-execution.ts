import { rpc, waitForRun } from "./lib/api.js";

async function main() {
  const routineId = process.argv[2];
  if (!routineId) {
    console.error("Usage: tsx scripts/test-routine-execution.ts <routineId>");
    process.exit(1);
  }

  const { runId } = await rpc<{ runId: string }>("routines/testRun", { routineId });
  console.log(`Routine ${routineId} started run ${runId}. Waiting for completion...`);

  const run = await waitForRun(runId);
  console.log(`Run status: ${run.status}`);
  process.exitCode = run.status === "completed" ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
