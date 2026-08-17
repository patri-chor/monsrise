import '../env';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { FORMATION_LIBRARY } from '../../ai/formation_library';
import type { Formation } from '../../ai/types';
import type { EvolFormation } from './evol_gene';
import { formationToEvol } from './evol_gene';
import { mapRefTreeToDeck } from './deck_separation';
import { evaluateBatchParallel } from './arena_parallel';
import {
  calculateMutationVector,
  selectRetainedCandidates,
  type CandidateAnalysisRecord,
} from './candidate_retention';
import {
  costOf,
  classifyDeck,
  validateDeck,
  poolForTemplate,
  badgeTemplateFor,
} from './deck_ontology';
import { COMBO_MODULES } from './flow_library';
import { optimizeFormation } from './branch_induct';

export const DEFAULT_OUTPUT_DIR = resolve('reports/new-formation-generation/first-four-cycle');

export interface SeedManifest {
  timestamp: string;
  seedCount: number;
  sourceSeeds: {
    index: number;
    id: string;
    name: string;
    archetype: string;
    cost: number;
  }[];
  panelCount: number;
  evaluationPanel: {
    index: number;
    id: string;
    name: string;
    archetype: string;
  }[];
  effectiveSettings: {
    attemptsPerSeed: number;
    maxRetained: number;
    explorationFloor: number;
    workers: number;
    coarseGames: number;
    coarseSeedBase: number;
    treeSearchSeedBase?: number;
    treeValSeedBase?: number;
  };
}

export interface GeneratedCandidateRecord {
  candidateId: string;
  sourceSeedIndex: number;
  sourceSeedName: string;
  sourceSeedId: string;
  generationSeed: number;
  attemptIndex: number;
  archPath: string;
  modulePath: string;
  coreKey: string;
  referenceFormation: string;
  team: { monsterId: number; badgeIds: number[] }[];
  treeFingerprint: string;
  canonicalKey: string;
  tree: any;
  validation: {
    valid: boolean;
    cost: number;
    size: number;
    hasTactic: boolean;
  };
  coarseEvaluation?: {
    adScore: number;
    winRate: number;
    drawRate: number;
    lossRate: number;
    totalGames: number;
    seedBase: number;
    games: number;
    workers: number;
  };
}

export interface SeedGenerationStats {
  sourceSeedName: string;
  sourceSeedId: string;
  attempts: number;
  accepted: number;
  duplicateRejections: number;
  structuralRejections: number;
  generatedCandidateIds: string[];
}

export interface FirstFourCycleOptions {
  outputDir?: string;
  baseSeed?: number;
  attemptsPerSeed?: number;
  workers?: number;
  coarseGames?: number;
  coarseSeedBase?: number;
  explorationFloor?: number;
  maxRetained?: number;
}

/**
 * 1. 运行时解析 Canonical Source Seeds 与 8 对手 Evaluation Panel
 */
