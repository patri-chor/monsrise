import '../src/engine/env';
import { runTier2VsTier1RoundRobinAndPruning } from '../src/engine/tree/round_robin_and_pruning_optimizer';
import { PersistentSimPool } from '../src/engine/tree/persistent_pool';

async function main() {
  console.log('=== 启动 Tier 2 (第二梯队) vs Tier 1 (第一梯队 11 阵) 全矩阵博弈与决策树剪枝优化流水线 ===\n');

  const pool = new PersistentSimPool({ workerCount: 8, enableCpuMonitor: false });
  await pool.init();

  const result = await runTier2VsTier1RoundRobinAndPruning(pool, (msg) => console.log(msg));

  pool.destroy();

  console.log('\n=== 流水线执行汇总 ===');
  console.log(`总对局对抗组合: ${result.totalMatches}`);
  console.log(`完成深评候选数: ${result.candidatesEvaluated}`);
}

main().catch(err => {
  console.error('执行异常:', err);
  process.exit(1);
});
