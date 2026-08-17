// ============================================================
// T009 — Diversity-Aware Candidate Retention Analyzer
//
// 目的：将有界评估试点生成的候选卡组数据集转化为兼顾性能、
// 流派/模块覆盖与变异创新的小规模、高解释度保留候选池 (至多 6 个)。
// 本分析纯离线运行，绝不调用 Arena 战斗或修改活跃阵型库。
// ============================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { FORMATION_LIBRARY } from '../../ai/formation_library';
import { formationToEvol, type EvolFormation, type EvolNode } from './evol_gene';
import { computeTreeFingerprint } from './search_experience';
import type { CandidateRecord } from './new_formation_pilot';

export interface DeckMutation {
  addedMonsters: number[];
  removedMonsters: number[];
  symmetricDifference: number;
  coreChanged: boolean | 'unknown';
  costDelta: number;
}

export interface BadgeMutation {
  commonMonstersBadgeDiffCount: number;
  badgesAdded: number;
  badgesRemoved: number;
}

export interface TreeMutation {
  treeFingerprintDiff: boolean;
  placementDiffCount: number;
  nodeCountDiff: number;
}

export interface MutationVector {
  deckMutation: DeckMutation;
  badgeMutation: BadgeMutation;
  treeMutation: TreeMutation;
  direction: {
    archPath: string;
    modulePath: string;
    coreKey: string;
    mutationBucket: 'light' | 'medium' | 'heavy';
  };
  noveltyScore: number;
  noveltyDetails: {
    normalizedDeckDist: number;
    normalizedBadgeDist: number;
    normalizedTreeDist: number;
    formula: string;
    version: string;
  };
}

export interface CandidateAnalysisRecord {
  candidateId: string;
  generationSeed: number;
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
    reason?: string;
  };
  coarseEvaluation?: any;
  refinedEvaluation?: any;
  effectiveScore: number;
  scoreSource: 'refined' | 'coarse' | 'none';
  mutationVector: MutationVector;
}

export interface RetainedCandidateRecord extends CandidateAnalysisRecord {
  retained: true;
  retentionReasons: string[];
}

export interface RejectedCandidateRecord extends CandidateAnalysisRecord {
  retained: false;
  rejectionReason: string;
}

export interface RetentionResult {
  inputPath: string;
  outputDir: string;
  analyzedCount: number;
  retainedCount: number;
  rejectedCount: number;
  retainedCandidates: RetainedCandidateRecord[];
  rejectedCandidates: RejectedCandidateRecord[];
  noveltyFormula: string;
  bucketThresholds: {
    light: string;
    medium: string;
    heavy: string;
  };
}

export interface RetentionOptions {
  inputPath?: string;
  outputDir?: string;
  maxRetained?: number;
  explorationFloor?: number;
  mockCandidates?: CandidateRecord[];
}

/**
 * 遍历提取决策树中的所有放置动作
 */
function extractPlacements(node: EvolNode | any, roundAcc: number = 0): Set<string> {
  const placements = new Set<string>();
  if (!node) return placements;

  const currentRound = node.round ?? roundAcc;
  if (Array.isArray(node.placements)) {
    for (const p of node.placements) {
      if (p && p.monsterId > 0) {
        placements.add(`${currentRound}:${p.monsterId}:${p.x ?? 0}:${p.y ?? 0}`);
      }
    }
  }

  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      const childPlacements = extractPlacements(child, currentRound + 1);
      for (const p of childPlacements) {
        placements.add(p);
      }
    }
  }

  return placements;
}

function countNodes(node: EvolNode | any): number {
  if (!node) return 0;
  let count = 1;
  if (Array.isArray(node.children)) {
    for (const c of node.children) {
      count += countNodes(c);
    }
  }
  return count;
}

/**
 * 计算候选卡组相对于基准阵型的变异向量与新颖度得分
 */
