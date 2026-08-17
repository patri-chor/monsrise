// ============================================================
// 自主分支 —— 决策树归纳（branch induction）
//
// 用户定案：
//   - 面对"输的分"，先看胜率是否不为 0（有赢有输）
//   - 分析"赢的对局 vs 输的对局"的标签差异，把赢的标签固化为新分支
//   - 固化后，该分支覆盖的情况从后续搜索排除，对剩余情况继续优化
//   - 暂不加预剪枝（后续再加样本量/收益阈值）
//
// 分裂特征（候选标签）：
//   - side（先后手 1/2）
//   - main（对手流派 prayer/halfrush/fullrush）
//   - subs（dof/shield/gift 有无）
//   - keys（钻头/冲锋/铁甲/忍猴/突突/咒法/矿爆 有无）
//
// 信息增益（二元分裂 win/loss）：
//   IG(feature) = H(all) - Σ (|subset|/|all|) * H(subset)
//   选 IG 最大的特征建分支。
//
// 运行：npx vite-node --script src/engine/tree/branch_induct.ts [种子] [对手] [侧] [局数]
// ============================================================

import '../env';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FORMATION_LIBRARY } from '../../ai/formation_library';
import type { Formation } from '../../ai/types';
import type { EvolFormation, FeatureMask, EvolNode } from './evol_gene';
import { formationToEvol, recognizeArchetype, maskToLabel, summarizeEvolFormation, matchMask, isEmptyMask, walkEvolNodes } from './evol_gene';
import { addBranch, replaceMonster, moveWithinZoneAtNode, isPositionIrrelevant, roleOf, getLastValidationError } from './tree_ops';
import { playSpecVsSpec, type SideSpec, type BranchDecision, type RoundObservation } from './arena';
import { ExperienceBank, replaceKey, moveKey, computeTreeFingerprint } from './search_experience';
import { calculateMatchMetrics, formatMatchMetrics, type MatchMetrics } from './match_metrics';
import { PersistentSimPool } from './persistent_pool';

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

/** 熵：-p*log2(p) - (1-p)*log2(1-p)，p=0 或 1 时为 0 */
function entropy(p: number): number {
  if (p <= 0 || p >= 1) return 0;
  return -p * Math.log2(p) - (1 - p) * Math.log2(1 - p);
}

/** 信息增益：按标签 splitter 把样本分成两组，算 win 率的熵减 */
function infoGain(samples: { win: boolean; has: boolean }[]): number {
  const n = samples.length;
  if (n === 0) return 0;
  const winCount = samples.filter(s => s.win).length;
  const hAll = entropy(winCount / n);

  const withFeature = samples.filter(s => s.has);
  const withoutFeature = samples.filter(s => !s.has);
  if (withFeature.length === 0 || withoutFeature.length === 0) return 0;

  const hWith = entropy(withFeature.filter(s => s.win).length / withFeature.length);
  const hWithout = entropy(withoutFeature.filter(s => s.win).length / withoutFeature.length);
  const hSplit = (withFeature.length / n) * hWith + (withoutFeature.length / n) * hWithout;
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
}

export interface Sample {
  win: boolean;
  side: 1 | 2;
  main: string | null;
  subs: string[];
  keys: string[];
  oppName: string;
  round: number;
}

/** 从实际对局轨迹中提取指定回合的样本（基于该回合候选侧实际可见对手特征） */
export function sampleFromTrace(trace: MatchTrace, focusRound: number, oppName: string): Sample | null {
  const score = trace.roundScores[focusRound - 1];
  if (score === undefined) return null; // 对局提前结束（该分未打），不计入样本

  const obs = trace.observations.get(focusRound);
  if (!obs) {
    // 关键：若该回合无 observation（如提前结束或无手牌），不计入样本，坚决不回退到全卡组
    return null;
  }

  // 严格使用运行时可见特征
  const rec = recognizeArchetype({
    handIds: new Set(obs.handIds),
    handBadges: new Set(obs.handBadges),
    boardIds: new Set(obs.boardIds),
  });

  return {
    win: score >= 0,
    side: trace.side,
    main: rec.main,
    subs: rec.subs,
    keys: rec.keys,
    oppName,
    round: focusRound,
  };
}

