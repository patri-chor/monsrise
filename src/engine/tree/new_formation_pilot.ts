// ============================================================
// T007 — New Formation Generation Pilot Runner (Corrected)
//
// 目的：有界、可复现的新阵型生成与两阶段评估试点流水线。
// 复用 generate_variants.ts 组装逻辑，流派对应正确参考阵型，
// 严格去重与结构校验，执行粗筛与精筛两阶段独立 seedBase 评估，
// 所有结果产物隔离输出至 reports/new-formation-pilot/。
// ============================================================

import '../env';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { registerAllBadges } from '../../game/BadgeSystem';
import { FORMATION_LIBRARY } from '../../ai/formation_library';
import { formationToEvol, type EvolFormation } from './evol_gene';
import { mapRefTreeToDeck } from './deck_separation';
import { evaluateBatchParallel, type ParallelArenaResult } from './arena_parallel';
import { CORE_TABLE, type ArchKey, type CoreKey } from './deck_ontology';
import { COMBO_MODULES } from './flow_library';
import { computeTreeFingerprint } from './search_experience';
import {
  outputCandidates,
  assemble,
} from './generate_variants';

registerAllBadges();

const OUTPUT_DIR = resolve('reports/new-formation-pilot');

export const ARCH_LIST: ArchKey[] = ['prayer', 'halfrush', 'fullrush'];

/**
 * 架构对应参考阵型字典映射 (T007 明确要求)
 * prayer -> 祷徒肃清
 * halfrush -> 全二永平
 * fullrush -> 全二冲
 */
export const ARCH_REF_FORMATION_NAME: Record<ArchKey, string> = {
  prayer: '泉水剑',
  halfrush: '全二永平',
  fullrush: '全二冲',
};

/**
 * 根据架构获取对应的参考决策树。若阵型缺失，抛出明确异常，绝不静默回退。
 */
export function getRefFormationForArch(arch: ArchKey): { name: string; evol: EvolFormation } {
  const targetName = ARCH_REF_FORMATION_NAME[arch];
  if (!targetName) {
    throw new Error(`[Pilot Reference Error] Unknown archetype '${arch}', cannot resolve reference formation.`);
  }
  const found = FORMATION_LIBRARY.find(f => f.name === targetName);
  if (!found) {
    throw new Error(`[Pilot Reference Error] Required reference formation '${targetName}' for archetype '${arch}' not found in FORMATION_LIBRARY.`);
  }
  return { name: targetName, evol: formationToEvol(found) };
}

function canonicalTeamKey(team: { monsterId: number; badgeIds: number[] }[]): string {
  const sorted = [...team]
    .filter(s => s.monsterId > 0)
    .sort((a, b) => a.monsterId - b.monsterId);
  return sorted.map(s => `${s.monsterId}:[${[...s.badgeIds].sort((x, y) => x - y).join(',')}]`).join('|');
}

export interface CandidateRecord {
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
  coarseEvaluation?: ParallelArenaResult & { seedBase: number; games: number; workers: number };
  refinedEvaluation?: ParallelArenaResult & { seedBase: number; games: number; workers: number };
}