export function calculateMutationVector(
  candidate: CandidateRecord,
  refEvol: EvolFormation,
  refCost: number
): MutationVector {
  const candMonsterIds = candidate.team.map(m => m.monsterId).filter(id => id > 0);
  const refMonsterIds = refEvol.team.map(m => m.monsterId).filter(id => id > 0);

  const addedMonsters = candMonsterIds.filter(id => !refMonsterIds.includes(id));
  const removedMonsters = refMonsterIds.filter(id => !candMonsterIds.includes(id));
  const symmetricDifference = addedMonsters.length + removedMonsters.length;

  // coreChanged 判定
  let coreChanged: boolean | 'unknown' = 'unknown';
  if (candidate.referenceFormation === '全二永平' || candidate.referenceFormation === '全二冲') {
    coreChanged = candidate.coreKey !== 'all2';
  } else if (candidate.referenceFormation === '泉水剑') {
    coreChanged = candidate.coreKey !== 'suqing';
  }

  const costDelta = (candidate.validation?.cost ?? 18) - refCost;

  const deckMutation: DeckMutation = {
    addedMonsters,
    removedMonsters,
    symmetricDifference,
    coreChanged,
    costDelta,
  };

  // Badge Mutation
  const commonIds = candMonsterIds.filter(id => refMonsterIds.includes(id));
  let badgeDiffMonstersCount = 0;
  let badgesAdded = 0;
  let badgesRemoved = 0;

  for (const mId of commonIds) {
    const candM = candidate.team.find(m => m.monsterId === mId);
    const refM = refEvol.team.find(m => m.monsterId === mId);
    const candBadges = [...(candM?.badgeIds ?? [])].sort((a, b) => a - b);
    const refBadges = [...(refM?.badgeIds ?? [])].sort((a, b) => a - b);

    if (candBadges.join(',') !== refBadges.join(',')) {
      badgeDiffMonstersCount++;
    }

    badgesAdded += candBadges.filter(b => !refBadges.includes(b)).length;
    badgesRemoved += refBadges.filter(b => !candBadges.includes(b)).length;
  }

  const badgeMutation: BadgeMutation = {
    commonMonstersBadgeDiffCount: badgeDiffMonstersCount,
    badgesAdded,
    badgesRemoved,
  };

  // Tree Mutation
  const refTreeFp = computeTreeFingerprint(refEvol);
  const treeFingerprintDiff = candidate.treeFingerprint !== refTreeFp;

  const candPlacements = extractPlacements(candidate.tree);
  const refPlacements = extractPlacements(refEvol.root);

  let placementDiffCount = 0;
  for (const p of candPlacements) {
    if (!refPlacements.has(p)) placementDiffCount++;
  }
  for (const p of refPlacements) {
    if (!candPlacements.has(p)) placementDiffCount++;
  }

  const candNodeCount = countNodes(candidate.tree);
  const refNodeCount = countNodes(refEvol.root);
  const nodeCountDiff = Math.abs(candNodeCount - refNodeCount);

  const treeMutation: TreeMutation = {
    treeFingerprintDiff,
    placementDiffCount,
    nodeCountDiff,
  };

  // 归一化分量与 Novelty 计算 (0..1)
  const normalizedDeckDist = Math.min(1, symmetricDifference / 8);
  const normalizedBadgeDist = Math.min(1, (badgesAdded + badgesRemoved) / 8);
  const normalizedTreeDist = Math.min(1, placementDiffCount / 10);

  const compositeDistance = 0.4 * normalizedDeckDist + 0.3 * normalizedBadgeDist + 0.3 * normalizedTreeDist;
  const noveltyScore = Math.round(compositeDistance * 10000) / 10000;

  // 变异分类桶判定标准 (轻度 < 0.35, 中度 0.35..0.65, 重度 >= 0.65)
  let mutationBucket: 'light' | 'medium' | 'heavy' = 'medium';
  if (noveltyScore < 0.35) {
    mutationBucket = 'light';
  } else if (noveltyScore >= 0.65) {
    mutationBucket = 'heavy';
  }

  const formula = '0.4 * min(1, symDiff/8) + 0.3 * min(1, (badgesAdded+badgesRemoved)/8) + 0.3 * min(1, placementDiff/10)';
  const version = '1.0.0';

  return {
    deckMutation,
    badgeMutation,
    treeMutation,
    direction: {
      archPath: candidate.archPath,
      modulePath: candidate.modulePath,
      coreKey: candidate.coreKey,
      mutationBucket,
    },
    noveltyScore,
    noveltyDetails: {
      normalizedDeckDist,
      normalizedBadgeDist,
      normalizedTreeDist,
      formula,
      version,
    },
  };
}

