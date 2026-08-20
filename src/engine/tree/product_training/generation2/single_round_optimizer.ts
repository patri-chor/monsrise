import { FormationSnapshotResolver, type ResolvedFormationSnapshot } from '../snapshot_resolver';
import {
  RoundBoardStateFactory,
  type RoundBoardEdit,
} from './round_board_state_factory';
import type { RoundBoardState } from './round_board_state';
import { SingleRoundEngine, type SingleRoundResult } from './single_round_engine';
import { EvidenceWriter } from './evidence_writer';
import { mulberry32, PRODUCT_ZONES, type DeploymentStrategy } from '../../../play_full_game';
import { ProductMatchRunner, type ObservableMatchResult } from './product_match_runner';
import { treeStrategyFor } from '../../product_tree_strategy';

export interface SingleRoundOptimizationInput {
  targetFormationId?: string;
  opponentFormationIds?: string[];
  seedList?: number[];
  maxAdverseCases?: number; // max total, e.g. 6 (at most 2 per opponent)
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
  drawEditCount: number;
  edits: RoundBoardEdit[];
  status: 'VALID' | 'INVALID' | 'DUPLICATE';
  invalidReason?: string;
  editedStateFingerprint?: string;
}

export interface LocalTrialRecord {
  caseId: string;
  trialIndex: number; // 1-based unique executed index
  editedStateFingerprint: string;
  editCount: number;
  edits: RoundBoardEdit[];
  result: SingleRoundResult;
  improvementClass: 'ROUND_WIN_IMPROVEMENT' | 'ROUND_DRAW_IMPROVEMENT' | 'HP_SURVIVOR_IMPROVEMENT' | 'NO_IMPROVEMENT';
  targetSurvivingHp: number;
  opponentSurvivingHp: number;
  targetSurvivingUnits: number;
  opponentSurvivingUnits: number;
  observableDigest: string;
}

