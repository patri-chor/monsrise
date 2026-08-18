import '../src/engine/env';
import { runExperiencePipeline } from '../src/engine/tree/experience_training_pipeline';
import { PersistentSimPool } from '../src/engine/tree/persistent_pool';

async function main() {
  const args = process.argv.slice(2);
  const isSmoke = args.includes('--smoke');
  const phaseArg = args.find(a => a.startsWith('--phase='))?.split('=')[1] as any;
  const isResume = args.includes('--resume');

  console.log(`=== 启动 T022 经验累积训练流水线 (Smoke: ${isSmoke}, Phase: ${phaseArg ?? 'full'}, Resume: ${isResume}) ===\n`);

  const pool = new PersistentSimPool({ workerCount: 8, enableCpuMonitor: false });
  await pool.init();

  const result = await runExperiencePipeline({
    smoke: isSmoke,
    phase: phaseArg ?? 'full',
    resume: isResume,
    pool,
    onProgress: (msg) => console.log(msg),
  });

  pool.destroy();

  console.log('\n=== T022 流水线执行结果 ===');
  console.log(JSON.stringify({ status: result.status, candidateCount: (result as any).candidateCount, observationCount: (result as any).observationCount }, null, 2));
}

main().catch(err => {
  console.error('流水线执行异常:', err);
  process.exit(1);
});
