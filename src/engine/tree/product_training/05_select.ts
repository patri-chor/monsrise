// ============================================================
// T038 Phase-3 — 05_select.ts
// 候选选择策略：成熟度判断、可控性预算、算子策略、候选排名
// ============================================================

import type { ScreenObservation } from './04_screen';
import type { CandidateEntry } from './04_screen';
import type { Formation } from '../../../ai/types';

// ---- 成熟度阈值 ----

export const MATURITY_STRONG_THRESHOLD = 0.92;   // >= 强/成熟
export const MATURITY_MID_THRESHOLD    = 0.70;   // >= 中等
// < 0.70 = 弱/未探索 → 允许多怪兽探索升级

// ---- 可控性阈值 ----

export const LOW_CONTROLLABILITY_THRESHOLD = 0.30; // ratio <= 此值 → 空间预算归零

// ---- 单算子失败升级阈值 ----

export const SINGLE_OP_ESCALATION_LIMIT = 3;  // 连续 N 次无改进 → 升级至 multi_monster

// ---- 成熟度类型 ----

export type SourceMaturity = 'STRONG' | 'MID' | 'WEAK';

export interface SourcePolicy {
  sourceId: string;
  baselineScore: number;
  maturity: SourceMaturity;
  controllableRatio: number;
  spatialBudget: number;    // 0-3，基于 controllableRatio × 3
  spatialBudgetReason: string;
  transformBudget: number;  // 成熟+可控 → 0-1
  branchBudget: number;     // 固定 1（每局注入一个 R1/R2 分支候选）
  allowMultiMonster: boolean;
  weakestSideScore: number | null;
  weakestSide: 1 | 2 | null;
}

/** 计算每个可执行源的自适应策略 */
export function computeSourcePolicies(
  execSources: Formation[],
  t037Obs: ScreenObservation[],
): SourcePolicy[] {
  const baselineMap = new Map<string, ScreenObservation>(
    t037Obs.filter(o => o.entityKind === 'baseline').map(o => [o.sourceId, o]),
  );

  return execSources.map(src => {
    const srcId = (src as any).id;
    const baseline = baselineMap.get(srcId);
    const baselineScore = baseline?.trainingScore ?? 0;
    const controllableRatio = (src as any).calculatedUnitRatio ?? 0;

    const maturity: SourceMaturity =
      baselineScore >= MATURITY_STRONG_THRESHOLD ? 'STRONG' :
      baselineScore >= MATURITY_MID_THRESHOLD    ? 'MID' : 'WEAK';

    // 空间预算 = base(3) × controllableRatio，rounded
    let spatialBudget: number;
    let spatialBudgetReason: string;
    if (controllableRatio <= LOW_CONTROLLABILITY_THRESHOLD) {
      spatialBudget = 0;
      spatialBudgetReason = `LOW_CONTROLLABILITY: ratio=${controllableRatio.toFixed(2)} <= ${LOW_CONTROLLABILITY_THRESHOLD}`;
    } else if (maturity === 'STRONG') {
      spatialBudget = Math.max(1, Math.round(3 * controllableRatio));
      spatialBudgetReason = `STRONG_SOURCE: ratio=${controllableRatio.toFixed(2)}`;
    } else {
      spatialBudget = Math.round(3 * controllableRatio);
      spatialBudgetReason = `${maturity}_SOURCE: ratio=${controllableRatio.toFixed(2)}`;
    }

    // 变换预算：ratio 低的源增加
    const transformBudget = controllableRatio <= LOW_CONTROLLABILITY_THRESHOLD ? 2 : 1;

    // 弱侧（从 T037 cells 推断）——此处简化：检查 sourceRelativeScore 最差侧
    // Phase-3 周期运行时补充 cell 级别弱侧分析
    const weakestSideScore: number | null = null;
    const weakestSide: 1 | 2 | null = null;

    return {
      sourceId: srcId,
      baselineScore,
      maturity,
      controllableRatio,
      spatialBudget,
      spatialBudgetReason,
      transformBudget,
      branchBudget: 1,
      allowMultiMonster: maturity === 'WEAK',
      weakestSideScore,
      weakestSide,
    };
  });
}

// ---- 候选排名 ----

export interface RankedCandidate {
  entry: CandidateEntry;
  obs: ScreenObservation;
  rank: number;
  rankReason: string;
  isPromotion: boolean;  // sourceRelativeScore > 0 且无 worker 错误
}

/**
 * 按 source-relative score → weakest-side score → coverage gain 排名
 * 返回每个源的最佳候选（若有）
 */
export function rankCandidates(
  allEntries: CandidateEntry[],
  allObs: ScreenObservation[],
  _policies: SourcePolicy[],
): RankedCandidate[] {
  const obsMap = new Map<string, ScreenObservation>(allObs.map(o => [o.entityId, o]));

  const ranked: RankedCandidate[] = [];

  // 按 source 分组
  const sourceIds = [...new Set(allEntries.map(e => e.meta.sourceId))];
  for (const srcId of sourceIds) {
    const candidates = allEntries.filter(e =>
      e.meta.sourceId === srcId &&
      !e.meta.rejected &&
      e.meta.operatorFamily !== 'baseline',
    );

    const scoredCandidates = candidates
      .map(entry => {
        const obs = obsMap.get(entry.meta.candidateId);
        if (!obs) return null;
        return { entry, obs };
      })
      .filter((x): x is { entry: CandidateEntry; obs: ScreenObservation } => x !== null)
      .filter(({ obs }) => obs.workerErrors === 0)
      .sort((a, b) => {
        // 主排序：source-relative score 降序
        const relA = a.obs.sourceRelativeScore ?? -999;
        const relB = b.obs.sourceRelativeScore ?? -999;
        if (Math.abs(relA - relB) > 0.001) return relB - relA;
        // 次排序：training score 降序
        return b.obs.trainingScore - a.obs.trainingScore;
      });

    scoredCandidates.forEach((sc, idx) => {
      const rel = sc.obs.sourceRelativeScore ?? 0;
      const isPromotion = rel > 0 && sc.obs.workerErrors === 0;
      ranked.push({
        entry: sc.entry,
        obs: sc.obs,
        rank: idx,
        rankReason: `rel=${rel.toFixed(3)} score=${sc.obs.trainingScore.toFixed(3)}`,
        isPromotion,
      });
    });
  }

  return ranked;
}

// ---- 周期决策记录 ----

export interface CycleDecisionRecord {
  protocol: string;
  cycleId: string;
  sourceId: string;
  maturity: SourceMaturity;
  controllableRatio: number;
  spatialBudget: number;
  spatialBudgetReason: string;
  baselineScore: number;
  bestCandidateId: string | null;
  bestCandidateScore: number | null;
  bestCandidateRel: number | null;
  isPromotion: boolean;
  candidatesScreened: number;
  singleOpFailCount: number;
  escalatedToMultiMonster: boolean;
  escalationReason: string | null;
  decidedAt: string;
}