/**
 * 核心保留选择策略
 */
export function selectRetainedCandidates(
  analyzedList: CandidateAnalysisRecord[],
  maxRetained: number = 6,
  explorationFloor: number = 0.25
): {
  retained: RetainedCandidateRecord[];
  rejected: RejectedCandidateRecord[];
} {
  const retained: RetainedCandidateRecord[] = [];
  const rejected: RejectedCandidateRecord[] = [];

  const seenCanonicalKeys = new Set<string>();
  const seenTreeFps = new Set<string>();

  // 1. 过滤结构非法与去重
  const uniqueCandidates: CandidateAnalysisRecord[] = [];
  for (const c of analyzedList) {
    if (!c.validation?.valid) {
      rejected.push({
        ...c,
        retained: false,
        rejectionReason: `invalid_structure: ${c.validation?.reason ?? 'validation failed'}`,
      });
      continue;
    }
    if (seenCanonicalKeys.has(c.canonicalKey)) {
      rejected.push({
        ...c,
        retained: false,
        rejectionReason: `duplicate_canonical_key: ${c.canonicalKey}`,
      });
      continue;
    }
    if (seenTreeFps.has(c.treeFingerprint)) {
      rejected.push({
        ...c,
        retained: false,
        rejectionReason: `duplicate_tree_fingerprint: ${c.treeFingerprint}`,
      });
      continue;
    }
    seenCanonicalKeys.add(c.canonicalKey);
    seenTreeFps.add(c.treeFingerprint);
    uniqueCandidates.push(c);
  }

  // 候选池按综合有效性能降序排序 (用于优先保留最佳性能)
  uniqueCandidates.sort((a, b) => b.effectiveScore - a.effectiveScore);

  const retainedIdMap = new Map<string, RetainedCandidateRecord>();

  function retainRecord(rec: CandidateAnalysisRecord, reason: string) {
    if (retainedIdMap.has(rec.candidateId)) {
      const existing = retainedIdMap.get(rec.candidateId)!;
      if (!existing.retentionReasons.includes(reason)) {
        existing.retentionReasons.push(reason);
      }
      return;
    }
    if (retainedIdMap.size >= maxRetained) return;

    const r: RetainedCandidateRecord = {
      ...rec,
      retained: true,
      retentionReasons: [reason],
    };
    retainedIdMap.set(rec.candidateId, r);
  }

  // Step 1: Performance Baseline
  const nonZeroCandidates = uniqueCandidates.filter(c => c.effectiveScore > 0);

  if (nonZeroCandidates.length > 0 && retainedIdMap.size < maxRetained) {
    const bestOverall = nonZeroCandidates[0];
    retainRecord(bestOverall, 'performance_baseline');
  }

  // Step 2: Direction Representatives (Archetype Coverage & Direction Coverage)
  const archSet = new Set(nonZeroCandidates.map(c => c.archPath));
  for (const arch of archSet) {
    if (retainedIdMap.size >= maxRetained) break;
    const candidatesInArch = nonZeroCandidates.filter(c => c.archPath === arch);
    const bestInArch = candidatesInArch[0];
    if (bestInArch) {
      retainRecord(bestInArch, 'archetype_coverage');
    }
  }

  // Direction Coverage (archPath, modulePath)
  if (retainedIdMap.size < maxRetained) {
    const coveredDirections = new Set(
      Array.from(retainedIdMap.values()).map(r => `${r.archPath}::${r.modulePath}`)
    );
    for (const c of nonZeroCandidates) {
      if (retainedIdMap.size >= maxRetained) break;
      const dirKey = `${c.archPath}::${c.modulePath}`;
      if (!coveredDirections.has(dirKey)) {
        retainRecord(c, 'direction_coverage');
        coveredDirections.add(dirKey);
      }
    }
  }

  // Step 3: Mutation Bucket Coverage (light, medium, heavy)
  if (retainedIdMap.size < maxRetained) {
    const coveredBuckets = new Set(
      Array.from(retainedIdMap.values()).map(r => r.mutationVector.direction.mutationBucket)
    );
    const allBuckets: ('light' | 'medium' | 'heavy')[] = ['light', 'medium', 'heavy'];
    for (const b of allBuckets) {
      if (retainedIdMap.size >= maxRetained) break;
      if (!coveredBuckets.has(b)) {
        const bestInBucket = nonZeroCandidates.find(c => c.mutationVector.direction.mutationBucket === b);
        if (bestInBucket) {
          retainRecord(bestInBucket, 'mutation_bucket_coverage');
          coveredBuckets.add(b);
        }
      }
    }
  }

  // Step 4: Exploration (ordered by noveltyScore desc, coarse/effectiveScore >= explorationFloor)
  if (retainedIdMap.size < maxRetained) {
    const unselected = uniqueCandidates
      .filter(c => !retainedIdMap.has(c.candidateId))
      .sort((a, b) => b.mutationVector.noveltyScore - a.mutationVector.noveltyScore);

    for (const c of unselected) {
      if (retainedIdMap.size >= maxRetained) break;
      const coarseScore = c.coarseEvaluation?.adScore ?? c.effectiveScore;
      if (coarseScore >= explorationFloor && coarseScore > 0) {
        retainRecord(c, 'exploration_novelty');
      }
    }
  }

  // 处理未入选的候选
  for (const c of uniqueCandidates) {
    if (retainedIdMap.has(c.candidateId)) {
      retained.push(retainedIdMap.get(c.candidateId)!);
    } else {
      const coarseScore = c.coarseEvaluation?.adScore ?? c.effectiveScore;
      let rejectionReason = 'capacity_exhausted';
      if (coarseScore === 0) {
        rejectionReason = 'zero_score_rejected';
      } else if (coarseScore < explorationFloor) {
        rejectionReason = `score_floor_below_${explorationFloor} (score: ${(coarseScore * 100).toFixed(1)}%)`;
      } else {
        rejectionReason = 'capacity_exhausted_unselected_novelty';
      }
      rejected.push({
        ...c,
        retained: false,
        rejectionReason,
      });
    }
  }

  return { retained, rejected };
}

