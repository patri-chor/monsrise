import '../env';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
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
  type RetainedCandidateRecord,
  type RejectedCandidateRecord,
} from './candidate_retention';
import {
  costOf,
  validateDeck,
  badgeTemplateFor,
} from './deck_ontology';
import { COMBO_MODULES } from './flow_library';
import { resolveSeedsAndPanel } from './first_four_generation';

import os from 'node:os';

export const EXPANSION_OUTPUT_DIR = resolve('reports/new-formation-generation/per-seed-expansion');

export interface ExpansionOptions {
  outputDir?: string;
  baseSeed?: number;
  attemptsPerSeed?: number;
  workers?: number;
  coarseGames?: number;
  coarseSeedBase?: number;
  explorationFloor?: number;
  maxRetainedPerSeed?: number;
}

/**
 * 计算有效 worker 数量
 */
export function resolveEffectiveWorkers(requestedWorkers?: number, availableCpus: number = os.cpus()?.length || 1): {
  requestedWorkers: number;
  effectiveWorkers: number;
  availableLogicalCpus: number;
} {
  const req = requestedWorkers ?? 16;
  const effective = Math.max(1, Math.min(req, availableCpus));
  return {
    requestedWorkers: req,
    effectiveWorkers: effective,
    availableLogicalCpus: availableCpus,
  };
}