export interface BudgetComparisonRecord {
  caseId: string;
  budget16: {
    proposals: number;
    invalid: number;
    duplicate: number;
    uniqueExecuted: number;
    oneEditTrials: number;
    twoEditTrials: number;
    threeEditTrials: number;
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
    oneEditTrials: number;
    twoEditTrials: number;
    threeEditTrials: number;
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
  observableDigest: string;
  edits: RoundBoardEdit[];
  editCount: number;
  improvementClass: string;
  roundWinner: 1 | 2 | 0;
  p1ScoreDelta: number;
  p2ScoreDelta: number;
  targetSurvivingHp: number;
  opponentSurvivingHp: number;
  targetSurvivingUnits: number;
  opponentSurvivingUnits: number;
  isRepresentative: boolean;
  representativeReason?: string;
  isDominated: boolean;
  dominatedBySolutionId: string | 'N/A';
  forwardAssessment: {
    status: 'FORWARD_EXPRESSIBLE' | 'LOCAL_ONLY_NEEDS_EARLIER_CONTEXT' | 'LOCAL_ONLY_NOT_VISIBLE' | 'NOT_ASSESSED';
    continuationOutcome?: 'CONTINUATION_IMPROVES' | 'CONTINUATION_NEUTRAL' | 'CONTINUATION_REGRESSES' | 'NOT_RUN';
  };
}

export interface RepresentativeContinuationRecord {
  caseId: string;
  solutionId: string;
  opponentDisplayName: string;
  seed: number;
  targetSide: 1 | 2;
  baselineWinner: 1 | 2 | 0;
  baselineScore: string;
  continuationWinner: 1 | 2 | 0;
  continuationScore: string;
  outcome: 'CONTINUATION_IMPROVES' | 'CONTINUATION_NEUTRAL' | 'CONTINUATION_REGRESSES' | 'NOT_RUN';
}

export interface SingleRoundOptimizationReport {
  manifest: {
    targetFormationId: string;
    searchSeed: number;
    budgets: number[];
    selectedOpponentsCount: number;
    casesPerOpponent: Record<string, number>;
  };
  baselineCases: BaselineCaseItem[];
  editCatalog: Array<{
    caseId: string;
    deployedUnitsAvailable: number;
    pendingActionsAvailable: number;
    supportsMultiEdit: boolean;
  }>;
  proposals: LocalProposalRecord[];
  uniqueTrials: LocalTrialRecord[];
  budgetComparison: BudgetComparisonRecord[];
  localSolutions: LocalSolutionRecord[];
  representativeContinuations: RepresentativeContinuationRecord[];
  summary: {
    totalCasesSelected: number;
    totalProposals: number;
    totalUniqueTrials: number;
    oneEditTotal: number;
    twoEditTotal: number;
    threeEditTotal: number;
    totalSolutionsFound: number;
    nonDominatedSolutionsCount: number;
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
    const searchSeed = input.searchSeed ?? 116001;
    const budgets = input.budgets ?? [16, 32];
    const maxBudget = Math.max(...budgets);

    // 1. Diverse Baseline Selection: 每对手最多挑 2 个最差 Case，合计至多 6 个 Case
    const selectedCases: BaselineCaseItem[] = [];
    const casesPerOpponent: Record<string, number> = {};

    for (const oppSnap of oppSnaps) {
      const oppCandidates: BaselineCaseItem[] = [];

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
            const isLoss = (side === 1 && baseRes.roundWinner === 2) || (side === 2 && baseRes.roundWinner === 1);
            const isDraw = baseRes.roundWinner === 0;

            if (isLoss || isDraw) {
              const targetScoreAfter = side === 1 ? baseRes.p1Score : baseRes.p2Score;
              const oppScoreAfter = side === 1 ? baseRes.p2Score : baseRes.p1Score;
              const deficit = oppScoreAfter - targetScoreAfter;

              oppCandidates.push({
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

      // 对手内排序：Loss > Draw -> Deficit 降序 -> 早期 Round
      oppCandidates.sort((a, b) => {
        const aLoss = (a.targetSide === 1 && a.baselineResult.roundWinner === 2) || (a.targetSide === 2 && a.baselineResult.roundWinner === 1);
        const bLoss = (b.targetSide === 1 && b.baselineResult.roundWinner === 2) || (b.targetSide === 2 && b.baselineResult.roundWinner === 1);
        if (aLoss !== bLoss) return aLoss ? -1 : 1;
        if (b.deficit !== a.deficit) return b.deficit - a.deficit;
        return a.round - b.round;
      });

      const topCasesForOpp = oppCandidates.slice(0, 2);
      selectedCases.push(...topCasesForOpp);
      casesPerOpponent[oppSnap.displayName] = topCasesForOpp.length;
    }

    const editCatalog: SingleRoundOptimizationReport['editCatalog'] = [];
    const allProposals: LocalProposalRecord[] = [];
    const allTrials: LocalTrialRecord[] = [];
    const allBudgetComparisons: BudgetComparisonRecord[] = [];
    const allLocalSolutions: LocalSolutionRecord[] = [];
    const representativeContinuations: RepresentativeContinuationRecord[] = [];

    // 2. 针对每个选定的 Case 进行 Genuine 1..3-Edit 采样搜索
    let caseIdx = 0;
    for (const c of selectedCases) {
      caseIdx++;
      const rng = mulberry32((searchSeed * 104729 + caseIdx * 7919 + c.round * 15485863) >>> 0);

      const zone = PRODUCT_ZONES[c.targetSide];
      const baseUnits = c.baseState.deployedUnits.filter(u => u.side === c.targetSide);
      const basePending = c.baseState.pendingActions.filter(a => a.side === c.targetSide);

      const supportsMulti = (baseUnits.length + basePending.length) >= 2;
      editCatalog.push({
        caseId: c.caseId,
        deployedUnitsAvailable: baseUnits.length,
        pendingActionsAvailable: basePending.length,
        supportsMultiEdit: supportsMulti,
      });

      const seenFingerprints = new Set<string>();
      seenFingerprints.add(c.baseState.stateFingerprint);

      const caseTrials: LocalTrialRecord[] = [];
      let proposalCount = 0;
      let invalidCount = 0;
      let duplicateCount = 0;

      while (caseTrials.length < maxBudget && proposalCount < maxBudget * 20) {
        proposalCount++;

        // 抽取 1, 2 或 3 个兼容编辑
        const maxDesired = supportsMulti ? (baseUnits.length + basePending.length >= 3 ? 3 : 2) : 1;
        const desiredEditCount = 1 + Math.floor(rng() * maxDesired);

        const edits: RoundBoardEdit[] = [];
        const usedDeployedIds = new Set<string>();
        const usedActionOrders = new Set<number>();

        for (let eIdx = 0; eIdx < desiredEditCount; eIdx++) {
          const r = rng();
          if (baseUnits.length > 0 && r < 0.5) {
            const availUnits = baseUnits.filter(u => !usedDeployedIds.has(u.instanceId));
            if (availUnits.length > 0) {
              const u = availUnits[Math.floor(rng() * availUnits.length)];
              usedDeployedIds.add(u.instanceId);
              const newX = zone.min + Math.floor(rng() * (zone.max - zone.min + 1));
              const newY = Math.floor(rng() * 5);
              edits.push({
                type: 'REPOSITION_DEPLOYED_UNIT',
                instanceId: u.instanceId,
                newX,
                newY,
              });
            }
          } else if (basePending.length > 0) {
            const availPending = basePending.filter(a => !usedActionOrders.has(a.order));
            if (availPending.length > 0) {
              const a = availPending[Math.floor(rng() * availPending.length)];
              usedActionOrders.add(a.order);
              const newX = zone.min + Math.floor(rng() * (zone.max - zone.min + 1));
              const newY = Math.floor(rng() * 5);
              edits.push({
                type: 'CHANGE_PENDING_PLACEMENT',
                actionOrder: a.order,
                newX,
                newY,
              });
            }
          }
        }

        if (edits.length === 0) {
          invalidCount++;
          allProposals.push({
            caseId: c.caseId,
            proposalIndex: proposalCount,
            drawEditCount: desiredEditCount,
            edits,
            status: 'INVALID',
            invalidReason: 'no_legal_compatible_edit_available',
          });
          continue;
        }

        const candidateState = RoundBoardStateFactory.cloneWithEdits(c.baseState, edits);
        const fp = candidateState.stateFingerprint;

        if (seenFingerprints.has(fp)) {
          duplicateCount++;
          allProposals.push({
            caseId: c.caseId,
            proposalIndex: proposalCount,
            drawEditCount: desiredEditCount,
            edits,
            status: 'DUPLICATE',
            editedStateFingerprint: fp,
          });
          continue;
        }

        // 校验部署单位间是否有战前静态坐标重叠碰撞
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
            drawEditCount: desiredEditCount,
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
          drawEditCount: desiredEditCount,
          edits,
          status: 'VALID',
          editedStateFingerprint: fp,
        });

        // 权威执行单回合战斗
        const res = SingleRoundEngine.runSingleRound(candidateState);
        const trialIdx = caseTrials.length + 1;

        const targetSurvHp = c.targetSide === 1 ? res.observableOutput.p1TotalHp : res.observableOutput.p2TotalHp;
        const oppSurvHp = c.targetSide === 1 ? res.observableOutput.p2TotalHp : res.observableOutput.p1TotalHp;
        const targetSurvUnits = c.targetSide === 1 ? res.observableOutput.p1Survivors.length : res.observableOutput.p2Survivors.length;
        const oppSurvUnits = c.targetSide === 1 ? res.observableOutput.p2Survivors.length : res.observableOutput.p1Survivors.length;

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
          editCount: edits.length,
          edits,
          result: res,
          improvementClass: impClass,
          targetSurvivingHp: targetSurvHp,
          opponentSurvivingHp: oppSurvHp,
          targetSurvivingUnits: targetSurvUnits,
          opponentSurvivingUnits: oppSurvUnits,
          observableDigest: res.observableOutput.observableDigest,
        };

        caseTrials.push(trialRec);
        allTrials.push(trialRec);
      }

      // 3. 统计 16 vs 32 对比与 1/2/3-edit 分布
      const t16 = caseTrials.slice(0, 16);
      const t32 = caseTrials.slice(0, 32);

      const one16 = t16.filter(t => t.editCount === 1).length;
      const two16 = t16.filter(t => t.editCount === 2).length;
      const three16 = t16.filter(t => t.editCount === 3).length;

      const one32 = t32.filter(t => t.editCount === 1).length;
      const two32 = t32.filter(t => t.editCount === 2).length;
      const three32 = t32.filter(t => t.editCount === 3).length;

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
          oneEditTrials: one16,
          twoEditTrials: two16,
          threeEditTrials: three16,
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
          oneEditTrials: one32,
          twoEditTrials: two32,
          threeEditTrials: three32,
          winImprovements: win32,
          drawImprovements: draw32,
          hpImprovements: hp32,
          totalImprovements: win32 + draw32 + hp32,
        },
        newImprovementsIn17To32: Math.max(0, (win32 + draw32 + hp32) - (win16 + draw16 + hp16)),
      };
      allBudgetComparisons.push(bComp);