/**
 * 主执行函数
 */
export async function analyzeAndRetainCandidates(options: RetentionOptions = {}): Promise<RetentionResult> {
  const inputPath = options.inputPath ?? resolve('reports/new-formation-pilot/candidates.jsonl');
  const outputDir = options.outputDir ?? dirname(inputPath);
  const maxRetained = options.maxRetained ?? 6;
  const explorationFloor = options.explorationFloor ?? 0.25;

  if (maxRetained < 1 || maxRetained > 6) {
    throw new Error(`[Retention Configuration Error] maxRetained (${maxRetained}) must be within 1..6.`);
  }

  let candidates: CandidateRecord[] = [];

  if (options.mockCandidates) {
    candidates = options.mockCandidates;
  } else {
    if (!existsSync(inputPath)) {
      throw new Error(`[Retention Input Error] Candidate file '${inputPath}' does not exist.`);
    }
    const rawContent = readFileSync(inputPath, 'utf8').trim();
    if (!rawContent) {
      throw new Error(`[Retention Input Error] Candidate file '${inputPath}' is empty.`);
    }
    const lines = rawContent.split('\n').filter(l => l.trim().length > 0);
    for (let i = 0; i < lines.length; i++) {
      try {
        const parsed = JSON.parse(lines[i]);
        candidates.push(parsed);
      } catch (err: any) {
        throw new Error(`[Retention Malformed Input] Malformed JSON on line ${i + 1}: ${err.message}`);
      }
    }
  }

  if (candidates.length === 0) {
    throw new Error('[Retention Input Error] No candidate records found to analyze.');
  }

  // 分析每个候选的变异与得分
  const analyzedList: CandidateAnalysisRecord[] = [];

  for (const c of candidates) {
    const refFound = FORMATION_LIBRARY.find(f => f.name === c.referenceFormation);
    if (!refFound) {
      throw new Error(`[Retention Reference Error] Reference formation '${c.referenceFormation}' not found in FORMATION_LIBRARY.`);
    }

    const refEvol = formationToEvol(refFound);
    const refCost = refEvol.team.reduce((acc, m) => acc + (m.badgeIds.length > 2 ? 3 : 2), 0); // 估算或按实际
    const mutationVector = calculateMutationVector(c, refEvol, refCost);

    let effectiveScore = 0;
    let scoreSource: 'refined' | 'coarse' | 'none' = 'none';

    if (typeof c.refinedEvaluation?.adScore === 'number') {
      effectiveScore = c.refinedEvaluation.adScore;
      scoreSource = 'refined';
    } else if (typeof c.coarseEvaluation?.adScore === 'number') {
      effectiveScore = c.coarseEvaluation.adScore;
      scoreSource = 'coarse';
    }

    analyzedList.push({
      ...c,
      effectiveScore,
      scoreSource,
      mutationVector,
    });
  }

  const { retained, rejected } = selectRetainedCandidates(analyzedList, maxRetained, explorationFloor);

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const result: RetentionResult = {
    inputPath,
    outputDir,
    analyzedCount: analyzedList.length,
    retainedCount: retained.length,
    rejectedCount: rejected.length,
    retainedCandidates: retained,
    rejectedCandidates: rejected,
    noveltyFormula: '0.4 * min(1, symDiff/8) + 0.3 * min(1, (badgesAdded+badgesRemoved)/8) + 0.3 * min(1, placementDiff/10)',
    bucketThresholds: {
      light: 'noveltyScore < 0.35',
      medium: '0.35 <= noveltyScore < 0.65',
      heavy: 'noveltyScore >= 0.65',
    },
  };

  // 写入 retention.json
  const jsonPath = join(outputDir, 'retention.json');
  writeFileSync(jsonPath, JSON.stringify(result, null, 2), 'utf8');

  // 写入 retention.md
  const mdPath = join(outputDir, 'retention.md');
  const mdContent = `# Diversity-Aware Candidate Retention Report (T009)

## 1. Summary Overview
- **Analyzed Candidates**: ${analyzedList.length}
- **Retained Count**: ${retained.length} / ${maxRetained} (hard cap: 6)
- **Rejected Count**: ${rejected.length}
- **Exploration Floor**: ${explorationFloor} (${(explorationFloor * 100).toFixed(0)}%)

## 2. Novelty Metric & Classification
- **Formula**: \`${result.noveltyFormula}\`
- **Bucket Thresholds**:
  - \`light\`: ${result.bucketThresholds.light}
  - \`medium\`: ${result.bucketThresholds.medium}
  - \`heavy\`: ${result.bucketThresholds.heavy}

## 3. Retained Candidates Pool
| Candidate ID | Arch | Module | Reference | Bucket | Novelty | Score (${retained.some(r => r.scoreSource === 'refined') ? 'Refined/Coarse' : 'Coarse'}) | Retention Reasons |
|---|---|---|---|---|---|---|---|
${retained.map(r => `| \`${r.candidateId}\` | ${r.archPath} | ${r.modulePath} | \`${r.referenceFormation}\` | \`${r.mutationVector.direction.mutationBucket}\` | **${(r.mutationVector.noveltyScore * 100).toFixed(1)}%** | **${(r.effectiveScore * 100).toFixed(1)}%** (${r.scoreSource}) | \`${r.retentionReasons.join(', ')}\` |`).join('\n')}