export interface PilotOptions {
  dryRun?: boolean;
  targetCount?: number;
  maxAttempts?: number;
  seed?: number;
  workers?: number;
  coarseGames?: number;
  refinedGames?: number;
  coarseSeedBase?: number;
  refinedSeedBase?: number;
  coarseThreshold?: number;
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

export async function runNewFormationPilot(options: PilotOptions = {}): Promise<{
  candidates: CandidateRecord[];
  acceptedCount: number;
  rejectedCount: number;
  attemptCount: number;
  pathsCovered: string[];
  terminatedReason: string;
}> {
  const dryRun = options.dryRun ?? false;
  const targetCount = options.targetCount ?? 12;
  const maxAttempts = options.maxAttempts ?? Math.max(100, targetCount * 15);
  const baseSeed = options.seed ?? 2026;
  const workers = Math.min(4, Math.max(1, options.workers ?? 2)); // T007 constraint: at most 4 workers
  const coarseGames = options.coarseGames ?? 2;
  const refinedGames = options.refinedGames ?? 6;
  const coarseSeedBase = options.coarseSeedBase ?? 1000;
  const refinedSeedBase = options.refinedSeedBase ?? 9000;
  const coarseThreshold = options.coarseThreshold ?? 0.35;

  if (coarseSeedBase === refinedSeedBase) {
    throw new Error(`[Pilot Configuration Error] coarseSeedBase (${coarseSeedBase}) and refinedSeedBase (${refinedSeedBase}) must be distinct.`);
  }

  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const candidates: CandidateRecord[] = [];
  const seenCanonicalKeys = new Set<string>();
  const seenTreeFps = new Set<string>();

  let attempts = 0;
  let rejectedCount = 0;
  const pathsSet = new Set<string>();

  console.log(`=== 开始执行新阵型生成试点流水线 (Target: ${targetCount}, MaxAttempts: ${maxAttempts}, DryRun: ${dryRun}, Workers: ${workers}, CoarseSeed: ${coarseSeedBase}, RefinedSeed: ${refinedSeedBase}) ===`);

  while (candidates.length < targetCount && attempts < maxAttempts) {
    attempts++;
    const currentSeed = baseSeed + attempts;
    const currentRng = mulberry32(currentSeed);

    // 1. 均匀轮询 3 大架构路径
    const arch = ARCH_LIST[attempts % ARCH_LIST.length];
    const coreKeys = Object.keys(CORE_TABLE) as CoreKey[];
    const coreKey = coreKeys[Math.floor(currentRng() * coreKeys.length)];

    // 2. 选择组合模块路径
    const comboMod = COMBO_MODULES[Math.floor(currentRng() * COMBO_MODULES.length)];
    const comboIds = comboMod.combos[Math.floor(currentRng() * comboMod.combos.length)] ?? [];

    // 3. 选择输出对
    const outs = outputCandidates(arch);
    const out1 = outs[Math.floor(currentRng() * outs.length)];
    const remainingOuts = outs.filter(id => id !== out1);
    const out2 = remainingOuts.length > 0 ? remainingOuts[Math.floor(currentRng() * remainingOuts.length)] : out1;
    const outputPair = [out1, out2];

    const pathKey = `${arch}::${coreKey}::${comboMod.id}`;

    // 4. 复用已提取的组装器 (generate_variants.ts: assemble)
    const assembled = assemble(arch, coreKey, outputPair, comboIds);
    if (!assembled.valid) {
      rejectedCount++;
      continue;
    }

    const fullTeam = assembled.team;

    // 5. 去重检查
    const canonKey = canonicalTeamKey(fullTeam);
    if (seenCanonicalKeys.has(canonKey)) {
      rejectedCount++;
      continue;
    }

    // 6. 按架构获取专属参考决策树
    const ref = getRefFormationForArch(arch);
    const tree = mapRefTreeToDeck(ref.evol, fullTeam);
    const treeFp = computeTreeFingerprint(tree);

    if (seenTreeFps.has(treeFp)) {
      rejectedCount++;
      continue;
    }

    seenCanonicalKeys.add(canonKey);
    seenTreeFps.add(treeFp);
    pathsSet.add(pathKey);

    const candidateId = `cand_${arch}_${candidates.length + 1}_${treeFp.slice(0, 6)}`;
    const record: CandidateRecord = {
      candidateId,
      generationSeed: currentSeed,
      archPath: arch,
      modulePath: comboMod.id,
      coreKey: String(coreKey),
      referenceFormation: ref.name,
      team: fullTeam,
      treeFingerprint: treeFp,
      canonicalKey: canonKey,
      tree: tree.root,
      validation: {
        valid: true,
        cost: assembled.cost,
        size: fullTeam.length,
        hasTactic: true,
      },
    };

    candidates.push(record);
    console.log(`  [生成成功 ${candidates.length}/${targetCount}] ID: ${candidateId} | 路径: ${pathKey} | 参考: ${ref.name} | 费用: ${assembled.cost} | 指纹: ${treeFp}`);
  }

  let terminatedReason = 'TARGET_REACHED';
  if (candidates.length < targetCount) {
    terminatedReason = 'ATTEMPT_CAP_EXHAUSTED';
    console.warn(`[有界终止] 已达最大尝试上限 ${maxAttempts}，生成 ${candidates.length} 个候选（空间已耗尽或去重冲突）。`);
  }

  // 7. 两阶段评估（仅在非 dry-run 下运行）
  if (!dryRun && candidates.length > 0) {
    console.log(`\n=== 阶段一：粗筛评估 (Coarse Pass: ${coarseGames} 局, SeedBase: ${coarseSeedBase}) ===`);
    const evalTargets = candidates.map(c => ({
      name: c.candidateId,
      f: { name: c.candidateId, archetype: c.archPath, team: c.team, root: c.tree } as EvolFormation,
    }));

    const coarseResults = await evaluateBatchParallel(evalTargets, coarseGames, {
      workerCount: workers,
      seedBase: coarseSeedBase,
    });

    for (let i = 0; i < candidates.length; i++) {
      const res = coarseResults[i];
      if (res) {
        candidates[i].coarseEvaluation = {
          ...res,
          seedBase: coarseSeedBase,
          games: coarseGames,
          workers,
        };
      }
    }

    // 筛选通过粗筛的候选进行阶段二精筛
    const refinedCandidates = candidates.filter(c => (c.coarseEvaluation?.adScore ?? 0) >= coarseThreshold);
    console.log(`\n=== 阶段二：精筛复评 (Refined Pass: ${refinedCandidates.length} 个候选通过阈值 ${coarseThreshold}, ${refinedGames} 局, SeedBase: ${refinedSeedBase}) ===`);

    if (refinedCandidates.length > 0) {
      const refinedTargets = refinedCandidates.map(c => ({
        name: c.candidateId,
        f: { name: c.candidateId, archetype: c.archPath, team: c.team, root: c.tree } as EvolFormation,
      }));
      const refinedResults = await evaluateBatchParallel(refinedTargets, refinedGames, {
        workerCount: workers,
        seedBase: refinedSeedBase,
      });

      for (let i = 0; i < refinedCandidates.length; i++) {
        const res = refinedResults[i];
        if (res) {
          refinedCandidates[i].refinedEvaluation = {
            ...res,
            seedBase: refinedSeedBase,
            games: refinedGames,
            workers,
          };
        }
      }
    }
  }

  // 8. 写入报告产物至 reports/new-formation-pilot/
  const jsonlPath = join(OUTPUT_DIR, 'candidates.jsonl');
  const jsonlContent = candidates.map(c => JSON.stringify(c)).join('\n');
  writeFileSync(jsonlPath, jsonlContent, 'utf8');

  const summaryPath = join(OUTPUT_DIR, 'summary.md');
  const summaryMd = `# New Formation Generation Pilot Summary (T007)

- **Generated Candidates**: ${candidates.length}
- **Accepted**: ${candidates.length}
- **Rejected Attempts**: ${rejectedCount}
- **Total Attempts**: ${attempts} / ${maxAttempts}
- **Terminated Reason**: \`${terminatedReason}\`
- **Distinct Paths Covered**: ${pathsSet.size} (${[...pathsSet].slice(0, 6).join(', ')})
- **Execution Mode**: \`${dryRun ? 'DRY_RUN' : 'EVALUATED'}\`
- **Resource Limit**: \`${workers} workers max\`
- **Coarse Seed Base**: \`${coarseSeedBase}\` (${coarseGames} games)
- **Refined Seed Base**: \`${refinedSeedBase}\` (${refinedGames} games)

## Reference Formation Mapping
${ARCH_LIST.map(arch => `- **${arch}** -> \`${ARCH_REF_FORMATION_NAME[arch]}\``).join('\n')}

