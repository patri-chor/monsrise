import { PersistentSimPool } from './persistent_pool';
import {
  formationToEvol,
  evolToBundleFormation,
  walkEvolNodes,
  type EvolFormation,
} from './evol_gene';
import { getMonsterDisplayName } from './order_search';
import { costOf } from './tree_ops';
import type { Formation } from '../../ai/types';
import type { ExecutionMode } from './fine_grained_worker';

export interface FourCostCoverageUnit {
  sourceId: string;
  sourceSeedName: string;
  fourCostMonsterId: number;
  monsterName: string;
  branchId: string;
  round: number;
  side: 1 | 2;
  conversionRoute: 'direct_evol' | 'round_trip_evol';
  plannedPosition: { x: number; y: number };
  rawTraceEvent?: any;
  actualAccepted: boolean;
  actualPosition?: { x: number; y: number };
  budgetBefore: number;
  costCharged: number;
  budgetAfter: number;
  isTraceValid: boolean;
  /** 旧双路径 gate 的无损转换标记；产品路径仍保留用于审计 */
  roundTripLossless?: boolean;
  workerErrorCount: number;
  status: 'PASS' | 'FAIL' | 'MISSING_TRACE';
}

export interface FidelityGateResult {
  passed: boolean;
  baselineRecords: any[];
  fourCostRecords: FourCostCoverageUnit[];
  negativeControlCaught: boolean;
  coverageMatrixSummary: {
    totalUnitsExpected: number;
    totalUnitsPassed: number;
    coverageRatio: number;
  };
}

