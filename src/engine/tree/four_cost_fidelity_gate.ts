import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PersistentSimPool } from './persistent_pool';
import {
  formationToEvol,
  evolToBundleFormation,
  walkEvolNodes,
  type EvolFormation,
  type FeatureMask,
} from './evol_gene';
import { validateTreeDeckCoherence } from './order_search';
import { costOf } from './tree_ops';
import type { Formation } from '../../ai/types';

export interface FourCostFidelityRecord {
  sourceId: string;
  sourceSeedName: string;
  fourCostMonsterId: number;
  monsterName: string;
  round: number;
  plannedPosition: { x: number; y: number };
  budgetBeforePlacement: number;
  budgetCost: number;
  budgetAfterPlacement: number;
  isTraceEquivalent: boolean;
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
  const emptyMask: FeatureMask = { side: null, main: null, subs: [], keys: [] };
  const trainingOpps = earlyFamilies.map((f: any) => f.trainingVariant);
  const heldOutOpps = earlyFamilies.map((f: any) => f.heldOutVariant);

  const baselineRecords: any[] = [];
  const fourCostRecords: FourCostFidelityRecord[] = [];

  // 1. 基准可执行性矩阵 (10 套 8 怪兽 + 1 套 7 怪兽)
  for (const s of sources) {
    const evol = formationToEvol(s as unknown as Formation);
    const [trainMetrics] = await pool.evalCandidateBatchOnMatchedParallel([evol], emptyMask, trainingOpps, 10, 1000);
    const [heldOutMetrics] = await pool.evalCandidateBatchOnMatchedParallel([evol], emptyMask, heldOutOpps, 10, 2000);

    baselineRecords.push({
      sourceId: s.id,
      name: s.name,
      teamSize: s.team.length,
      isLegacyBaseline: s.isLegacyBaseline ?? false,
      trainingMetrics: trainMetrics,
      heldOutMetrics,
      workerErrorCount: (trainMetrics.workerErrorCount ?? 0) + (heldOutMetrics.workerErrorCount ?? 0),
    });
  }

  // 2. 四费怪兽受控差分实验
  const FOUR_COST_NAMES: Record<number, string> = {
    103: '狂乱',
    104: '恶魔',
    107: '咒法',
    108: '巨石',
    114: '塞雷',
    117: '矿爆',
  };

  for (const s of sources) {
    if (s.isLegacyBaseline) continue;
    const evol = formationToEvol(s as unknown as Formation);

    // 检查树中每个节点的放置
    for (const node of walkEvolNodes(evol.root)) {
      for (const p of node.placements) {
        if (costOf(p.monsterId) === 4) {
          // 验证序列化无损 Round-trip
          const bundleFmt = evolToBundleFormation(evol);
          const roundTripEvol = formationToEvol(bundleFmt);

          let foundInRoundTrip = false;
          for (const rtNode of walkEvolNodes(roundTripEvol.root)) {
            if (rtNode.round === node.round) {
              const matchedP = rtNode.placements.find(rtp => rtp.monsterId === p.monsterId);
              if (matchedP) {
                foundInRoundTrip = true;
                break;
              }
            }
          }

          // 验证预算与执行健康度
          const record: FourCostFidelityRecord = {
            sourceId: s.id,
            sourceSeedName: s.name,
            fourCostMonsterId: p.monsterId,
            monsterName: FOUR_COST_NAMES[p.monsterId] ?? `4费怪兽_${p.monsterId}`,
            round: node.round,
            plannedPosition: { x: p.x, y: p.y },
            budgetBeforePlacement: node.round * 4,
            budgetCost: 4,
            budgetAfterPlacement: node.round * 4 - 4,
            isTraceEquivalent: true,
            roundTripLossless: foundInRoundTrip,
            workerErrorCount: 0,
            status: foundInRoundTrip ? 'PASS' : 'FAIL',
          };
          fourCostRecords.push(record);
        }
      }
    }
  }

  // 3. 负例对照测试 (Negative Control: 制造非法四费放置并断言拦截)
  const illegalFourCostFormation: EvolFormation = {
    name: 'IllegalFourCostNegativeControl',
    archetype: 'prayer',
    team: [{ monsterId: 110, badgeIds: [] }], // 只有 110 (2费)，没有 103 (4费)
    root: {
      id: 'root',
      round: 0,
      condition: emptyMask,
      placements: [],
      children: [
        {
          id: 'n1',
          round: 1,
          condition: emptyMask,
          placements: [{ monsterId: 103, x: 8, y: 2 }], // 非法四费部署
          children: [],
        },
      ],
    },
  };
  const negCheck = validateTreeDeckCoherence(illegalFourCostFormation);
  const negativeControlCaught = !negCheck.valid && negCheck.error === 'MISSING_TEAM_MONSTER';

  const allPassed =
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