## 4. Retained Candidates Detail Breakdown
${retained.map((r, idx) => `### ${idx + 1}. \`${r.candidateId}\` (${r.archPath} - ${r.modulePath})
- **Reference Formation**: \`${r.referenceFormation}\`
- **Reasons**: \`${r.retentionReasons.join(', ')}\`
- **Performance**: ${(r.effectiveScore * 100).toFixed(1)}% (source: \`${r.scoreSource}\`)
- **Deck Mutation**: SymDiff=${r.mutationVector.deckMutation.symmetricDifference} (+[${r.mutationVector.deckMutation.addedMonsters.join(',')}], -[${r.mutationVector.deckMutation.removedMonsters.join(',')}]), CostDelta=${r.mutationVector.deckMutation.costDelta}
- **Badge Mutation**: CommonDiffCount=${r.mutationVector.badgeMutation.commonMonstersBadgeDiffCount}, Added=${r.mutationVector.badgeMutation.badgesAdded}, Removed=${r.mutationVector.badgeMutation.badgesRemoved}
- **Tree Mutation**: PlacementsDiff=${r.mutationVector.treeMutation.placementDiffCount}, NodeCountDiff=${r.mutationVector.treeMutation.nodeCountDiff}
- **Novelty Score**: \`${(r.mutationVector.noveltyScore * 100).toFixed(1)}%\` (\`${r.mutationVector.direction.mutationBucket}\`)
`).join('\n')}

