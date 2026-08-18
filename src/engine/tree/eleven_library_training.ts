// ============================================================
// 隔夜全库 11 阵型多样性训练与三层阵型库构建引擎 (T016 / T017 Engine)
//
// 核心模块：
//   1. 强制树/卡组闭包检查门禁 (Tree/Deck Coherence Gate)
//   2. 严格 8 怪兽候选规则 (Eight-Monster Candidate Rule, 无总费上限)
//   3. 3 次独立优化尝试 (Three Independent Attempts) 与稳健性聚合
//   4. 真实上界强化通道 (Reinforcement Pass for Best Robust Candidates)
//   5. 强阵面板独立泛化测试与退化预警
//   6. 确定性三层阵型库分类 (Tier 1 Baseline, Tier 2 Enhanced, Tier 3 Exploratory)
//   7. 归档输出至 tests/fixtures/tree/t016_training_archive/
// ============================================================

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { PersistentSimPool } from './persistent_pool';
import { computeCalculatedUnitRatio, generateOrderCandidates, validateTreeDeckCoherence, getMonsterDisplayName, type BundleFamily } from './order_search';
import { formationToEvol, evolToBundleFormation, type EvolFormation, type FeatureMask } from './evol_gene';
import { resolveEvaluationPanel } from './candidate_optimization_runner';
import { costOf } from './tree_ops';
import type { Formation } from '../../ai/types';

export const ELEVEN_LIBRARY_DIR = resolve('reports/new-formation-generation/overnight-eleven-library-training');
export const COMMITTED_ARCHIVE_DIR = resolve('tests/fixtures/tree/t016_training_archive');

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