export function resolveSeedsAndPanel(): {
  sourceSeeds: Formation[];
  evaluationPanel: Formation[];
} {
  // 必须严格取 FORMATION_LIBRARY.slice(0, 4)
  const sourceSeeds = FORMATION_LIBRARY.slice(0, 4);
  if (sourceSeeds.length !== 4) {
    throw new Error(`[Seed Resolution Error] Expected 4 source seeds from FORMATION_LIBRARY.slice(0, 4), found ${sourceSeeds.length}`);
  }

  // Panel 必须严格包含 FORMATION_LIBRARY.slice(0, 7) + 壕炸金猴
  const firstSeven = FORMATION_LIBRARY.slice(0, 7);
  const goldenMonkey = FORMATION_LIBRARY.find(f => f.name === '壕炸金猴');

  if (!goldenMonkey) {
    throw new Error(`[Panel Resolution Error] Eighth opponent named '壕炸金猴' not found in FORMATION_LIBRARY.`);
  }

  // 检查是否已经在前 7 个中
  const firstSevenNames = new Set(firstSeven.map(f => f.name));
  if (firstSevenNames.has('壕炸金猴')) {
    throw new Error(`[Panel Resolution Error] '壕炸金猴' is already among the first seven formations in FORMATION_LIBRARY.`);
  }

  const evaluationPanel = [...firstSeven, goldenMonkey];
  if (evaluationPanel.length !== 8) {
    throw new Error(`[Panel Resolution Error] Evaluation panel must contain exactly 8 opponents, found ${evaluationPanel.length}`);
  }

  const panelNames = new Set(evaluationPanel.map(f => f.name));
  if (panelNames.size !== 8) {
    throw new Error(`[Panel Resolution Error] Duplicate opponent detected in evaluation panel (${panelNames.size}/8 unique)`);
  }

  return { sourceSeeds, evaluationPanel };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 2. 多源变异生成（每个源种子最多尝试 attemptsPerSeed 次）
 */
export function generateFromSourceSeed(
  sourceSeed: Formation,
  sourceSeedIndex: number,
  genSeed: number,
  maxAttempts: number = 6,
  existingCanonicalKeys: Set<string> = new Set(),
  existingTreeFps: Set<string> = new Set(),
): {
  candidates: GeneratedCandidateRecord[];
  stats: SeedGenerationStats;
} {
  const rng = mulberry32(genSeed);
  const stats: SeedGenerationStats = {
    sourceSeedName: sourceSeed.name,
    sourceSeedId: sourceSeed.id,
    attempts: 0,
    accepted: 0,
    duplicateRejections: 0,
    structuralRejections: 0,
    generatedCandidateIds: [],
  };

  const candidates: GeneratedCandidateRecord[] = [];
  const srcEvol = formationToEvol(sourceSeed);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    stats.attempts++;

    // 随机选择一个 combo 模块作为变异方向
    const comboMod = COMBO_MODULES[Math.floor(rng() * COMBO_MODULES.length)];
    const modMonsterIds = [...comboMod.required, ...comboMod.optional];
    const coreKey = sourceSeed.archetype === 'fullrush' ? 'digger' : (sourceSeed.archetype === 'prayer' ? 'savior' : 'all2');

    // 组装队伍（保持总费用 <= 18，尺寸 6..8）
    const teamSlots: { monsterId: number; badgeIds: number[] }[] = [];
    const usedIds = new Set<number>();

    // 加入模块核心怪兽
    for (const mId of modMonsterIds) {
      if (!usedIds.has(mId)) {
        usedIds.add(mId);
        teamSlots.push({ monsterId: mId, badgeIds: badgeTemplateFor(mId) });
      }
    }

    // 从源种子队伍补充互补怪兽
    for (const slot of sourceSeed.team) {
      if (!usedIds.has(slot.monsterId) && teamSlots.length < 8) {
        usedIds.add(slot.monsterId);
        teamSlots.push({ monsterId: slot.monsterId, badgeIds: slot.badgeIds ?? badgeTemplateFor(slot.monsterId) });
      }
    }

    // 校验费用
    let cost = teamSlots.reduce((sum, s) => sum + costOf(s.monsterId), 0);
    while (cost > 18 && teamSlots.length > 6) {
      // 移除最后一个非模块核心怪兽
      const removeIdx = teamSlots.findLastIndex(s => !modMonsterIds.includes(s.monsterId));
      if (removeIdx >= 0) {
        const removed = teamSlots.splice(removeIdx, 1)[0];
        cost -= costOf(removed.monsterId);
        usedIds.delete(removed.monsterId);
      } else {
        break;
      }
    }

    const valErrors = validateDeck(teamSlots);
    if (valErrors.length > 0 || cost > 18 || teamSlots.length < 6) {
      stats.structuralRejections++;
      continue;
    }

    // 映射基准树
    let evolWithTree: EvolFormation;
    try {
      evolWithTree = mapRefTreeToDeck(srcEvol, teamSlots);
    } catch {
      stats.structuralRejections++;
      continue;
    }

    const canonKey = teamSlots.map(s => s.monsterId).sort((a, b) => a - b).join(',');
    const treeFp = JSON.stringify(evolWithTree.root);

    if (existingCanonicalKeys.has(canonKey) || existingTreeFps.has(treeFp)) {
      stats.duplicateRejections++;
      continue;
    }

    existingCanonicalKeys.add(canonKey);
    existingTreeFps.add(treeFp);

    const candId = `cand_s${sourceSeedIndex + 1}_${candidates.length + 1}_${Math.abs(genSeed + attempt).toString(16).slice(0, 6)}`;
    const record: GeneratedCandidateRecord = {
      candidateId: candId,
      sourceSeedIndex,
      sourceSeedName: sourceSeed.name,
      sourceSeedId: sourceSeed.id,
      generationSeed: genSeed,
      attemptIndex: attempt,
      archPath: sourceSeed.archetype,
      modulePath: comboMod.id,
      coreKey,
      referenceFormation: sourceSeed.name,
      team: teamSlots,
      treeFingerprint: treeFp,
      canonicalKey: canonKey,
      tree: evolWithTree.root,
      validation: {
        valid: true,
        cost,
        size: teamSlots.length,
        hasTactic: true,
      },
    };

    candidates.push(record);
    stats.accepted++;
    stats.generatedCandidateIds.push(candId);
  }

  return { candidates, stats };
}