      // 4. 提取行为独特的本地解 (基于 editedStateFingerprint + observableDigest 联合唯一)
      const improvedTrials = caseTrials.filter(t => t.improvementClass !== 'NO_IMPROVEMENT');
      const seenSolKeys = new Set<string>();
      const caseSolutions: LocalSolutionRecord[] = [];

      for (const t of improvedTrials) {
        const solKey = `${t.editedStateFingerprint}_${t.observableDigest}`;
        if (seenSolKeys.has(solKey)) continue;
        seenSolKeys.add(solKey);

        const hasDeployedReposition = t.edits.some(e => e.type === 'REPOSITION_DEPLOYED_UNIT');

        caseSolutions.push({
          caseId: c.caseId,
          solutionId: `SOL_${c.caseId}_T${t.trialIndex}`,
          editedStateFingerprint: t.editedStateFingerprint,
          observableDigest: t.observableDigest,
          edits: t.edits,
          editCount: t.editCount,
          improvementClass: t.improvementClass,
          roundWinner: t.result.roundWinner,
          p1ScoreDelta: t.result.p1ScoreDelta,
          p2ScoreDelta: t.result.p2ScoreDelta,
          targetSurvivingHp: t.targetSurvivingHp,
          opponentSurvivingHp: t.opponentSurvivingHp,
          targetSurvivingUnits: t.targetSurvivingUnits,
          opponentSurvivingUnits: t.opponentSurvivingUnits,
          isRepresentative: false,
          isDominated: false,
          dominatedBySolutionId: 'N/A',
          forwardAssessment: {
            status: hasDeployedReposition ? 'LOCAL_ONLY_NEEDS_EARLIER_CONTEXT' : 'FORWARD_EXPRESSIBLE',
            continuationOutcome: 'NOT_RUN',
          },
        });
      }

