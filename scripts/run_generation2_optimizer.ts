import '../src/engine/env';
import { runGeneration2Optimizer, resumeGeneration2Optimizer } from '../src/engine/tree/product_training/generation2';

async function main() {
  const args = process.argv.slice(2);
  let resumeId: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--resume' && i + 1 < args.length) {
      resumeId = args[i + 1];
    }
  }

  if (resumeId) {
    console.log(`[Optimizer] Resuming run: ${resumeId}...`);
    const report = await resumeGeneration2Optimizer(resumeId);
    console.log(`[Optimizer] Resumed run completed. Mined: ${report.summary.totalCasesMined}, Unique: ${report.summary.totalUniqueEvaluations}`);
  } else {
    console.log(`[Optimizer] Starting new autonomous optimization run...`);
    const report = await runGeneration2Optimizer();
    console.log(`[Optimizer] Run completed: ${report.runId}. Cases: ${report.summary.totalCasesMined}, Unique Evals: ${report.summary.totalUniqueEvaluations}, Active Pilot Branches: ${report.summary.activePilotBranchesCount}`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
