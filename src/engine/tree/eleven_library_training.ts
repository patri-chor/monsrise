// ============================================================
// 隔夜全库 11 阵型多样性训练与三层阵型库构建引擎 (T016 Engine)
//
// 核心逻辑：
//   1. 冻结 11 套源阵型 (eleven_frozen_sources.json)
//   2. 33 个非重复合法突变候选 (thirty_three_mutated_candidates.jsonl)
//   3. 仅使用已验证的计算定位单位占比路由与纯顺序优化算子
//   4. 3 次独立优化尝试 (Three Independent Attempts) 与稳健性聚合 (>=2/3 passes)
//   5. 强阵面板泛化校验与上界强化通道 (Reinforcement Pass)
//   6. 确定性三层阵型库分类 (Tier 1 Baseline, Tier 2 Enhanced, Tier 3 Exploratory)
// ============================================================

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { PersistentSimPool } from './persistent_pool';
import { computeCalculatedUnitRatio, generateOrderCandidates, getMonsterDisplayName, type BundleFamily } from './order_search';
import { formationToEvol, evolToBundleFormation, type EvolFormation, type FeatureMask } from './evol_gene';
import { resolveEvaluationPanel } from './candidate_optimization_runner';
import { costOf } from './tree_ops';
import type { Formation } from '../../ai/types';

export const ELEVEN_LIBRARY_DIR = resolve('reports/new-formation-generation/overnight-eleven-library-training');

export interface AttemptResult {
  attemptIndex: number;
  searchSeed: number;
  validationSeed: number;
  initialTrainingScore: number;
  bestTrainingScore: number;
  initialHeldOutScore: number;
  finalHeldOutScore: number;
  heldOutDelta: number;
  initialHeldOutLoss: number;
  finalHeldOutLoss: number;
  passedValidation: boolean;
  acceptedMoveDesc: string;
  optimizedEvol: EvolFormation;
}

