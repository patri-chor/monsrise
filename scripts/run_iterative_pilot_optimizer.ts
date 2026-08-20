import '../src/engine/env';
import { runIterativePilotOptimizer } from '../src/engine/tree/product_training/generation2';

async function main() {
  const args = process.argv.slice(2);
  let iterations = 3;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--iterations' && i + 1 < args.length) {
      iterations = parseInt(args[i + 1], 10);
    }
  }

  console.log(`[IterativeOptimizer] Starting iterative optimization (maxIterations: ${iterations})...`);
  const report = await runIterativePilotOptimizer({ maxIterations: iterations });
  console.log(`[IterativeOptimizer] Completed ${report.totalIterationsExecuted} iterations. Final Pilot Library size: ${report.pilotLibrary.length}. Stop reason: ${report.stopReason}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
