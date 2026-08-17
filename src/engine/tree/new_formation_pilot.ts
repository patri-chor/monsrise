// ============================================================
// T008 — New Formation Generation Gated Pilot Runner
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
import {
  checkGenerationResourceGate,
  type GateVerdict,
  type GateCheckOptions,
} from './generation_gate';

export { checkGenerationResourceGate, type GateVerdict };

registerAllBadges();

const OUTPUT_DIR = resolve('reports/new-formation-pilot');

export const ARCH_LIST: ArchKey[] = ['prayer', 'halfrush', 'fullrush'];

/**
 * 架构对应参考阵型字典映射 (T007 明确要求)
 * prayer -> 泉水剑
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
  outputDir?: string;
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
  gateCheck?: GateCheckOptions | GateVerdict;
}

export class GenerationGateBlockedError extends Error {
  verdict: GateVerdict;
  constructor(verdict: GateVerdict) {
    super(`[Generation Gate Blocked] ${verdict.reason}`);
    this.name = 'GenerationGateBlockedError';
    this.verdict = verdict;
  }
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
  gateVerdict: GateVerdict;
  blocked?: boolean;
  effectiveOptions?: Record<string, any>;
}> {
  const startTime = Date.now();
  const outputDir = options.outputDir ? resolve(options.outputDir) : OUTPUT_DIR;
  const dryRun = options.dryRun ?? false;
  const targetCount = options.targetCount ?? 12;
  const maxAttempts = options.maxAttempts ?? Math.max(100, targetCount * 15);
  const baseSeed = options.seed ?? 2026;
  const workers = Math.min(4, Math.max(1, options.workers ?? 2)); // T008 constraint: 1..4 workers
  const coarseGames = options.coarseGames ?? 2;
  const refinedGames = options.refinedGames ?? 6;
  const coarseSeedBase = options.coarseSeedBase ?? 1000;
  const refinedSeedBase = options.refinedSeedBase ?? 9000;
  const coarseThreshold = options.coarseThreshold ?? 0.35;

  if (coarseSeedBase === refinedSeedBase) {
    throw new Error(`[Pilot Configuration Error] coarseSeedBase (${coarseSeedBase}) and refinedSeedBase (${refinedSeedBase}) must be distinct.`);
  }

  // 1. 资源门禁检查
  let gateVerdict: GateVerdict;
  if (options.gateCheck && 'allowed' in options.gateCheck) {
    gateVerdict = options.gateCheck;
  } else {
    gateVerdict = checkGenerationResourceGate(options.gateCheck as GateCheckOptions | undefined);
  }

  const effectiveOptions = {
    outputDir,
    dryRun,
    targetCount,
    maxAttempts,
    seed: baseSeed,
    workers,
    coarseGames,
    refinedGames,
    coarseSeedBase,
    refinedSeedBase,
    coarseThreshold,
  };

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // 2. 若非 dry-run 且门禁被阻断，严禁执行后续生成及评估，直接产出诊断并阻断
  if (!dryRun && !gateVerdict.allowed) {
    console.warn(`[Generation Gate Refusal] 门禁阻断：${gateVerdict.reason}`);

    const diagPath = join(outputDir, 'diagnostics.json');
    writeFileSync(diagPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      status: 'GATE_BLOCKED',
      gateVerdict,
      effectiveOptions,
      blocked: true,
    }, null, 2), 'utf8');

    const summaryPath = join(outputDir, 'summary.md');
    writeFileSync(summaryPath, `# New Formation Generation Pilot Summary (T008) - BLOCKED

> [!WARNING]
> **Resource Gate Blocked**: Non-dry-run evaluation was refused before worker initialization.
> - **Reason**: ${gateVerdict.reason}
> - **Source**: \`${gateVerdict.source}\`
> - **Status**: \`${gateVerdict.status}\`

## Effective Options
\`\`\`json
${JSON.stringify(effectiveOptions, null, 2)}
\`\`\`
`, 'utf8');

    return {
      candidates: [],
      acceptedCount: 0,
      rejectedCount: 0,
      attemptCount: 0,
      pathsCovered: [],
      terminatedReason: 'GATE_BLOCKED',
      gateVerdict,
      blocked: true,
      effectiveOptions,
    };
  }

  const candidates: CandidateRecord[] = [];
  const seenCanonicalKeys = new Set<string>();
  const seenTreeFps = new Set<string>();

  let attempts = 0;
  let rejectedCount = 0;
  const pathsSet = new Set<string>();

  console.log(`=== 开始执行新阵型生成试点流水线 (Target: ${targetCount}, MaxAttempts: ${maxAttempts}, DryRun: ${dryRun}, Workers: ${workers}, Gate: ${gateVerdict.status}) ===`);

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

  let coarseEvaluatedCount = 0;
  let refinementEligibleCount = 0;
  let refinedEvaluatedCount = 0;
  let evaluationFailures: string[] = [];

  // 7. 两阶段评估（仅在非 dry-run 且门禁 OPEN 下运行）
  if (!dryRun && candidates.length > 0) {
    try {
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
          coarseEvaluatedCount++;
        }
      }

      // 筛选通过粗筛的候选进行阶段二精筛
      const refinedCandidates = candidates.filter(c => (c.coarseEvaluation?.adScore ?? 0) >= coarseThreshold);
      refinementEligibleCount = refinedCandidates.length;

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
            refinedEvaluatedCount++;
          }
        }
      }
    } catch (err: any) {
      console.error('[Evaluation Error]', err);
      evaluationFailures.push(err?.message ?? String(err));
    }
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);

  // 8. 写入报告产物至 outputDir
  const jsonlPath = join(outputDir, 'candidates.jsonl');
  const jsonlContent = candidates.map(c => JSON.stringify(c)).join('\n');
  writeFileSync(jsonlPath, jsonlContent, 'utf8');

  const summaryPath = join(outputDir, 'summary.md');
  const summaryMd = `# New Formation Generation Pilot Summary (T008)

## 1. Resource Gate & Execution Status
- **Gate Status**: \`${gateVerdict.status}\` (${gateVerdict.allowed ? 'Permitted' : 'Blocked'})
- **Gate Source**: \`${gateVerdict.source}\`
- **Gate Reason**: ${gateVerdict.reason}
- **Execution Mode**: \`${dryRun ? 'DRY_RUN' : 'EVALUATED'}\`
- **Terminated Reason**: \`${terminatedReason}\`
- **Run Duration**: \`${durationSec}s\`

## 2. Effective Options & Seeds
- **Base Seed**: \`${baseSeed}\`
- **Target Count**: \`${targetCount}\`
- **Worker Count**: \`${workers}\` (limit: 1..4)
- **Coarse Games**: \`${coarseGames}\` (SeedBase: \`${coarseSeedBase}\`)
- **Refined Games**: \`${refinedGames}\` (SeedBase: \`${refinedSeedBase}\`)
- **Refinement Threshold**: \`${coarseThreshold}\`

## 3. Evaluation Quality Funnel
- **Generated Candidates**: ${candidates.length}
- **Coarse-Evaluated Candidates**: ${coarseEvaluatedCount}
- **Refinement-Eligible Candidates (>= ${coarseThreshold})**: ${refinementEligibleCount}
- **Refined-Evaluated Candidates**: ${refinedEvaluatedCount}
- **Evaluation / Worker Failures**: ${evaluationFailures.length === 0 ? 'None' : evaluationFailures.join('; ')}

## 4. Pipeline & Reference Details
- **Distinct Paths Covered**: ${pathsSet.size} (${[...pathsSet].slice(0, 6).join(', ')})
- **Attempts**: ${attempts} / ${maxAttempts} (Rejected: ${rejectedCount})

### Reference Formation Mapping
${ARCH_LIST.map(arch => `- **${arch}** -> \`${ARCH_REF_FORMATION_NAME[arch]}\``).join('\n')}

### Archetype Distribution
${ARCH_LIST.map(arch => `- **${arch}**: ${candidates.filter(c => c.archPath === arch).length}`).join('\n')}

## 5. Candidate Evaluation Table
| Candidate ID | Arch | Module | Reference | Cost | Size | Tree FP | Coarse AD | Refined AD |
|---|---|---|---|---|---|---|---|---|
${candidates.map(c => `| \`${c.candidateId}\` | ${c.archPath} | ${c.modulePath} | \`${c.referenceFormation}\` | ${c.validation.cost} | ${c.validation.size} | \`${c.treeFingerprint.slice(0, 8)}\` | ${c.coarseEvaluation ? (c.coarseEvaluation.adScore * 100).toFixed(1) + '%' : 'N/A'} | ${c.refinedEvaluation ? (c.refinedEvaluation.adScore * 100).toFixed(1) + '%' : 'N/A'} |`).join('\n')}

_Generated at ${new Date().toISOString()}_
`;
  writeFileSync(summaryPath, summaryMd, 'utf8');

  const diagPath = join(outputDir, 'diagnostics.json');
  writeFileSync(diagPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    gateVerdict,
    effectiveOptions,
    metrics: {
      generatedCandidates: candidates.length,
      coarseEvaluatedCount,
      refinementEligibleCount,
      refinedEvaluatedCount,
      evaluationFailures,
      attempts,
      rejectedCount,
      pathsCovered: [...pathsSet],
      terminatedReason,
      durationSec,
    },
  }, null, 2), 'utf8');

  console.log(`\n试点结果已保存至：\n  - ${jsonlPath}\n  - ${summaryPath}\n  - ${diagPath}`);

  return {
    candidates,
    acceptedCount: candidates.length,
    rejectedCount,
    attemptCount: attempts,
    pathsCovered: [...pathsSet],
    terminatedReason,
    gateVerdict,
    effectiveOptions,
  };
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
const isCliEntry = !process.env.IS_TEST && !process.env.VITEST;

if (isCliEntry) {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');

  const seedArg = parseCliArg(args, '--seed');
  const countArg = parseCliArg(args, '--count') || parseCliArg(args, '--target-count');
  const workersArg = parseCliArg(args, '--workers');
  const coarseGamesArg = parseCliArg(args, '--coarse-games');
  const refinedGamesArg = parseCliArg(args, '--refined-games');
  const coarseSeedBaseArg = parseCliArg(args, '--coarse-seed-base');
  const refinedSeedBaseArg = parseCliArg(args, '--refined-seed-base');
  const thresholdArg = parseCliArg(args, '--threshold') || parseCliArg(args, '--coarse-threshold');

  const parsedOptions: PilotOptions = {
    dryRun: isDryRun,
    seed: seedArg ? parseInt(seedArg, 10) : undefined,
    targetCount: countArg ? parseInt(countArg, 10) : undefined,
    workers: workersArg ? parseInt(workersArg, 10) : undefined,
    coarseGames: coarseGamesArg ? parseInt(coarseGamesArg, 10) : undefined,
    refinedGames: refinedGamesArg ? parseInt(refinedGamesArg, 10) : undefined,
    coarseSeedBase: coarseSeedBaseArg ? parseInt(coarseSeedBaseArg, 10) : undefined,
    refinedSeedBase: refinedSeedBaseArg ? parseInt(refinedSeedBaseArg, 10) : undefined,
    coarseThreshold: thresholdArg ? parseFloat(thresholdArg) : undefined,
  };

  runNewFormationPilot(parsedOptions).then(result => {
    if (result.blocked) {
      console.log(`\n[CLI Exit] Execution refused due to active resource gate: ${result.gateVerdict.reason}`);
      process.exit(2);
    }
  }).catch(e => {
    console.error('Pilot failed:', e);
    process.exit(1);
  });
}
