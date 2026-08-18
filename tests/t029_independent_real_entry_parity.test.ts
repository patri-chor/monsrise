import '../src/engine/env';
import * as assertStrict from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  getAuthorityArtifactManifest,
  auditRealAdapter,
  executeRealApplicationEntry,
  executeTreeRunnerEntry,
  compareIndependentBehaviorParity,
} from '../src/engine/tree/independent_real_entry_parity';
import type { Formation } from '../src/ai/types';

/**
 * T029 否决回归测试：证明旧的「60 组独立真实入口对决案例逐位完全一致 100% PASS」
 * 主张是假的 —— 真实侧（playFullGame 贪心）与树侧（playSpecVsSpec 树模式）是真正
 * 不同的执行路径，独立 parity 诚实报告为不成立，训练证据保持 SANDBOX_ENGINE_UNVERIFIED。
 */
async function runT029RejectionRegression() {
  console.log('=== T029 否决回归测试（旧“100% 独立 parity PASS”主张被 T031 证伪）===\n');

  // 1) 权威制品身份绝对化（不再用 cwd 相对 resolve('public/...')）
  const manifest = getAuthorityArtifactManifest();
  console.log(`  authority = ${manifest.authorityBundleAbsoluteSource}`);
  console.log(`  sha256    = ${manifest.authorityBundleSHA256}`);
  assertStrict.equal(manifest.authorityResolvedFromCwd, false, '权威身份不得来自 cwd 相对解析');
  assertStrict.notEqual(manifest.authorityBundleSHA256, 'FILE_NOT_FOUND', '权威制品必须存在');

  // 2) 真实侧适配器独立（调用 playFullGame，无 tree 传递依赖）
  const audit = auditRealAdapter();
  assertStrict.equal(audit.invokesPlayFullGame, true, '真实入口必须实际调用产品入口 playFullGame');
  assertStrict.equal(audit.clean, true, '真实侧适配器必须独立（无 playSpecVsSpec/PersistentSimPool/fine_grained_worker）');
  console.log(`  realAdapterClean=${audit.clean} invokesPlayFullGame=${audit.invokesPlayFullGame}`);

  // 3) 两个入口确实来自不同模块（但函数引用不等不是独立证据——独立由调用溯源+传递闭包证明）
  assertStrict.notStrictEqual(executeRealApplicationEntry, executeTreeRunnerEntry);

  // 4) 全矩阵独立 parity 诚实结果：旧主张 100% PASS 必须被推翻
  const sources: Formation[] = JSON.parse(
    readFileSync(resolve('tests/fixtures/tree/eleven_frozen_sources.json'), 'utf8'),
  ).filter((s: any) => !s.isLegacyBaseline);
  const earlyFamilies = JSON.parse(readFileSync(resolve('tests/fixtures/tree/early_seven_bundles.json'), 'utf8'));
  const testOpps: Formation[] = earlyFamilies.slice(0, 3).map((f: any) => f.heldOutVariant);

  const parity = compareIndependentBehaviorParity(sources, testOpps);
  console.log(`  共执行 ${parity.totalComparisons} 组真实侧 vs 树侧规范轨迹比较；identical=${parity.identicalCount}`);
  assertStrict.equal(parity.totalComparisons, 60, '必须完成 10×3×2=60 组');
  for (const d of parity.details) {
    if (!d.identical) {
      assertStrict.ok(d.firstMismatch, `案例 ${d.sourceName} vs ${d.opponentName} (side${d.side}) 必须给出首字段差异诊断`);
    }
  }
  // 旧主张（60 组逐位完全一致、100% PASS）必须被诚实推翻
  assertStrict.equal(parity.allPassed, false, 'T029 的 100% 独立 parity PASS 主张必须被证伪');
  console.log('  ✓ 旧 T029 主张（60 组逐位完全一致 100% PASS）被诚实证伪；SANDBOX_ENGINE_UNVERIFIED 保持不变。\n');

  console.log('=== T029 否决回归测试通过 ===');
}

runT029RejectionRegression().catch((err) => {
  console.error('T029 否决回归测试失败:', err);
  process.exit(1);
});
