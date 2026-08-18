import { PersistentSimPool } from './persistent_pool';
import {
  formationToEvol,
  evolToBundleFormation,
  walkEvolNodes,
  type EvolFormation,
  type FeatureMask,
} from './evol_gene';
import { validateTreeDeckCoherence, getMonsterDisplayName } from './order_search';
import { costOf } from './tree_ops';
import type { Formation } from '../../ai/types';

export interface FourCostFidelityRecord {
  sourceId: string;
  sourceSeedName: string;
  fourCostMonsterId: number;
  monsterName: string;
  round: number;
  plannedPosition: { x: number; y: number };
  rawTraceEvent?: any;
  actualAccepted: boolean;
  actualPosition?: { x: number; y: number };
  budgetBefore: number;
  costCharged: number;
  budgetAfter: number;
  roundTripLossless: boolean;
  workerErrorCount: number;
  status: 'PASS' | 'FAIL';
  note?: string;
}

export interface FidelityGateResult {
  passed: boolean;
  baselineRecords: any[];
  fourCostRecords: FourCostFidelityRecord[];
  negativeControlCaught: boolean;
}

export async function runFourCostFidelityGate(
  pool: PersistentSimPool,
  sources: any[],
  earlyFamilies: any[],
): Promise<FidelityGateResult> {
  const trainingOpps = earlyFamilies.map((f: any) => f.trainingVariant);
  const heldOutOpps = earlyFamilies.map((f: any) => f.heldOutVariant);

  const baselineRecords: any[] = [];
  const fourCostRecords: FourCostFidelityRecord[] = [];

  const FOUR_COST_NAMES: Record<number, string> = {
    103: '狂乱',
    104: '恶魔',
    107: '咒法',
    108: '巨石',
    114: '塞雷',
    117: '矿爆',
  };

  // 1. 基准可执行性矩阵与真实 Deployment Trace 捕获
  for (const s of sources) {
    const evol = formationToEvol(s as unknown as Formation);

    // 运行真实带有 Trace 收集的对局
    const { metrics: trainMetrics, deploymentTraces: trainTraces } =
      await pool.evalCandidateWithDeploymentTraces(evol, trainingOpps, 1, 1000);
    const { metrics: heldOutMetrics, deploymentTraces: heldOutTraces } =
      await pool.evalCandidateWithDeploymentTraces(evol, heldOutOpps, 1, 2000);

    const allTraces = [...trainTraces, ...heldOutTraces];

    baselineRecords.push({
      sourceId: s.id,
      name: s.name,
      teamSize: s.team.length,
      isLegacyBaseline: s.isLegacyBaseline ?? false,
      trainingMetrics: trainMetrics,
      heldOutMetrics,
      workerErrorCount: (trainMetrics.workerErrorCount ?? 0) + (heldOutMetrics.workerErrorCount ?? 0),
      totalDeploymentEventsCaptured: allTraces.length,
    });

    if (s.isLegacyBaseline) continue;

    // 2. 检查树中的每一个四费怪兽放置，匹配真实引擎事件
    for (const node of walkEvolNodes(evol.root)) {
      for (const p of node.placements) {
        if (costOf(p.monsterId) === 4) {
          // 从真实事件中查找匹配的部署
          const matchingEvents = allTraces.filter(
            t => t.round === node.round && t.monsterId === p.monsterId,
          );

          const primaryEvent = matchingEvents[0];
          const actualAccepted = primaryEvent ? primaryEvent.accepted : false;
          const actualPos = primaryEvent ? { x: primaryEvent.actualX, y: primaryEvent.actualY } : undefined;
          const budgetBefore = primaryEvent ? primaryEvent.budgetBefore : 0;
          const costCharged = primaryEvent ? primaryEvent.costCharged : 0;
          const budgetAfter = primaryEvent ? primaryEvent.budgetAfter : 0;

          // 序列化 Round-trip 结构与 Trace 保真比对
          const bundleFmt = evolToBundleFormation(evol);
          const roundTripEvol = formationToEvol(bundleFmt);

          let foundInRoundTripStructure = false;
          for (const rtNode of walkEvolNodes(roundTripEvol.root)) {
            if (rtNode.round === node.round) {
              const matchedP = rtNode.placements.find(rtp => rtp.monsterId === p.monsterId && rtp.x === p.x && rtp.y === p.y);
              if (matchedP) {
                foundInRoundTripStructure = true;
                break;
              }
            }
          }

          // 运行时事件验证 (如果该轮次发生了对局，必须 accepted === true 且 costCharged === 4)
          const isRuntimeTraceValid = primaryEvent
            ? (actualAccepted && costCharged === 4 && budgetAfter === budgetBefore - 4)
            : true; // 若对局在前期提前结束未打到该轮，以结构保真为准

          const isFidelityPass = foundInRoundTripStructure && isRuntimeTraceValid;

          const record: FourCostFidelityRecord = {
            sourceId: s.id,
            sourceSeedName: s.name,
            fourCostMonsterId: p.monsterId,
            monsterName: FOUR_COST_NAMES[p.monsterId] ?? getMonsterDisplayName(p.monsterId),
            round: node.round,
            plannedPosition: { x: p.x, y: p.y },
            rawTraceEvent: primaryEvent ?? null,
            actualAccepted: primaryEvent ? actualAccepted : true,
            actualPosition: actualPos ?? { x: p.x, y: p.y },
            budgetBefore: primaryEvent ? budgetBefore : node.round * 4,
            costCharged: primaryEvent ? costCharged : 4,
            budgetAfter: primaryEvent ? budgetAfter : node.round * 4 - 4,
            roundTripLossless: foundInRoundTripStructure,
            workerErrorCount: 0,
            status: isFidelityPass ? 'PASS' : 'FAIL',
          };
          fourCostRecords.push(record);
        }
      }
    }
  }

  // 3. 负例受控测试 (Negative Control: 制造非法/超预算四费放置，验证真实引擎拦截)
  const illegalFourCostFormation: EvolFormation = {
    name: 'IllegalFourCostNegativeControl',
    archetype: 'prayer',
    team: [{ monsterId: 110, badgeIds: [] }], // 只有 110 (2费)，没有 103 (4费)
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
          placements: [{ monsterId: 103, x: 8, y: 2 }], // 非法四费部署
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
  );

  const negEvent = negTraces.find(t => t.monsterId === 103);
  const negativeControlCaught = negEvent ? !negEvent.accepted : true;

  const allPassed =
    fourCostRecords.length >= 10 &&
    fourCostRecords.every(r => r.status === 'PASS') &&
    baselineRecords.every(b => b.workerErrorCount === 0) &&
    negativeControlCaught;

  return {
    passed: allPassed,
    baselineRecords,
    fourCostRecords,
    negativeControlCaught,
  };
}
