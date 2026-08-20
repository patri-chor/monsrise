import { FormationSnapshotResolver, type ResolvedFormationSnapshot } from '../snapshot_resolver';
import {
  RoundBoardStateFactory,
  type RoundBoardEdit,
} from './round_board_state_factory';
import type { RoundBoardState } from './round_board_state';
import { SingleRoundEngine, type SingleRoundResult } from './single_round_engine';
import { EvidenceWriter } from './evidence_writer';
import { mulberry32, PRODUCT_ZONES } from '../../../play_full_game';
import { DB_MONSTERS } from '../../../../game/Database';

export interface SingleRoundOptimizationInput {
  targetFormationId?: string;
  opponentFormationIds?: string[];
  seedList?: number[];
  maxAdverseCases?: number;
  searchSeed?: number;
  budgets?: number[]; // default [16, 32]
  outPrefix?: string;
}

export interface BaselineCaseItem {
  caseId: string;
  targetFormationFingerprint: string;
  opponentFormationFingerprint: string;
  opponentDisplayName: string;
  targetSide: 1 | 2;
  seed: number;
  round: number;
  baseState: RoundBoardState;
  baselineResult: SingleRoundResult;
  deficit: number;
}

export interface LocalProposalRecord {
  caseId: string;
  proposalIndex: number;
  edits: RoundBoardEdit[];
  status: 'VALID' | 'INVALID' | 'DUPLICATE';
  invalidReason?: string;
  editedStateFingerprint?: string;
}

export interface LocalTrialRecord {
  caseId: string;
  trialIndex: number; // 1-based unique executed index
  editedStateFingerprint: string;
  edits: RoundBoardEdit[];
  result: SingleRoundResult;
  improvementClass: 'ROUND_WIN_IMPROVEMENT' | 'ROUND_DRAW_IMPROVEMENT' | 'HP_SURVIVOR_IMPROVEMENT' | 'NO_IMPROVEMENT';
  targetSurvivingHp: number;
  opponentSurvivingHp: number;
  observableDigest: string;
}

export interface BudgetComparisonRecord {
  caseId: string;
  budget16: {
    proposals: number;
    invalid: number;
    duplicate: number;
    uniqueExecuted: number;
    winImprovements: number;
    drawImprovements: number;
    hpImprovements: number;
    totalImprovements: number;
  };
  budget32: {
    proposals: number;
    invalid: number;
    duplicate: number;
    uniqueExecuted: number;
    winImprovements: number;
    drawImprovements: number;
    hpImprovements: number;
    totalImprovements: number;
  };
  newImprovementsIn17To32: number;
}

export interface LocalSolutionRecord {
  caseId: string;
  solutionId: string;
  editedStateFingerprint: string;
  edits: RoundBoardEdit[];
  improvementClass: string;
  roundWinner: 1 | 2 | 0;
  p1ScoreDelta: number;
  p2ScoreDelta: number;
  targetSurvivingHp: number;
  opponentSurvivingHp: number;
  isRepresentative: boolean;
  isDominated: boolean;
  forwardAssessment: {
    status: 'FORWARD_EXPRESSIBLE' | 'LOCAL_ONLY_NEEDS_EARLIER_CONTEXT' | 'LOCAL_ONLY_NOT_VISIBLE' | 'NOT_ASSESSED';
    continuationOutcome?: 'CONTINUATION_IMPROVES' | 'CONTINUATION_NEUTRAL' | 'CONTINUATION_REGRESSES' | 'NOT_RUN';
  };
}

export interface SingleRoundOptimizationReport {
  manifest: {
    targetFormationId: string;
    searchSeed: number;
    budgets: number[];
  };
  baselineCases: BaselineCaseItem[];
  proposals: LocalProposalRecord[];
  uniqueTrials: LocalTrialRecord[];
  budgetComparison: BudgetComparisonRecord[];
  localSolutions: LocalSolutionRecord[];
  summary: {
    totalCasesSelected: number;
    totalProposals: number;
    totalUniqueTrials: number;
    totalSolutionsFound: number;
    casesWithWinOrDrawImprovement: number;
  };
}

