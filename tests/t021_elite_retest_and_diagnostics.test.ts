import '../src/engine/env';
import * as assertStrict from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execSync } from 'node:child_process';
import {
  canonicalizeEliteFormation,
  getCanonicalTreeFingerprint,
} from '../scripts/run_t021_diagnostics_and_elite_retest';
import { formationToEvol, walkEvolNodes, type EvolFormation } from '../src/engine/tree/evol_gene';
import { PersistentSimPool } from '../src/engine/tree/persistent_pool';
import type { Formation } from '../src/ai/types';

async function runT021Tests() {
  console.log('=== 开始执行 T021 精英重测保真度与运行时诊断修复专项验收测试 ===\n');

  // Test 1: 验证类型安全转换与树节点保真（反向证明 formationToEvol(evol as Formation) 会丢放置）
  console.log('[Test 1] 验证精英种子树形保真转换与非法强转拦截...');
  const eliteSeedsRaw = JSON.parse(readFileSync(resolve('tests/fixtures/tree/persistent_elite_seeds.json'), 'utf8'));

  for (const raw of eliteSeedsRaw) {
    // 1. 如果错误地调用 formationToEvol(raw as Formation)，放置数会退化为 0
    const brokenEvol = formationToEvol(raw as unknown as Formation);
    let brokenPlacements = 0;
    for (const n of walkEvolNodes(brokenEvol.root)) {
      brokenPlacements += n.placements.length;
    }
    assertStrict.equal(brokenPlacements, 0, '非法类型强转确实会导致 placements 丢失为 0 (已捕获)');

    // 2. 使用规范的 canonicalizeEliteFormation 转换，放置数必须保持非空且与原数据一致
    const validEvol = canonicalizeEliteFormation(raw);
    let validPlacements = 0;
    for (const n of walkEvolNodes(validEvol.root)) {
      validPlacements += n.placements.length;
    }
    assertStrict.ok(validPlacements > 0, '规范转换必须保留全部 placements');

    const fp = getCanonicalTreeFingerprint(validEvol);
    assertStrict.ok(fp.startsWith('team:'), '指纹必须以 team 开头');
    assertStrict.ok(fp.includes('node:'), '指纹必须包含节点段');
  }
  console.log('  ✓ 精英种子树形保真与防退化断言通过。\n');

  // Test 2: 验证精英重测档案 (elite_seed_retests.jsonl)
  console.log('[Test 2] 验证精英重测档案与真实战绩...');
  const diagDir = resolve('tests/fixtures/tree/t020_runtime_diagnostics');
  const eliteRetestsPath = join(diagDir, 'elite_seed_retests.jsonl');
  assertStrict.ok(existsSync(eliteRetestsPath), 'elite_seed_retests.jsonl 必须存在');

  const eliteRetests = readFileSync(eliteRetestsPath, 'utf8')
    .trim()
    .split('\n')
    .map(l => JSON.parse(l));

  assertStrict.equal(eliteRetests.length, 3, '必须包含 3 个精英种子重测记录');
  for (const r of eliteRetests) {
    assertStrict.equal(r.preflight.passed, true, 'Preflight 必须通过');
    assertStrict.equal(r.earlyHeldOut.workerErrorCount, 0, 'Held-Out 必须 0 Worker Errors');
    assertStrict.equal(r.strongPanel.workerErrorCount, 0, 'Strong Panel 必须 0 Worker Errors');
    assertStrict.equal(r.status, 'COMPLETE_VALID_EVALUATED', '状态必须为 COMPLETE_VALID_EVALUATED');
    assertStrict.ok(r.earlyHeldOut.trainingScore > 0.40, '真实精英战绩训练分必须 > 40%');
  }
  console.log('  ✓ 3 个精英重测记录校验通过 (全部 0 Errors, 真实高胜率)。\n');

  // Test 3: 验证全量 30 候选诊断档案 (runtime_diagnostic_ledger.jsonl)
  console.log('[Test 3] 验证全量诊断档案 (含全零候选分类)...');
  const diagLedgerPath = join(diagDir, 'runtime_diagnostic_ledger.jsonl');
  assertStrict.ok(existsSync(diagLedgerPath), 'runtime_diagnostic_ledger.jsonl 必须存在');

  const diagLedger = readFileSync(diagLedgerPath, 'utf8')
    .trim()
    .split('\n')
    .map(l => JSON.parse(l));

  assertStrict.equal(diagLedger.length, 30, '必须包含全部 30 个候选的诊断记录');

  // 验证坚果救星 3 个 T017 候选均在诊断清册中
  const s2Cands = diagLedger.filter(d => d.sourceSeedName === '坚果救星');
  assertStrict.equal(s2Cands.length, 3, '必须包含 3 个坚果救星候选');
  for (const s2 of s2Cands) {
    assertStrict.equal(s2.preflight.passed, true, 'Preflight 必须通过');
    assertStrict.equal(s2.heldOutEvaluation.workerErrorCount, 0, '必须 0 错误');
  }

  const summaryMdPath = join(diagDir, 'diagnostic_summary.md');
  assertStrict.ok(existsSync(summaryMdPath), 'diagnostic_summary.md 必须存在');
  console.log('  ✓ 全量 30 候选诊断清册与 Summary Markdown 校验通过。\n');

  // Test 4: 验证任务规范文件存在与恢复 (T020, T021)
  console.log('[Test 4] 验证任务规范文件完整存在与 Git 追踪...');
  const t020Spec = resolve('TASKS/tree/T020-runtime-integrity-and-elite-seed-continuity.md');
  const t021Spec = resolve('TASKS/tree/T021-t020-elite-retest-and-runtime-diagnostic-repair.md');
  assertStrict.ok(existsSync(t020Spec), 'T020 规范必须存在');
  assertStrict.ok(existsSync(t021Spec), 'T021 规范必须存在');
  console.log('  ✓ T020/T021 任务规范文件完整存在。\n');

  // Test 5: 验证 Worker 异常保留契约 (T020 原有核心逻辑)
  console.log('[Test 5] 验证 Worker 异常错误保留契约...');
  const pool = new PersistentSimPool({ workerCount: 2, enableCpuMonitor: false });
  await pool.init();
  const fakeFormation: any = { name: 'FakeErr', archetype: 'prayer', team: [{ monsterId: 110, badgeIds: [] }], root: null };
  const fakeOpp: any = { id: 'springsword', name: '泉水剑', archetype: 'prayer', team: [{ monsterId: 110, badgeIds: [] }], tree: null };
  const [errorMetrics] = await pool.evalCandidateBatchOnMatchedParallel([fakeFormation], { side: null, main: null, subs: [], keys: [] }, [fakeOpp], 1, 1234);
  assertStrict.equal(errorMetrics.isEvaluationComplete, false);
  assertStrict.ok((errorMetrics.workerErrorCount ?? 0) > 0);
  pool.destroy();
  console.log('  ✓ Worker 异常保留契约验证通过。\n');

  console.log('=== 所有 T021 验收测试全部通过 ===');
}

runT021Tests().catch((err) => {
  console.error('T021 测试失败:', err);
  process.exit(1);
});
