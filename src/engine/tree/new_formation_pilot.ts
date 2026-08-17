// ============================================================
// T006 — New Formation Generation Pilot Runner
//
// 目的：有界、可复现的新阵型生成与两阶段评估试点流水线。
// 生成多流派候选阵型，严格去重与结构校验，执行粗筛与精筛两阶段评估，
// 所有结果产物隔离输出至 reports/new-formation-pilot/。
//
// 运行：
//   npx vite-node --script src/engine/tree/new_formation_pilot.ts [--dry-run] [--count 12] [--workers 4] [--seed 2026]
// ============================================================

import '../env';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { registerAllBadges } from '../../game/BadgeSystem';
import { FORMATION_LIBRARY } from '../../ai/formation_library';
import { formationToEvol, type EvolFormation } from './evol_gene';
import { mapRefTreeToDeck } from './deck_separation';
import { evaluateBatchParallel, type ParallelArenaResult } from './arena_parallel';
import {
  CORE_TABLE, BADGE_TEMPLATES, badgeLimit, costOf, type ArchKey,
} from './deck_ontology';
import { hasEffect, hasTactic, TACTIC_IDS } from './monster_taxonomy';
import { COMBO_MODULES } from './flow_library';
import { computeTreeFingerprint } from './search_experience';

registerAllBadges();

const OUTPUT_DIR = resolve('reports/new-formation-pilot');

const ARCH_SKELETON: Record<string, number[]> = {
  prayer: [103, 105],
  halfrush: [105, 110],
  fullrush: [110],
};
const ARCH_LIST: ArchKey[] = ['prayer', 'halfrush', 'fullrush'];

const ELEMENT_IDS = [101, 104, 124];
function hasElementHand(ids: number[]): boolean {
  return ids.some(id => ELEMENT_IDS.includes(id));
}

function badgesFor(id: number, hasElement: boolean): number[] {
  const tpls = BADGE_TEMPLATES[id];
  if (!tpls || tpls.length === 0) return [];
  if (hasElement) {
    const wither = tpls.find(t => t.includes(2));
    if (wither) return [...wither].slice(0, badgeLimit(id));
  }
  const generic = tpls.find(t => !t.includes(2));
  return [...(generic ?? tpls[0])].slice(0, badgeLimit(id));
}

function outputCandidates(arch: string): number[] {
  const all2 = [104, 106, 107, 109, 110, 111, 112, 113, 114, 116, 117, 119, 121, 122, 123, 124, 125];
  const skeleton = ARCH_SKELETON[arch] ?? [];
  return all2.filter(id =>
    (hasEffect(id, '输出') || hasEffect(id, '爆发')) &&
    !TACTIC_IDS.includes(id) &&
    !skeleton.includes(id),
  );
}