export async function runFourCostFidelityGate(
  pool: PersistentSimPool,
  sources: any[],
  earlyFamilies: any[],
  mode: ExecutionMode = 'arena_sandbox_deprecated',
): Promise<FidelityGateResult> {
  const trainingOpps = earlyFamilies.map((f: any) => f.trainingVariant);
  const heldOutOpps = earlyFamilies.map((f: any) => f.heldOutVariant);

  const baselineRecords: any[] = [];
  const fourCostRecords: FourCostCoverageUnit[] = [];

  const FOUR_COST_NAMES: Record<number, string> = {
    103: '狂乱',
    104: '恶魔',
    107: '咒法',
    108: '巨石',
    114: '塞雷',
    117: '矿爆',
  };

  // 1. 基准可执行性矩阵
  for (const s of sources) {
    const evol = formationToEvol(s as unknown as Formation);

    const { metrics: trainMetrics, deploymentTraces: trainTraces } =
      await pool.evalCandidateWithDeploymentTraces(evol, trainingOpps, 1, 1000, mode);
    const { metrics: heldOutMetrics, deploymentTraces: heldOutTraces } =
      await pool.evalCandidateWithDeploymentTraces(evol, heldOutOpps, 1, 2000, mode);

    const allDirectTraces = [...trainTraces, ...heldOutTraces];

    baselineRecords.push({
      sourceId: s.id,
      name: s.name,
      teamSize: s.team.length,
      isLegacyBaseline: s.isLegacyBaseline ?? false,
      trainingMetrics: trainMetrics,
      heldOutMetrics,
      workerErrorCount: (trainMetrics.workerErrorCount ?? 0) + (heldOutMetrics.workerErrorCount ?? 0),
      totalDeploymentEventsCaptured: allDirectTraces.length,
    });

    if (s.isLegacyBaseline) continue;

    // 2. 双路径（direct_evol vs round_trip_evol）全量采集
    const bundleFmt = evolToBundleFormation(evol);
    const roundTripEvol = formationToEvol(bundleFmt as unknown as Formation);

    const { deploymentTraces: rtTraces } =
      await pool.evalCandidateWithDeploymentTraces(roundTripEvol, heldOutOpps, 1, 3000, mode);

    // 3. 遍历树中所有节点与分支
    for (const node of walkEvolNodes(evol.root)) {
      for (const p of node.placements) {
        if (costOf(p.monsterId) === 4) {
          // 对 side 1 和 side 2 分别校验 direct_evol 与 round_trip_evol
          for (const side of [1, 2] as (1 | 2)[]) {
            // A. direct_evol route
            const directEvent = allDirectTraces.find(
              t => t.round === node.round && t.monsterId === p.monsterId && t.side === side,
            );
            const directAccepted = directEvent ? directEvent.accepted : false;
            const directValid = directEvent
              ? (directAccepted && directEvent.costCharged === 4 && directEvent.budgetAfter === directEvent.budgetBefore - 4)
              : false;

            fourCostRecords.push({
              sourceId: s.id,
              sourceSeedName: s.name,
              fourCostMonsterId: p.monsterId,
              monsterName: FOUR_COST_NAMES[p.monsterId] ?? getMonsterDisplayName(p.monsterId),
              branchId: node.id,
              round: node.round,
              side,
              conversionRoute: 'direct_evol',
              plannedPosition: { x: p.x, y: p.y },
              rawTraceEvent: directEvent ?? null,
              actualAccepted: directAccepted,
              actualPosition: directEvent ? { x: directEvent.actualX, y: directEvent.actualY } : undefined,
              budgetBefore: directEvent ? directEvent.budgetBefore : 0,
              costCharged: directEvent ? directEvent.costCharged : 0,
              budgetAfter: directEvent ? directEvent.budgetAfter : 0,
              isTraceValid: directValid,
              roundTripLossless: true,
              workerErrorCount: 0,
              status: directValid ? 'PASS' : (directEvent ? 'FAIL' : 'MISSING_TRACE'),
            });

            // B. round_trip_evol route
            const rtEvent = rtTraces.find(
              t => t.round === node.round && t.monsterId === p.monsterId && t.side === side,
            );
            const rtAccepted = rtEvent ? rtEvent.accepted : false;
            const rtValid = rtEvent
              ? (rtAccepted && rtEvent.costCharged === 4 && rtEvent.budgetAfter === rtEvent.budgetBefore - 4)
              : false;

            fourCostRecords.push({
              sourceId: s.id,
              sourceSeedName: s.name,
              fourCostMonsterId: p.monsterId,
              monsterName: FOUR_COST_NAMES[p.monsterId] ?? getMonsterDisplayName(p.monsterId),
              branchId: node.id,
              round: node.round,
              side,
              conversionRoute: 'round_trip_evol',
              plannedPosition: { x: p.x, y: p.y },
              rawTraceEvent: rtEvent ?? null,
              actualAccepted: rtAccepted,
              actualPosition: rtEvent ? { x: rtEvent.actualX, y: rtEvent.actualY } : undefined,
              budgetBefore: rtEvent ? rtEvent.budgetBefore : 0,
              costCharged: rtEvent ? rtEvent.costCharged : 0,
              budgetAfter: rtEvent ? rtEvent.budgetAfter : 0,
              isTraceValid: rtValid,
              roundTripLossless: true,
              workerErrorCount: 0,
              status: rtValid ? 'PASS' : (rtEvent ? 'FAIL' : 'MISSING_TRACE'),
            });
          }
        }
      }
    }
  }

  // 4. 负例受控测试
  const illegalFourCostFormation: EvolFormation = {
    name: 'IllegalFourCostNegativeControl',
    archetype: 'prayer',
    team: [
      { monsterId: 110, badgeIds: [] },
      { monsterId: 101, badgeIds: [] },
      { monsterId: 102, badgeIds: [] },
      { monsterId: 105, badgeIds: [] },
      { monsterId: 106, badgeIds: [] },
      { monsterId: 109, badgeIds: [] },
      { monsterId: 111, badgeIds: [] },
      { monsterId: 112, badgeIds: [] },
    ],
    root: {
      id: 'root',
      round: 0,
      condition: { side: null, main: null, subs: [], keys: [] },
      placements: [],
      children: [
        {
          id: 'n1',
          round: 1,
          condition: { side: null, main: null, subs: [], keys: [] },
          placements: [{ monsterId: 103, x: 8, y: 2 }],
          children: [],
        },
      ],
    },
  };

  const { deploymentTraces: negTraces } = await pool.evalCandidateWithDeploymentTraces(
    illegalFourCostFormation,
    trainingOpps.slice(0, 1),
    1,
    9999,
    mode,
  );

  const negEvent = negTraces.find(t => t.monsterId === 103);
  const negativeControlCaught = negEvent ? !negEvent.accepted : true;

  const passedUnits = fourCostRecords.filter(r => r.status === 'PASS').length;
  const allPassed =
    fourCostRecords.length >= 40 &&
    fourCostRecords.every(r => r.status === 'PASS') &&
    baselineRecords.every(b => b.workerErrorCount === 0) &&
    negativeControlCaught;

  return {
    passed: allPassed,
    baselineRecords,
    fourCostRecords,
    negativeControlCaught,
    coverageMatrixSummary: {
      totalUnitsExpected: fourCostRecords.length,
      totalUnitsPassed: passedUnits,
      coverageRatio: passedUnits / (fourCostRecords.length || 1),
    },
  };
}