/** 对所有候选标签算信息增益，返回最优分裂 */
function bestSplit(samples: Sample[]): { kind: string; value: string; mask: FeatureMask; ig: number } | null {
  const candidates: { kind: string; value: string; has: (s: Sample) => boolean; mask: FeatureMask }[] = [];

  // side 特征
  if (new Set(samples.map(s => s.side)).size > 1) {
    candidates.push({ kind: 'side', value: '2(后手)', has: s => s.side === 2, mask: { side: 2, main: null, subs: [], keys: [] } });
    candidates.push({ kind: 'side', value: '1(先手)', has: s => s.side === 1, mask: { side: 1, main: null, subs: [], keys: [] } });
  }
  // main 特征
  const mains = [...new Set(samples.map(s => s.main).filter((x): x is string => !!x))];
  for (const m of mains) {
    candidates.push({ kind: 'main', value: m, has: s => s.main === m, mask: { side: null, main: m as any, subs: [], keys: [] } });
  }
  // subs 特征
  const subs = [...new Set(samples.flatMap(s => s.subs))];
  for (const sb of subs) {
    candidates.push({ kind: 'sub', value: sb, has: s => s.subs.includes(sb), mask: { side: null, main: null, subs: [sb as any], keys: [] } });
  }
  // keys 特征
  const keys = [...new Set(samples.flatMap(s => s.keys))];
  for (const k of keys) {
    candidates.push({ kind: 'key', value: k, has: s => s.keys.includes(k), mask: { side: null, main: null, subs: [], keys: [k as any] } });
  }

  // 二元组合候选
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
  for (const sb of subs.slice(0, 3)) {
    for (const k of keys.slice(0, 7)) {
      candidates.push({
        kind: 'sub+key', value: `${sb}+${k}`,
        has: s => s.subs.includes(sb) && s.keys.includes(k),
        mask: { side: null, main: null, subs: [sb as any], keys: [k as any] },
      });
    }
  }

  let best: { kind: string; value: string; mask: FeatureMask; ig: number } | null = null;
  for (const c of candidates) {
    const ig = infoGain(samples.map(s => ({ win: s.win, has: c.has(s) })));
    if (best === null || ig > best.ig) {
      best = { kind: c.kind, value: c.value, mask: c.mask, ig };
    }
  }
  return best && best.ig > 0 ? best : null;
}

/** 单局轨迹在拟分叉回合 forkRound 是否精确匹配 mask */
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

/** 对手在拟分叉回合 forkRound 是否有至少一次实际观察匹配 mask */
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

/** 两个 mask 是否完全相同 */
function maskEqual(a: FeatureMask, b: FeatureMask): boolean {
  return a.side === b.side && a.main === b.main
    && a.subs.length === b.subs.length && a.subs.every(s => b.subs.includes(s))
    && a.keys.length === b.keys.length && a.keys.every(k => b.keys.includes(k));
}

/** 主链 R1..(forkRound-1) 已上场怪集合 */
function preUsedMonsters(f: EvolFormation, forkRound: number): Set<number> {
  const used = new Set<number>();
  let cur: EvolNode | null = f.root;
  while (cur && cur.round < forkRound) {
    for (const p of cur.placements) used.add(p.monsterId);
    cur = cur.children.find(c => isEmptyMask(c.condition)) ?? cur.children[0] ?? null;
  }
  return used;
}

/** 分支子树内除 (exceptNodeId, exceptMonsterId) 外已占用的怪集合 */
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

/** 评估个体：对「命中 mask 的对手」计算全套指标，利用缓存复用 */
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