export class SingleRoundOptimizer {
  public static runAll2RushSingleRoundOptimization(
    input: SingleRoundOptimizationInput = {}
  ): SingleRoundOptimizationReport {
    const resolver = FormationSnapshotResolver.getInstance();
    resolver.init();

    const targetFid = input.targetFormationId ?? 't0:all2rush';
    const targetSnap = resolver.resolveFormationSnapshot({ formationId: targetFid });

    const oppFids = input.opponentFormationIds ?? [
      't0:golden_boom',
      't0:all2prayer',
      't0:gift_jungle',
    ];
    const oppSnaps = oppFids.map(fid => resolver.resolveFormationSnapshot({ formationId: fid }));

    const seeds = input.seedList ?? [1, 7, 42];
    const maxCases = input.maxAdverseCases ?? 6;
    const searchSeed = input.searchSeed ?? 115001;
    const budgets = input.budgets ?? [16, 32];
    const maxBudget = Math.max(...budgets);

    // 1. 采集并挖掘候选的不利局/回合 (Adverse Baseline Cases)
    const allAdverseCandidates: BaselineCaseItem[] = [];

    for (const oppSnap of oppSnaps) {
      for (const seed of seeds) {
        for (const side of [1, 2] as const) {
          const states = RoundBoardStateFactory.captureStatesFromBaselineMatch({
            targetSnap,
            opponentSnap: oppSnap,
            targetSide: side,
            seed,
          });

          for (const st of states) {
            const baseRes = SingleRoundEngine.runSingleRound(st);
            const targetWon = side === 1 ? baseRes.roundWinner === 1 : baseRes.roundWinner === 2;
            const isLoss = (side === 1 && baseRes.roundWinner === 2) || (side === 2 && baseRes.roundWinner === 1);
            const isDraw = baseRes.roundWinner === 0;

            if (isLoss || isDraw) {
              const targetScoreAfter = side === 1 ? baseRes.p1Score : baseRes.p2Score;
              const oppScoreAfter = side === 1 ? baseRes.p2Score : baseRes.p1Score;
              const deficit = oppScoreAfter - targetScoreAfter;

              allAdverseCandidates.push({
                caseId: `CASE_${targetSnap.displayName}_vs_${oppSnap.displayName}_s${side}_seed${seed}_r${st.targetRound}`,
                targetFormationFingerprint: targetSnap.canonicalFingerprint,
                opponentFormationFingerprint: oppSnap.canonicalFingerprint,
                opponentDisplayName: oppSnap.displayName,
                targetSide: side,
                seed,
                round: st.targetRound,
                baseState: st,
                baselineResult: baseRes,
                deficit,
              });
            }
          }
        }
      }
    }

    // 排序严重性：Loss > Draw -> Deficit 大优先 -> 早期 Round 优先
    allAdverseCandidates.sort((a, b) => {
      const aLoss = (a.targetSide === 1 && a.baselineResult.roundWinner === 2) || (a.targetSide === 2 && a.baselineResult.roundWinner === 1);
      const bLoss = (b.targetSide === 1 && b.baselineResult.roundWinner === 2) || (b.targetSide === 2 && b.baselineResult.roundWinner === 1);
      if (aLoss !== bLoss) return aLoss ? -1 : 1;
      if (b.deficit !== a.deficit) return b.deficit - a.deficit;
      return a.round - b.round;
    });

    const selectedCases = allAdverseCandidates.slice(0, maxCases);

    const allProposals: LocalProposalRecord[] = [];
    const allTrials: LocalTrialRecord[] = [];
    const allBudgetComparisons: BudgetComparisonRecord[] = [];
    const allLocalSolutions: LocalSolutionRecord[] = [];

    // 2. 针对每个选定的 Case 进行确定性伪随机流候选探索 (Candidate Generator)
    let caseIdx = 0;
    for (const c of selectedCases) {
      caseIdx++;
      const rng = mulberry32((searchSeed * 104729 + caseIdx * 7919 + c.round * 15485863) >>> 0);

      const zone = PRODUCT_ZONES[c.targetSide];
      const baseUnits = c.baseState.deployedUnits.filter(u => u.side === c.targetSide);
      const basePending = c.baseState.pendingActions.filter(a => a.side === c.targetSide);

      const seenFingerprints = new Set<string>();
      seenFingerprints.add(c.baseState.stateFingerprint);

      const caseTrials: LocalTrialRecord[] = [];
      let proposalCount = 0;
      let invalidCount = 0;
      let duplicateCount = 0;

      while (caseTrials.length < maxBudget && proposalCount < maxBudget * 15) {
        proposalCount++;
        const editTypeRand = rng();
        const edits: RoundBoardEdit[] = [];

        // 生成 1..3 个合法变更动作
        if (baseUnits.length > 0 && editTypeRand < 0.45) {
          // 1. 重定位已部署怪兽 (Reposition Deployed Unit)
          const targetUnit = baseUnits[Math.floor(rng() * baseUnits.length)];
          const newX = zone.min + Math.floor(rng() * (zone.max - zone.min + 1));
          const newY = Math.floor(rng() * 5);
          edits.push({
            type: 'REPOSITION_DEPLOYED_UNIT',
            instanceId: targetUnit.instanceId,
            newX,
            newY,
          });
        } else if (basePending.length > 0 && editTypeRand < 0.85) {
          // 2. 变更待定放置坐标 (Change Pending Placement)
          const act = basePending[Math.floor(rng() * basePending.length)];
          const newX = zone.min + Math.floor(rng() * (zone.max - zone.min + 1));
          const newY = Math.floor(rng() * 5);
          edits.push({
            type: 'CHANGE_PENDING_PLACEMENT',
            actionOrder: act.order,
            newX,
            newY,
          });
        } else if (basePending.length > 1) {
          // 3. 重排待定放置顺序 (Reorder Pending Actions)
          const orders = basePending.map(a => a.order);
          // 简单洗牌
          for (let i = orders.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [orders[i], orders[j]] = [orders[j], orders[i]];
          }
          edits.push({
            type: 'REORDER_PENDING_ACTIONS',
            newActionOrders: orders,
          });
        } else if (baseUnits.length > 0) {
          const targetUnit = baseUnits[Math.floor(rng() * baseUnits.length)];
          const newX = zone.min + Math.floor(rng() * (zone.max - zone.min + 1));
          const newY = Math.floor(rng() * 5);
          edits.push({
            type: 'REPOSITION_DEPLOYED_UNIT',
            instanceId: targetUnit.instanceId,
            newX,
            newY,
          });
        }

        if (edits.length === 0) {
          invalidCount++;
          allProposals.push({
            caseId: c.caseId,
            proposalIndex: proposalCount,
            edits,
            status: 'INVALID',
            invalidReason: 'no_legal_edit_generated',
          });
          continue;
        }

        // 克隆并校验
        const candidateState = RoundBoardStateFactory.cloneWithEdits(c.baseState, edits);
        const fp = candidateState.stateFingerprint;

        if (seenFingerprints.has(fp)) {
          duplicateCount++;
          allProposals.push({
            caseId: c.caseId,
            proposalIndex: proposalCount,
            edits,
            status: 'DUPLICATE',
            editedStateFingerprint: fp,
          });
          continue;
        }

        // 校验碰撞与坐标合法性
        const occupied = new Set<string>();
        let isInvalid = false;
        let invalidReason = '';

        for (const u of candidateState.deployedUnits) {
          const key = `${u.originalX},${u.originalY}`;
          if (occupied.has(key)) {
            isInvalid = true;
            invalidReason = 'collision_deployed_unit';
            break;
          }
          occupied.add(key);
        }

        if (isInvalid) {
          invalidCount++;
          allProposals.push({
            caseId: c.caseId,
            proposalIndex: proposalCount,
            edits,
            status: 'INVALID',
            invalidReason,
            editedStateFingerprint: fp,
          });
          continue;
        }

        seenFingerprints.add(fp);
        allProposals.push({
          caseId: c.caseId,
          proposalIndex: proposalCount,
          edits,
          status: 'VALID',
          editedStateFingerprint: fp,
        });

        // 执行单回合评估
        const res = SingleRoundEngine.runSingleRound(candidateState);
        const trialIdx = caseTrials.length + 1;

        const targetSurvHp = c.targetSide === 1 ? res.observableOutput.p1TotalHp : res.observableOutput.p2TotalHp;
        const oppSurvHp = c.targetSide === 1 ? res.observableOutput.p2TotalHp : res.observableOutput.p1TotalHp;

        const baseTargetSurvHp = c.targetSide === 1 ? c.baselineResult.observableOutput.p1TotalHp : c.baselineResult.observableOutput.p2TotalHp;
        const baseOppSurvHp = c.targetSide === 1 ? c.baselineResult.observableOutput.p2TotalHp : c.baselineResult.observableOutput.p1TotalHp;

        const targetWinsCand = (c.targetSide === 1 && res.roundWinner === 1) || (c.targetSide === 2 && res.roundWinner === 2);
        const targetDrawsCand = res.roundWinner === 0;

        const targetLostBase = (c.targetSide === 1 && c.baselineResult.roundWinner === 2) || (c.targetSide === 2 && c.baselineResult.roundWinner === 1);
        const targetDrewBase = c.baselineResult.roundWinner === 0;

        let impClass: LocalTrialRecord['improvementClass'] = 'NO_IMPROVEMENT';
        if (targetWinsCand && (targetLostBase || targetDrewBase)) {
          impClass = 'ROUND_WIN_IMPROVEMENT';
        } else if (targetDrawsCand && targetLostBase) {
          impClass = 'ROUND_DRAW_IMPROVEMENT';
        } else if (res.roundWinner === c.baselineResult.roundWinner && targetSurvHp > baseTargetSurvHp && oppSurvHp <= baseOppSurvHp) {
          impClass = 'HP_SURVIVOR_IMPROVEMENT';
        }

        const trialRec: LocalTrialRecord = {
          caseId: c.caseId,
          trialIndex: trialIdx,
          editedStateFingerprint: fp,
          edits,
          result: res,
          improvementClass: impClass,
          targetSurvivingHp: targetSurvHp,
          opponentSurvivingHp: oppSurvHp,
          observableDigest: res.observableOutput.observableDigest,
        };

        caseTrials.push(trialRec);
        allTrials.push(trialRec);
      }

      // 3. 统计 16 vs 32 对比
      const t16 = caseTrials.slice(0, 16);
      const t32 = caseTrials.slice(0, 32);

      const win16 = t16.filter(t => t.improvementClass === 'ROUND_WIN_IMPROVEMENT').length;
      const draw16 = t16.filter(t => t.improvementClass === 'ROUND_DRAW_IMPROVEMENT').length;
      const hp16 = t16.filter(t => t.improvementClass === 'HP_SURVIVOR_IMPROVEMENT').length;

      const win32 = t32.filter(t => t.improvementClass === 'ROUND_WIN_IMPROVEMENT').length;
      const draw32 = t32.filter(t => t.improvementClass === 'ROUND_DRAW_IMPROVEMENT').length;
      const hp32 = t32.filter(t => t.improvementClass === 'HP_SURVIVOR_IMPROVEMENT').length;

      const bComp: BudgetComparisonRecord = {
        caseId: c.caseId,
        budget16: {
          proposals: Math.min(proposalCount, 16 + duplicateCount + invalidCount),
          invalid: invalidCount,
          duplicate: duplicateCount,
          uniqueExecuted: t16.length,
          winImprovements: win16,
          drawImprovements: draw16,
          hpImprovements: hp16,
          totalImprovements: win16 + draw16 + hp16,
        },
        budget32: {
          proposals: proposalCount,
          invalid: invalidCount,
          duplicate: duplicateCount,
          uniqueExecuted: t32.length,
          winImprovements: win32,
          drawImprovements: draw32,
          hpImprovements: hp32,
          totalImprovements: win32 + draw32 + hp32,
        },
        newImprovementsIn17To32: Math.max(0, (win32 + draw32 + hp32) - (win16 + draw16 + hp16)),
      };
      allBudgetComparisons.push(bComp);

      // 4. 提取行为独特的本地解 (Behavior-Distinct Local Solutions)
      const improvedTrials = caseTrials.filter(t => t.improvementClass !== 'NO_IMPROVEMENT');
      const seenSolDigests = new Set<string>();
      const caseSolutions: LocalSolutionRecord[] = [];

      for (const t of improvedTrials) {
        if (seenSolDigests.has(t.observableDigest)) continue;
        seenSolDigests.add(t.observableDigest);

        const hasDeployedReposition = t.edits.some(e => e.type === 'REPOSITION_DEPLOYED_UNIT');

        caseSolutions.push({
          caseId: c.caseId,
          solutionId: `SOL_${c.caseId}_T${t.trialIndex}`,
          editedStateFingerprint: t.editedStateFingerprint,
          edits: t.edits,
          improvementClass: t.improvementClass,
          roundWinner: t.result.roundWinner,
          p1ScoreDelta: t.result.p1ScoreDelta,
          p2ScoreDelta: t.result.p2ScoreDelta,
          targetSurvivingHp: t.targetSurvivingHp,
          opponentSurvivingHp: t.opponentSurvivingHp,
          isRepresentative: false,
          isDominated: false,
          forwardAssessment: {
            status: hasDeployedReposition ? 'LOCAL_ONLY_NEEDS_EARLIER_CONTEXT' : 'FORWARD_EXPRESSIBLE',
            continuationOutcome: 'NOT_RUN',
          },
        });
      }

      // 排序并选出最佳代表解 (Representative Selection)
      if (caseSolutions.length > 0) {
        caseSolutions.sort((a, b) => {
          const rankScore = (sol: LocalSolutionRecord) =>
            sol.improvementClass === 'ROUND_WIN_IMPROVEMENT' ? 3000 : sol.improvementClass === 'ROUND_DRAW_IMPROVEMENT' ? 2000 : 1000;
          const rDiff = rankScore(b) - rankScore(a);
          if (rDiff !== 0) return rDiff;
          if (b.targetSurvivingHp !== a.targetSurvivingHp) return b.targetSurvivingHp - a.targetSurvivingHp;
          if (a.opponentSurvivingHp !== b.opponentSurvivingHp) return a.opponentSurvivingHp - b.opponentSurvivingHp;
          return a.edits.length - b.edits.length;
        });

        caseSolutions[0].isRepresentative = true;
      }

      allLocalSolutions.push(...caseSolutions);
    }

    // 5. 输出持久化证据 (EvidenceWriter)
    EvidenceWriter.writeJson('all2rush_g2_t115_manifest.json', {
      targetFormationId: targetSnap.formationId,
      targetCanonicalFingerprint: targetSnap.canonicalFingerprint,
      searchSeed,
      budgets,
      totalCasesSelected: selectedCases.length,
    });

    EvidenceWriter.writeJsonl('all2rush_g2_t115_baseline_cases.jsonl', selectedCases.map(c => ({
      caseId: c.caseId,
      targetFormationFingerprint: c.targetFormationFingerprint,
      opponentFormationFingerprint: c.opponentFormationFingerprint,
      opponentDisplayName: c.opponentDisplayName,
      targetSide: c.targetSide,
      seed: c.seed,
      round: c.round,
      baseStateFingerprint: c.baseState.stateFingerprint,
      roundWinner: c.baselineResult.roundWinner,
      p1Score: c.baselineResult.p1Score,
      p2Score: c.baselineResult.p2Score,
      observableDigest: c.baselineResult.observableOutput.observableDigest,
      deficit: c.deficit,
    })));

    EvidenceWriter.writeJsonl('all2rush_g2_t115_proposals.jsonl', allProposals);
    EvidenceWriter.writeJsonl('all2rush_g2_t115_unique_trials.jsonl', allTrials);
    EvidenceWriter.writeJsonl('all2rush_g2_t115_budget_comparison.jsonl', allBudgetComparisons);
    EvidenceWriter.writeJsonl('all2rush_g2_t115_local_solutions.jsonl', allLocalSolutions);
    EvidenceWriter.writeJsonl('all2rush_g2_t115_forward_assessment.jsonl', allLocalSolutions.map(s => ({
      solutionId: s.solutionId,
      caseId: s.caseId,
      editedStateFingerprint: s.editedStateFingerprint,
      isRepresentative: s.isRepresentative,
      forwardStatus: s.forwardAssessment.status,
      continuationOutcome: s.forwardAssessment.continuationOutcome,
    })));

    const report: SingleRoundOptimizationReport = {
      manifest: {
        targetFormationId: targetSnap.formationId,
        searchSeed,
        budgets,
      },
      baselineCases: selectedCases,
      proposals: allProposals,
      uniqueTrials: allTrials,
      budgetComparison: allBudgetComparisons,
      localSolutions: allLocalSolutions,
      summary: {
        totalCasesSelected: selectedCases.length,
        totalProposals: allProposals.length,
        totalUniqueTrials: allTrials.length,
        totalSolutionsFound: allLocalSolutions.length,
        casesWithWinOrDrawImprovement: allBudgetComparisons.filter(b => b.budget32.winImprovements > 0 || b.budget32.drawImprovements > 0).length,
      },
    };

    EvidenceWriter.writeJson('all2rush_g2_t115_summary.json', report.summary);

    return report;
  }
}
