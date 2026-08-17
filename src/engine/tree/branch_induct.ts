// ============================================================
// 自主分支 —— 决策树归纳与跨种子/卡组/开局联合优化 (T011)
//
// 核心能力：
//   1. 目标池驱动的分裂与诊断 (Low-Score Target Cell Pool)
//   2. 受约束的卡组外怪兽搜索 (Constrained External Deck Search)
//   3. 早期开局优化算子 (Early Opening Optimization: R1/R2 弱点专项调优)
//   4. 细分终端状态流转 (Terminal Outcomes)
// ============================================================

import '../env';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FORMATION_LIBRARY } from '../../ai/formation_library';
import type { Formation } from '../../ai/types';
import type { EvolFormation, FeatureMask, EvolNode } from './evol_gene';
import {
  formationToEvol,
  recognizeArchetype,
  maskToLabel,
  summarizeEvolFormation,
  matchMask,
  isEmptyMask,
  walkEvolNodes,
} from './evol_gene';
import {
  addBranch,
  replaceMonster,
  moveWithinZoneAtNode,
  isPositionIrrelevant,
  roleOf,
  getLastValidationError,
} from './tree_ops';
import { playSpecVsSpec, type SideSpec, type BranchDecision, type RoundObservation } from './arena';
import { ExperienceBank, replaceKey, moveKey, computeTreeFingerprint } from './search_experience';
import { calculateMatchMetrics, formatMatchMetrics, type MatchMetrics } from './match_metrics';
import { PersistentSimPool } from './persistent_pool';
import {
  costOf,
  ARCH_RULES,
  validateDeck,
  badgeTemplateFor,
  type ArchKey,
} from './deck_ontology';

export type BranchInductionOutcome =
  | 'IMPROVED'
  | 'NO_INFORMATIVE_SPLIT'
  | 'NO_OBSERVED_TRIGGER_AT_FORK'
  | 'BRANCH_SEARCH_NO_TRAINING_GAIN'
  | 'VALIDATION_TRAINING_REJECTED'
  | 'ERROR';

const MONSTER_NAME: Record<number, string> = {
  101: '肃清哥', 102: '大祭司', 103: '学徒', 104: '散弹', 105: '祈祷', 106: '冲锋', 107: '咒法',
  108: '救星', 109: '银狙', 110: '帝国', 111: '见习', 112: '守卫', 113: '矿爆', 114: '突突',
  115: '铲土', 116: '钻头', 117: '铁甲', 118: '塞雷', 119: '忍猴', 120: '金猴', 121: '僧猴',
  122: '丛林猴', 123: '棒球', 124: '三振', 125: '战壕', 126: '祭司',
};
const nm = (id: number) => MONSTER_NAME[id] ?? String(id);

export function loadBundle(): any {
  const w = globalThis as any;
  const code = readFileSync(resolve('public/ai-bundle.iife.js'), 'utf8');
  const factory = new Function('window', 'globalThis', '"use strict";\n' + code + '\n;return BattleAI;');
  const b = factory(w, w);
  return b?.BattleAI ?? w.BattleAI;
}

function entropy(p: number): number {
  if (p <= 0 || p >= 1) return 0;
  return -p * Math.log2(p) - (1 - p) * Math.log2(1 - p);
}

function infoGain(samples: { win: boolean; has: boolean; weight?: number }[]): number {
  const n = samples.length;
  if (n === 0) return 0;
  let totalWeight = 0;
  let winWeight = 0;
  for (const s of samples) {
    const w = s.weight ?? 1;
    totalWeight += w;
    if (s.win) winWeight += w;
  }
  if (totalWeight <= 0) return 0;

  const hAll = entropy(winWeight / totalWeight);

  const withFeature = samples.filter(s => s.has);
  const withoutFeature = samples.filter(s => !s.has);
  if (withFeature.length === 0 || withoutFeature.length === 0) return 0;

  const wWith = withFeature.reduce((sum, s) => sum + (s.weight ?? 1), 0);
  const winWith = withFeature.filter(s => s.win).reduce((sum, s) => sum + (s.weight ?? 1), 0);

  const wWithout = withoutFeature.reduce((sum, s) => sum + (s.weight ?? 1), 0);
  const winWithout = withoutFeature.filter(s => s.win).reduce((sum, s) => sum + (s.weight ?? 1), 0);

  const hWith = entropy(winWith / wWith);
  const hWithout = entropy(winWithout / wWithout);
  const hSplit = (wWith / totalWeight) * hWith + (wWithout / totalWeight) * hWithout;
  return hAll - hSplit;
}

export interface MatchTrace {
  seed: number;
  side: 1 | 2;
  oppId: string;
  roundScores: number[];
  observations: Map<number, RoundObservation>;
  decisions: Map<number, BranchDecision>;
  w: number;
  d: number;
  l: number;
}

