import * as path from 'node:path';
import { FormationSnapshotResolver, type ResolvedFormationSnapshot } from '../../snapshot_resolver';
import type { BulkOptimizerConfig } from './bulk_config';
import { DEFAULT_BULK_CONFIG } from './bulk_config';
import { AdverseCaseMiner, type AdverseCaseRecord } from './adverse_case_miner';
import { SolutionArchive, type ArchiveEntry } from './solution_archive';
import { EvolutionarySearch } from './evolutionary_search';
import { ForwardCompiler, type CompiledForwardCandidate } from './forward_compiler';
import { ProductMatchRunner, type ObservableMatchResult } from '../product_match_runner';
import { treeStrategyFor } from '../../../product_tree_strategy';
import { BranchLibrary } from '../branch_library';
import { Persistence } from './persistence';

export interface PairedValidationRecord {
  runId: string;
  candidateId: string;
  opponentDisplayName: string;
  targetSide: 1 | 2;
  seed: number;
  baselineWinner: 1 | 2 | 0;
  baselineScore: string;
  baselineScoreValue: number;
  candidateWinner: 1 | 2 | 0;
  candidateScore: string;
  candidateScoreValue: number;
  scoreDelta: number;
  branchSelected: boolean;
  classification: 'IMPROVES' | 'NEUTRAL' | 'REGRESSES' | 'NOT_SELECTED';
}

export interface BulkRunOutput {
  runId: string;
  searchSeed: number;
  baselineCases: AdverseCaseRecord[];
  archiveEntries: ArchiveEntry[];
  forwardCandidates: CompiledForwardCandidate[];
  pairedValidations: PairedValidationRecord[];
  summary: any;
}

export interface BulkOptimizerReport {
  config: BulkOptimizerConfig;
  runs: BulkRunOutput[];
  aggregate: {
    totalBaselineInstances: number;
    totalParityInstances: number;
    totalParityMismatches: number;
    totalOptimizerRuns: number;
    totalMinedAdverseCases: number;
    totalUniqueCandidatesEvaluated: number;
    improvementDistribution: {
      lossToWin: number;
      lossToDraw: number;
      drawToWin: number;
      hpSurvivorOnly: number;
      noImprovement: number;
    };
    forwardExpressibleCount: number;
    localOnlyCount: number;
    totalPairedValidations: number;
    pairedImprovements: number;
    pairedNeutrals: number;
    pairedRegressions: number;
    baselineAverageScore: number;
    candidateAverageScore: number;
    scoreDeltaAggregate: number;
    activePilotBranchesCount: number;
    rejectedBranchesCount: number;
  };
  byOpponent: Array<{
    opponentDisplayName: string;
    casesCount: number;
    pairedValidationCount: number;
    baselineAverageScore: number;
    candidateAverageScore: number;
    scoreDelta: number;
    improves: number;
    regresses: number;
  }>;
  bySide: Array<{
    side: 1 | 2;
    casesCount: number;
    pairedValidationCount: number;
    baselineAverageScore: number;
    candidateAverageScore: number;
    scoreDelta: number;
  }>;
}