## 5. Rejected Candidates
| Candidate ID | Arch | Module | Score | Novelty | Rejection Reason |
|---|---|---|---|---|---|
${rejected.map(rej => `| \`${rej.candidateId}\` | ${rej.archPath} | ${rej.modulePath} | ${(rej.effectiveScore * 100).toFixed(1)}% | ${(rej.mutationVector.noveltyScore * 100).toFixed(1)}% | \`${rej.rejectionReason}\` |`).join('\n')}

_Generated at ${new Date().toISOString()}_
`;
  writeFileSync(mdPath, mdContent, 'utf8');

  console.log(`\n保留分析结果已保存至：\n  - ${jsonPath}\n  - ${mdPath}`);

  return result;
}

// 辅助函数：解析 CLI 参数值
function parseCliArg(args: string[], flag: string): string | null {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && i + 1 < args.length) {
      return args[i + 1];
    }
    if (args[i].startsWith(`${flag}=`)) {
      return args[i].slice(flag.length + 1);
    }
  }
  return null;
}

// CLI 执行入口
const isDirectScript = Boolean(
  process.argv[1] &&
  (process.argv[1].endsWith('candidate_retention.ts') || process.argv[1].endsWith('candidate_retention.js'))
);
const isTesting = process.env.IS_TEST || process.env.VITEST;
if (isDirectScript && !isTesting) {
  const args = process.argv.slice(2);
  const inputArg = parseCliArg(args, '--input');
  const outputDirArg = parseCliArg(args, '--output-dir');
  const maxRetainedArg = parseCliArg(args, '--max-retained');
  const floorArg = parseCliArg(args, '--exploration-floor');

  analyzeAndRetainCandidates({
    inputPath: inputArg ?? undefined,
    outputDir: outputDirArg ?? undefined,
    maxRetained: maxRetainedArg ? parseInt(maxRetainedArg, 10) : undefined,
    explorationFloor: floorArg ? parseFloat(floorArg) : undefined,
  }).then(res => {
    console.log(`\n[Retention CLI Done] Successfully retained ${res.retainedCount} candidates (analyzed: ${res.analyzedCount}, rejected: ${res.rejectedCount}).`);
  }).catch(e => {
    console.error('Retention failed:', e.message);
    process.exit(1);
  });
}