export class MatchSimulationCache {
  private cache = new Map<string, MatchTrace>();
  public simCount = 0;

  getOrSimulate(
    BundleAI: any,
    candidate: EvolFormation,
    target: Formation,
    aSide: 1 | 2,
    seed: number,
  ): MatchTrace {
    const treeFp = computeTreeFingerprint(candidate);
    const oppKey = target.id ?? target.name;
    const key = `${treeFp}::${oppKey}::${aSide}::${seed}`;
    const hit = this.cache.get(key);
    if (hit) return hit;

    this.simCount++;
    const specA: SideSpec = { kind: 'evol', f: candidate };
    const specB: SideSpec = { kind: 'native', f: target };
    const decisions = new Map<number, BranchDecision>();

    const r = playSpecVsSpec(BundleAI, specA, specB, aSide, seed, (d) => {
      decisions.set(d.round, d);
    });

    const observations = new Map<number, RoundObservation>();
    for (const obs of r.observations ?? []) {
      observations.set(obs.round, obs);
    }

    const trace: MatchTrace = {
      seed,
      side: aSide,
      oppId: oppKey,
      roundScores: r.roundScores,
      observations,
      decisions,
      w: r.w,
      d: r.d,
      l: r.l,
    };
    this.cache.set(key, trace);
    return trace;
  }

  put(
    candidate: EvolFormation,
    target: Formation,
    aSide: 1 | 2,
    seed: number,
    trace: MatchTrace,
  ): void {
    const treeFp = computeTreeFingerprint(candidate);
    const oppKey = target.id ?? target.name;
    const key = `${treeFp}::${oppKey}::${aSide}::${seed}`;
    this.cache.set(key, trace);
  }
}

export interface Sample {
  win: boolean;
  side: 1 | 2;
  main: string | null;
  subs: string[];
  keys: string[];
  oppId: string;
  weight?: number;
}

export function sampleFromTrace(trace: MatchTrace, round: number, oppId: string, weight: number = 1): Sample | null {
  if (trace.w === 0 && trace.l === 0) return null;
  const win = trace.w > 0;
  const obs = trace.observations.get(round);
  if (!obs) return null;

  const rec = recognizeArchetype({
    handIds: new Set(obs.handIds),
    handBadges: new Set(obs.handBadges),
    boardIds: new Set(obs.boardIds),
  });

  return {
    win,
    side: trace.side,
    main: rec.main,
    subs: rec.subs,
    keys: rec.keys,
    oppId,
    weight,
  };
}

function bestSplit(samples: Sample[]): { kind: string; value: string; mask: FeatureMask; ig: number } | null {
  interface CandidateSplit {
    kind: string;
    value: string;
    has: (s: Sample) => boolean;
    mask: FeatureMask;
  }
  const candidates: CandidateSplit[] = [];

  candidates.push({ kind: 'side', value: '1(先手)', has: s => s.side === 1, mask: { side: 1, main: null, subs: [], keys: [] } });
  candidates.push({ kind: 'side', value: '2(后手)', has: s => s.side === 2, mask: { side: 2, main: null, subs: [], keys: [] } });

  const mains = [...new Set(samples.map(s => s.main).filter(Boolean))] as string[];
  for (const m of mains) {
    candidates.push({ kind: 'main', value: m, has: s => s.main === m, mask: { side: null, main: m as any, subs: [], keys: [] } });
  }

  const subs = [...new Set(samples.flatMap(s => s.subs))];
  for (const sb of subs) {
    candidates.push({ kind: 'sub', value: sb, has: s => s.subs.includes(sb), mask: { side: null, main: null, subs: [sb as any], keys: [] } });
  }

  const keys = [...new Set(samples.flatMap(s => s.keys))];
  for (const k of keys) {
    candidates.push({ kind: 'key', value: k, has: s => s.keys.includes(k), mask: { side: null, main: null, subs: [], keys: [k as any] } });
  }

  for (const m of mains.slice(0, 3)) {
    for (const sb of subs.slice(0, 3)) {
      candidates.push({
        kind: 'main+sub', value: `${m}+${sb}`,
        has: s => s.main === m && s.subs.includes(sb),
        mask: { side: null, main: m as any, subs: [sb as any], keys: [] },
      });
    }
    for (const k of keys.slice(0, 7)) {
      candidates.push({
        kind: 'main+key', value: `${m}+${k}`,
        has: s => s.main === m && s.keys.includes(k),
        mask: { side: null, main: m as any, subs: [], keys: [k as any] },
      });
    }
  }

  let best: { kind: string; value: string; mask: FeatureMask; ig: number } | null = null;
  for (const c of candidates) {
    const ig = infoGain(samples.map(s => ({ win: s.win, has: c.has(s), weight: s.weight })));
    if (best === null || ig > best.ig) {
      best = { kind: c.kind, value: c.value, mask: c.mask, ig };
    }
  }
  return best && best.ig > 0 ? best : null;
}