export interface ExpandedCandidateRecord {
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

export interface SeedExpansionStats {
  sourceSeedIndex: number;
  sourceSeedName: string;
  sourceSeedId: string;
  attempts: number;
  generatedCount: number;
  acceptedCount: number;
  duplicateRejections: number;
  structuralRejections: number;
  retainedCount: number;
  rejectedCount: number;
  shortfall: number;
  generatedCandidateIds: string[];
  retainedCandidateIds: string[];
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
 * 单源种子有界扩展（最多 attemptsPerSeed 次尝试）
 */
export function expandFromSourceSeed(
  sourceSeed: Formation,
  sourceSeedIndex: number,
  genSeed: number,
  maxAttempts: number = 20,
  globalCanonicalMap: Map<string, number> = new Map(),
  globalTreeFps: Map<string, number> = new Map(),
): {
  candidates: ExpandedCandidateRecord[];
  stats: SeedExpansionStats;
} {
  const rng = mulberry32(genSeed);
  const stats: SeedExpansionStats = {
    sourceSeedIndex,
    sourceSeedName: sourceSeed.name,
    sourceSeedId: sourceSeed.id,
    attempts: 0,
    generatedCount: 0,
    acceptedCount: 0,
    duplicateRejections: 0,
    structuralRejections: 0,
    retainedCount: 0,
    rejectedCount: 0,
    shortfall: 0,
    generatedCandidateIds: [],
    retainedCandidateIds: [],
  };

  const candidates: ExpandedCandidateRecord[] = [];
  const srcEvol = formationToEvol(sourceSeed);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    stats.attempts++;

    const comboMod = COMBO_MODULES[Math.floor(rng() * COMBO_MODULES.length)];
    const modMonsterIds = [...comboMod.required, ...comboMod.optional];
    const coreKey = sourceSeed.archetype === 'fullrush' ? 'digger' : (sourceSeed.archetype === 'prayer' ? 'savior' : 'all2');

    const teamSlots: { monsterId: number; badgeIds: number[] }[] = [];
    const usedIds = new Set<number>();

    // 1. 加入模块核心怪兽
    for (const mId of modMonsterIds) {
      if (!usedIds.has(mId)) {
        usedIds.add(mId);
        teamSlots.push({ monsterId: mId, badgeIds: badgeTemplateFor(mId) });
      }
    }

    // 2. 从源种子队伍补充怪兽（随机打乱补充以增加多样性）
    const remainingSeedSlots = sourceSeed.team.filter(s => !usedIds.has(s.monsterId));
    for (let i = remainingSeedSlots.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [remainingSeedSlots[i], remainingSeedSlots[j]] = [remainingSeedSlots[j], remainingSeedSlots[i]];
    }

    for (const slot of remainingSeedSlots) {
      if (teamSlots.length < 8) {
        usedIds.add(slot.monsterId);
        teamSlots.push({ monsterId: slot.monsterId, badgeIds: slot.badgeIds ?? badgeTemplateFor(slot.monsterId) });
      }
    }

    // 3. 校验并调整费用
    let cost = teamSlots.reduce((sum, s) => sum + costOf(s.monsterId), 0);
    while (cost > 18 && teamSlots.length > 6) {
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

    // 4. 映射基准树
    let evolWithTree: EvolFormation;
    try {
      evolWithTree = mapRefTreeToDeck(srcEvol, teamSlots);
    } catch {
      stats.structuralRejections++;
      continue;
    }

    const canonKey = teamSlots.map(s => s.monsterId).sort((a, b) => a - b).join(',');
    const treeFp = JSON.stringify(evolWithTree.root);

    // 全局与跨种子去重：若已被之前的种子注册，则拒绝并在本种子记录 duplicateRejection
    if (globalCanonicalMap.has(canonKey) || globalTreeFps.has(treeFp)) {
      stats.duplicateRejections++;
      continue;
    }

    globalCanonicalMap.set(canonKey, sourceSeedIndex);
    globalTreeFps.set(treeFp, sourceSeedIndex);

    const candId = `cand_s${sourceSeedIndex + 1}_${candidates.length + 1}_${Math.abs(genSeed + attempt * 17).toString(16).slice(0, 6)}`;
    const record: ExpandedCandidateRecord = {
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
    stats.generatedCount++;
    stats.acceptedCount++;
    stats.generatedCandidateIds.push(candId);
  }

  return { candidates, stats };
}

/**
 * 执行完整 Per-Seed 扩展流水线
 */
export async function runPerSeedExpansion(options: ExpansionOptions = {}): Promise<{
  manifest: any;
  allGenerated: ExpandedCandidateRecord[];
  frozenCandidates: any[];
  seedStats: SeedExpansionStats[];
  retentionBySeed: Record<string, { retained: RetainedCandidateRecord[]; rejected: RejectedCandidateRecord[] }>;
  outputDir: string;
}> {
  const outputDir = options.outputDir ? resolve(options.outputDir) : EXPANSION_OUTPUT_DIR;
  const baseSeed = options.baseSeed ?? 42;
  const attemptsPerSeed = Math.min(20, Math.max(1, options.attemptsPerSeed ?? 20));
  const workerInfo = resolveEffectiveWorkers(options.workers);
  const workers = workerInfo.effectiveWorkers;
  const coarseGames = options.coarseGames ?? 1;
  const coarseSeedBase = options.coarseSeedBase ?? 1000;
  const explorationFloor = options.explorationFloor ?? 0.25;
  const maxRetainedPerSeed = options.maxRetainedPerSeed ?? 6;

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // 1. 解析 Seeds 与 Panel
  const { sourceSeeds, evaluationPanel } = resolveSeedsAndPanel();

  const manifest = {
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
      maxRetainedPerSeed,
      maxTotalCapacity: sourceSeeds.length * maxRetainedPerSeed,
      explorationFloor,
      requestedWorkers: workerInfo.requestedWorkers,
      effectiveWorkers: workerInfo.effectiveWorkers,
      availableLogicalCpus: workerInfo.availableLogicalCpus,
      coarseGames,
      coarseSeedBase,
    },
  };

  writeFileSync(join(outputDir, 'seed_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  // 2. 独立多源扩展生成（跨种子全局去重）
  const allGenerated: ExpandedCandidateRecord[] = [];
  const seedStats: SeedExpansionStats[] = [];
  const globalCanonicalMap = new Map<string, number>();
  const globalTreeFps = new Map<string, number>();

  for (let i = 0; i < sourceSeeds.length; i++) {
    const s = sourceSeeds[i];
    const genSeed = baseSeed + i * 1000;
    const res = expandFromSourceSeed(s, i, genSeed, attemptsPerSeed, globalCanonicalMap, globalTreeFps);
    allGenerated.push(...res.candidates);
    seedStats.push(res.stats);
  }

  // 3. 在固定 8 对手面板上进行粗筛评估 (1 局/侧, 最多 2 workers)
  if (allGenerated.length > 0) {
    console.log(`\n=== 阶段一：在固定 8 对手面板上执行粗筛评估 (${allGenerated.length} 候选, ${coarseGames} 局/侧, ${workers} workers) ===`);
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

  // 4. 按种子独立进行多样性保留 (Per-Seed Retention)
  const retentionBySeed: Record<string, { retained: RetainedCandidateRecord[]; rejected: RejectedCandidateRecord[] }> = {};
  const frozenCandidates: any[] = [];

  for (let i = 0; i < sourceSeeds.length; i++) {
    const s = sourceSeeds[i];
    const sEvol = formationToEvol(s);
    const seedCandidates = allGenerated.filter(c => c.sourceSeedIndex === i);

    const analysisRecords: CandidateAnalysisRecord[] = seedCandidates.map(c => {
      const mutationVector = calculateMutationVector(c as any, sEvol, 18);
      const effectiveScore = c.coarseEvaluation?.adScore ?? 0;
      return {
        ...(c as any),
        mutationVector,
        effectiveScore,
        scoreSource: 'coarse',
      };
    });

    const retRes = selectRetainedCandidates(analysisRecords, maxRetainedPerSeed, explorationFloor);
    retentionBySeed[s.name] = retRes;

    seedStats[i].retainedCount = retRes.retained.length;
    seedStats[i].rejectedCount = retRes.rejected.length;
    seedStats[i].shortfall = Math.max(0, maxRetainedPerSeed - retRes.retained.length);
    seedStats[i].retainedCandidateIds = retRes.retained.map(r => r.candidateId);

    // 加入冻结池
    for (const r of retRes.retained) {
      frozenCandidates.push({
        candidateId: r.candidateId,
        sourceSeedIndex: i,
        sourceSeedName: s.name,
        sourceSeedId: s.id,
        archPath: r.archPath,
        modulePath: r.modulePath,
        referenceFormation: r.referenceFormation,
        coarseScore: r.effectiveScore,
        scoreSource: r.scoreSource,
        mutationVector: r.mutationVector,
        retentionReasons: r.retentionReasons,
        canonicalKey: r.canonicalKey,
        treeFingerprint: r.treeFingerprint,
        validation: r.validation,
        team: r.team,
        tree: r.tree,
      });
    }
  }

  // 写入 retention_by_seed.json
  writeFileSync(join(outputDir, 'retention_by_seed.json'), JSON.stringify(retentionBySeed, null, 2), 'utf8');

  // 写入 retention_by_seed.md
  let retentionMd = `# Per-Seed Candidate Retention Report (T013)\n\n`;
  retentionMd += `## 1. Summary Overview\n`;
  retentionMd += `- **Total Generated Candidates**: ${allGenerated.length}\n`;
  retentionMd += `- **Total Frozen Candidates**: ${frozenCandidates.length} / ${sourceSeeds.length * maxRetainedPerSeed} (max capacity)\n`;
  retentionMd += `- **Exploration Floor**: ${explorationFloor}\n\n`;

  for (const s of sourceSeeds) {
    const res = retentionBySeed[s.name];
    retentionMd += `### Source Seed: \`${s.name}\` (${s.archetype})\n`;
    retentionMd += `- **Retained**: ${res.retained.length} / ${maxRetainedPerSeed} (Shortfall: ${Math.max(0, maxRetainedPerSeed - res.retained.length)})\n`;
    retentionMd += `- **Rejected**: ${res.rejected.length}\n\n`;
    retentionMd += `| Candidate ID | Module | Coarse Score | Novelty | Bucket | Retention Reasons |\n`;
    retentionMd += `|---|---|---|---|---|---|\n`;
    for (const r of res.retained) {
      retentionMd += `| \`${r.candidateId}\` | ${r.modulePath} | ${(r.effectiveScore * 100).toFixed(1)}% | ${(r.mutationVector.noveltyScore * 100).toFixed(1)}% | \`${r.mutationVector.direction.mutationBucket}\` | \`${r.retentionReasons.join(', ')}\` |\n`;
    }
    retentionMd += `\n`;
  }
  writeFileSync(join(outputDir, 'retention_by_seed.md'), retentionMd, 'utf8');

  // 写入 frozen_candidates.jsonl
  const frozenJsonlContent = frozenCandidates.map(c => JSON.stringify(c)).join('\n') + '\n';
  writeFileSync(join(outputDir, 'frozen_candidates.jsonl'), frozenJsonlContent, 'utf8');

  // 写入 summary.md
  const summaryMd = `# Per-Seed Variant Expansion Summary (T013 / T014)

## 1. Source Seeds & Evaluation Panel Resolution
- **Source Seeds**: ${sourceSeeds.map(s => `\`${s.name}\``).join(', ')} (${sourceSeeds.length} total)
- **Evaluation Panel**: ${evaluationPanel.map(o => `\`${o.name}\``).join(', ')} (${evaluationPanel.length} total)

## 2. Worker Concurrency Settings (T014)
- **Requested Workers**: ${workerInfo.requestedWorkers}
- **Effective Workers**: ${workerInfo.effectiveWorkers}
- **Available Logical CPUs**: ${workerInfo.availableLogicalCpus}

## 3. Multi-Seed Mutation Statistics (Attempts <= ${attemptsPerSeed}/seed)
| Source Seed | Attempts | Generated | Accepted | Dup Rejections | Struct Rejections | Retained | Shortfall |
|---|---|---|---|---|---|---|---|
${seedStats.map(s => `| \`${s.sourceSeedName}\` | ${s.attempts} | ${s.generatedCount} | ${s.acceptedCount} | ${s.duplicateRejections} | ${s.structuralRejections} | **${s.retainedCount}** | ${s.shortfall} |`).join('\n')}

## 4. Frozen Candidates Pool
- **Total Frozen**: **${frozenCandidates.length}** / ${sourceSeeds.length * maxRetainedPerSeed}
- **Destination**: \`${join(outputDir, 'frozen_candidates.jsonl')}\`

_Generated at ${new Date().toISOString()}_
`;
  writeFileSync(join(outputDir, 'summary.md'), summaryMd, 'utf8');

  return {
    manifest,
    allGenerated,
    frozenCandidates,
    seedStats,
    retentionBySeed,
    outputDir,
  };
}

// CLI 执行入口
const isTesting = process.env.IS_TEST || process.env.VITEST;
const isDirectScript = process.argv.some(a => a.includes('per_seed_expansion'));
if (isDirectScript && !isTesting) {
  runPerSeedExpansion().then(res => {
    console.log(`\n[Per-Seed Expansion CLI Done] Total Generated: ${res.allGenerated.length}, Frozen Total: ${res.frozenCandidates.length}`);
    res.seedStats.forEach(st => {
      console.log(`  - ${st.sourceSeedName}: attempts=${st.attempts}, generated=${st.generatedCount}, retained=${st.retainedCount}, shortfall=${st.shortfall}`);
    });
  }).catch(e => {
    console.error('Per-seed expansion failed:', e);
    process.exit(1);
  });
}