function survivalCandidates(arch: string): number[] {
  const all2 = [104, 106, 107, 109, 110, 111, 112, 113, 114, 116, 117, 119, 121, 122, 123, 124, 125];
  const skeleton = ARCH_SKELETON[arch] ?? [];
  return all2.filter(id =>
    hasEffect(id, '生存') &&
    !TACTIC_IDS.includes(id) &&
    !skeleton.includes(id),
  );
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
  const workers = Math.min(4, Math.max(1, options.workers ?? 2)); // T006 constraint: at most 4 workers
  const coarseGames = options.coarseGames ?? 2;
  const refinedGames = options.refinedGames ?? 6;
  const coarseSeedBase = options.coarseSeedBase ?? 1000;
  const refinedSeedBase = options.refinedSeedBase ?? 9000;
  const coarseThreshold = options.coarseThreshold ?? 0.35;

  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const candidates: CandidateRecord[] = [];
  const seenCanonicalKeys = new Set<string>();
  const seenTreeFps = new Set<string>();

  let attempts = 0;
  let rejectedCount = 0;
  const pathsSet = new Set<string>();

  // 找到参考阵型作为映射基准
  const refFormations: Record<string, EvolFormation> = {};
  for (const f of FORMATION_LIBRARY) {
    if (['全二永平', '全二冲', '祷徒肃清', '梯子塞雷', '肃清', '经典救星'].includes(f.name)) {
      refFormations[f.name] = formationToEvol(f);
    }
  }
  const defaultRef = formationToEvol(FORMATION_LIBRARY[0]);

  console.log(`=== 开始执行新阵型生成试点流水线 (Target: ${targetCount}, MaxAttempts: ${maxAttempts}, DryRun: ${dryRun}, Workers: ${workers}) ===`);

  while (candidates.length < targetCount && attempts < maxAttempts) {
    attempts++;
    const currentSeed = baseSeed + attempts;
    const currentRng = mulberry32(currentSeed);

    // 1. 均匀轮询 3 大架构路径
    const arch = ARCH_LIST[attempts % ARCH_LIST.length];
    const coreKeys = Object.keys(CORE_TABLE) as (keyof typeof CORE_TABLE)[];
    const coreKey = coreKeys[Math.floor(currentRng() * coreKeys.length)];
    const coreId = CORE_TABLE[coreKey]?.monsterId ?? null;

    // 2. 选择组合模块路径
    const comboMod = COMBO_MODULES[Math.floor(currentRng() * COMBO_MODULES.length)];
    const comboIds = comboMod.combos[Math.floor(currentRng() * comboMod.combos.length)] ?? [];

    const pathKey = `${arch}::${coreKey}::${comboMod.id}`;

    // 3. 构建卡组怪兽集合
    const deckSet = new Set<number>();
    for (const id of ARCH_SKELETON[arch] ?? []) deckSet.add(id);
    if (coreId !== null) deckSet.add(coreId);
    for (const id of comboIds) deckSet.add(id);

    // 补充战术怪
    if (!hasTactic([...deckSet])) {
      const tac = TACTIC_IDS[Math.floor(currentRng() * TACTIC_IDS.length)];
      deckSet.add(tac);
    }

    // 补充输出位
    const outs = outputCandidates(arch).filter(id => !deckSet.has(id));
    if (outs.length > 0) {
      deckSet.add(outs[Math.floor(currentRng() * outs.length)]);
    }

    // 补充生存位直到槽位达到 7~8
    const surs = survivalCandidates(arch).filter(id => !deckSet.has(id));
    while (deckSet.size < 7 && surs.length > 0) {
      const s = surs.splice(Math.floor(currentRng() * surs.length), 1)[0];
      if (s) deckSet.add(s);
    }

    const deckIds = [...deckSet];
    const hasElem = hasElementHand(deckIds);
    const totalCost = deckIds.reduce((sum, id) => sum + costOf(id), 0);
    const hasTac = hasTactic(deckIds);

    // 结构验证
    const valid = totalCost <= 18 && deckIds.length <= 8 && hasTac && deckIds.length >= 6;
    if (!valid) {
      rejectedCount++;
      continue;
    }

    // 组装带徽章的卡组
    const fullTeam = deckIds.map(id => ({
      monsterId: id,
      badgeIds: badgesFor(id, hasElem),
    }));

    // 去重检查
    const canonKey = canonicalTeamKey(fullTeam);
    if (seenCanonicalKeys.has(canonKey)) {
      rejectedCount++;
      continue;
    }

    // 映射决策树
    const refTree = refFormations['全二永平'] ?? defaultRef;
    const tree = mapRefTreeToDeck(refTree, fullTeam);
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
      team: fullTeam,
      treeFingerprint: treeFp,
      canonicalKey: canonKey,
      tree: tree.root,
      validation: {
        valid: true,
        cost: totalCost,
        size: fullTeam.length,
        hasTactic: hasTac,
      },
    };

    candidates.push(record);
    console.log(`  [生成成功 ${candidates.length}/${targetCount}] ID: ${candidateId} | 路径: ${pathKey} | 费用: ${totalCost} | 指纹: ${treeFp}`);
  }

  let terminatedReason = 'TARGET_REACHED';
  if (candidates.length < targetCount) {
    terminatedReason = 'ATTEMPT_CAP_EXHAUSTED';
    console.warn(`[有界终止] 已达最大尝试上限 ${maxAttempts}，生成 ${candidates.length} 个候选（空间已耗尽或去重冲突）。`);
  }

  // 4. 两阶段评估（仅在非 dry-run 下运行）
  if (!dryRun && candidates.length > 0) {
    console.log(`\n=== 阶段一：粗筛评估 (Coarse Pass: ${coarseGames} 局, SeedBase: ${coarseSeedBase}) ===`);
    const evalTargets = candidates.map(c => ({
      name: c.candidateId,
      f: { name: c.candidateId, archetype: c.archPath, team: c.team, root: c.tree } as EvolFormation,
    }));

    const coarseResults = await evaluateBatchParallel(evalTargets, coarseGames, workers);
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
      const refinedResults = await evaluateBatchParallel(refinedTargets, refinedGames, workers);
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

  // 5. 写入报告产物至 reports/new-formation-pilot/
  const jsonlPath = join(OUTPUT_DIR, 'candidates.jsonl');
  const jsonlContent = candidates.map(c => JSON.stringify(c)).join('\n');
  writeFileSync(jsonlPath, jsonlContent, 'utf8');

  const summaryPath = join(OUTPUT_DIR, 'summary.md');
  const summaryMd = `# New Formation Generation Pilot Summary

- **Generated Candidates**: ${candidates.length}
- **Accepted**: ${candidates.length}
- **Rejected Attempts**: ${rejectedCount}
- **Total Attempts**: ${attempts} / ${maxAttempts}
- **Terminated Reason**: \`${terminatedReason}\`
- **Distinct Paths Covered**: ${pathsSet.size} (${[...pathsSet].slice(0, 6).join(', ')})
- **Execution Mode**: \`${dryRun ? 'DRY_RUN' : 'EVALUATED'}\`
- **Resource Limit**: \`${workers} workers max\`

## Archetype Distribution
${ARCH_LIST.map(arch => `- **${arch}**: ${candidates.filter(c => c.archPath === arch).length}`).join('\n')}

## Top Candidates Sample
| Candidate ID | Arch | Module | Cost | Size | Tree FP | Coarse AD | Refined AD |
|---|---|---|---|---|---|---|---|
${candidates.slice(0, 10).map(c => `| \`${c.candidateId}\` | ${c.archPath} | ${c.modulePath} | ${c.validation.cost} | ${c.validation.size} | \`${c.treeFingerprint.slice(0, 8)}\` | ${c.coarseEvaluation ? (c.coarseEvaluation.adScore * 100).toFixed(1) + '%' : 'N/A'} | ${c.refinedEvaluation ? (c.refinedEvaluation.adScore * 100).toFixed(1) + '%' : 'N/A'} |`).join('\n')}

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
  const targetCount = countIdx !== -1 ? parseInt(process.argv[countIdx + 1], 10) : 12;
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