      // 5. 严格 Pareto 支配性判定 (Pareto Dominance Calculation)
      const classRank = (cls: string) => (cls === 'ROUND_WIN_IMPROVEMENT' ? 3 : cls === 'ROUND_DRAW_IMPROVEMENT' ? 2 : 1);

      for (let i = 0; i < caseSolutions.length; i++) {
        for (let j = 0; j < caseSolutions.length; j++) {
          if (i === j) continue;
          const a = caseSolutions[i]; // 被检验者
          const b = caseSolutions[j]; // 潜在支配者

          const bRank = classRank(b.improvementClass);
          const aRank = classRank(a.improvementClass);

          const bTargetScore = c.targetSide === 1 ? b.p1ScoreDelta : b.p2ScoreDelta;
          const aTargetScore = c.targetSide === 1 ? a.p1ScoreDelta : a.p2ScoreDelta;

          const bNoWorse =
            bRank >= aRank &&
            bTargetScore >= aTargetScore &&
            b.targetSurvivingUnits >= a.targetSurvivingUnits &&
            b.targetSurvivingHp >= a.targetSurvivingHp &&
            b.opponentSurvivingUnits <= a.opponentSurvivingUnits &&
            b.opponentSurvivingHp <= a.opponentSurvivingHp;

          const bStrictlyBetter =
            bRank > aRank ||
            bTargetScore > aTargetScore ||
            b.targetSurvivingUnits > a.targetSurvivingUnits ||
            b.targetSurvivingHp > a.targetSurvivingHp ||
            b.opponentSurvivingUnits < a.opponentSurvivingUnits ||
            b.opponentSurvivingHp < a.opponentSurvivingHp;

          if (bNoWorse && bStrictlyBetter) {
            a.isDominated = true;
            a.dominatedBySolutionId = b.solutionId;
            break;
          }
        }
      }