export function isTraceMatchedAtFork(trace: MatchTrace, mask: FeatureMask, forkRound: number): boolean {
  if (mask.side !== null) {
    return trace.side === mask.side && trace.observations.has(forkRound);
  }
  const obs = trace.observations.get(forkRound);
  if (!obs) return false;
  const rec = recognizeArchetype({
    handIds: new Set(obs.handIds),
    handBadges: new Set(obs.handBadges),
    boardIds: new Set(obs.boardIds),
  });
  return matchMask(mask, rec, trace.side);
}

export function oppMatchesAtFork(opp: Formation, mask: FeatureMask, forkRound: number, allTraces: MatchTrace[]): boolean {
  const oppKey = opp.id ?? opp.name;
  const oppTraces = allTraces.filter(t => t.oppId === oppKey);
  for (const trace of oppTraces) {
    if (isTraceMatchedAtFork(trace, mask, forkRound)) {
      return true;
    }
  }
  return false;
}

function maskEqual(a: FeatureMask, b: FeatureMask): boolean {
  return a.side === b.side && a.main === b.main
    && a.subs.length === b.subs.length && a.subs.every(s => b.subs.includes(s))
    && a.keys.length === b.keys.length && a.keys.every(k => b.keys.includes(k));
}

function preUsedMonsters(f: EvolFormation, forkRound: number): Set<number> {
  const used = new Set<number>();
  let cur: EvolNode | null = f.root;
  while (cur && cur.round < forkRound) {
    for (const p of cur.placements) used.add(p.monsterId);
    cur = cur.children.find(c => isEmptyMask(c.condition)) ?? cur.children[0] ?? null;
  }
  return used;
}

function branchUsedMonsters(branchNodes: EvolNode[], exceptNodeId: string, exceptMonsterId: number): Set<number> {
  const used = new Set<number>();
  for (const n of branchNodes) {
    for (const p of n.placements) {
      if (n.id === exceptNodeId && p.monsterId === exceptMonsterId) continue;
      used.add(p.monsterId);
    }
  }
  return used;
}

function evalMatchOnMatched(
  BundleAI: any,
  f: EvolFormation,
  mask: FeatureMask,
  matchedOpps: Formation[],
  games: number,
  cache: MatchSimulationCache,
  seedBase: number,
): MatchMetrics {
  let win = 0, draw = 0, loss = 0;
  const sides: (1 | 2)[] = mask.side !== null ? [mask.side] : [1, 2];
  for (const opp of matchedOpps) {
    for (const side of sides) {
      for (let i = 0; i < games; i++) {
        const trace = cache.getOrSimulate(BundleAI, f, opp, side, seedBase + i);
        win += trace.w;
        draw += trace.d;
        loss += trace.l;
      }
    }
  }
  return calculateMatchMetrics(win, draw, loss);
}

export interface TargetCellInfo {
  opponentIndex: number;
  opponentName: string;
  side: 1 | 2;
  initialTrainingScore: number;
  addressed: boolean;
  addressable: boolean;
  rejectionReason?: string;
}

export interface SearchOperatorStats {
  inDeckCandidates: number;
  externalCandidates: number;
  rejectedByConstraintCandidates: number;
  openingCandidates: number;
  acceptedExternalReplacements: number;
}

