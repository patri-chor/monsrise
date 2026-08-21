import * as path from 'node:path';
import { FormationSnapshotResolver } from '../snapshot_resolver';
import type { TreeCycleConfig, TreeCycleReport } from './tree_types';
import { DEFAULT_TREE_CYCLE_CONFIG } from './tree_types';
import { TreeBenchmark } from './tree_benchmark';
import { TreeSearch } from './tree_search';
import { TreeDeck } from './tree_deck';
import { TreeLineage, type ExecutableBranch } from './tree_lineage';
import { TreeEvidence } from './tree_evidence';
import { TreeWorkerPool } from './tree_worker_pool';

export class TreeCycleOrchestrator {
  public static async runCycle(
    config: Partial<TreeCycleConfig> = {}
  ): Promise<TreeCycleReport> {
    const fullConfig: TreeCycleConfig = { ...DEFAULT_TREE_CYCLE_CONFIG, ...config };
    const runId = `CYCLE_RUN_${Date.now()}`;
    const outBaseDir = fullConfig.outputBaseDirectory ?? path.join(process.cwd(), 'reports', 'tree-cycle', runId);
    TreeEvidence.ensureDir(outBaseDir);

    TreeEvidence.writeJson(path.join(outBaseDir, 'config.json'), fullConfig);

    const resolver = FormationSnapshotResolver.getInstance();
    resolver.init();

    const targetSnap = fullConfig.targetSnapshot
      ? {
          formationId: fullConfig.targetSnapshot.formationId,
          displayName: fullConfig.targetSnapshot.displayName,
          canonicalFingerprint: fullConfig.targetSnapshot.canonicalFingerprint,
          team: fullConfig.targetSnapshot.team,
          evol: fullConfig.targetSnapshot.evol,
          provenance: 'cycle_target_snapshot_input',
          rootR0SourceId: fullConfig.targetSnapshot.rootSourceId,
        }
      : resolver.resolveFormationSnapshot({ formationId: fullConfig.targetFormationId });

    const oppSnaps = fullConfig.opponentSnapshots
      ? fullConfig.opponentSnapshots.map(s => ({
          formationId: s.formationId,
          displayName: s.displayName,
          canonicalFingerprint: s.canonicalFingerprint,
          team: s.team,
          evol: s.evol,
          provenance: 'cycle_opponent_snapshot_input',
          rootR0SourceId: s.rootSourceId,
        }))
      : fullConfig.opponentFormationIds.map(fid => resolver.resolveFormationSnapshot({ formationId: fid }));

    let workerPool: TreeWorkerPool | null = null;
    const isWorkerBackend = fullConfig.parallelBackend === 'worker_threads';
    if (isWorkerBackend) {
      workerPool = new TreeWorkerPool(fullConfig.workerCount, fullConfig.workerTimeoutMs);
      workerPool.init();
    }

    let currentPilotLibrary: ExecutableBranch[] = [];
    const iterationSummaries: any[] = [];
    let consecutiveNoImprovements = 0;
    let stopReason = 'MAX_ITERATIONS_REACHED';

    try {
      for (let iter = 1; iter <= fullConfig.maxIterations; iter++) {
        const iterDir = path.join(outBaseDir, `iteration-${String(iter).padStart(3, '0')}`);
        TreeEvidence.ensureDir(iterDir);

        const sSeed = fullConfig.searchSeeds[(iter - 1) % fullConfig.searchSeeds.length] ?? (125000 + iter);

        // A. 当前 Pilot 基线
        const currentTargetEvol = TreeLineage.attachExecutableBranchesToEvol(targetSnap.evol, currentPilotLibrary);
        const currentTargetSnap = { ...targetSnap, evol: currentTargetEvol };

        // 1. 基线 Benchmark
        const { aggregate: baselineBenchmark } = TreeBenchmark.runPilotBenchmark(currentTargetSnap, oppSnaps, fullConfig);
        TreeEvidence.writeJson(path.join(iterDir, 'benchmark.json'), baselineBenchmark);

        // 2. 挖掘不利局
        const adverseCases = TreeBenchmark.mineAdverseCasesFromBenchmark(currentTargetSnap, oppSnaps, fullConfig);
        TreeEvidence.writeJsonl(path.join(iterDir, 'adverse_cases.jsonl'), adverseCases);

        if (adverseCases.length === 0) {
          stopReason = 'NO_ADVERSE_CASES_REMAINING';
          break;
        }

        // 3. 局部 S 搜索与代表解
        let trials: any[] = [];
        let representatives: any[] = [];
        let searchMetrics: any = null;

        if (isWorkerBackend && workerPool) {
          const sTasks = adverseCases.map((c, cIdx) => ({
            workId: `WORK_S_iter${iter}_case${c.caseId}`,
            type: 'S_SEARCH' as const,
            payload: {
              cases: [c],
              config: fullConfig,
              searchSeed: sSeed,
              caseIndexOffset: cIdx,
            },
          }));

          const sResults = await workerPool.executeTasksDeterministic(sTasks);
          for (const res of sResults) {
            if (!res.success) throw new Error(`Worker S_SEARCH failed: ${res.error}`);
            trials.push(...res.data.trials);
            representatives.push(...res.data.representatives);
          }

          searchMetrics = {
            totalProposals: trials.length * 2,
            totalInvalid: 0,
            totalDuplicate: 0,
            uniqueEvaluated: trials.length,
            wallTimeMs: sResults.reduce((s, r) => s + r.wallTimeMs, 0),
            cpuTimeUserMs: sResults.reduce((s, r) => s + r.cpuTimeUserMs, 0),
            cpuTimeSystemMs: sResults.reduce((s, r) => s + r.cpuTimeSystemMs, 0),
          };
        } else {
          const searchRes = TreeSearch.runLocalSearch(adverseCases, fullConfig, sSeed);
          trials = searchRes.trials;
          representatives = searchRes.representatives;
          searchMetrics = searchRes.metrics;
        }

        trials.sort((a, b) => a.candidateId.localeCompare(b.candidateId));
        representatives.sort((a, b) => a.candidateId.localeCompare(b.candidateId));

        TreeEvidence.writeJsonl(path.join(iterDir, 's_trials.jsonl'), trials);
        TreeEvidence.writeJsonl(path.join(iterDir, 'candidate_trials.jsonl'), trials);
        TreeEvidence.writeJsonl(path.join(iterDir, 'candidate_archive.jsonl'), representatives);

        const sLineages = TreeLineage.buildSLineages(representatives, targetSnap.canonicalFingerprint);

        // 3B. 判定 D+S 触发条件
        const shouldTriggerDS = baselineBenchmark.targetScore70Average < 0.70 && sLineages.length === 0;
        let dCatalog: any[] = [];
        let dsTrials: any[] = [];
        let dsLineages: any[] = [];

        if (shouldTriggerDS) {
          dCatalog = TreeDeck.generateDCatalog(targetSnap, sSeed);

          if (isWorkerBackend && workerPool) {
            const dsTasks = dCatalog.map((dRec, dIdx) => ({
              workId: `WORK_DS_iter${iter}_d${dRec.dId}`,
              type: 'DS_ATTEMPT' as const,
              payload: {
                dCatalog: [dRec],
                adverseCases,
                searchSeed: sSeed,
              },
            }));

            const dsResults = await workerPool.executeTasksDeterministic(dsTasks);
            for (const res of dsResults) {
              if (!res.success) throw new Error(`Worker DS_ATTEMPT failed: ${res.error}`);
              dsTrials.push(...res.data.dsTrials);
              dsLineages.push(...res.data.retainedLineages);
            }
          } else {
            const dsRes = await TreeDeck.executeDPlusSSearch(dCatalog, adverseCases, sSeed);
            dsTrials = dsRes.dsTrials;
            dsLineages = dsRes.retainedLineages;
          }
        }

        dCatalog.sort((a, b) => a.dId.localeCompare(b.dId));
        dsTrials.sort((a, b) => a.dsTrialId.localeCompare(b.dsTrialId));
        dsLineages.sort((a, b) => a.lineageId.localeCompare(b.lineageId));

        TreeEvidence.writeJsonl(path.join(iterDir, 'd_catalog.jsonl'), dCatalog);
        TreeEvidence.writeJsonl(path.join(iterDir, 'ds_trials.jsonl'), dsTrials);

        const combinedLineages = [...sLineages, ...dsLineages];
        TreeEvidence.writeJsonl(path.join(iterDir, 'local_lineages.jsonl'), combinedLineages);

        // 4. 前向编译与验证
        const forwardCandidates: any[] = [];
        for (const rep of representatives) {
          const baseCase = adverseCases.find(c => c.caseId === rep.caseId)!;
          const oppSnap = oppSnaps.find(o => o.displayName === baseCase.opponentDisplayName)!;
          forwardCandidates.push(TreeLineage.compileForwardCandidate(rep, baseCase, oppSnap));
        }

        const allPairedValidations = [];
        const allCandidateDecisions = [];
        const allStrategyTraces = [];
        let acceptedThisIter: ExecutableBranch[] = [];

        if (isWorkerBackend && workerPool) {
          const backpropTasks = forwardCandidates.map(cand => {
            const baseCase = adverseCases.find(c => c.caseId === cand.caseId)!;
            const oppSnap = oppSnaps.find(o => o.displayName === baseCase.opponentDisplayName)!;
            return {
              workId: `WORK_BP_iter${iter}_cand${cand.candidateId}`,
              type: 'BACKPROP_VALIDATION' as const,
              payload: {
                cand,
                baseCase,
                targetSnap,
                oppSnap,
                currentTargetEvol,
                config: fullConfig,
                iter,
              },
            };
          });

          const bpResults = await workerPool.executeTasksDeterministic(backpropTasks);
          for (const res of bpResults) {
            if (!res.success) throw new Error(`Worker BACKPROP_VALIDATION failed: ${res.error}`);
            const { decision, pairedValidations, strategyTraces } = res.data;
            allPairedValidations.push(...pairedValidations);
            allCandidateDecisions.push(decision);
            if (strategyTraces) allStrategyTraces.push(...strategyTraces);

            if (decision.decision === 'PILOT_ACCEPTED' && decision.branch) {
              acceptedThisIter.push(decision.branch);
            }
          }
        } else {
          for (const cand of forwardCandidates) {
            const baseCase = adverseCases.find(c => c.caseId === cand.caseId)!;
            const oppSnap = oppSnaps.find(o => o.displayName === baseCase.opponentDisplayName)!;

            const { decision, pairedValidations, strategyTraces } = TreeLineage.validateCandidateAgainstCurrentPilot(
              cand,
              baseCase,
              targetSnap,
              oppSnap,
              currentTargetEvol,
              fullConfig,
              iter
            );

            allPairedValidations.push(...pairedValidations);
            allCandidateDecisions.push(decision);
            if (strategyTraces) allStrategyTraces.push(...strategyTraces);

            if (decision.decision === 'PILOT_ACCEPTED' && decision.branch) {
              acceptedThisIter.push(decision.branch);
            }
          }
        }

        allPairedValidations.sort((a, b) => a.candidateId.localeCompare(b.candidateId) || a.seed - b.seed || a.targetSide - b.targetSide);
        allCandidateDecisions.sort((a, b) => a.candidateId.localeCompare(b.candidateId));

        if (acceptedThisIter.length > fullConfig.maxNewPilotBranchesPerIteration) {
          acceptedThisIter = acceptedThisIter.slice(0, fullConfig.maxNewPilotBranchesPerIteration);
        }

        TreeEvidence.writeJsonl(path.join(iterDir, 'strategy_traces.jsonl'), allStrategyTraces);
        TreeEvidence.writeJsonl(path.join(iterDir, 'paired_validations.jsonl'), allPairedValidations);
        TreeEvidence.writeJsonl(path.join(iterDir, 'backprop_validations.jsonl'), allPairedValidations);
        TreeEvidence.writeJsonl(path.join(iterDir, 'pilot_decisions.jsonl'), allCandidateDecisions);

        TreeEvidence.writeJson(path.join(iterDir, 'lineage_selection.json'), {
          iteration: iter,
          retainedLocalLineagesCount: combinedLineages.length,
          sLineagesCount: sLineages.length,
          dsLineagesCount: dsLineages.length,
          acceptedBranchesCount: acceptedThisIter.length,
          decisions: allCandidateDecisions,
        });

        // 5. 更新 Pilot 库并运行 Post-Benchmark
        const initialCount = currentPilotLibrary.length;
        currentPilotLibrary.push(...acceptedThisIter);

        const postEvol = TreeLineage.attachExecutableBranchesToEvol(targetSnap.evol, currentPilotLibrary);
        const { aggregate: postBenchmark } = TreeBenchmark.runPilotBenchmark({ ...targetSnap, evol: postEvol }, oppSnaps, fullConfig);

        const iterSum = {
          iterationNumber: iter,
          searchSeed: sSeed,
          initialPilotBranchesCount: initialCount,
          baselineScore70Average: baselineBenchmark.targetScore70Average,
          postDecisionScore70Average: postBenchmark.targetScore70Average,
          score70Delta: postBenchmark.targetScore70Average - baselineBenchmark.targetScore70Average,
          adverseCasesMined: adverseCases.length,
          uniqueCandidatesEvaluated: trials.length,
          forwardExpressibleCount: forwardCandidates.filter(c => c.isForwardExpressible).length,
          localOnlyCount: forwardCandidates.filter(c => !c.isForwardExpressible).length,
          acceptedPilotBranchesCount: acceptedThisIter.length,
          neutralPilotBranchesCount: allCandidateDecisions.filter(d => d.decision === 'PILOT_NEUTRAL').length,
          rejectedPilotBranchesCount: allCandidateDecisions.filter(d => d.decision === 'PILOT_REJECTED').length,
          newAcceptedBranches: acceptedThisIter,
          searchMetrics,
          dPlusSMetrics: {
            triggered: shouldTriggerDS,
            dCatalogSize: dCatalog.length,
            dsTrialsCount: dsTrials.length,
            retainedDSLineagesCount: dsLineages.length,
          },
          parallelMetrics: workerPool ? workerPool.getMetrics() : { backend: 'single' },
        };

        iterationSummaries.push(iterSum);

        if (acceptedThisIter.length === 0) {
          consecutiveNoImprovements++;
          if (consecutiveNoImprovements >= fullConfig.maxConsecutiveNoImprovementIterations) {
            stopReason = 'CONSECUTIVE_NO_IMPROVEMENTS';
            break;
          }
        } else {
          consecutiveNoImprovements = 0;
        }
      }
    } finally {
      if (workerPool) {
        await workerPool.terminate();
      }
    }

    const report: TreeCycleReport = {
      runId,
      config: fullConfig,
      totalIterationsExecuted: iterationSummaries.length,
      stopReason,
      pilotLibrary: currentPilotLibrary,
      iterations: iterationSummaries,
      summary: {
        runId,
        totalIterations: iterationSummaries.length,
        initialPilotBranchesCount: 0,
        finalPilotBranchesCount: currentPilotLibrary.length,
        totalAdverseCasesMined: iterationSummaries.reduce((s, it) => s + it.adverseCasesMined, 0),
        totalUniqueCandidatesEvaluated: iterationSummaries.reduce((s, it) => s + it.uniqueCandidatesEvaluated, 0),
        totalAcceptedBranches: iterationSummaries.reduce((s, it) => s + it.acceptedPilotBranchesCount, 0),
        totalRejectedBranches: iterationSummaries.reduce((s, it) => s + it.rejectedPilotBranchesCount, 0),
        stopReason,
      },
    };

    TreeEvidence.writeJson(path.join(outBaseDir, 'summary.json'), report);
    TreeEvidence.writeJson(path.join(outBaseDir, 'pilot_library.json'), currentPilotLibrary);
    TreeEvidence.writeJsonl(path.join(outBaseDir, 'iterations.jsonl'), iterationSummaries);

    return report;
  }
}
