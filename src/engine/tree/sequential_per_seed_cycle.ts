import '../env';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import os from 'node:os';
import { FORMATION_LIBRARY } from '../../ai/formation_library';
import type { Formation } from '../../ai/types';
import type { EvolFormation } from './evol_gene';
import { formationToEvol } from './evol_gene';
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
import { mapRefTreeToDeck } from './deck_separation';
import { COMBO_MODULES } from './flow_library';
import { resolveSeedsAndPanel } from './first_four_generation';
import { resolveEffectiveWorkers, type ExpandedCandidateRecord, type SeedExpansionStats } from './per_seed_expansion';

export const SEQUENTIAL_CYCLE_OUTPUT_DIR = resolve('reports/new-formation-generation/sequential-per-seed-cycle');

export interface SequentialCycleOptions {
  outputDir?: string;
  baseSeed?: number;
  attemptsPerSeed?: number;
  workers?: number;
  coarseGames?: number;
  coarseSeedBase?: number;
  explorationFloor?: number;
  maxRetainedPerSeed?: number;
  onEvent?: (event: { type: string; seedIndex: number; seedName: string; detail?: any }) => void;
}

export interface SeedTransactionResult {
  seedIndex: number;
  seedId: string;
  seedName: string;
  archetype: string;
  status: 'COMPLETED' | 'FAILED';
  startedAt: string;
  completedAt: string;
  stats: SeedExpansionStats;
  generatedCandidates: ExpandedCandidateRecord[];
  retainedCandidates: RetainedCandidateRecord[];
  rejectedCandidates: RejectedCandidateRecord[];
  frozenCandidates: any[];
  seedDirectory: string;
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
 * 格式化 Seed 子目录名，如 seed-00-prayer_1
 */
export function formatSeedDirName(index: number, seed: Formation): string {
  const padIdx = String(index).padStart(2, '0');
  const safeId = (seed.id || seed.name).replace(/[^a-zA-Z0-9_\u4e00-\u9fa5-]/g, '_');
  return `seed-${padIdx}-${safeId}`;
}

/**
 * 单种子独立事务执行
 */
export async function executeSingleSeedTransaction(
  sourceSeed: Formation,
  sourceSeedIndex: number,
  evaluationPanel: Formation[],
  options: {
    outputDir: string;
    baseSeed: number;
    attemptsPerSeed: number;
    workers: number;
    coarseGames: number;
    coarseSeedBase: number;
    explorationFloor: number;
    maxRetainedPerSeed: number;
    globalCanonicalMap: Map<string, number>;
    globalTreeFps: Map<string, number>;
    onEvent?: (event: { type: string; seedIndex: number; seedName: string; detail?: any }) => void;
  },
): Promise<SeedTransactionResult> {
  const startedAt = new Date().toISOString();
  const seedDirName = formatSeedDirName(sourceSeedIndex, sourceSeed);
  const seedDir = join(options.outputDir, seedDirName);
  if (!existsSync(seedDir)) {
    mkdirSync(seedDir, { recursive: true });
  }

  options.onEvent?.({ type: 'SEED_GENERATE_START', seedIndex: sourceSeedIndex, seedName: sourceSeed.name });

  // 1. 变异生成
  const genSeed = options.baseSeed + sourceSeedIndex * 1000;
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

  for (let attempt = 0; attempt < options.attemptsPerSeed; attempt++) {
    stats.attempts++;

    const comboMod = COMBO_MODULES[Math.floor(rng() * COMBO_MODULES.length)];
    const modMonsterIds = [...comboMod.required, ...comboMod.optional];
    const coreKey = sourceSeed.archetype === 'fullrush' ? 'digger' : (sourceSeed.archetype === 'prayer' ? 'savior' : 'all2');

    const teamSlots: { monsterId: number; badgeIds: number[] }[] = [];
    const usedIds = new Set<number>();

    for (const mId of modMonsterIds) {
      if (!usedIds.has(mId)) {
        usedIds.add(mId);
        teamSlots.push({ monsterId: mId, badgeIds: badgeTemplateFor(mId) });
      }
    }

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

    let evolWithTree: EvolFormation;
    try {
      evolWithTree = mapRefTreeToDeck(srcEvol, teamSlots);
    } catch {
      stats.structuralRejections++;
      continue;
    }

    const canonKey = teamSlots.map(s => s.monsterId).sort((a, b) => a - b).join(',');
    const treeFp = JSON.stringify(evolWithTree.root);

    if (options.globalCanonicalMap.has(canonKey) || options.globalTreeFps.has(treeFp)) {
      stats.duplicateRejections++;
      continue;
    }

    options.globalCanonicalMap.set(canonKey, sourceSeedIndex);
    options.globalTreeFps.set(treeFp, sourceSeedIndex);

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

  options.onEvent?.({ type: 'SEED_GENERATE_END', seedIndex: sourceSeedIndex, seedName: sourceSeed.name, detail: { generated: candidates.length } });

  // 2. 粗筛评估（仅评估本 Seed 候选）
  options.onEvent?.({ type: 'SEED_EVALUATE_START', seedIndex: sourceSeedIndex, seedName: sourceSeed.name, detail: { candidates: candidates.length } });

  if (candidates.length > 0) {
    const evalTargets = candidates.map(c => ({
      name: c.candidateId,
      f: { name: c.candidateId, archetype: c.archPath, team: c.team, root: c.tree } as EvolFormation,
    }));

    const seedEvalBase = options.coarseSeedBase + sourceSeedIndex * 10000;
    const coarseResults = await evaluateBatchParallel(evalTargets, options.coarseGames, {
      workerCount: options.workers,
      seedBase: seedEvalBase,
    });

    for (let i = 0; i < candidates.length; i++) {
      const res = coarseResults[i];
      if (res) {
        candidates[i].coarseEvaluation = {
          ...res,
          seedBase: seedEvalBase,
          games: options.coarseGames,
          workers: options.workers,
        };
      }
    }
  }

  options.onEvent?.({ type: 'SEED_EVALUATE_END', seedIndex: sourceSeedIndex, seedName: sourceSeed.name });

  // 3. 多样性保留与冻结
  options.onEvent?.({ type: 'SEED_RETAIN_START', seedIndex: sourceSeedIndex, seedName: sourceSeed.name });

  const analysisRecords: CandidateAnalysisRecord[] = candidates.map(c => {
    const mutationVector = calculateMutationVector(c as any, srcEvol, 18);
    const effectiveScore = c.coarseEvaluation?.adScore ?? 0;
    return {
      ...(c as any),
      mutationVector,
      effectiveScore,
      scoreSource: 'coarse',
    };
  });

  const retRes = selectRetainedCandidates(analysisRecords, options.maxRetainedPerSeed, options.explorationFloor);

  stats.retainedCount = retRes.retained.length;
  stats.rejectedCount = retRes.rejected.length;
  stats.shortfall = Math.max(0, options.maxRetainedPerSeed - retRes.retained.length);
  stats.retainedCandidateIds = retRes.retained.map(r => r.candidateId);

  const frozenCandidates = retRes.retained.map(r => ({
    candidateId: r.candidateId,
    sourceSeedIndex,
    sourceSeedName: sourceSeed.name,
    sourceSeedId: sourceSeed.id,
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
  }));

  const completedAt = new Date().toISOString();

  // 4. 持久化本 Seed 事务产物
  const seedManifest = {
    seedIndex: sourceSeedIndex,
    seedId: sourceSeed.id,
    seedName: sourceSeed.name,
    archetype: sourceSeed.archetype,
    status: 'COMPLETED',
    startedAt,
    completedAt,
    evaluationPanel: evaluationPanel.map(p => p.name),
    stats,
    effectiveSettings: {
      attempts: options.attemptsPerSeed,
      maxRetained: options.maxRetainedPerSeed,
      explorationFloor: options.explorationFloor,
      workers: options.workers,
      coarseGames: options.coarseGames,
      coarseSeedBase: options.coarseSeedBase + sourceSeedIndex * 10000,
    },
  };

  writeFileSync(join(seedDir, 'manifest.json'), JSON.stringify(seedManifest, null, 2), 'utf8');
  writeFileSync(join(seedDir, 'generated_candidates.jsonl'), candidates.map(c => JSON.stringify(c)).join('\n') + (candidates.length ? '\n' : ''), 'utf8');
  writeFileSync(join(seedDir, 'retention.json'), JSON.stringify(retRes, null, 2), 'utf8');
  writeFileSync(join(seedDir, 'frozen_candidates.jsonl'), frozenCandidates.map(c => JSON.stringify(c)).join('\n') + (frozenCandidates.length ? '\n' : ''), 'utf8');

  let seedSummaryMd = `# Seed ${sourceSeedIndex} Summary: ${sourceSeed.name} (${sourceSeed.archetype})\n\n`;
  seedSummaryMd += `- **Status**: \`COMPLETED\`\n`;
  seedSummaryMd += `- **Time**: ${startedAt} -> ${completedAt}\n`;
  seedSummaryMd += `- **Attempts**: ${stats.attempts} | Generated: ${stats.generatedCount} | Accepted: ${stats.acceptedCount}\n`;
  seedSummaryMd += `- **Rejections**: Dup=${stats.duplicateRejections}, Struct=${stats.structuralRejections}\n`;
  seedSummaryMd += `- **Retained**: **${stats.retainedCount}** / ${options.maxRetainedPerSeed} (Shortfall: ${stats.shortfall})\n\n`;
  seedSummaryMd += `### Retained Candidates\n`;
  seedSummaryMd += `| Candidate ID | Module | Score | Novelty | Bucket | Reasons |\n`;
  seedSummaryMd += `|---|---|---|---|---|---|\n`;
  for (const r of retRes.retained) {
    seedSummaryMd += `| \`${r.candidateId}\` | ${r.modulePath} | ${(r.effectiveScore * 100).toFixed(1)}% | ${(r.mutationVector.noveltyScore * 100).toFixed(1)}% | \`${r.mutationVector.direction.mutationBucket}\` | \`${r.retentionReasons.join(', ')}\` |\n`;
  }
  writeFileSync(join(seedDir, 'summary.md'), seedSummaryMd, 'utf8');

  options.onEvent?.({
    type: 'SEED_TRANSACTION_COMPLETED',
    seedIndex: sourceSeedIndex,
    seedName: sourceSeed.name,
    detail: { retained: stats.retainedCount, frozen: frozenCandidates.length },
  });

  return {
    seedIndex: sourceSeedIndex,
    seedId: sourceSeed.id,
    seedName: sourceSeed.name,
    archetype: sourceSeed.archetype,
    status: 'COMPLETED',
    startedAt,
    completedAt,
    stats,
    generatedCandidates: candidates,
    retainedCandidates: retRes.retained,
    rejectedCandidates: retRes.rejected,
    frozenCandidates,
    seedDirectory: seedDir,
  };
}

/**
 * 完整顺序执行 4 个源种子流水线
 */
export async function runSequentialPerSeedCycle(options: SequentialCycleOptions = {}): Promise<{
  runManifest: any;
  transactions: SeedTransactionResult[];
  rootFrozenCandidates: any[];
  outputDir: string;
}> {
  const outputDir = options.outputDir ? resolve(options.outputDir) : SEQUENTIAL_CYCLE_OUTPUT_DIR;
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

  const { sourceSeeds, evaluationPanel } = resolveSeedsAndPanel();

  const cycleStartedAt = new Date().toISOString();
  const transactions: SeedTransactionResult[] = [];
  const globalCanonicalMap = new Map<string, number>();
  const globalTreeFps = new Map<string, number>();

  // 严格顺序执行：Seed 0 -> Seed 1 -> Seed 2 -> Seed 3
  for (let i = 0; i < sourceSeeds.length; i++) {
    const s = sourceSeeds[i];
    console.log(`\n============================================================`);
    console.log(`[Sequential Transaction] Starting Seed ${i}: ${s.name} (${s.archetype})`);
    console.log(`============================================================`);

    const txRes = await executeSingleSeedTransaction(s, i, evaluationPanel, {
      outputDir,
      baseSeed,
      attemptsPerSeed,
      workers,
      coarseGames,
      coarseSeedBase,
      explorationFloor,
      maxRetainedPerSeed,
      globalCanonicalMap,
      globalTreeFps,
      onEvent: options.onEvent,
    });

    if (txRes.status !== 'COMPLETED') {
      throw new Error(`Transaction for seed ${s.name} (index ${i}) failed. Aborting sequential cycle.`);
    }

    transactions.push(txRes);
  }

  const cycleCompletedAt = new Date().toISOString();

  // 汇总根目录 frozen_candidates.jsonl
  const rootFrozenCandidates: any[] = [];
  for (const tx of transactions) {
    rootFrozenCandidates.push(...tx.frozenCandidates);
  }

  writeFileSync(
    join(outputDir, 'frozen_candidates.jsonl'),
    rootFrozenCandidates.map(c => JSON.stringify(c)).join('\n') + (rootFrozenCandidates.length ? '\n' : ''),
    'utf8',
  );

  const runManifest = {
    cycleType: 'sequential_per_seed_cycle',
    startedAt: cycleStartedAt,
    completedAt: cycleCompletedAt,
    sourceSeeds: sourceSeeds.map(s => s.name),
    evaluationPanel: evaluationPanel.map(p => p.name),
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
    transactions: transactions.map(tx => ({
      seedIndex: tx.seedIndex,
      seedName: tx.seedName,
      status: tx.status,
      startedAt: tx.startedAt,
      completedAt: tx.completedAt,
      attempts: tx.stats.attempts,
      generated: tx.stats.generatedCount,
      retained: tx.stats.retainedCount,
      shortfall: tx.stats.shortfall,
      seedDirectory: tx.seedDirectory,
    })),
    totalFrozenCandidates: rootFrozenCandidates.length,
  };

  writeFileSync(join(outputDir, 'run_manifest.json'), JSON.stringify(runManifest, null, 2), 'utf8');

  let summaryMd = `# Sequential Per-Seed Variant Cycle Summary (T017)\n\n`;
  summaryMd += `## 1. Execution Overview\n`;
  summaryMd += `- **Cycle Range**: ${cycleStartedAt} -> ${cycleCompletedAt}\n`;
  summaryMd += `- **Execution Model**: Strict Sequential Per-Seed Transactions (1 Seed at a time)\n`;
  summaryMd += `- **Workers**: ${workerInfo.requestedWorkers} requested, ${workerInfo.effectiveWorkers} effective (${workerInfo.availableLogicalCpus} CPUs)\n`;
  summaryMd += `- **Total Frozen Candidates**: **${rootFrozenCandidates.length}** / ${sourceSeeds.length * maxRetainedPerSeed}\n\n`;
  summaryMd += `## 2. Sequential Seed Breakdown\n`;
  summaryMd += `| Order | Seed Name | Archetype | Attempts | Generated | Dup Rejections | Retained | Shortfall | Duration |\n`;
  summaryMd += `|---|---|---|---|---|---|---|---|---|\n`;
  for (const tx of transactions) {
    const durSec = ((new Date(tx.completedAt).getTime() - new Date(tx.startedAt).getTime()) / 1000).toFixed(1);
    summaryMd += `| ${tx.seedIndex} | \`${tx.seedName}\` | ${tx.archetype} | ${tx.stats.attempts} | ${tx.stats.generatedCount} | ${tx.stats.duplicateRejections} | **${tx.stats.retainedCount}** | ${tx.stats.shortfall} | ${durSec}s |\n`;
  }
  summaryMd += `\n_Authoritative frozen pool exported to \`${join(outputDir, 'frozen_candidates.jsonl')}\`_\n`;

  writeFileSync(join(outputDir, 'summary.md'), summaryMd, 'utf8');

  return {
    runManifest,
    transactions,
    rootFrozenCandidates,
    outputDir,
  };
}

// CLI 执行入口
const isTesting = process.env.IS_TEST || process.env.VITEST;
const isDirectScript = process.argv.some(a => a.includes('sequential_per_seed_cycle'));
if (isDirectScript && !isTesting) {
  runSequentialPerSeedCycle().then(res => {
    console.log(`\n[Sequential Cycle CLI Done] Total Frozen: ${res.rootFrozenCandidates.length}`);
    res.transactions.forEach(tx => {
      console.log(`  - Seed ${tx.seedIndex} (${tx.seedName}): status=${tx.status}, retained=${tx.stats.retainedCount}, shortfall=${tx.stats.shortfall}`);
    });
  }).catch(e => {
    console.error('Sequential cycle failed:', e);
    process.exit(1);
  });
}
