import '../src/engine/env';
import { runExperiencePipeline } from '../src/engine/tree/experience_training_pipeline';
import { PersistentSimPool } from '../src/engine/tree/persistent_pool';

async function main() {
  const args = process.argv.slice(2);
  const isSmoke = args.includes('--smoke');
  const phaseArg = args.find(a => a.startsWith('--phase='))?.split('=')[1] as any;
  const isResume = args.includes('--resume');
  const runIdArg = args.find(a => a.startsWith('--run-id='))?.split('=')[1];

  console.log(`=== 启动 T023 经验累积训练流水线 (Smoke: ${isSmoke}, Phase: ${phaseArg ?? 'full'}, Resume: ${isResume}, RunID: ${runIdArg ?? 'auto'}) ===\n`);

  const pool = new PersistentSimPool({ workerCount: 8, enableCpuMonitor: false });
  await pool.init();

  const result = await runExperiencePipeline({
    smoke: isSmoke,
    phase: phaseArg ?? 'full',
    resume: isResume,
    runId: runIdArg,
    pool,
    onProgress: (msg) => console.log(msg),
  });

  pool.destroy();

  console.log('\n=== T023 流水线执行结果 ===');
  console.log(JSON.stringify({
    status: result.status,
    runKind: (result as any).runKind,
    candidateCount: (result as any).candidateCount,
    completedThisRun: (result as any).completedThisRun,
  }, null, 2));
}

main().catch(err => {
  console.error('流水线执行异常:', err);
  process.exit(1);
});
