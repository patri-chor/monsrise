import '../src/engine/env';
import { TreeCycleOrchestrator } from '../src/engine/tree/tree_cycle';
import { TreeDynamicPool } from '../src/engine/tree/tree_dynamic_pool';

async function main() {
  const isSmoke = process.argv.includes('--smoke');
  const pool = new TreeDynamicPool();
  const entries = pool.initOrLoad();
  const target = entries[0];

  console.log(`[TreeCycle CLI] Starting ${isSmoke ? 'Smoke' : 'Full'} Optimizer Cycle for target ${target.formationId}...`);

  const report = await TreeCycleOrchestrator.runCycle({
    targetFormationId: target.formationId,
    maxIterations: isSmoke ? 1 : 3,
    uniqueCandidatesPerCase: isSmoke ? 8 : 32,
    populationSize: 4,
    maxGenerations: 1,
    parallelBackend: 'worker_threads',
    workerCount: 2,
  });

  console.log(`[TreeCycle CLI] Complete! Run ID: ${report.runId}, Total Iterations: ${report.totalIterationsExecuted}, Accepted Branches: ${report.summary.totalAcceptedBranches}`);
}

main().catch(err => {
  console.error('[TreeCycle CLI Error]:', err);
  process.exit(1);
});
