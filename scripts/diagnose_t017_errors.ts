import '../src/engine/env';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PersistentSimPool } from '../src/engine/tree/persistent_pool';
import { formationToEvol, type FeatureMask } from '../src/engine/tree/evol_gene';
import type { Formation } from '../src/ai/types';

async function main() {
  const pool = new PersistentSimPool({ workerCount: 4, enableCpuMonitor: false });
  await pool.init();

  const cands = readFileSync(resolve('tests/fixtures/tree/thirty_three_mutated_candidates.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map(l => JSON.parse(l));

  const families = JSON.parse(readFileSync(resolve('tests/fixtures/tree/early_seven_bundles.json'), 'utf8'));
  const opps = families.map((f: any) => f.trainingVariant);
  const emptyMask: FeatureMask = { side: null, main: null, subs: [], keys: [] };

  console.log('=== 开始 T017 候选运行时 Preflight 诊断 ===\n');
  const errorLedger: any[] = [];

  for (const c of cands) {
    const evol = formationToEvol(c as unknown as Formation);
    const [metrics] = await pool.evalCandidateBatchOnMatchedParallel([evol], emptyMask, opps, 1, 5000);
    const hasError = (metrics.workerErrorCount ?? 0) > 0;
    console.log(`Candidate ${c.candidateId} (${c.sourceSeedName}): Score=${(metrics.trainingScore * 100).toFixed(1)}%, W/D/L=${metrics.win}/${metrics.draw}/${metrics.loss}, Errors=${metrics.workerErrorCount ?? 0}`);
    if (hasError) {
      console.log(`  -> Error details:`, metrics.workerErrors);
      errorLedger.push({
        candidateId: c.candidateId,
        sourceSeedName: c.sourceSeedName,
        errors: metrics.workerErrors,
      });
    }
  }

  pool.destroy();
  console.log(`\n诊断完成: 共 ${errorLedger.length} 个候选存在运行时错误。`);
}

main().catch(err => {
  console.error('诊断脚本失败:', err);
  process.exit(1);
});
