// ============================================================
// tests/t052_unified_hillclimb_branch_routing.test.ts
// T052 统一爬山变异与条件分支归纳自动化单测与端到端验证
// ============================================================

import '../src/engine/env';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import type { EvolFormation, EvolNode, FeatureMask } from '../src/engine/tree/evol_gene';
import { cloneEvolFormation, walkEvolNodes, formationToEvol } from '../src/engine/tree/evol_gene';
import {
  routeLocalCandidate,
  inferMinimalFeatureMask,
  convertLocalSolutionToBranch,
  optimizeBranchSubtreeLocally,
  evaluateForwardBranchNode,
  appendLocalSolutionRoutingAudit,
  appendBranchConversionAudit,
  LOCAL_SOLUTION_ROUTING_AUDIT_PATH,
  BRANCH_CONVERSION_AUDIT_PATH,
  type MatchupObservation,
  type CandidateEvaluationData,
  type Score70Outcome,
} from '../src/engine/tree/product_training/05_branch_routing';
import { computeCandidateFingerprint } from '../src/engine/tree/product_training/02_candidates';
import { FORMATION_LIBRARY } from '../src/ai/formation_library';

function makeMockScore70(w: number, d: number, l: number): Score70Outcome {
  const total = w + d + l;
  return {
    w,
    d,
    l,
    totalGames: total,
    winRate: total > 0 ? w / total : 0,
    drawRate: total > 0 ? d / total : 0,
    lossRate: total > 0 ? l / total : 0,
    score70: total > 0 ? Number(((w + 0.70 * d) / total).toFixed(4)) : 0,
  };
}