/**
 * 3. 检查现有优化器接口是否支持 fixed opponent panel
 */
export function checkTreeOptimizerPanelInterface(): {
  supported: boolean;
  reason: string;
  missingInterfaceDescription: string;
} {
  // 检查 optimizeFormation 源码及参数签名
  // branch_induct.ts 的 optimizeFormation 签名仅为:
  // optimizeFormation(BundleAI: any, src: Formation, gamesPerOpp: number, options?: { searchSeedBase?: number; validationSeedBase?: number })
  // 且内部写死 for (const opp of FORMATION_LIBRARY)
  return {
    supported: false,
    reason: "Public tree optimizer entry 'optimizeFormation' in 'src/engine/tree/branch_induct.ts' hardcodes iteration over 'FORMATION_LIBRARY' and does not accept a custom 'opponents?: Formation[]' parameter in its options.",
    missingInterfaceDescription: "optimizeFormation(BundleAI: any, src: Formation, gamesPerOpp: number, options?: { opponents?: Formation[]; searchSeedBase?: number; validationSeedBase?: number })",
  };
}

/**
 * 4. 执行整个 First-Four Cycle 流水线
 */
export async function runFirstFourGenerationCycle(options: FirstFourCycleOptions = {}): Promise<{
  manifest: SeedManifest;
  generatedCandidates: GeneratedCandidateRecord[];
  seedStats: SeedGenerationStats[];
  retainedRecords: any[];
  rejectedRecords: any[];
  optimizerInterfaceCheck: ReturnType<typeof checkTreeOptimizerPanelInterface>;
  outputDir: string;
}> {
  const outputDir = options.outputDir ? resolve(options.outputDir) : DEFAULT_OUTPUT_DIR;
  const baseSeed = options.baseSeed ?? 42;
  const attemptsPerSeed = options.attemptsPerSeed ?? 6;
  const workers = Math.min(2, Math.max(1, options.workers ?? 2));
  const coarseGames = options.coarseGames ?? 2;
  const coarseSeedBase = options.coarseSeedBase ?? 1000;
  const explorationFloor = options.explorationFloor ?? 0.25;
  const maxRetained = options.maxRetained ?? 6;

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // 1. 解析 Seeds 与 Panel
  const { sourceSeeds, evaluationPanel } = resolveSeedsAndPanel();

  const manifest: SeedManifest = {
    timestamp: new Date().toISOString(),
    seedCount: sourceSeeds.length,
    sourceSeeds: sourceSeeds.map((s, idx) => ({
      index: idx,
      id: s.id,
      name: s.name,
      archetype: s.archetype,
      cost: s.team.reduce((sum, slot) => sum + costOf(slot.monsterId), 0),
    })),
    panelCount: evaluationPanel.length,
    evaluationPanel: evaluationPanel.map((o, idx) => ({
      index: idx,
      id: o.id,
      name: o.name,
      archetype: o.archetype,
    })),
    effectiveSettings: {
      attemptsPerSeed,
      maxRetained,
      explorationFloor,
      workers,
      coarseGames,
      coarseSeedBase,
    },
  };

  writeFileSync(join(outputDir, 'seed_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  // 2. 多源变异生成
  const allGenerated: GeneratedCandidateRecord[] = [];
  const seedStats: SeedGenerationStats[] = [];
  const seenCanonical = new Set<string>();
  const seenFps = new Set<string>();

  for (let i = 0; i < sourceSeeds.length; i++) {
    const s = sourceSeeds[i];
    const genSeed = baseSeed + i * 100;
    const res = generateFromSourceSeed(s, i, genSeed, attemptsPerSeed, seenCanonical, seenFps);
    allGenerated.push(...res.candidates);
    seedStats.push(res.stats);
  }

  // 3. 在固定 8 对手面板上进行粗筛评估
  if (allGenerated.length > 0) {
    console.log(`\n=== 阶段一：在固定 8 对手面板上进行粗筛评估 (${allGenerated.length} 候选, ${coarseGames} 局/侧, ${workers} workers) ===`);
    const evalTargets = allGenerated.map(c => ({
      name: c.candidateId,
      f: { name: c.candidateId, archetype: c.archPath, team: c.team, root: c.tree } as EvolFormation,
    }));

    const coarseResults = await evaluateBatchParallel(evalTargets, coarseGames, {
      workerCount: workers,
      seedBase: coarseSeedBase,
    });

    for (let i = 0; i < allGenerated.length; i++) {
      const res = coarseResults[i];
      if (res) {
        allGenerated[i].coarseEvaluation = {
          ...res,
          seedBase: coarseSeedBase,
          games: coarseGames,
          workers,
        };
      }
    }
  }

  // 写入 generated_candidates.jsonl
  const candJsonlContent = allGenerated.map(c => JSON.stringify(c)).join('\n') + '\n';
  writeFileSync(join(outputDir, 'generated_candidates.jsonl'), candJsonlContent, 'utf8');

  // 4. 多样性保留分析
  const analysisRecords: CandidateAnalysisRecord[] = allGenerated.map(c => {
    const refForm = FORMATION_LIBRARY.find(f => f.name === c.referenceFormation) ?? sourceSeeds[0];
    const refEvol = formationToEvol(refForm);
    const mutationVector = calculateMutationVector(c as any, refEvol, 18);
    const effectiveScore = c.coarseEvaluation?.adScore ?? 0;
    return {
      ...(c as any),
      mutationVector,
      effectiveScore,
      scoreSource: 'coarse',
    };
  });

  const retentionRes = selectRetainedCandidates(analysisRecords, maxRetained, explorationFloor);

  // 写入 retention.json 与 retention.md
  writeFileSync(join(outputDir, 'retention.json'), JSON.stringify(retentionRes, null, 2), 'utf8');

  const retentionMd = `# First-Four Cycle Retention Report (T011)

## 1. Summary
- **Analyzed Candidates**: ${analysisRecords.length}
- **Retained Count**: ${retentionRes.retained.length} / ${maxRetained}
- **Rejected Count**: ${retentionRes.rejected.length}
- **Exploration Floor**: ${explorationFloor}

## 2. Retained Candidates
| Candidate ID | Source Seed | Module | Score (Coarse) | Novelty | Bucket | Retention Reasons |
|---|---|---|---|---|---|---|
${retentionRes.retained.map(r => `| \`${r.candidateId}\` | \`${r.referenceFormation}\` | ${r.modulePath} | ${(r.effectiveScore * 100).toFixed(1)}% | ${(r.mutationVector.noveltyScore * 100).toFixed(1)}% | \`${r.mutationVector.direction.mutationBucket}\` | \`${r.retentionReasons.join(', ')}\` |`).join('\n')}

## 3. Rejected Candidates
| Candidate ID | Source Seed | Score | Novelty | Rejection Reason |
|---|---|---|---|---|
${retentionRes.rejected.map(r => `| \`${r.candidateId}\` | \`${r.referenceFormation}\` | ${(r.effectiveScore * 100).toFixed(1)}% | ${(r.mutationVector.noveltyScore * 100).toFixed(1)}% | \`${r.rejectionReason}\` |`).join('\n')}
`;
  writeFileSync(join(outputDir, 'retention.md'), retentionMd, 'utf8');

  // 5. 检查树优化器接口
  const optCheck = checkTreeOptimizerPanelInterface();

  // 6. 生成 summary.md
  const summaryMd = `# First-Four Bundle Seed Cycle Summary (T011)

## 1. Source Seeds & Evaluation Panel Resolution
- **Source Seeds**: ${sourceSeeds.map(s => `\`${s.name}\``).join(', ')} (${sourceSeeds.length} total)
- **Evaluation Panel**: ${evaluationPanel.map(o => `\`${o.name}\``).join(', ')} (${evaluationPanel.length} total)

## 2. Multi-Seed Mutation Statistics
| Source Seed | Attempts | Accepted | Duplicate Rejections | Structural Rejections | Generated Candidate IDs |
|---|---|---|---|---|---|
${seedStats.map(s => `| \`${s.sourceSeedName}\` | ${s.attempts} | ${s.accepted} | ${s.duplicateRejections} | ${s.structuralRejections} | ${s.generatedCandidateIds.join(', ') || 'none'} |`).join('\n')}

## 3. Pre-Tree Retention Summary
- **Generated**: ${allGenerated.length}
- **Retained**: ${retentionRes.retained.length}
- **Rejected**: ${retentionRes.rejected.length}

## 4. Tree Optimizer Interface Status
- **Supported**: \`${optCheck.supported ? 'YES' : 'NO'}\`
- **Reason**: ${optCheck.reason}
- **Missing Interface**: \`${optCheck.missingInterfaceDescription}\`
- **Action**: Stopped before running tree optimization in accordance with T011 safety constraints.

_Generated at ${new Date().toISOString()}_
`;
  writeFileSync(join(outputDir, 'summary.md'), summaryMd, 'utf8');

  return {
    manifest,
    generatedCandidates: allGenerated,
    seedStats,
    retainedRecords: retentionRes.retained,
    rejectedRecords: retentionRes.rejected,
    optimizerInterfaceCheck: optCheck,
    outputDir,
  };
}

// CLI 执行入口
const isDirectScript = Boolean(
  process.argv[1] &&
  (process.argv[1].endsWith('first_four_generation.ts') || process.argv[1].endsWith('first_four_generation.js'))
);
const isTesting = process.env.IS_TEST || process.env.VITEST;
if (isDirectScript && !isTesting) {
  runFirstFourGenerationCycle().then(res => {
    console.log(`\n[First-Four Cycle CLI Done] Generated: ${res.generatedCandidates.length}, Retained: ${res.retainedRecords.length}, Rejected: ${res.rejectedRecords.length}`);
    console.log(`[Optimizer Gate]: ${res.optimizerInterfaceCheck.supported ? 'Supported' : 'Blocked (Missing Interface: ' + res.optimizerInterfaceCheck.missingInterfaceDescription + ')'}`);
  }).catch(e => {
    console.error('First-Four cycle failed:', e);
    process.exit(1);
  });
}