export class BulkOptimizerRunner {
  public static async runBulkOptimization(
    config: Partial<BulkOptimizerConfig> = {}
  ): Promise<BulkOptimizerReport> {
    const fullConfig: BulkOptimizerConfig = { ...DEFAULT_BULK_CONFIG, ...config };
    const outBaseDir = fullConfig.outputBaseDirectory ?? path.join(process.cwd(), 'reports', 'tree-cycle', 'generation2-bulk');
    Persistence.ensureDir(outBaseDir);

    const resolver = FormationSnapshotResolver.getInstance();
    resolver.init();

    const targetSnap = resolver.resolveFormationSnapshot({ formationId: fullConfig.targetFormationId });
    const oppSnaps = fullConfig.opponentFormationIds.map(fid => resolver.resolveFormationSnapshot({ formationId: fid }));

    const runs: BulkRunOutput[] = [];
    const allPairedValidations: PairedValidationRecord[] = [];

    let totalParityInstances = 0;
    let totalParityMismatches = 0;
    let totalUniqueEvaluated = 0;

    const impDist = {
      lossToWin: 0,
      lossToDraw: 0,
      drawToWin: 0,
      hpSurvivorOnly: 0,
      noImprovement: 0,
    };

    // 独立运行多个 searchSeed 的优化流程
    for (const sSeed of fullConfig.searchSeeds) {
      const runId = `BULK_RUN_seed${sSeed}`;
      const runDir = path.join(outBaseDir, runId);
      Persistence.ensureDir(runDir);

      const runConfig = {
        targetFormationId: fullConfig.targetFormationId,
        opponentFormationIds: fullConfig.opponentFormationIds,
        baselineSeeds: fullConfig.baselineSeeds,
        validationSeeds: fullConfig.holdoutSeeds,
        maxOpponents: fullConfig.opponentFormationIds.length,
        maxAdverseCasesPerOpponent: fullConfig.maxAdverseCasesPerOpponent,
        populationSize: fullConfig.populationSize,
        uniqueCandidatesPerCase: fullConfig.uniqueCandidatesPerCase,
        maxGenerations: fullConfig.maxGenerations,
        searchSeed: sSeed,
        allowForwardCompilation: true,
        dryRun: false,
        outputDirectory: runDir,
      };

      Persistence.writeJson(path.join(runDir, 'config.json'), runConfig);

      // 1. Mine baseline adverse cases
      const { selectedCases: adverseCases, diagnostics } = AdverseCaseMiner.mineAdverseCases(targetSnap, oppSnaps, runConfig);
      for (const c of adverseCases) {
        totalParityInstances++;
        if (!c.parityPassed) totalParityMismatches++;
      }

      Persistence.writeJsonl(path.join(runDir, 'baseline_cases.jsonl'), adverseCases);

      // 2. Search candidates
      const archive = new SolutionArchive();
      const searchRes = EvolutionarySearch.runEvolutionarySearch(adverseCases, archive, runConfig);

      totalUniqueEvaluated += searchRes.allEvaluations.length;

      for (const ev of searchRes.allEvaluations) {
        const isLoss = (adverseCases.find(c => c.caseId === ev.caseId)?.targetSide === 1 && ev.roundWinner === 2) ||
          (adverseCases.find(c => c.caseId === ev.caseId)?.targetSide === 2 && ev.roundWinner === 1);
        const isWin = (adverseCases.find(c => c.caseId === ev.caseId)?.targetSide === 1 && ev.roundWinner === 1) ||
          (adverseCases.find(c => c.caseId === ev.caseId)?.targetSide === 2 && ev.roundWinner === 2);
        const isDraw = ev.roundWinner === 0;

        const baseCase = adverseCases.find(c => c.caseId === ev.caseId)!;
        const baseLoss = (baseCase.targetSide === 1 && baseCase.baselineResult.roundWinner === 2) || (baseCase.targetSide === 2 && baseCase.baselineResult.roundWinner === 1);
        const baseDraw = baseCase.baselineResult.roundWinner === 0;

        if (baseLoss && isWin) impDist.lossToWin++;
        else if (baseLoss && isDraw) impDist.lossToDraw++;
        else if (baseDraw && isWin) impDist.drawToWin++;
        else if (ev.targetSurvivingHp > (baseCase.targetSide === 1 ? baseCase.baselineResult.observableOutput.p1TotalHp : baseCase.baselineResult.observableOutput.p2TotalHp)) {
          impDist.hpSurvivorOnly++;
        } else {
          impDist.noImprovement++;
        }
      }

      Persistence.writeJsonl(path.join(runDir, 'local_trials.jsonl'), searchRes.allEvaluations);
      Persistence.writeJsonl(path.join(runDir, 'local_solutions.jsonl'), archive.getEntries());

      // 3. Compile forward representatives
      const representatives = archive.getEntries().filter(e => e.isRepresentative);
      const forwardCandidates: CompiledForwardCandidate[] = [];

      for (const rep of representatives) {
        const adverseCase = adverseCases.find(c => c.caseId === rep.caseId)!;
        const oppSnap = oppSnaps.find(o => o.displayName === adverseCase.opponentDisplayName)!;
        const comp = ForwardCompiler.compileRepresentative(rep, adverseCase, oppSnap);
        forwardCandidates.push(comp);
      }

      // 4. Paired Full-Match Holdout Validation
      const runPairedValidations: PairedValidationRecord[] = [];

      for (const cand of forwardCandidates) {
        if (!cand.isForwardExpressible || !cand.executableBranch) continue;

        const baseCase = adverseCases.find(c => c.caseId === cand.caseId)!;
        const srcOppSnap = oppSnaps.find(o => o.displayName === baseCase.opponentDisplayName)!;
        const branchedEvol = BranchLibrary.attachExecutableBranchesToEvol(targetSnap.evol, [cand.executableBranch]);

        let hasRegression = false;

        for (const hSeed of fullConfig.holdoutSeeds) {
          for (const sSide of fullConfig.sides) {
            const isP1 = sSide === 1;

            const baseRes = ProductMatchRunner.runFullMatch({
              teamA: isP1 ? targetSnap.team : srcOppSnap.team,
              teamB: isP1 ? srcOppSnap.team : targetSnap.team,
              seed: hSeed,
              nameA: isP1 ? targetSnap.displayName : srcOppSnap.displayName,
              nameB: isP1 ? srcOppSnap.displayName : targetSnap.displayName,
              strategyA: treeStrategyFor(isP1 ? targetSnap.evol : srcOppSnap.evol),
              strategyB: treeStrategyFor(isP1 ? srcOppSnap.evol : targetSnap.evol),
            });

            const candRes = ProductMatchRunner.runFullMatch({
              teamA: isP1 ? targetSnap.team : srcOppSnap.team,
              teamB: isP1 ? srcOppSnap.team : targetSnap.team,
              seed: hSeed,
              nameA: isP1 ? 'branched' : srcOppSnap.displayName,
              nameB: isP1 ? srcOppSnap.displayName : 'branched',
              strategyA: treeStrategyFor(isP1 ? branchedEvol : srcOppSnap.evol),
              strategyB: treeStrategyFor(isP1 ? srcOppSnap.evol : branchedEvol),
            });

            const bScoreVal = isP1 ? baseRes.p1Score : baseRes.p2Score;
            const cScoreVal = isP1 ? candRes.p1Score : candRes.p2Score;
            const delta = cScoreVal - bScoreVal;

            let classification: PairedValidationRecord['classification'] = 'NEUTRAL';
            if (delta > 0) classification = 'IMPROVES';
            else if (delta < 0) {
              classification = 'REGRESSES';
              hasRegression = true;
            }

            const rec: PairedValidationRecord = {
              runId,
              candidateId: cand.candidateId,
              opponentDisplayName: srcOppSnap.displayName,
              targetSide: sSide,
              seed: hSeed,
              baselineWinner: baseRes.winner,
              baselineScore: `${baseRes.p1Score}:${baseRes.p2Score}`,
              baselineScoreValue: bScoreVal,
              candidateWinner: candRes.winner,
              candidateScore: `${candRes.p1Score}:${candRes.p2Score}`,
              candidateScoreValue: cScoreVal,
              scoreDelta: delta,
              branchSelected: true,
              classification,
            };

            runPairedValidations.push(rec);
            allPairedValidations.push(rec);
          }
        }

        cand.classification = hasRegression ? 'FORWARD_REJECTED' : 'PILOT_ACTIVE';
      }

      Persistence.writeJsonl(path.join(runDir, 'paired_validations.jsonl'), runPairedValidations);

      const runSummary = {
        runId,
        adverseCasesCount: adverseCases.length,
        uniqueCandidatesEvaluated: searchRes.allEvaluations.length,
        representativesCount: representatives.length,
        forwardExpressibleCount: forwardCandidates.filter(c => c.isForwardExpressible).length,
        activePilotBranchesCount: forwardCandidates.filter(c => c.classification === 'PILOT_ACTIVE').length,
        rejectedBranchesCount: forwardCandidates.filter(c => c.classification === 'FORWARD_REJECTED').length,
      };
      Persistence.writeJson(path.join(runDir, 'summary.json'), runSummary);

      runs.push({
        runId,
        searchSeed: sSeed,
        baselineCases: adverseCases,
        archiveEntries: archive.getEntries(),
        forwardCandidates,
        pairedValidations: runPairedValidations,
        summary: runSummary,
      });
    }

    // 5. Aggregate metrics computation
    const totalPaired = allPairedValidations.length;
    const pairedImproves = allPairedValidations.filter(v => v.classification === 'IMPROVES').length;
    const pairedNeutrals = allPairedValidations.filter(v => v.classification === 'NEUTRAL').length;
    const pairedRegresses = allPairedValidations.filter(v => v.classification === 'REGRESSES').length;

    const baseScoreSum = allPairedValidations.reduce((sum, v) => sum + v.baselineScoreValue, 0);
    const candScoreSum = allPairedValidations.reduce((sum, v) => sum + v.candidateScoreValue, 0);

    const baseAvg = totalPaired > 0 ? baseScoreSum / totalPaired : 0;
    const candAvg = totalPaired > 0 ? candScoreSum / totalPaired : 0;

    const allForwardCands = runs.flatMap(r => r.forwardCandidates);
    const forwardExpCount = allForwardCands.filter(c => c.isForwardExpressible).length;
    const localOnlyCount = allForwardCands.filter(c => !c.isForwardExpressible).length;
    const activePilotCount = allForwardCands.filter(c => c.classification === 'PILOT_ACTIVE').length;
    const rejectedCount = allForwardCands.filter(c => c.classification === 'FORWARD_REJECTED').length;

    // By Opponent Aggregate
    const byOpponent = oppSnaps.map(opp => {
      const oppPairs = allPairedValidations.filter(v => v.opponentDisplayName === opp.displayName);
      const bSum = oppPairs.reduce((s, v) => s + v.baselineScoreValue, 0);
      const cSum = oppPairs.reduce((s, v) => s + v.candidateScoreValue, 0);
      const count = oppPairs.length;
      return {
        opponentDisplayName: opp.displayName,
        casesCount: runs.flatMap(r => r.baselineCases).filter(c => c.opponentDisplayName === opp.displayName).length,
        pairedValidationCount: count,
        baselineAverageScore: count > 0 ? bSum / count : 0,
        candidateAverageScore: count > 0 ? cSum / count : 0,
        scoreDelta: count > 0 ? (cSum - bSum) / count : 0,
        improves: oppPairs.filter(v => v.classification === 'IMPROVES').length,
        regresses: oppPairs.filter(v => v.classification === 'REGRESSES').length,
      };
    });

    // By Side Aggregate
    const bySide = ([1, 2] as const).map(s => {
      const sidePairs = allPairedValidations.filter(v => v.targetSide === s);
      const bSum = sidePairs.reduce((sum, v) => sum + v.baselineScoreValue, 0);
      const cSum = sidePairs.reduce((sum, v) => sum + v.candidateScoreValue, 0);
      const count = sidePairs.length;
      return {
        side: s,
        casesCount: runs.flatMap(r => r.baselineCases).filter(c => c.targetSide === s).length,
        pairedValidationCount: count,
        baselineAverageScore: count > 0 ? bSum / count : 0,
        candidateAverageScore: count > 0 ? cSum / count : 0,
        scoreDelta: count > 0 ? (cSum - bSum) / count : 0,
      };
    });

    const report: BulkOptimizerReport = {
      config: fullConfig,
      runs,
      aggregate: {
        totalBaselineInstances: fullConfig.baselineSeeds.length * fullConfig.sides.length * oppSnaps.length * fullConfig.searchSeeds.length,
        totalParityInstances,
        totalParityMismatches,
        totalOptimizerRuns: fullConfig.searchSeeds.length,
        totalMinedAdverseCases: runs.reduce((sum, r) => sum + r.baselineCases.length, 0),
        totalUniqueCandidatesEvaluated: totalUniqueEvaluated,
        improvementDistribution: impDist,
        forwardExpressibleCount: forwardExpCount,
        localOnlyCount,
        totalPairedValidations: totalPaired,
        pairedImprovements: pairedImproves,
        pairedNeutrals: pairedNeutrals,
        pairedRegressions: pairedRegresses,
        baselineAverageScore: baseAvg,
        candidateAverageScore: candAvg,
        scoreDeltaAggregate: candAvg - baseAvg,
        activePilotBranchesCount: activePilotCount,
        rejectedBranchesCount: rejectedCount,
      },
      byOpponent,
      bySide,
    };

    Persistence.writeJson(path.join(outBaseDir, 'all2rush_g2_t121_bulk_aggregate.json'), report.aggregate);
    Persistence.writeJsonl(path.join(outBaseDir, 'all2rush_g2_t121_bulk_by_opponent.jsonl'), byOpponent);
    Persistence.writeJsonl(path.join(outBaseDir, 'all2rush_g2_t121_bulk_by_side.jsonl'), bySide);

    return report;
  }
}