async function optimizeBranchParallel(
  BundleAI: any,
  branched: EvolFormation,
  mask: FeatureMask,
  forkRound: number,
  matchedOpps: Formation[],
  games: number,
  exp: ExperienceBank,
  formationId: string,
  cache: MatchSimulationCache,
  searchSeedBase: number,
  pool?: PersistentSimPool,
  isEarlyOpeningWeak: boolean = false,
  enableExternalDeckSearch: boolean = true,
  enableOpeningOperators: boolean = true,
): Promise<{
  optimized: EvolFormation;
  hasTrainingGain: boolean;
  stats: SearchOperatorStats;
}> {
  const teamIds = branched.team.filter(s => s.monsterId > 0).map(s => s.monsterId);
  const preUsed = preUsedMonsters(branched, forkRound);
  let current = branched;
  let curEval = evalMatchOnMatched(BundleAI, current, mask, matchedOpps, games, cache, searchSeedBase);
  const initTrainingScore = curEval.trainingScore;
  let skippedByExp = 0, newlyInvalid = 0;
  let hasGain = false;

  const stats: SearchOperatorStats = {
    inDeckCandidates: 0,
    externalCandidates: 0,
    rejectedByConstraintCandidates: 0,
    openingCandidates: 0,
    acceptedExternalReplacements: 0,
  };

  const activePool = pool ?? PersistentSimPool.getInstance();

  // 获取卡组外部合法候选池
  const arch: ArchKey = (branched.archetype as ArchKey) || 'prayer';
  const rawExtPool: number[] = [];
  if (enableExternalDeckSearch) {
    const archRule = (ARCH_RULES as any)[arch];
    if (archRule?.poolPref) {
      for (const list of Object.values(archRule.poolPref) as number[][]) {
        for (const id of list) {
          if (!rawExtPool.includes(id)) rawExtPool.push(id);
        }
      }
    } else {
      rawExtPool.push(101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126);
    }
  }
  const currentTeamSet = new Set(branched.team.map(s => s.monsterId));

  for (let iter = 0; iter < 10; iter++) {
    const currentFp = computeTreeFingerprint(current);
    const roots = walkEvolNodes(current.root).filter(n => !isEmptyMask(n.condition) && maskEqual(n.condition, mask));
    const branchNodes: EvolNode[] = [];
    for (const r of roots) branchNodes.push(...walkEvolNodes(r));

    if (branchNodes.length === 0) {
      console.log('  未找到分支节点，停止优化。');
      break;
    }

    const candidateQueue: { child: EvolFormation; desc: string; key: string; isExternal?: boolean; isOpening?: boolean }[] = [];

    for (const node of branchNodes) {
      // P1: In-deck 内部单替换
      for (const slot of node.placements) {
        const subtreeUsed = branchUsedMonsters(branchNodes, node.id, slot.monsterId);
        for (const toMid of teamIds) {
          if (toMid === slot.monsterId) continue;
          if (preUsed.has(toMid)) continue;
          if (subtreeUsed.has(toMid)) continue;

          stats.inDeckCandidates++;
          const key = replaceKey(formationId, node.id, slot.monsterId, toMid, currentFp);
          if (exp.isKnownInvalid(key)) { skippedByExp++; continue; }
          const child = replaceMonster(current, node.id, slot.monsterId, toMid);
          if (!child) {
            const reason = getLastValidationError() ?? '结构非法';
            exp.markInvalid(key, reason);
            newlyInvalid++;
            stats.rejectedByConstraintCandidates++;
            continue;
          }
          candidateQueue.push({
            child,
            desc: `[内卡替换] R${node.round} 节点${node.id}：${nm(slot.monsterId)} → ${nm(toMid)}`,
            key,
          });
        }
      }

      // P2: External 外部合法怪兽替换 (Cap <= 8)
      if (enableExternalDeckSearch) {
        for (const slot of node.placements) {
          let externalCountForSlot = 0;
          const currentSlotCost = costOf(slot.monsterId);
          const currentTeamCost = current.team.reduce((sum, s) => sum + costOf(s.monsterId), 0);

          for (const extMid of rawExtPool) {
            if (externalCountForSlot >= 8) break;
            if (currentTeamSet.has(extMid)) continue; // 排除队伍已有怪兽

            const extCost = costOf(extMid);
            if (currentTeamCost - currentSlotCost + extCost > 18) {
              stats.rejectedByConstraintCandidates++;
              continue; // 费用超标拦截
            }

            // 构造临时 team 校验合法性
            const newTeam = current.team.map(s => s.monsterId === slot.monsterId ? { monsterId: extMid, badgeIds: badgeTemplateFor(extMid) } : s);
            const valErrors = validateDeck(newTeam);
            if (valErrors.length > 0) {
              stats.rejectedByConstraintCandidates++;
              continue;
            }

            stats.externalCandidates++;
            externalCountForSlot++;

            const key = replaceKey(formationId, node.id, slot.monsterId, extMid, currentFp);
            if (exp.isKnownInvalid(key)) { skippedByExp++; continue; }

            const child = replaceMonster({ ...current, team: newTeam }, node.id, slot.monsterId, extMid);
            if (!child) {
              const reason = getLastValidationError() ?? '外部替换结构非法';
              exp.markInvalid(key, reason);
              newlyInvalid++;
              stats.rejectedByConstraintCandidates++;
              continue;
            }

            candidateQueue.push({
              child,
              desc: `[外卡替换] R${node.round} 节点${node.id}：${nm(slot.monsterId)} → ${nm(extMid)} (费${extCost})`,
              key,
              isExternal: true,
            });
          }
        }
      }

      // P3: 位置微调
      for (const slot of node.placements) {
        if (isPositionIrrelevant(slot.monsterId)) continue;
        const role = roleOf(slot.monsterId);
        const isBackline = role === '法师' || role === '射手';
        const cols = isBackline ? [8, 9, 10] : [6, 7, 8];
        for (const x of cols) {
          for (let y = 0; y < 5; y++) {
            const key = moveKey(formationId, node.id, slot.monsterId, x, y, currentFp);
            if (exp.isKnownInvalid(key)) { skippedByExp++; continue; }
            const child = moveWithinZoneAtNode(current, node.id, slot.monsterId, x, y);
            if (!child) {
              const reason = getLastValidationError() ?? '结构非法';
              exp.markInvalid(key, reason);
              newlyInvalid++;
              continue;
            }
            candidateQueue.push({
              child,
              desc: `[站位] ${nm(slot.monsterId)} → (${x},${y})`,
              key,
            });
          }
        }
      }

      // P4: 早期开局专项优化 (Early Opening Operators: 仅当 R1/R2 早期崩盘时激活)
      if (enableOpeningOperators && isEarlyOpeningWeak && (node.round === 1 || node.round === 2)) {
        for (const slot of node.placements) {
          stats.openingCandidates++;
          // 尝试紧凑/拉扯开局站位
          const altCols = node.round === 1 ? [7, 8, 9] : [6, 8, 10];
          for (const x of altCols) {
            for (const y of [1, 2, 3]) {
              const key = `open_move::${node.id}::${slot.monsterId}::${x},${y}::${currentFp}`;
              if (exp.isKnownInvalid(key)) continue;
              const child = moveWithinZoneAtNode(current, node.id, slot.monsterId, x, y);
              if (child) {
                candidateQueue.push({
                  child,
                  desc: `[开局站位优化 R${node.round}] ${nm(slot.monsterId)} → (${x},${y})`,
                  key,
                  isOpening: true,
                });
              }
            }
          }
        }
      }
    }

    if (candidateQueue.length === 0) {
      console.log(`  第${iter + 1}轮：无新的有效变异候选，停止。`);
      break;
    }

    const evalResults = await activePool.evalCandidateBatchOnMatchedParallel(
      candidateQueue.map(c => c.child),
      mask,
      matchedOpps,
      games,
      searchSeedBase,
    );

    let bestChild: EvolFormation | null = null;
    let bestScore = curEval.trainingScore;
    let bestDesc = '';
    let bestEval = curEval;
    let bestIsExternal = false;

    for (let i = 0; i < candidateQueue.length; i++) {
      const cand = candidateQueue[i];
      const metric = evalResults[i];
      if (metric.trainingScore > bestScore) {
        bestScore = metric.trainingScore;
        bestChild = cand.child;
        bestDesc = cand.desc;
        bestEval = metric;
        bestIsExternal = Boolean(cand.isExternal);
      }
    }

    console.log(`  第${iter + 1}轮：并发评估 ${candidateQueue.length} 个候选，最优训练分 ${(bestScore * 100).toFixed(1)}%`);
    if (bestChild && bestScore > curEval.trainingScore) {
      current = bestChild;
      curEval = bestEval;
      hasGain = true;
      if (bestIsExternal) stats.acceptedExternalReplacements++;
      console.log(`    [采纳] ${bestDesc} → ${formatMatchMetrics(curEval)}`);
    } else {
      console.log(`    [无改进] 最优候选训练分 ${(bestScore * 100).toFixed(1)}% ≤ 当前 ${(curEval.trainingScore * 100).toFixed(1)}%，停止。`);
      break;
    }
  }

  return { optimized: current, hasTrainingGain: hasGain || curEval.trainingScore > initTrainingScore, stats };
}