## Archetype Distribution
${ARCH_LIST.map(arch => `- **${arch}**: ${candidates.filter(c => c.archPath === arch).length}`).join('\n')}

## Top Candidates Sample
| Candidate ID | Arch | Module | Reference | Cost | Size | Tree FP | Coarse AD | Refined AD |
|---|---|---|---|---|---|---|---|---|
${candidates.slice(0, 10).map(c => `| \`${c.candidateId}\` | ${c.archPath} | ${c.modulePath} | \`${c.referenceFormation}\` | ${c.validation.cost} | ${c.validation.size} | \`${c.treeFingerprint.slice(0, 8)}\` | ${c.coarseEvaluation ? (c.coarseEvaluation.adScore * 100).toFixed(1) + '%' : 'N/A'} | ${c.refinedEvaluation ? (c.refinedEvaluation.adScore * 100).toFixed(1) + '%' : 'N/A'} |`).join('\n')}

_Generated at ${new Date().toISOString()}_
`;
  writeFileSync(summaryPath, summaryMd, 'utf8');

  const diagPath = join(OUTPUT_DIR, 'diagnostics.json');
  writeFileSync(diagPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    options,
    attempts,
    rejectedCount,
    acceptedCount: candidates.length,
    pathsCovered: [...pathsSet],
    terminatedReason,
    coarseSeedBase,
    refinedSeedBase,
    referenceMapping: ARCH_REF_FORMATION_NAME,
  }, null, 2), 'utf8');

  console.log(`\n试点结果已保存至：\n  - ${jsonlPath}\n  - ${summaryPath}\n  - ${diagPath}`);

  return {
    candidates,
    acceptedCount: candidates.length,
    rejectedCount,
    attemptCount: attempts,
    pathsCovered: [...pathsSet],
    terminatedReason,
  };
}

// CLI 执行入口
if (process.argv[1] && process.argv[1].endsWith('new_formation_pilot.ts')) {
  const isDryRun = process.argv.includes('--dry-run');
  const countIdx = process.argv.indexOf('--count');
  const targetCount = countIdx !== -1 ? parseInt(process.argv[countIdx + 1], 10) : 6;
  const workersIdx = process.argv.indexOf('--workers');
  const workers = workersIdx !== -1 ? parseInt(process.argv[workersIdx + 1], 10) : 2;

  runNewFormationPilot({
    dryRun: isDryRun,
    targetCount,
    workers,
  }).catch(e => {
    console.error('Pilot failed:', e);
    process.exit(1);
  });
}