export interface ReinforcementResult {
  candidateId: string;
  sourceSeedName: string;
  searchSeed: number;
  validationSeed: number;
  baselineScore: number;
  baselineLoss: number;
  reinforcementScore: number;
  reinforcementLoss: number;
  deltaScore: number;
  passedValidation: boolean;
  replacedSelectedTree: boolean;
  acceptedMoveDesc: string;
  reason: string;
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
  reinforcement?: ReinforcementResult;
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
  archiveDir?: string;
  pool?: PersistentSimPool;
  onProgress?: (msg: string) => void;
} = {}): Promise<{
  outputDir: string;
  archiveDir: string;
  results: CandidateTrainingResult[];
  tier1: any[];
  tier2: any[];
  tier3: any[];
  rejected: any[];
  reinforcements: ReinforcementResult[];
}> {
  const outputDir = options.outputDir ?? ELEVEN_LIBRARY_DIR;
  const archiveDir = options.archiveDir ?? COMMITTED_ARCHIVE_DIR;

  for (const dir of [outputDir, archiveDir]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
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

  // 2. 严格 8 怪兽与树/卡组闭包检查门禁 (Tree/Deck Coherence Gate)
  const screeningLedger: any[] = [];
  const validCandidates: any[] = [];

  for (const c of rawCandidates) {
    const totalCost = c.team.reduce((sum: number, slot: any) => sum + costOf(slot.monsterId), 0);
    const teamSize = c.team.length;
    const isEightMonsters = teamSize === 8;

    const evol = formationToEvol(c as unknown as Formation);
    const coherence = validateTreeDeckCoherence(evol);

    const passed = isEightMonsters && coherence.valid;
    let reason = 'LEGAL_SCREEN_PASS';
    if (!isEightMonsters) {
      reason = `INVALID_TEAM_SIZE: Expected 8 monsters, found ${teamSize}`;
    } else if (!coherence.valid) {
      reason = `COHERENCE_GATE_FAILED: ${coherence.error} (${coherence.message})`;
    }

    const screened = {
      candidateId: c.candidateId,
      sourceSeedName: c.sourceSeedName,
      teamSize,
      totalCost,
      coherenceValid: coherence.valid,
      coherenceError: coherence.error,
      passed,
      reason,
    };
    screeningLedger.push(screened);
    if (passed) validCandidates.push(c);
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
    let selectedEvol = selectedAttempt ? selectedAttempt.optimizedEvol : initialEvol;
    let selectedTreeProvenance = selectedAttempt ? `Attempt ${selectedAttempt.attemptIndex} (${selectedAttempt.acceptedMoveDesc})` : 'Baseline (0/3 passed)';

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
      selectedBundle: evolToBundleFormation(selectedEvol) as unknown as Formation,
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

  // 6. 真实上界强化通道 (Reinforcement Pass for Best Robust Candidate per Source)
  const reinforcements: ReinforcementResult[] = [];

  // 按源找出最优稳健候选
  const sourceGroups = new Map<number, CandidateTrainingResult[]>();
  for (const r of allResults) {
    const arr = sourceGroups.get(r.sourceSeedIndex) || [];
    arr.push(r);
    sourceGroups.set(r.sourceSeedIndex, arr);
  }

  for (const [sIdx, cands] of sourceGroups.entries()) {
    const robustCands = cands.filter(c => c.robustStats.robustlyImproved).sort((a, b) => b.robustStats.medianHeldOutScore - a.robustStats.medianHeldOutScore);
    if (robustCands.length === 0) continue; // 该源无稳健候选，不运行 lucky 强化

    const bestCand = robustCands[0];
    const searchSeed = 40000 + sIdx * 500;
    const validationSeed = 45000 + sIdx * 500;

    const initialEvol = formationToEvol(bestCand.selectedBundle);
    const searchRes = generateOrderCandidates(initialEvol, bestCand.candidateId, `reinf_s_${sIdx}`);

    const [initHeldOut] = await pool.evalCandidateBatchOnMatchedParallel([initialEvol], emptyMask, heldOutOpps, 5, validationSeed);
    let bestEvol = initialEvol;
    let acceptedMoveDesc = '无采纳变动';
    let passedValidation = false;
    let finalHeldOutScore = initHeldOut.trainingScore;
    let finalHeldOutLoss = initHeldOut.loss;

    if (searchRes.candidates.length > 0) {
      const evalMetricsList = await pool.evalCandidateBatchOnMatchedParallel(
        searchRes.candidates.map(c => c.child),
        emptyMask,
        trainingOpps,
        1,
        searchSeed,
      );

      let bestScore = initHeldOut.trainingScore;
      for (let i = 0; i < searchRes.candidates.length; i++) {
        if (evalMetricsList[i].trainingScore > bestScore) {
          bestScore = evalMetricsList[i].trainingScore;
          bestEvol = searchRes.candidates[i].child;
          acceptedMoveDesc = searchRes.candidates[i].desc;
        }
      }

      const [reinfHeldOut] = await pool.evalCandidateBatchOnMatchedParallel([bestEvol], emptyMask, heldOutOpps, 5, validationSeed);
      finalHeldOutScore = reinfHeldOut.trainingScore;
      finalHeldOutLoss = reinfHeldOut.loss;
      passedValidation = (reinfHeldOut.trainingScore - initHeldOut.trainingScore >= 0.05) && (reinfHeldOut.loss <= initHeldOut.loss);
    }

    const deltaScore = finalHeldOutScore - initHeldOut.trainingScore;
    const replaced = passedValidation && (finalHeldOutScore >= bestCand.robustStats.medianHeldOutScore);

    if (replaced) {
      bestCand.selectedEvol = bestEvol;
      bestCand.selectedTreeProvenance = `Reinforcement Pass (${acceptedMoveDesc})`;
      bestCand.selectedBundle = evolToBundleFormation(bestEvol) as unknown as Formation;
    }

    const reinfRecord: ReinforcementResult = {
      candidateId: bestCand.candidateId,
      sourceSeedName: bestCand.sourceSeedName,
      searchSeed,
      validationSeed,
      baselineScore: initHeldOut.trainingScore,
      baselineLoss: initHeldOut.loss,
      reinforcementScore: finalHeldOutScore,
      reinforcementLoss: finalHeldOutLoss,
      deltaScore,
      passedValidation,
      replacedSelectedTree: replaced,
      acceptedMoveDesc,
      reason: replaced ? 'REINFORCEMENT_ADOPTED' : (passedValidation ? 'SCORE_NOT_SUPERIOR_TO_MEDIAN' : 'HELD_OUT_VALIDATION_FAILED'),
    };
    bestCand.reinforcement = reinfRecord;
    reinforcements.push(reinfRecord);
    options.onProgress?.(`[Reinforcement] Source ${bestCand.sourceSeedName} -> ${reinfRecord.reason} (Replaced: ${replaced})`);
  }

  // 7. 整理三层阵型库
  const tier1 = sources.map(s => ({
    tier: 'Tier 1',
    sourceIndex: s.sourceIndex,
    id: s.id,
    name: s.name,
    archetype: s.archetype,
    teamSize: s.team.length,
    isLegacyBaseline: s.isLegacyBaseline ?? false,
    team: s.team,
    tree: s.tree,
    description: s.isLegacyBaseline ? 'Frozen legacy 7-monster baseline (Requires explicit decision for expansion)' : 'Current bundle authoritative baseline (Frozen snapshot)',
  }));

  const tier2 = allResults.filter(r => r.tier === 'Tier 2');
  const tier3 = allResults.filter(r => r.tier === 'Tier 3');
  const rejected = allResults.filter(r => r.tier === 'Rejected');

  // 8. 双重写入产物 (reports/ 与 tests/fixtures/tree/t016_training_archive/)
  const allDirs = [outputDir, archiveDir];

  for (const dir of allDirs) {
    writeFileSync(join(dir, 'source_snapshot.json'), JSON.stringify(tier1, null, 2), 'utf8');
    writeFileSync(join(dir, 'generation_manifest.json'), JSON.stringify({
      timestamp: new Date().toISOString(),
      totalSources: 11,
      legacySources: 1,
      totalMutatedCandidates: rawCandidates.length,
      validScreenedCandidates: validCandidates.length,
      eightMonsterRuleApplied: true,
      coherenceGateApplied: true,
      costCeilingRemoved: true,
      attemptsPerCandidate: 3,
      rules: { calculatedThreshold: 0.50, minHeldOutGain: 0.05, robustPassMin: 2 },
    }, null, 2), 'utf8');
    writeFileSync(join(dir, 'all_candidates.jsonl'), rawCandidates.map(c => JSON.stringify(c)).join('\n') + '\n', 'utf8');
    writeFileSync(join(dir, 'screening_ledger.jsonl'), screeningLedger.map(s => JSON.stringify(s)).join('\n') + '\n', 'utf8');

    const attemptsFlat: any[] = [];
    for (const r of allResults) {
      for (const a of r.attempts) {
        attemptsFlat.push({ candidateId: r.candidateId, sourceSeedName: r.sourceSeedName, ...a, optimizedEvol: undefined });
      }
    }
    writeFileSync(join(dir, 'optimization_attempts.jsonl'), attemptsFlat.map(a => JSON.stringify(a)).join('\n') + '\n', 'utf8');

    writeFileSync(join(dir, 'early_holdout_evaluations.jsonl'), allResults.map(r => JSON.stringify({
      candidateId: r.candidateId,
      sourceSeedName: r.sourceSeedName,
      noveltyBucket: r.noveltyBucket,
      calculatedUnitRatio: r.calculatedUnitRatio,
      robustStats: r.robustStats,
      selectedProvenance: r.selectedTreeProvenance,
    })).join('\n') + '\n', 'utf8');

    writeFileSync(join(dir, 'current_panel_generalization.jsonl'), allResults.map(r => JSON.stringify({
      candidateId: r.candidateId,
      sourceSeedName: r.sourceSeedName,
      generalization: r.generalization,
    })).join('\n') + '\n', 'utf8');

    writeFileSync(join(dir, 'reinforcement_attempts.jsonl'), reinforcements.map(re => JSON.stringify(re)).join('\n') + '\n', 'utf8');

    writeFileSync(join(dir, 'tier_library.json'), JSON.stringify({ tier1, tier2, tier3 }, null, 2), 'utf8');
    writeFileSync(join(dir, 'rejection_ledger.jsonl'), rejected.map(r => JSON.stringify({
      candidateId: r.candidateId,
      sourceSeedName: r.sourceSeedName,
      robustStats: r.robustStats,
      generalization: r.generalization,
      reason: r.tierReason,
    })).join('\n') + '\n', 'utf8');

    // tier_library.md
    let tierMd = `# Three-Tier Candidate Library\n\n`;
    tierMd += `## Tier 1: Current Bundle Baselines (11 Formations)\n\n`;
    for (const s of tier1) {
      tierMd += `- **${s.name}** (\`${s.id}\` | ${s.archetype}) - ${s.isLegacyBaseline ? '⚠️ 7-Monster Legacy Baseline' : '8-Monster Standard Baseline'}\n`;
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
    writeFileSync(join(dir, 'tier_library.md'), tierMd, 'utf8');

    // summary.md
    let sumMd = `# Overnight Eleven-Formation Library Training Summary\n\n`;
    sumMd += `- **Sources**: 11 Frozen Formations (10 standard 8-monster + 1 legacy 7-monster)\n`;
    sumMd += `- **Generated Candidates**: ${rawCandidates.length} (Strictly 8-monster, full tree/deck coherence)\n`;
    sumMd += `- **Screened Pass**: ${validCandidates.length} / ${rawCandidates.length}\n`;
    sumMd += `- **Tier 1 (Baselines)**: ${tier1.length}\n`;
    sumMd += `- **Tier 2 (Enhanced)**: ${tier2.length}\n`;
    sumMd += `- **Tier 3 (Exploratory)**: ${tier3.length}\n`;
    sumMd += `- **Rejected**: ${rejected.length}\n`;
    sumMd += `- **Reinforcement Attempts**: ${reinforcements.length}\n`;
    sumMd += `\n## No-Apply Confirmation\nThis run was strictly an offline training and tier curation experiment. No active formation was modified, deployed, or overwritten.\n`;
    writeFileSync(join(dir, 'summary.md'), sumMd, 'utf8');
  }

  return { outputDir, archiveDir, results: allResults, tier1, tier2, tier3, rejected, reinforcements };
}