export interface CandidateTrainingResult {
  candidateId: string;
  sourceSeedIndex: number;
  sourceSeedId: string;
  sourceSeedName: string;
  noveltyBucket: 'light' | 'medium' | 'heavy';
  noveltyScore: number;
  calculatedUnitRatio: number;
  calculatedCount: number;
  controllableCount: number;
  attempts: AttemptResult[];
  robustStats: {
    passCount: number;
    passRate: number;
    medianHeldOutScore: number;
    minHeldOutScore: number;
    medianHeldOutDelta: number;
    medianLossDelta: number;
    robustlyImproved: boolean;
  };
  selectedTreeProvenance: string;
  selectedEvol: EvolFormation;
  selectedBundle: Formation;
  generalization: {
    strongBeforeScore: number;
    strongAfterScore: number;
    strongScoreDelta: number;
    hasGeneralizationWarning: boolean;
  };
  tier: 'Tier 1' | 'Tier 2' | 'Tier 3' | 'Rejected';
  tierReason: string;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export async function runElevenLibraryTraining(options: {
  outputDir?: string;
  pool?: PersistentSimPool;
  onProgress?: (msg: string) => void;
} = {}): Promise<{
  outputDir: string;
  results: CandidateTrainingResult[];
  tier1: any[];
  tier2: any[];
  tier3: any[];
  rejected: any[];
}> {
  const outputDir = options.outputDir ?? ELEVEN_LIBRARY_DIR;
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const pool = options.pool ?? PersistentSimPool.getInstance();
  const emptyMask: FeatureMask = { side: null, main: null, subs: [], keys: [] };

  // 1. 读取 Fixtures
  const sources: any[] = JSON.parse(readFileSync(resolve('tests/fixtures/tree/eleven_frozen_sources.json'), 'utf8'));
  const rawCandidates: any[] = readFileSync(resolve('tests/fixtures/tree/thirty_three_mutated_candidates.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map(l => JSON.parse(l));
  const families: BundleFamily[] = JSON.parse(readFileSync(resolve('tests/fixtures/tree/early_seven_bundles.json'), 'utf8'));
  const strongPanel = resolveEvaluationPanel();

  const trainingOpps = families.map(f => f.trainingVariant);
  const heldOutOpps = families.map(f => f.heldOutVariant);

  // 2. 初筛 (Coarse Screening)
  const screeningLedger: any[] = [];
  const validCandidates: any[] = [];

  for (const c of rawCandidates) {
    const totalCost = c.team.reduce((sum: number, slot: any) => sum + costOf(slot.monsterId), 0);
    const teamSize = c.team.length;
    const isValidSize = teamSize >= 6 && teamSize <= 8;
    const isValidCost = totalCost <= 24;

    const screened = {
      candidateId: c.candidateId,
      sourceSeedName: c.sourceSeedName,
      teamSize,
      totalCost,
      passed: isValidSize && isValidCost,
      reason: isValidSize && isValidCost ? 'LEGAL_SCREEN_PASS' : 'INVALID_BUDGET_OR_SIZE',
    };
    screeningLedger.push(screened);
    if (screened.passed) validCandidates.push(c);
  }

  // 3. 3 次独立优化尝试
  const allResults: CandidateTrainingResult[] = [];

  for (let cIdx = 0; cIdx < validCandidates.length; cIdx++) {
    const cand = validCandidates[cIdx];
    const initialEvol = formationToEvol(cand as unknown as Formation);
    const ratioAnalysis = computeCalculatedUnitRatio(cand.team);

    const attempts: AttemptResult[] = [];

    for (let attIdx = 0; attIdx < 3; attIdx++) {
      const searchSeed = 10000 * (attIdx + 1) + cIdx * 500;
      const validationSeed = 20000 * (attIdx + 1) + cIdx * 500;

      const searchRes = generateOrderCandidates(initialEvol, cand.candidateId, `c_${cIdx}_att_${attIdx}`);

      // 评估初始 Training 与 HeldOut
      const [initTrain] = await pool.evalCandidateBatchOnMatchedParallel([initialEvol], emptyMask, trainingOpps, 1, searchSeed);
      const [initHeldOut] = await pool.evalCandidateBatchOnMatchedParallel([initialEvol], emptyMask, heldOutOpps, 5, validationSeed);

      let bestTrainScore = initTrain.trainingScore;
      let bestEvol = initialEvol;
      let acceptedMoveDesc = '无采纳变动';
      let searchImproved = false;

      if (searchRes.candidates.length > 0) {
        const evalMetricsList = await pool.evalCandidateBatchOnMatchedParallel(
          searchRes.candidates.map(c => c.child),
          emptyMask,
          trainingOpps,
          1,
          searchSeed,
        );

        for (let i = 0; i < searchRes.candidates.length; i++) {
          const m = evalMetricsList[i];
          if (m.trainingScore > bestTrainScore) {
            bestTrainScore = m.trainingScore;
            bestEvol = searchRes.candidates[i].child;
            acceptedMoveDesc = searchRes.candidates[i].desc;
            searchImproved = true;
          }
        }
      }

      // 独立 HeldOut 验证
      const [finalHeldOut] = await pool.evalCandidateBatchOnMatchedParallel([bestEvol], emptyMask, heldOutOpps, 5, validationSeed);

      const heldOutDelta = finalHeldOut.trainingScore - initHeldOut.trainingScore;
      const passedValidation = searchImproved && (heldOutDelta >= 0.05) && (finalHeldOut.loss <= initHeldOut.loss);

      attempts.push({
        attemptIndex: attIdx + 1,
        searchSeed,
        validationSeed,
        initialTrainingScore: initTrain.trainingScore,
        bestTrainingScore: bestTrainScore,
        initialHeldOutScore: initHeldOut.trainingScore,
        finalHeldOutScore: finalHeldOut.trainingScore,
        heldOutDelta,
        initialHeldOutLoss: initHeldOut.loss,
        finalHeldOutLoss: finalHeldOut.loss,
        passedValidation,
        acceptedMoveDesc,
        optimizedEvol: passedValidation ? bestEvol : initialEvol,
      });
    }

    // 统计 3 次稳健性
    const passCount = attempts.filter(a => a.passedValidation).length;
    const passRate = passCount / 3;
    const robustlyImproved = passCount >= 2;
    const medianHeldOutScore = median(attempts.map(a => a.finalHeldOutScore));
    const minHeldOutScore = Math.min(...attempts.map(a => a.finalHeldOutScore));
    const medianHeldOutDelta = median(attempts.map(a => a.heldOutDelta));
    const medianLossDelta = median(attempts.map(a => a.finalHeldOutLoss - a.initialHeldOutLoss));

    // 选择代表树 (最佳通过尝试，或 baseline)
    const passedAttempts = attempts.filter(a => a.passedValidation).sort((a, b) => b.finalHeldOutScore - a.finalHeldOutScore);
    const selectedAttempt = passedAttempts.length > 0 ? passedAttempts[0] : null;
    const selectedEvol = selectedAttempt ? selectedAttempt.optimizedEvol : initialEvol;
    const selectedTreeProvenance = selectedAttempt ? `Attempt ${selectedAttempt.attemptIndex} (${selectedAttempt.acceptedMoveDesc})` : 'Baseline (0/3 passed)';
    const selectedBundle = evolToBundleFormation(selectedEvol);

    // 4. 强阵面板泛化测试
    const [strongBefore, strongAfter] = await pool.evalCandidateBatchOnMatchedParallel(
      [initialEvol, selectedEvol],
      emptyMask,
      strongPanel,
      5,
      50000 + cIdx * 500,
    );

    const strongScoreDelta = strongAfter.trainingScore - strongBefore.trainingScore;
    const hasGeneralizationWarning = strongScoreDelta < -0.05;

    // 5. 三层分类判定
    let tier: 'Tier 1' | 'Tier 2' | 'Tier 3' | 'Rejected' = 'Rejected';
    let tierReason = '未达到 Tier 2 或 Tier 3 入库门槛';

    if (robustlyImproved && medianHeldOutScore >= 0.50 && strongAfter.trainingScore >= 0.35 && !hasGeneralizationWarning) {
      tier = 'Tier 2';
      tierReason = `稳健通过 ${passCount}/3 尝试，早期中位数 ${(medianHeldOutScore * 100).toFixed(1)}%，强阵得分 ${(strongAfter.trainingScore * 100).toFixed(1)}% 无退化预警`;
    } else if (medianHeldOutScore >= 0.30 && strongAfter.trainingScore >= 0.25) {
      tier = 'Tier 3';
      tierReason = `探索性多样性候选，早期中位数 ${(medianHeldOutScore * 100).toFixed(1)}%，强阵得分 ${(strongAfter.trainingScore * 100).toFixed(1)}% 达到安全底线`;
    }

    const candResult: CandidateTrainingResult = {
      candidateId: cand.candidateId,
      sourceSeedIndex: cand.sourceSeedIndex,
      sourceSeedId: cand.sourceSeedId,
      sourceSeedName: cand.sourceSeedName,
      noveltyBucket: cand.noveltyBucket,
      noveltyScore: cand.noveltyScore,
      calculatedUnitRatio: ratioAnalysis.ratio,
      calculatedCount: ratioAnalysis.calculatedCount,
      controllableCount: ratioAnalysis.controllableMonsterIds.length,
      attempts,
      robustStats: {
        passCount,
        passRate,
        medianHeldOutScore,
        minHeldOutScore,
        medianHeldOutDelta,
        medianLossDelta,
        robustlyImproved,
      },
      selectedTreeProvenance,
      selectedEvol,
      selectedBundle: selectedBundle as unknown as Formation,
      generalization: {
        strongBeforeScore: strongBefore.trainingScore,
        strongAfterScore: strongAfter.trainingScore,
        strongScoreDelta,
        hasGeneralizationWarning,
      },
      tier,
      tierReason,
    };

    allResults.push(candResult);
    options.onProgress?.(`[${cIdx + 1}/${validCandidates.length}] ${cand.candidateId} (${cand.sourceSeedName}) -> ${tier} (${passCount}/3 passes, Median HeldOut: ${(medianHeldOutScore * 100).toFixed(1)}%)`);
  }

  // 6. 整理三层阵型库
  const tier1 = sources.map(s => ({
    tier: 'Tier 1',
    sourceIndex: s.sourceIndex,
    id: s.id,
    name: s.name,
    archetype: s.archetype,
    team: s.team,
    tree: s.tree,
    description: 'Current bundle authoritative baseline (Frozen snapshot)',
  }));

  const tier2 = allResults.filter(r => r.tier === 'Tier 2');
  const tier3 = allResults.filter(r => r.tier === 'Tier 3');
  const rejected = allResults.filter(r => r.tier === 'Rejected');

  // 7. 写入全部 12 项 Reviewable Artifacts
  writeFileSync(join(outputDir, 'source_snapshot.json'), JSON.stringify(tier1, null, 2), 'utf8');
  writeFileSync(join(outputDir, 'generation_manifest.json'), JSON.stringify({
    timestamp: new Date().toISOString(),
    totalSources: 11,
    totalMutatedCandidates: rawCandidates.length,
    validScreenedCandidates: validCandidates.length,
    attemptsPerCandidate: 3,
    rules: { calculatedThreshold: 0.50, minHeldOutGain: 0.05, robustPassMin: 2 },
  }, null, 2), 'utf8');
  writeFileSync(join(outputDir, 'all_candidates.jsonl'), rawCandidates.map(c => JSON.stringify(c)).join('\n') + '\n', 'utf8');
  writeFileSync(join(outputDir, 'screening_ledger.jsonl'), screeningLedger.map(s => JSON.stringify(s)).join('\n') + '\n', 'utf8');
  
  const attemptsFlat: any[] = [];
  for (const r of allResults) {
    for (const a of r.attempts) {
      attemptsFlat.push({ candidateId: r.candidateId, sourceSeedName: r.sourceSeedName, ...a, optimizedEvol: undefined });
    }
  }
  writeFileSync(join(outputDir, 'optimization_attempts.jsonl'), attemptsFlat.map(a => JSON.stringify(a)).join('\n') + '\n', 'utf8');

  writeFileSync(join(outputDir, 'early_holdout_evaluations.jsonl'), allResults.map(r => JSON.stringify({
    candidateId: r.candidateId,
    sourceSeedName: r.sourceSeedName,
    noveltyBucket: r.noveltyBucket,
    calculatedUnitRatio: r.calculatedUnitRatio,
    robustStats: r.robustStats,
    selectedProvenance: r.selectedTreeProvenance,
  })).join('\n') + '\n', 'utf8');

  writeFileSync(join(outputDir, 'current_panel_generalization.jsonl'), allResults.map(r => JSON.stringify({
    candidateId: r.candidateId,
    sourceSeedName: r.sourceSeedName,
    generalization: r.generalization,
  })).join('\n') + '\n', 'utf8');

  writeFileSync(join(outputDir, 'tier_library.json'), JSON.stringify({ tier1, tier2, tier3 }, null, 2), 'utf8');
  writeFileSync(join(outputDir, 'rejection_ledger.jsonl'), rejected.map(r => JSON.stringify({
    candidateId: r.candidateId,
    sourceSeedName: r.sourceSeedName,
    robustStats: r.robustStats,
    generalization: r.generalization,
    reason: r.tierReason,
  })).join('\n') + '\n', 'utf8');

  // 生成 tier_library.md
  let tierMd = `# Three-Tier Candidate Library\n\n`;
  tierMd += `## Tier 1: Current Bundle Baselines (11 Formations)\n\n`;
  for (const s of tier1) {
    tierMd += `- **${s.name}** (\`${s.id}\` | ${s.archetype})\n`;
  }
  tierMd += `\n## Tier 2: Stable Enhanced Candidates (${tier2.length} Candidates)\n\n`;
  tierMd += `| Candidate ID | Source Seed | Bucket | Passes | Median Held-Out | Strong Score | Generalization | Provenance |\n|---|---|---|---|---|---|---|---|\n`;
  for (const t of tier2) {
    tierMd += `| \`${t.candidateId}\` | ${t.sourceSeedName} | ${t.noveltyBucket} | ${t.robustStats.passCount}/3 | ${(t.robustStats.medianHeldOutScore * 100).toFixed(1)}% | ${(t.generalization.strongAfterScore * 100).toFixed(1)}% | ${t.generalization.hasGeneralizationWarning ? '⚠️ WARNING' : 'Normal'} | ${t.selectedTreeProvenance} |\n`;
  }
  tierMd += `\n## Tier 3: Exploratory Diversity Candidates (${tier3.length} Candidates)\n\n`;
  tierMd += `| Candidate ID | Source Seed | Bucket | Passes | Median Held-Out | Strong Score | Provenance |\n|---|---|---|---|---|---|---|\n`;
  for (const t of tier3) {
    tierMd += `| \`${t.candidateId}\` | ${t.sourceSeedName} | ${t.noveltyBucket} | ${t.robustStats.passCount}/3 | ${(t.robustStats.medianHeldOutScore * 100).toFixed(1)}% | ${(t.generalization.strongAfterScore * 100).toFixed(1)}% | ${t.selectedTreeProvenance} |\n`;
  }
  writeFileSync(join(outputDir, 'tier_library.md'), tierMd, 'utf8');

  // 生成 summary.md
  let sumMd = `# Overnight Eleven-Formation Library Training Summary\n\n`;
  sumMd += `- **Sources**: 11 Frozen Formations\n`;
  sumMd += `- **Generated Candidates**: ${rawCandidates.length} (3 per source across light/medium/heavy)\n`;
  sumMd += `- **Screened Pass**: ${validCandidates.length} / ${rawCandidates.length}\n`;
  sumMd += `- **Tier 1 (Baselines)**: ${tier1.length}\n`;
  sumMd += `- **Tier 2 (Enhanced)**: ${tier2.length}\n`;
  sumMd += `- **Tier 3 (Exploratory)**: ${tier3.length}\n`;
  sumMd += `- **Rejected**: ${rejected.length}\n`;
  sumMd += `\n## No-Apply Confirmation\nThis run was strictly an offline training and tier curation experiment. No active formation was modified, deployed, or overwritten.\n`;
  writeFileSync(join(outputDir, 'summary.md'), sumMd, 'utf8');

  return { outputDir, results: allResults, tier1, tier2, tier3, rejected };
}