export interface OptimizeFormationResult {
  outcome: BranchInductionOutcome;
  optimized: EvolFormation;
  improved: boolean;
  forkRound: number;
  mask: FeatureMask;
  maskLabel: string;
  before: MatchMetrics;
  after: MatchMetrics;
  targetPoolDiagnostics?: {
    targetPoolCount: number;
    cells: TargetCellInfo[];
  };
  searchOperatorStats?: SearchOperatorStats;
  searchValidation?: {
    searchSeedBase: number;
    validationSeedBase: number;
    gamesPerOpp: number;
    searchBefore: MatchMetrics;
    searchAfter: MatchMetrics;
    matchedOpponents: string[];
    simCount: number;
    forkRound: number;
    triggerCoverage: { matched: number; totalObserved: number; coverageRate: number };
    untriggeredReasons: { prematureEnd: number; noHand: number; maskMismatch: number };
  };
}

export interface OptimizeFormationOptions {
  opponents?: Formation[];
  searchSeedBase?: number;
  validationSeedBase?: number;
  pool?: PersistentSimPool;
  targetPoolCap?: number;
  targetScoreBand?: number;
  enableLowScorePool?: boolean;
  enableExternalDeckSearch?: boolean;
  enableOpeningOperators?: boolean;
}

export async function optimizeFormation(
  BundleAI: any,
  src: Formation,
  gamesPerOpp: number,
  options?: OptimizeFormationOptions,
): Promise<OptimizeFormationResult> {
  if (options?.opponents !== undefined && options.opponents.length === 0) {
    throw new Error('OptimizeFormationOptions.opponents cannot be empty');
  }
  const panelOpponents = options?.opponents ?? FORMATION_LIBRARY;
  const candidate = formationToEvol(src);
  const searchSeedBase = options?.searchSeedBase ?? 2000;
  const validationSeedBase = options?.validationSeedBase ?? 9000;
  const pool = options?.pool ?? PersistentSimPool.getInstance();
  const targetPoolCap = options?.targetPoolCap ?? 4;
  const targetScoreBand = options?.targetScoreBand ?? 0.20;
  const enableLowScorePool = options?.enableLowScorePool ?? true;
  const enableExternalDeckSearch = options?.enableExternalDeckSearch ?? true;
  const enableOpeningOperators = options?.enableOpeningOperators ?? true;

  const emptyMetrics = calculateMatchMetrics(0, 0, 0);

  const exp = new ExperienceBank();
  exp.load();
  const cache = new MatchSimulationCache();

  console.log(`=== 分支归纳优化：${src.name} vs ${panelOpponents.length} 阵型（LowScorePool=${enableLowScorePool}, ExtDeck=${enableExternalDeckSearch}, Opening=${enableOpeningOperators}）===`);

  // 1. 批量并发采集全对局轨迹
  const initialTraces = await pool.collectInitialTracesParallel(candidate, panelOpponents, gamesPerOpp, searchSeedBase);
  for (const tr of initialTraces) {
    const opp = panelOpponents.find(o => (o.id ?? o.name) === tr.oppId);
    if (opp) {
      cache.put(candidate, opp, tr.side, tr.seed, tr);
    }
  }

  // 2. 统计各 cell 得分并构建目标池 (单最弱格 vs 低分目标格池)
  interface CellStat {
    oppIdx: number;
    oppName: string;
    oppId: string;
    side: 1 | 2;
    w: number;
    d: number;
    l: number;
    score: number;
  }
  const cellStats: CellStat[] = [];
  for (let oIdx = 0; oIdx < panelOpponents.length; oIdx++) {
    const opp = panelOpponents[oIdx];
    const oppKey = opp.id ?? opp.name;
    for (const side of [1, 2] as (1 | 2)[]) {
      const traces = initialTraces.filter(t => t.oppId === oppKey && t.side === side);
      let w = 0, d = 0, l = 0;
      for (const t of traces) {
        w += t.w;
        d += t.d;
        l += t.l;
      }
      const m = calculateMatchMetrics(w, d, l);
      cellStats.push({
        oppIdx: oIdx,
        oppName: opp.name,
        oppId: oppKey,
        side,
        w,
        d,
        l,
        score: m.trainingScore,
      });
    }
  }

  cellStats.sort((a, b) => a.score - b.score);
  const minScore = cellStats[0]?.score ?? 0;
  const targetThreshold = Math.min(0.50, minScore + targetScoreBand);
  const targetCells = enableLowScorePool
    ? cellStats.filter(c => c.score <= targetThreshold).slice(0, targetPoolCap)
    : [cellStats[0]];

  console.log(`\n=== 目标格池（共 ${targetCells.length} 格，LowScorePool=${enableLowScorePool}）===`);
  for (const tc of targetCells) {
    console.log(`  - 目标格: ${tc.oppName} (Side ${tc.side}) 初始训练分 ${(tc.score * 100).toFixed(1)}% (${tc.w}胜/${tc.d}平/${tc.l}负)`);
  }

  const targetOppKeys = new Set(targetCells.map(c => c.oppId));

  // 3. 派生 R1-R5 样本
  let bestOverall: { round: number; split: { kind: string; value: string; mask: FeatureMask; ig: number }; winRate: number } | null = null;

  for (let round = 1; round <= 5; round++) {
    const allSamples: Sample[] = [];
    for (const trace of initialTraces) {
      const isTarget = targetOppKeys.has(trace.oppId);
      const weight = enableLowScorePool ? (isTarget ? 3 : 1) : 1;
      const s = sampleFromTrace(trace, round, trace.oppId, weight);
      if (s) allSamples.push(s);
    }
    if (allSamples.length === 0) continue;
    const winCount = allSamples.filter(s => s.win).length;
    const winRate = winCount / allSamples.length;
    const split = bestSplit(allSamples);
    console.log(`R${round}: 胜率 ${(winRate * 100).toFixed(0)}%（有效样本 ${allSamples.length}）${split ? ` 最优分裂 ${split.kind}=${split.value} IG=${split.ig.toFixed(3)}` : ''}`);
    if (split && (!bestOverall || split.ig > bestOverall.split.ig)) {
      bestOverall = { round, split, winRate };
    }
  }

  const createTargetDiagnostics = (outcome: BranchInductionOutcome, matchedOppsList: Formation[] = []): TargetCellInfo[] => {
    return targetCells.map(tc => {
      const isMatched = matchedOppsList.some(o => (o.id ?? o.name) === tc.oppId);
      return {
        opponentIndex: tc.oppIdx,
        opponentName: tc.oppName,
        side: tc.side,
        initialTrainingScore: tc.score,
        addressed: outcome === 'IMPROVED' && isMatched,
        addressable: isMatched,
        rejectionReason: !isMatched ? 'not_matched_at_fork' : (outcome === 'IMPROVED' ? undefined : outcome),
      };
    });
  };

  const emptySearchStats: SearchOperatorStats = {
    inDeckCandidates: 0,
    externalCandidates: 0,
    rejectedByConstraintCandidates: 0,
    openingCandidates: 0,
    acceptedExternalReplacements: 0,
  };

  if (!bestOverall) {
    console.log('\n无有效分裂（所有对局标签无区分度），无需建分支。');
    return {
      outcome: 'NO_INFORMATIVE_SPLIT',
      optimized: candidate,
      improved: false,
      forkRound: 1,
      mask: { side: null, main: null, subs: [], keys: [] },
      maskLabel: '无',
      before: emptyMetrics,
      after: emptyMetrics,
      targetPoolDiagnostics: {
        targetPoolCount: targetCells.length,
        cells: createTargetDiagnostics('NO_INFORMATIVE_SPLIT'),
      },
      searchOperatorStats: emptySearchStats,
    };
  }

  console.log(`\n=== 最优分裂：R${bestOverall.round} 按 ${bestOverall.split.kind}=${bestOverall.split.value} 建分支 ===`);
  console.log(`分支标签 [${maskToLabel(bestOverall.split.mask)}]，信息增益 ${bestOverall.split.ig.toFixed(3)}`);

  // 4. 定位崩盘起点 forkRound
  const diagSides: (1 | 2)[] = bestOverall.split.mask.side !== null ? [bestOverall.split.mask.side] : [1, 2];
  const roundRates: { round: number; win: number; total: number; rate: number }[] = [];
  for (let round = 1; round <= 5; round++) {
    let win = 0, total = 0;
    for (const trace of initialTraces) {
      if (!diagSides.includes(trace.side)) continue;
      const s = sampleFromTrace(trace, round, trace.oppId);
      if (s) {
        if (s.win) win++;
        total++;
      }
    }
    const rate = total ? win / total : 0;
    roundRates.push({ round, win, total, rate });
  }

  const CRASH_THRESHOLD = 0.75;
  const crash = roundRates.find(x => x.rate < CRASH_THRESHOLD && x.total > 0);
  const rawFork = crash ? crash.round : bestOverall.round;
  const forkRound = Math.max(1, rawFork - 1);
  const isEarlyOpeningWeak = (crash && crash.round <= 2) || bestOverall.round <= 2;

  // 5. 命中对手校验
  const effectiveOpps = panelOpponents.filter(o => oppMatchesAtFork(o, bestOverall!.split.mask, forkRound, initialTraces));
  if (effectiveOpps.length === 0) {
    console.log(`\n[分支拒绝] 在拟分叉回合 R${forkRound} 实际观察中未命中任何对手，放弃建分支。`);
    return {
      outcome: 'NO_OBSERVED_TRIGGER_AT_FORK',
      optimized: candidate,
      improved: false,
      forkRound,
      mask: bestOverall.split.mask,
      maskLabel: maskToLabel(bestOverall.split.mask),
      before: emptyMetrics,
      after: emptyMetrics,
      targetPoolDiagnostics: {
        targetPoolCount: targetCells.length,
        cells: createTargetDiagnostics('NO_OBSERVED_TRIGGER_AT_FORK', effectiveOpps),
      },
      searchOperatorStats: emptySearchStats,
    };
  }

  console.log(`\n=== 命中「${maskToLabel(bestOverall.split.mask)}」的对手（${effectiveOpps.map(o => o.name).join('、')}）===`);

  let matchedTracesCount = 0;
  let totalObservedTraces = 0;
  const untriggeredReasons = { prematureEnd: 0, noHand: 0, maskMismatch: 0 };

  for (const trace of initialTraces) {
    if (!effectiveOpps.some(o => (o.id ?? o.name) === trace.oppId)) continue;
    if (!diagSides.includes(trace.side)) continue;

    if (trace.roundScores[forkRound - 1] === undefined) {
      untriggeredReasons.prematureEnd++;
      continue;
    }
    const obs = trace.observations.get(forkRound);
    if (!obs) {
      untriggeredReasons.noHand++;
      continue;
    }
    totalObservedTraces++;
    if (isTraceMatchedAtFork(trace, bestOverall.split.mask, forkRound)) {
      matchedTracesCount++;
    } else {
      untriggeredReasons.maskMismatch++;
    }
  }

  // 6. 建分支
  const rng = mulberry32(777);
  console.log(`\n[建分支] 在 R${forkRound} 处按标签「${maskToLabel(bestOverall.split.mask)}」复制子树作模板`);
  const branched = addBranch(candidate, bestOverall.split.mask, rng, forkRound);
  if (!branched) {
    return {
      outcome: 'BRANCH_SEARCH_NO_TRAINING_GAIN',
      optimized: candidate,
      improved: false,
      forkRound,
      mask: bestOverall.split.mask,
      maskLabel: maskToLabel(bestOverall.split.mask),
      before: emptyMetrics,
      after: emptyMetrics,
      targetPoolDiagnostics: {
        targetPoolCount: targetCells.length,
        cells: createTargetDiagnostics('BRANCH_SEARCH_NO_TRAINING_GAIN', effectiveOpps),
      },
      searchOperatorStats: emptySearchStats,
    };
  }

  // 7. 并发搜索新分支（包含内卡/外卡/开局联合算子）
  console.log(`\n=== 并发优化新分支（R${forkRound}~R5，开局弱势增强=${isEarlyOpeningWeak}） ===`);
  const searchBefore = evalMatchOnMatched(BundleAI, candidate, bestOverall.split.mask, effectiveOpps, gamesPerOpp, cache, searchSeedBase);
  const { optimized, hasTrainingGain, stats: searchOpStats } = await optimizeBranchParallel(
    BundleAI,
    branched,
    bestOverall.split.mask,
    forkRound,
    effectiveOpps,
    gamesPerOpp,
    exp,
    src.id,
    cache,
    searchSeedBase,
    pool,
    isEarlyOpeningWeak,
    enableExternalDeckSearch,
    enableOpeningOperators,
  );
  const searchAfter = evalMatchOnMatched(BundleAI, optimized, bestOverall.split.mask, effectiveOpps, gamesPerOpp, cache, searchSeedBase);
  exp.save();

  // 8. 独立验证集评估
  console.log(`\n=== 独立验证集整局对比（ValSeed=${validationSeedBase}，优化前 vs 优化后） ===`);
  const [beforeVal, afterVal] = await pool.evalCandidateBatchOnMatchedParallel(
    [candidate, optimized],
    bestOverall.split.mask,
    effectiveOpps,
    gamesPerOpp,
    validationSeedBase,
  );
  console.log(`  [验证集] 优化前 ${formatMatchMetrics(beforeVal)} → 优化后 ${formatMatchMetrics(afterVal)}`);

  const totalValMatches = afterVal.total;
  const improved = totalValMatches > 0
    && afterVal.trainingScore >= beforeVal.trainingScore + 0.05
    && afterVal.loss <= beforeVal.loss;

  let outcome: BranchInductionOutcome = 'IMPROVED';
  if (!improved) {
    if (!hasTrainingGain && searchAfter.trainingScore <= searchBefore.trainingScore) {
      outcome = 'BRANCH_SEARCH_NO_TRAINING_GAIN';
    } else {
      outcome = 'VALIDATION_TRAINING_REJECTED';
    }
    console.log(`\n独立验证集未达到最低改善门槛（状态: ${outcome}），不采纳该分支（保持原阵型）。`);
  }

  // 诊断目标格处理状态
  const targetDiagnostics: TargetCellInfo[] = targetCells.map(tc => {
    const isMatched = effectiveOpps.some(o => (o.id ?? o.name) === tc.oppId);
    let rejectionReason: string | undefined = undefined;
    if (!isMatched) {
      rejectionReason = 'not_matched_at_fork';
    } else if (!improved) {
      rejectionReason = outcome;
    }
    return {
      opponentIndex: tc.oppIdx,
      opponentName: tc.oppName,
      side: tc.side,
      initialTrainingScore: tc.score,
      addressed: improved && isMatched,
      addressable: isMatched,
      rejectionReason,
    };
  });

  return {
    outcome,
    optimized: improved ? optimized : candidate,
    improved,
    forkRound,
    mask: bestOverall.split.mask,
    maskLabel: maskToLabel(bestOverall.split.mask),
    before: beforeVal,
    after: afterVal,
    targetPoolDiagnostics: {
      targetPoolCount: targetCells.length,
      cells: targetDiagnostics,
    },
    searchOperatorStats: searchOpStats,
    searchValidation: {
      searchSeedBase,
      validationSeedBase,
      gamesPerOpp,
      searchBefore,
      searchAfter,
      matchedOpponents: effectiveOpps.map(o => o.name),
      simCount: cache.simCount,
      forkRound,
      triggerCoverage: {
        matched: matchedTracesCount,
        totalObserved: totalObservedTraces,
        coverageRate: totalObservedTraces > 0 ? matchedTracesCount / totalObservedTraces : 0,
      },
      untriggeredReasons,
    },
  };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
