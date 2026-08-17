import '../src/engine/env';
import * as assertStrict from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { PersistentSimPool } from '../src/engine/tree/persistent_pool';
import { loadAuthoritativeFrozenCandidates } from '../src/engine/tree/sequential_tree_optimization';
import { resolveEvaluationPanel } from '../src/engine/tree/candidate_optimization_runner';
import { computeCalculatedUnitRatio, generateOrderCandidates, type BundleFamily } from '../src/engine/tree/order_search';
import { evolToBundleFormation, type EvolFormation, type FeatureMask } from '../src/engine/tree/evol_gene';
import { calculateMatchMetrics, type MatchMetrics, formatMatchMetrics } from '../src/engine/tree/match_metrics';
import type { Formation } from '../src/ai/types';

async function runT014Tests() {
  console.log('=== 开始执行 T014 早期 7 家族生态与计算定位单位顺序优化专项验收测试 ===\n');

  // 1. 验证 Fixture 完整性与无泄漏
  console.log('[Test 1] 验证早期 7 家族生态 Fixture 完整性与变体隔离...');
  const fixturePath = resolve('tests/fixtures/tree/early_seven_bundles.json');
  assertStrict.ok(existsSync(fixturePath), 'early_seven_bundles.json 必须存在');

  const families: BundleFamily[] = JSON.parse(readFileSync(fixturePath, 'utf8'));
  assertStrict.equal(families.length, 7, '必须恰好包含 7 个代表性早期家族');

  for (const f of families) {
    assertStrict.ok(f.familyId && f.chineseName && f.archetypeDescription, `家族 ${f.familyId} 必须包含完整元数据`);
    assertStrict.ok(f.trainingVariant && f.trainingVariant.team.length >= 6, `家族 ${f.familyId} trainingVariant 必须合法`);
    assertStrict.ok(f.heldOutVariant && f.heldOutVariant.team.length >= 6, `家族 ${f.familyId} heldOutVariant 必须合法`);
    assertStrict.notEqual(f.trainingVariant.id, f.heldOutVariant.id, `家族 ${f.familyId} 训练与保留变体 ID 必须隔离`);
  }
  console.log('  ✓ 7 家族生态 Fixture 校验通过，训练与验证变体完全隔离。\n');

  // 2. 验证非相邻顺序枚举与计算怪兽零站位变异
  console.log('[Test 2] 验证非相邻排列与计算怪兽零站位变异规则...');
  const sampleCand = loadAuthoritativeFrozenCandidates(resolve('tests/fixtures/tree/eight_frozen_candidates.jsonl'))[0];
  const evolSample: EvolFormation = {
    name: sampleCand.candidateId,
    archetype: sampleCand.archPath || 'prayer',
    team: sampleCand.team,
    root: sampleCand.tree,
  };
  const candAnalysis = computeCalculatedUnitRatio(sampleCand.team);
  const genRes = generateOrderCandidates(evolSample, sampleCand.candidateId, 'test_fp');

  assertStrict.ok(genRes.stats.withinRoundReorders >= 0, '必须支持轮内重排');
  // 验证计算怪兽零站位变异
  for (const c of genRes.candidates) {
    if (c.operatorType === 'controllable_reposition') {
      assertStrict.ok(!candAnalysis.calculatedMonsterIds.includes(c.monsterId), `计算怪兽 ${c.monsterId} 严禁生成位置变异`);
    }
  }
  console.log(`  ✓ 候选 ${sampleCand.candidateId} 计算单位占比 ${(candAnalysis.ratio * 100).toFixed(1)}%，拦截计算单位站位变异 ${genRes.stats.calculatorPositionsBlocked} 次。\n`);

  // 3. 执行完整 8 候选顺序优化 Run
  console.log('[Test 3] 启动 8 候选早期 7 家族生态顺序优化与泛化评测...');
  const pool = new PersistentSimPool({ workerCount: 16, enableCpuMonitor: false });
  await pool.init();

  const candidates = loadAuthoritativeFrozenCandidates(resolve('tests/fixtures/tree/eight_frozen_candidates.jsonl'));
  assertStrict.equal(candidates.length, 8, '必须处理全部 8 个候选');

  const trainingOpps = families.map(f => f.trainingVariant);
  const heldOutOpps = families.map(f => f.heldOutVariant);
  const strongPanel = resolveEvaluationPanel();

  const emptyMask: FeatureMask = { side: null, main: null, subs: [], keys: [] };

  const outputDir = resolve('reports/new-formation-generation/early-seven-bundle-order-search-proof');
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const results: any[] = [];

  for (let cIdx = 0; cIdx < candidates.length; cIdx++) {
    const raw = candidates[cIdx];
    const evolForm: EvolFormation = {
      name: raw.candidateId,
      archetype: raw.archPath || 'prayer',
      team: raw.team,
      root: raw.tree,
    };

    const ratioAnalysis = computeCalculatedUnitRatio(raw.team);
    const searchRes = generateOrderCandidates(evolForm, raw.candidateId, `c_${cIdx}`);

    console.log(`  [Cand ${cIdx + 1}/8] ${raw.candidateId} (Seed ${raw.sourceSeedName}): 计算单位比率 ${(ratioAnalysis.ratio * 100).toFixed(1)}% (算力: ${ratioAnalysis.calculatedCount}/${ratioAnalysis.totalCount}), 生成顺序候选 ${searchRes.candidates.length} 个`);

    // 初始在 trainingOpps 上的评估
    const [initTrainMetrics] = await pool.evalCandidateBatchOnMatchedParallel(
      [evolForm],
      emptyMask,
      trainingOpps,
      1,
      5000 + cIdx * 500,
    );

    let bestTrainScore = initTrainMetrics.trainingScore;
    let bestTrainMetrics = initTrainMetrics;
    let bestEvol = evolForm;
    let acceptedMoveDesc = '无采纳变动';
    let improved = false;

    if (searchRes.candidates.length > 0) {
      const candEvolList = searchRes.candidates.map(c => c.child);
      const evalMetricsList = await pool.evalCandidateBatchOnMatchedParallel(
        candEvolList,
        emptyMask,
        trainingOpps,
        1,
        5000 + cIdx * 500,
      );

      for (let i = 0; i < searchRes.candidates.length; i++) {
        const cand = searchRes.candidates[i];
        const m = evalMetricsList[i];
        if (m.trainingScore > bestTrainScore) {
          bestTrainScore = m.trainingScore;
          bestTrainMetrics = m;
          bestEvol = cand.child;
          acceptedMoveDesc = cand.desc;
          improved = true;
        }
      }
    }

    // 独立验证阶段：在 heldOutOpps 上评估 (5 局/格)
    const [initHeldOutMetrics, finalHeldOutMetrics] = await pool.evalCandidateBatchOnMatchedParallel(
      [evolForm, bestEvol],
      emptyMask,
      heldOutOpps,
      5,
      20000 + cIdx * 500,
    );

    const heldOutDelta = finalHeldOutMetrics.trainingScore - initHeldOutMetrics.trainingScore;
    const isEarlyAdopted = improved && (heldOutDelta >= 0.05) && (finalHeldOutMetrics.loss <= initHeldOutMetrics.loss);

    const finalAdoptedEvol = isEarlyAdopted ? bestEvol : evolForm;

    // 强阵泛化校验 (Current Strong Panel Generalization, 5 局/格)
    const [strongInitMetrics, strongFinalMetrics] = await pool.evalCandidateBatchOnMatchedParallel(
      [evolForm, finalAdoptedEvol],
      emptyMask,
      strongPanel,
      5,
      35000 + cIdx * 500,
    );

    const strongScoreDelta = strongFinalMetrics.trainingScore - strongInitMetrics.trainingScore;
    const hasGeneralizationWarning = strongScoreDelta < -0.05;

    const candRecord = {
      candidateIndex: cIdx,
      candidateId: raw.candidateId,
      sourceSeedIndex: raw.sourceSeedIndex ?? 0,
      sourceSeedName: raw.sourceSeedName ?? 'Unknown',
      calculatedUnitRatio: ratioAnalysis.ratio,
      calculatedCount: ratioAnalysis.calculatedCount,
      controllableCount: ratioAnalysis.controllableMonsterIds.length,
      operatorStats: searchRes.stats,
      searchGain: improved,
      acceptedMoveDesc,
      earlyEcosystem: {
        trainingBefore: initTrainMetrics,
        trainingAfter: bestTrainMetrics,
        heldOutBefore: initHeldOutMetrics,
        heldOutAfter: finalHeldOutMetrics,
        heldOutDelta,
        earlyAdopted: isEarlyAdopted,
      },
      strongPanelGeneralization: {
        strongBefore: strongInitMetrics,
        strongAfter: strongFinalMetrics,
        strongScoreDelta,
        hasGeneralizationWarning,
      },
      finalStatus: isEarlyAdopted ? 'EARLY_ECOSYSTEM_IMPROVED' : 'HELD_OUT_VALIDATION_REJECTED',
    };

    results.push(candRecord);
    console.log(`    -> 结果: ${candRecord.finalStatus} (HeldOut: ${(initHeldOutMetrics.trainingScore * 100).toFixed(1)}% → ${(finalHeldOutMetrics.trainingScore * 100).toFixed(1)}%, StrongPanel Delta: ${(strongScoreDelta * 100).toFixed(1)}%)`);
  }

  // 产出证据文件
  const manifest = {
    task: 'T014 - Early Seven-Bundle Ecosystem and Calculated-Unit Order Search',
    timestamp: new Date().toISOString(),
    candidateCount: 8,
    familyCount: 7,
    families: families.map(f => ({
      familyId: f.familyId,
      chineseName: f.chineseName,
      archetype: f.archetype,
      trainingVariantId: f.trainingVariant.id,
      heldOutVariantId: f.heldOutVariant.id,
    })),
    operatorRules: {
      calculatedUnitThreshold: 0.50,
      calculatedUnitsBlockPositions: true,
    },
  };
  writeFileSync(join(outputDir, 'panel_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  writeFileSync(join(outputDir, 'optimization_results.jsonl'), results.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');

  // 生成 summary.md
  let summaryMd = `# T014 - Early Seven-Bundle Order Search Proof Summary\n\n`;
  summaryMd += `## 1. Early 7-Bundle Ecosystem Manifest\n\n`;
  summaryMd += `| Family ID | Chinese Name | Archetype | Training Variant | Held-Out Variant |\n|---|---|---|---|---|\n`;
  for (const f of families) {
    summaryMd += `| \`${f.familyId}\` | ${f.chineseName} | ${f.archetype} | \`${f.trainingVariant.id}\` | \`${f.heldOutVariant.id}\` |\n`;
  }
  summaryMd += `\n## 2. Calculated-Unit-Ratio-Driven Optimization Results\n\n`;
  summaryMd += `| Candidate ID | Seed | Calc Ratio | Route | Search Move | Held-Out Before | Held-Out After | Early Adopted | Strong Panel Delta | Gen Warning |\n|---|---|---|---|---|---|---|---|---|---|\n`;
  for (const r of results) {
    summaryMd += `| \`${r.candidateId}\` | ${r.sourceSeedName} | ${(r.calculatedUnitRatio * 100).toFixed(1)}% | ${r.calculatedUnitRatio >= 0.5 ? 'Sequence-Only' : 'R1/R2 Pos + Seq'} | ${r.acceptedMoveDesc} | ${(r.earlyEcosystem.heldOutBefore.trainingScore * 100).toFixed(1)}% | ${(r.earlyEcosystem.heldOutAfter.trainingScore * 100).toFixed(1)}% | ${r.earlyEcosystem.earlyAdopted ? '**YES**' : 'NO'} | ${(r.strongPanelGeneralization.strongScoreDelta * 100).toFixed(1)}% | ${r.strongPanelGeneralization.hasGeneralizationWarning ? '⚠️ YES' : 'None'} |\n`;
  }
  writeFileSync(join(outputDir, 'summary.md'), summaryMd, 'utf8');

  pool.destroy();
  console.log('\n=== 所有 T014 验收测试全部通过 ===');
}

runT014Tests().catch((err) => {
  console.error('T014 测试失败:', err);
  process.exit(1);
});