/** 优化新分支内部走法（支持细粒度 64-Worker 批次并发） */
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
): Promise<EvolFormation> {
  const teamIds = branched.team.filter(s => s.monsterId > 0).map(s => s.monsterId);
  const preUsed = preUsedMonsters(branched, forkRound);
  let current = branched;
  let curEval = evalMatchOnMatched(BundleAI, current, mask, matchedOpps, games, cache, searchSeedBase);
  let skippedByExp = 0, newlyInvalid = 0;
  console.log(`  新分支初始（命中对手整局）：${formatMatchMetrics(curEval)}`);

  const activePool = pool ?? PersistentSimPool.getInstance();

  for (let iter = 0; iter < 10; iter++) {
    const currentFp = computeTreeFingerprint(current);
    const roots = walkEvolNodes(current.root).filter(n => !isEmptyMask(n.condition) && maskEqual(n.condition, mask));
    const branchNodes: EvolNode[] = [];
    for (const r of roots) branchNodes.push(...walkEvolNodes(r));

    if (branchNodes.length === 0) {
      console.log('  未找到分支节点（可能标签未命中任何节点），停止优化。');
      break;
    }

    const candidateQueue: { child: EvolFormation; desc: string; key: string }[] = [];

    for (const node of branchNodes) {
      // P1 单替换穷举
      for (const slot of node.placements) {
        const subtreeUsed = branchUsedMonsters(branchNodes, node.id, slot.monsterId);
        for (const toMid of teamIds) {
          if (toMid === slot.monsterId) continue;
          if (preUsed.has(toMid)) continue;
          if (subtreeUsed.has(toMid)) continue;
          const key = replaceKey(formationId, node.id, slot.monsterId, toMid, currentFp);
          if (exp.isKnownInvalid(key)) { skippedByExp++; continue; }
          const child = replaceMonster(current, node.id, slot.monsterId, toMid);
          if (!child) {
            const reason = getLastValidationError() ?? '结构非法';
            exp.markInvalid(key, reason);
            newlyInvalid++;
            continue;
          }
          candidateQueue.push({
            child,
            desc: `替换 R${node.round} 节点${node.id}：${nm(slot.monsterId)} → ${nm(toMid)}`,
            key,
          });
        }
      }

      // P2 同战区坐标微调
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
              desc: `移动 ${nm(slot.monsterId)} → (${x},${y})`,
              key,
            });
          }
        }
      }
    }

    if (candidateQueue.length === 0) {
      console.log(`  第${iter + 1}轮：无新的有效变异候选，停止。`);
      break;
    }

    // 细粒度批次并发评估（一次性打满所有 Worker）
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

    for (let i = 0; i < candidateQueue.length; i++) {
      const cand = candidateQueue[i];
      const metric = evalResults[i];
      if (metric.trainingScore > bestScore) {
        bestScore = metric.trainingScore;
        bestChild = cand.child;
        bestDesc = cand.desc;
        bestEval = metric;
      }
    }

    console.log(`  第${iter + 1}轮：并发评估 ${candidateQueue.length} 个候选（跳过经验库无效 ${skippedByExp} 个），最优训练分 ${(bestScore * 100).toFixed(1)}%`);
    if (bestChild && bestScore > curEval.trainingScore) {
      current = bestChild;
      curEval = bestEval;
      console.log(`    [采纳] ${bestDesc} → ${formatMatchMetrics(curEval)}`);
    } else {
      console.log(`    [无改进] 最优候选训练分 ${(bestScore * 100).toFixed(1)}% ≤ 当前 ${(curEval.trainingScore * 100).toFixed(1)}%，停止。`);
      break;
    }
  }

  console.log(`  [经验库] 分支优化累计：跳过历史无效 ${skippedByExp} 个，新增无效 ${newlyInvalid} 个`);
  return current;
}

async function main(): Promise<void> {
  const seedName = process.argv[2] || '肃清';
  const gamesPerOpp = Number(process.argv[3] || 4);

  const BundleAI = loadBundle();
  const src = FORMATION_LIBRARY.find(f => f.name === seedName);
  if (!src) { console.error('阵型不存在'); process.exit(1); }

  const out = await optimizeFormation(BundleAI, src, gamesPerOpp);
  if (!out) return;

  const outPath = resolve('reports/branch_induct_result.json');
  const json = {
    type: 'branch_induct_result',
    seedFormation: seedName,
    forkRound: out.forkRound,
    mask: out.mask,
    maskLabel: out.maskLabel,
    before: out.before,
    after: out.after,
    searchValidation: out.searchValidation,
    formation: { name: out.optimized.name, archetype: out.optimized.archetype, team: out.optimized.team, tree: out.optimized.root },
  };
  writeFileSync(outPath, JSON.stringify(json, null, 2));
  console.log(`\n优化结果已保存 → ${outPath}`);
}

export interface OptimizeFormationResult {
  optimized: EvolFormation;
  improved: boolean;
  forkRound: number;
  mask: FeatureMask;
  maskLabel: string;
  before: MatchMetrics;
  after: MatchMetrics;
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
}

/**
 * 自主分支优化（可复用）：分析 → 诊断崩盘 → 建分支 → 优化新分支 → 独立验证集评估。
 */
