import '../src/engine/env';
import { runGeneration2OptimizerCycle } from '../src/engine/tree/product_training/generation2/cycle';

async function main() {
  const args = process.argv.slice(2);
  let iterations = 3;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--iterations' && i + 1 < args.length) {
      iterations = parseInt(args[i + 1], 10);
    }
  }

  console.log(`[OptimizerCycle] Starting Generation 2 Optimizer Cycle (iterations: ${iterations})...`);
  const report = await runGeneration2OptimizerCycle({ maxIterations: iterations });
  console.log(`[OptimizerCycle] Run complete: ${report.runId}. Executed ${report.totalIterationsExecuted} iterations. Final Pilot Library size: ${report.pilotLibrary.length}. Stop reason: ${report.stopReason}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
