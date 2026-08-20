import '../src/engine/env';
import { PersistentSimPool } from '../src/engine/tree/persistent_pool';
import { loadCurrentStrong11Opponents } from '../src/engine/tree/product_training/benchmark_pools';
import { loadProductSources } from '../src/engine/tree/product_training/01_sources';
import { formationToEvol } from '../src/engine/tree/evol_gene';
import type { SimTaskMessage } from '../src/engine/tree/fine_grained_worker';

async function testReal() {
  console.log('1. Initializing 16 workers...');
  const pool = await PersistentSimPool.getInstance({ workerCount: 16 });
  await pool.init();
  console.log('2. Pool ready.');

  const strong11 = loadCurrentStrong11Opponents().opponents;
  const sources = loadProductSources().executable;

  const tasks: SimTaskMessage[] = [];
  let taskId = 0;

  for (let s = 0; s < 5; s++) {
    const src = sources[s];
    const evol = formationToEvol(src as any);
    for (let opp of strong11) {
      for (const side of [1, 2] as (1 | 2)[]) {
        tasks.push({
          taskId: taskId++,
          formalRequest: true,
          executionMode: 'product_path',
          formationA: evol,
          opponentNameOrId: opp.name,
          opponentFormation: opp as any,
          side,
          seed: 50000 + taskId,
          games: 10,
        });
      }
    }
  }

  console.log(`3. Dispatching ${tasks.length} tasks (${tasks.length * 10} games)...`);
  const t0 = Date.now();
  const results = await pool.dispatchTasks(tasks, 'real_test');
  console.log(`4. Successfully completed in ${Date.now() - t0}ms! Received ${results.length} results.`);
  pool.destroy();
}

testReal().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