export async function optimizeFormation(
  BundleAI: any,
  src: Formation,
  gamesPerOpp: number,
  options?: OptimizeFormationOptions,
): Promise<OptimizeFormationResult | null> {
  if (options?.opponents !== undefined && options.opponents.length === 0) {
    throw new Error('OptimizeFormationOptions.opponents cannot be empty');
  }
  const panelOpponents = options?.opponents ?? FORMATION_LIBRARY;
  const candidate = formationToEvol(src);
  const searchSeedBase = options?.searchSeedBase ?? 2000;
  const validationSeedBase = options?.validationSeedBase ?? 9000;
  const pool = options?.pool ?? PersistentSimPool.getInstance();

  const exp = new ExperienceBank();
  exp.load();
  const cache = new MatchSimulationCache();

  console.log(`=== 分支归纳分析：${src.name} 先手+后手 vs 全部 ${panelOpponents.length} 阵型（每对手每侧${gamesPerOpp}局，经验库 ${exp.size} 条，SearchSeed=${searchSeedBase}, ValSeed=${validationSeedBase}）===`);

  // 1. 批量采集全对局轨迹 (一次性模拟各对手各 side 的 gamesPerOpp 局)
  const initialTraces: MatchTrace[] = [];
  for (const opp of panelOpponents) {
    for (const side of [1, 2] as (1 | 2)[]) {
      for (let i = 0; i < gamesPerOpp; i++) {
        const trace = cache.getOrSimulate(BundleAI, candidate, opp, side, searchSeedBase + i);
        initialTraces.push(trace);
      }
    }
  }

  // 2. 从缓存轨迹派生 R1-R5 样本，无需重打对局
  let bestOverall: { round: number; split: { kind: string; value: string; mask: FeatureMask; ig: number }; winRate: number } | null = null;

  for (let round = 1; round <= 5; round++) {
    const allSamples: Sample[] = [];
    for (const trace of initialTraces) {
      const s = sampleFromTrace(trace, round, trace.oppId);
      if (s) allSamples.push(s);
    }
    if (allSamples.length === 0) continue;
    const winCount = allSamples.filter(s => s.win).length;
    const winRate = winCount / allSamples.length;
    const split = bestSplit(allSamples);
    console.log(`R${round}: 胜率 ${(winRate * 100).toFixed(0)}%（${winCount}赢/${allSamples.length - winCount}输，共${allSamples.length}有效决策样本）${split ? ` 分裂 ${split.kind}=${split.value} IG=${split.ig.toFixed(3)}` : ''}`);
    if (split && (!bestOverall || split.ig > bestOverall.split.ig)) {
      bestOverall = { round, split, winRate };
    }
  }

  if (!bestOverall) {
    console.log('\n无有效分裂（所有分要么全赢要么标签无区分度），无需建分支。');
    return null;
  }

  console.log(`\n=== 最优分裂：R${bestOverall.round} 按 ${bestOverall.split.kind}=${bestOverall.split.value} 建分支 ===`);
  console.log(`分支标签 [${maskToLabel(bestOverall.split.mask)}]，信息增益 ${bestOverall.split.ig.toFixed(3)}`);

  // 3. 诊断崩盘起点定位 forkRound
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
    console.log(`  R${round}: ${win}/${total} 胜率 ${(rate * 100).toFixed(0)}%`);
  }

  const CRASH_THRESHOLD = 0.75;
  const crash = roundRates.find(x => x.rate < CRASH_THRESHOLD && x.total > 0);
  const rawFork = crash ? crash.round : bestOverall.round;
  const forkRound = Math.max(1, rawFork - 1);
  if (crash) {
    console.log(`\n崩盘起点 R${crash.round}（胜率 ${(crash.rate * 100).toFixed(0)}% < ${(CRASH_THRESHOLD * 100).toFixed(0)}%）`);
    console.log(`分叉点往前推一个回合：R${rawFork} → R${forkRound}，覆盖 R${forkRound}~R5 整棵子树。`);
  } else {
    console.log(`\n无跌破阈值回合，分叉点 = IG 最高的 R${forkRound}。`);
  }

  // 4. 精确在拟分叉 forkRound 与候选侧判断命中对手（严禁回退到静态全卡组候选）
  const effectiveOpps = panelOpponents.filter(o => oppMatchesAtFork(o, bestOverall.split.mask, forkRound, initialTraces));
  if (effectiveOpps.length === 0) {
    console.log(`\n[分支拒绝] 在拟分叉回合 R${forkRound} 实际观察中未命中任何对手，放弃建分支。`);
    return null;
  }

  console.log(`\n=== 命中「${maskToLabel(bestOverall.split.mask)}」的对手（${effectiveOpps.map(o => o.name).join('、')}）===`);

  // 统计触发覆盖率与未触发原因
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

  // 5. 建分支
  const rng = mulberry32(777);
  console.log(`\n[建分支] 在 R${forkRound} 处按标签「${maskToLabel(bestOverall.split.mask)}」复制主链子树作模板`);
  const branched = addBranch(candidate, bestOverall.split.mask, rng, forkRound);
  if (!branched) {
    console.log('addBranch 失败（可能分支数已满）。');
    return null;
  }
  console.log('[建分支] 分支创建成功，新树结构：');
  console.log(summarizeEvolFormation(branched));

  // 6. 搜索集内并发优化新分支
  console.log(`\n=== 并发优化新分支（R${forkRound}~R5，命中对手，搜索集 Seed=${searchSeedBase}） ===`);
  const searchBefore = evalMatchOnMatched(BundleAI, candidate, bestOverall.split.mask, effectiveOpps, gamesPerOpp, cache, searchSeedBase);
  const optimized = await optimizeBranchParallel(
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
  );
  const searchAfter = evalMatchOnMatched(BundleAI, optimized, bestOverall.split.mask, effectiveOpps, gamesPerOpp, cache, searchSeedBase);
  exp.save();

  // 7. 独立验证集评估 (Validation Seed Base)
  console.log(`\n=== 独立验证集整局对比（ValSeed=${validationSeedBase}，优化前 vs 优化后） ===`);
  const beforeVal = evalMatchOnMatched(BundleAI, candidate, bestOverall.split.mask, effectiveOpps, gamesPerOpp, cache, validationSeedBase);
  const afterVal = evalMatchOnMatched(BundleAI, optimized, bestOverall.split.mask, effectiveOpps, gamesPerOpp, cache, validationSeedBase);
  console.log(`  [验证集] 优化前 ${formatMatchMetrics(beforeVal)} → 优化后 ${formatMatchMetrics(afterVal)}`);

  for (const opp of effectiveOpps) {
    let bw = 0, bd = 0, bl = 0, aw = 0, ad = 0, al = 0;
    for (const side of diagSides) {
      for (let i = 0; i < gamesPerOpp; i++) {
        const tb = cache.getOrSimulate(BundleAI, candidate, opp, side, validationSeedBase + i);
        const ta = cache.getOrSimulate(BundleAI, optimized, opp, side, validationSeedBase + i);
        bw += tb.w; bd += tb.d; bl += tb.l;
        aw += ta.w; ad += ta.d; al += ta.l;
      }
    }
    const bM = calculateMatchMetrics(bw, bd, bl);
    const aM = calculateMatchMetrics(aw, ad, al);
    console.log(`  ${opp.name}: 训练分 ${(bM.trainingScore * 100).toFixed(1)}% (${bw}W/${bd}D/${bl}L) → ${(aM.trainingScore * 100).toFixed(1)}% (${aw}W/${ad}D/${al}L) ${aM.trainingScore >= bM.trainingScore ? '↑' : '↓'}`);
  }

  // 验收标准：验证样本非空，训练分改善 >= 0.05 (5%) 且 净负场不恶化
  const totalValMatches = afterVal.total;
  const improved = totalValMatches > 0
    && afterVal.trainingScore >= beforeVal.trainingScore + 0.05
    && afterVal.loss <= beforeVal.loss;

  if (!improved) {
    console.log('\n独立验证集未达到最低改善门槛（+5% 训练分或负场增加），不采纳该分支（保持原阵型）。');
  }

  return {
    optimized: improved ? optimized : candidate,
    improved,
    forkRound,
    mask: bestOverall.split.mask,
    maskLabel: maskToLabel(bestOverall.split.mask),
    before: beforeVal,
    after: afterVal,
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

// 仅 CLI 直接运行时执行 main（被 import 时不执行）
if (process.argv[1] && process.argv[1].endsWith('branch_induct.ts')) {
  main();
}