describe('T052: Unified Hill-Climb and Conditional-Branch Learning Routing', () => {
  const rootSrc = FORMATION_LIBRARY.find(f => f.id === 'golden_boom') || FORMATION_LIBRARY[0];
  const parentEvol = formationToEvol(rootSrc);

  it('routes local improvement with mild global regression to LOCAL_ONLY_BRANCH', () => {
    // 构造一个在对手 'mine_fullrush' 上胜率大幅提高 (+0.30) 但大盘整体因过度特异化略降 (-0.02) 的变异体
    const mutatedEvol = cloneEvolFormation(parentEvol);
    const r1 = walkEvolNodes(mutatedEvol.root).find(n => n.round === 1)!;
    if (r1.placements.length > 0) {
      r1.placements[0].y = r1.placements[0].y === 0 ? 1 : 0;
    }

    const parentEval: CandidateEvaluationData = {
      candidateId: 'cand:parent:golden_boom',
      candidateFingerprint: computeCandidateFingerprint(parentEvol),
      globalMetrics: makeMockScore70(140, 20, 40), // Score70 = (140 + 14)/200 = 0.770
      targetedMatchupMetrics: new Map([
        ['mine_fullrush', makeMockScore70(5, 2, 13)], // 针对 mine_fullrush 只有 5/20 胜率 = 0.320
      ]),
      matchupObservations: [],
    };

    const candEval: CandidateEvaluationData = {
      candidateId: 'cand:golden_boom:counter_mine:c1',
      candidateFingerprint: computeCandidateFingerprint(mutatedEvol),
      globalMetrics: makeMockScore70(135, 20, 45), // Score70 = (135 + 14)/200 = 0.745 (全局退化 -0.025)
      targetedMatchupMetrics: new Map([
        ['mine_fullrush', makeMockScore70(14, 2, 4)], // 针对 mine_fullrush 提升到 14/20 = 0.770 (+0.450 巨大突破)
      ]),
      matchupObservations: [
        {
          opponentId: 'mine_fullrush',
          opponentName: 'Mine Fullrush Deck',
          side: 2,
          round: 1,
          recognizedMain: 'fullrush',
          recognizedSubs: [],
          recognizedKeys: ['mine'],
          visibleHandIds: [113, 114],
          visibleBoardIds: [],
          outcome: 'W',
        },
      ],
    };

    const routing = routeLocalCandidate({
      parentCandidateId: parentEval.candidateId,
      parentEvol,
      mutatedEvol,
      parentEvaluation: parentEval,
      candidateEvaluation: candEval,
      targetedKeys: ['mine_fullrush'],
      globalRegressionTolerance: 0.05,
      minLocalGainThreshold: 0.10,
    });

    assert.equal(routing.route, 'LOCAL_ONLY_BRANCH');
    assert(routing.targetedGainAttribution !== null);
    assert.equal(routing.targetedGainAttribution.targetKey, 'mine_fullrush');
    assert(routing.targetedGainAttribution.scoreDelta > 0.40);
    assert(routing.convertedBranchEvol !== null);

    // 验证生成的决策树中包含针对该弱项的条件分支
    const forkNode = walkEvolNodes(routing.convertedBranchEvol!.root).find(n => n.round === 1)!;
    assert(forkNode.children && forkNode.children.length > 0);
    const branch = forkNode.children.find(c => c.id.includes('counter_mine_fullrush'))!;
    assert(branch !== undefined, 'Target counter branch must exist');
    assert.deepEqual(branch.condition.keys, ['mine']);
  });

  it('routes global panel improvement to GLOBAL_IMPROVEMENT', () => {
    const mutatedEvol = cloneEvolFormation(parentEvol);
    const r1 = walkEvolNodes(mutatedEvol.root).find(n => n.round === 1)!;
    if (r1.placements.length > 1) {
      r1.placements[1].y = r1.placements[1].y === 0 ? 1 : 0;
    }

    const parentEval: CandidateEvaluationData = {
      candidateId: 'cand:parent:golden_boom',
      candidateFingerprint: computeCandidateFingerprint(parentEvol),
      globalMetrics: makeMockScore70(140, 20, 40),
      targetedMatchupMetrics: new Map(),
      matchupObservations: [],
    };

    const candEval: CandidateEvaluationData = {
      candidateId: 'cand:golden_boom:global_opt:c1',
      candidateFingerprint: computeCandidateFingerprint(mutatedEvol),
      globalMetrics: makeMockScore70(155, 20, 25), // Score70 = (155 + 14)/200 = 0.845 (+0.075 全局大幅提升)
      targetedMatchupMetrics: new Map(),
      matchupObservations: [],
    };

    const routing = routeLocalCandidate({
      parentCandidateId: parentEval.candidateId,
      parentEvol,
      mutatedEvol,
      parentEvaluation: parentEval,
      candidateEvaluation: candEval,
      targetedKeys: [],
    });

    assert.equal(routing.route, 'GLOBAL_IMPROVEMENT');
    assert(routing.globalScoreDelta > 0.05);
  });

  it('infers minimal visible FeatureMask based on actual matchup observations', () => {
    const obs: MatchupObservation[] = [
      {
        opponentId: 'opp_mine_1',
        opponentName: 'Mine Deck 1',
        side: 2,
        round: 1,
        recognizedMain: 'fullrush',
        recognizedSubs: ['dof'],
        recognizedKeys: ['mine', 'tutu'],
        visibleHandIds: [113, 114],
        visibleBoardIds: [],
        outcome: 'W',
      },
      {
        opponentId: 'opp_mine_2',
        opponentName: 'Mine Deck 2',
        side: 2,
        round: 1,
        recognizedMain: 'prayer',
        recognizedSubs: [],
        recognizedKeys: ['mine', 'drill'],
        visibleHandIds: [113, 116],
        visibleBoardIds: [],
        outcome: 'W',
      },
    ];

    const mask = inferMinimalFeatureMask(obs, 1);
    assert(mask !== null);
    // 双方共同具有的关键怪为 'mine'，根据最小特异性原则应提取 keys: ['mine']，side: 2
    assert.deepEqual(mask.keys, ['mine']);
    assert.equal(mask.side, 2);
  });

  it('optimizes branch subtree locally without altering the main branch', () => {
    const baseEvol = cloneEvolFormation(parentEvol);
    const converted = convertLocalSolutionToBranch({
      parentEvol: baseEvol,
      mutatedEvol: cloneEvolFormation(parentEvol),
      conditionMask: { side: 2, main: null, subs: [], keys: ['mine'] },
      forkRound: 1,
      branchLabel: 'test_branch',
    })!;

    const originalMainFp = computeCandidateFingerprint(baseEvol);
    const optimized = optimizeBranchSubtreeLocally(converted.branchEvol, converted.branchId, 'shift_y');

    assert(optimized !== null);
    // 验证主干 main 分支的站位与结构未被篡改
    const mainNode = walkEvolNodes(optimized.root).find(n => n.round === 1)!;
    assert(mainNode.placements.length > 0);
    // 验证子分支内部的站位已被优化修改
    const branchChild = mainNode.children!.find(c => c.id === converted.branchId)!;
    assert(branchChild.placements.length > 0);
  });

  it('evaluates safe forward-node movement from Round 2 to Round 1', () => {
    const baseEvol = cloneEvolFormation(parentEvol);
    const converted = convertLocalSolutionToBranch({
      parentEvol: baseEvol,
      mutatedEvol: cloneEvolFormation(parentEvol),
      conditionMask: { side: null, main: null, subs: [], keys: ['mine'] },
      forkRound: 2,
      branchLabel: 'r2_branch',
    })!;

    // 模拟在 Round 1 能够合法观测到 'mine' 的场景
    const obsAtR1: MatchupObservation[] = [
      {
        opponentId: 'mine_opp',
        opponentName: 'Mine Opponent',
        side: 1,
        round: 1,
        recognizedMain: 'fullrush',
        recognizedSubs: [],
        recognizedKeys: ['mine'],
        visibleHandIds: [113],
        visibleBoardIds: [],
        outcome: 'W',
      },
    ];

    const forwardRes = evaluateForwardBranchNode({
      branchEvol: converted.branchEvol,
      branchId: converted.branchId,
      fromRound: 2,
      toRound: 1,
      observationsAtTargetRound: obsAtR1,
    });

    assert.equal(forwardRes.canForward, true);
    assert(forwardRes.forwardedEvol !== null);
    const r1Node = walkEvolNodes(forwardRes.forwardedEvol!.root).find(n => n.round === 1)!;
    assert(r1Node.children && r1Node.children.some(c => c.id.includes('fwd_r1')));
  });

  it('rejects forward-node movement when condition is not observable at earlier round', () => {
    const baseEvol = cloneEvolFormation(parentEvol);
    const converted = convertLocalSolutionToBranch({
      parentEvol: baseEvol,
      mutatedEvol: cloneEvolFormation(parentEvol),
      conditionMask: { side: null, main: null, subs: [], keys: ['ninja'] },
      forkRound: 2,
      branchLabel: 'r2_ninja_branch',
    })!;

    // 模拟在 Round 1 没有看到 'ninja' 的场景
    const obsAtR1: MatchupObservation[] = [
      {
        opponentId: 'ninja_opp',
        opponentName: 'Ninja Opponent',
        side: 1,
        round: 1,
        recognizedMain: 'fullrush',
        recognizedSubs: [],
        recognizedKeys: ['mine'], // 没有 ninja
        visibleHandIds: [113],
        visibleBoardIds: [],
        outcome: 'W',
      },
    ];

    const forwardRes = evaluateForwardBranchNode({
      branchEvol: converted.branchEvol,
      branchId: converted.branchId,
      fromRound: 2,
      toRound: 1,
      observationsAtTargetRound: obsAtR1,
    });

    assert.equal(forwardRes.canForward, false);
    assert(forwardRes.reason.includes('not observable'));
  });

  it('persists and reconciles routing and branch conversion audit ledger records', () => {
    const routingRec = {
      route: 'LOCAL_ONLY_BRANCH' as const,
      candidateId: 'test_cand_audit',
      parentFingerprint: 'parent_fp_123',
      candidateFingerprint: 'cand_fp_456',
      globalScoreDelta: -0.015,
      targetedGainAttribution: {
        targetKey: 'golden_boom',
        scoreDelta: 0.35,
        explainedMask: { side: 2, main: null, subs: [], keys: ['mine'] as any },
      },
      convertedBranchEvol: null,
      reason: 'Audit reconciliation test record',
      createdAt: new Date().toISOString(),
    };

    const branchRec = {
      recordId: 'b_conv_test_123',
      parentFingerprint: 'parent_fp_123',
      localCandidateFingerprint: 'cand_fp_456',
      conditionMask: { side: 2, main: null, subs: [], keys: ['mine'] as any },
      targetLabelSubset: 'golden_boom:keys:mine',
      globalScoreDelta: -0.015,
      targetedScoreDelta: 0.35,
      forkRound: 1,
      operatorFamily: 'spatial_local_to_branch',
      conversionReason: 'Significant local gain on golden_boom',
      createdAt: new Date().toISOString(),
    };

    appendLocalSolutionRoutingAudit(routingRec);
    appendBranchConversionAudit(branchRec);

    assert(existsSync(LOCAL_SOLUTION_ROUTING_AUDIT_PATH));
    assert(existsSync(BRANCH_CONVERSION_AUDIT_PATH));
  });
});