      // 6. 选定 Pareto 非支配的最佳代表解 (Representative Selection)
      if (caseSolutions.length > 0) {
        const nonDominated = caseSolutions.filter(s => !s.isDominated);
        const candidatePool = nonDominated.length > 0 ? nonDominated : caseSolutions;

        candidatePool.sort((a, b) => {
          const rDiff = classRank(b.improvementClass) - classRank(a.improvementClass);
          if (rDiff !== 0) return rDiff;
          if (b.targetSurvivingHp !== a.targetSurvivingHp) return b.targetSurvivingHp - a.targetSurvivingHp;
          if (a.opponentSurvivingHp !== b.opponentSurvivingHp) return a.opponentSurvivingHp - b.opponentSurvivingHp;
          if (a.editCount !== b.editCount) return a.editCount - b.editCount;
          return a.solutionId.localeCompare(b.solutionId);
        });

        const rep = candidatePool[0];
        rep.isRepresentative = true;
        rep.representativeReason = `Highest Pareto rank (${rep.improvementClass}), max target HP (${rep.targetSurvivingHp}), min edits (${rep.editCount})`;

        // 7. 代表解全比赛连贯验证 (Representative Full-Match Check)
        if (rep.forwardAssessment.status === 'FORWARD_EXPRESSIBLE') {
          const oppSnap = oppSnaps.find(s => s.displayName === c.opponentDisplayName)!;
          const isP1 = c.targetSide === 1;

          // 正常基线完整比赛
          const baseMatch = ProductMatchRunner.runFullMatch({
            teamA: isP1 ? targetSnap.team : oppSnap.team,
            teamB: isP1 ? oppSnap.team : targetSnap.team,
            seed: c.seed,
            nameA: isP1 ? targetSnap.displayName : oppSnap.displayName,
            nameB: isP1 ? oppSnap.displayName : targetSnap.displayName,
            strategyA: treeStrategyFor(isP1 ? targetSnap.evol : oppSnap.evol),
            strategyB: treeStrategyFor(isP1 ? oppSnap.evol : targetSnap.evol),
          });

          // 构造合规代表动作修改的策略
          const customStrat: DeploymentStrategy = (ctx) => {
            const baseIntents = treeStrategyFor(targetSnap.evol)(ctx);
            if (ctx.round === c.round) {
              const editMap = new Map<number, { x: number; y: number }>();
              for (const e of rep.edits) {
                if (e.type === 'CHANGE_PENDING_PLACEMENT' && typeof e.actionOrder === 'number' && typeof e.newX === 'number' && typeof e.newY === 'number') {
                  const targetAct = c.baseState.pendingActions.find(a => a.order === e.actionOrder && a.side === c.targetSide);
                  if (targetAct) editMap.set(targetAct.monsterId, { x: e.newX, y: e.newY });
                }
              }
              return baseIntents.map(i => {
                if (editMap.has(i.monsterId)) {
                  const coords = editMap.get(i.monsterId)!;
                  return { ...i, plannedX: coords.x, plannedY: coords.y };
                }
                return i;
              });
            }
            return baseIntents;
          };

          const contMatch = ProductMatchRunner.runFullMatch({
            teamA: isP1 ? targetSnap.team : oppSnap.team,
            teamB: isP1 ? oppSnap.team : targetSnap.team,
            seed: c.seed,
            nameA: isP1 ? targetSnap.displayName : oppSnap.displayName,
            nameB: isP1 ? oppSnap.displayName : targetSnap.displayName,
            strategyA: isP1 ? customStrat : treeStrategyFor(oppSnap.evol),
            strategyB: isP1 ? treeStrategyFor(oppSnap.evol) : customStrat,
          });

          const baseTargetScore = isP1 ? baseMatch.p1Score : baseMatch.p2Score;
          const contTargetScore = isP1 ? contMatch.p1Score : contMatch.p2Score;

          let contOutcome: RepresentativeContinuationRecord['outcome'] = 'CONTINUATION_NEUTRAL';
          if (contTargetScore > baseTargetScore) {
            contOutcome = 'CONTINUATION_IMPROVES';
          } else if (contTargetScore < baseTargetScore) {
            contOutcome = 'CONTINUATION_REGRESSES';
          }

          rep.forwardAssessment.continuationOutcome = contOutcome;

          representativeContinuations.push({
            caseId: c.caseId,
            solutionId: rep.solutionId,
            opponentDisplayName: c.opponentDisplayName,
            seed: c.seed,
            targetSide: c.targetSide,
            baselineWinner: baseMatch.winner,
            baselineScore: `${baseMatch.p1Score}:${baseMatch.p2Score}`,
            continuationWinner: contMatch.winner,
            continuationScore: `${contMatch.p1Score}:${contMatch.p2Score}`,
            outcome: contOutcome,
          });
        }
      }

      allLocalSolutions.push(...caseSolutions);
    }

    // 8. 导出 T116 专属证据产物
    EvidenceWriter.writeJson('all2rush_g2_t116_manifest.json', {
      targetFormationId: targetSnap.formationId,
      targetCanonicalFingerprint: targetSnap.canonicalFingerprint,
      searchSeed,
      budgets,
      selectedOpponentsCount: oppSnaps.length,
      casesPerOpponent,
      totalCasesSelected: selectedCases.length,
    });

    EvidenceWriter.writeJsonl('all2rush_g2_t116_baseline_cases.jsonl', selectedCases.map(c => ({
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

    EvidenceWriter.writeJsonl('all2rush_g2_t116_edit_catalog.jsonl', editCatalog);
    EvidenceWriter.writeJsonl('all2rush_g2_t116_proposals.jsonl', allProposals);
    EvidenceWriter.writeJsonl('all2rush_g2_t116_unique_trials.jsonl', allTrials);
    EvidenceWriter.writeJsonl('all2rush_g2_t116_budget_comparison.jsonl', allBudgetComparisons);
    EvidenceWriter.writeJsonl('all2rush_g2_t116_local_solutions.jsonl', allLocalSolutions);
    EvidenceWriter.writeJsonl('all2rush_g2_t116_representative_continuations.jsonl', representativeContinuations);

    const report: SingleRoundOptimizationReport = {
      manifest: {
        targetFormationId: targetSnap.formationId,
        searchSeed,
        budgets,
        selectedOpponentsCount: oppSnaps.length,
        casesPerOpponent,
      },
      baselineCases: selectedCases,
      editCatalog,
      proposals: allProposals,
      uniqueTrials: allTrials,
      budgetComparison: allBudgetComparisons,
      localSolutions: allLocalSolutions,
      representativeContinuations,
      summary: {
        totalCasesSelected: selectedCases.length,
        totalProposals: allProposals.length,
        totalUniqueTrials: allTrials.length,
        oneEditTotal: allTrials.filter(t => t.editCount === 1).length,
        twoEditTotal: allTrials.filter(t => t.editCount === 2).length,
        threeEditTotal: allTrials.filter(t => t.editCount === 3).length,
        totalSolutionsFound: allLocalSolutions.length,
        nonDominatedSolutionsCount: allLocalSolutions.filter(s => !s.isDominated).length,
        casesWithWinOrDrawImprovement: allBudgetComparisons.filter(b => b.budget32.winImprovements > 0 || b.budget32.drawImprovements > 0).length,
      },
    };

    EvidenceWriter.writeJson('all2rush_g2_t116_summary.json', report.summary);

    return report;
  }
}
