import * as path from 'node:path';
import { FormationSnapshotResolver, type ResolvedFormationSnapshot } from '../../snapshot_resolver';
import type { OptimizerConfig } from './config';
import { DEFAULT_OPTIMIZER_CONFIG } from './config';
import { AdverseCaseMiner, type AdverseCaseRecord } from './adverse_case_miner';
import { SolutionArchive, type ArchiveEntry } from './solution_archive';
import { EvolutionarySearch, type GenerationEvent, type CandidateRecord, type EvaluationRecord } from './evolutionary_search';
import { ForwardCompiler, type CompiledForwardCandidate } from './forward_compiler';
import { Validator, type ValidationRecord } from './validation';
import { Persistence } from './persistence';

export interface OptimizerCheckpoint {
  runId: string;
  config: OptimizerConfig;
  completedGenerationsByCase: Record<string, number>;
  completedFingerprintsByCase: Record<string, string[]>;
  phaseCursor: 'baseline' | 'search' | 'compile' | 'validate' | 'complete';
  summary?: any;
}

export interface OptimizerRunReport {
  runId: string;
  config: OptimizerConfig;
  baselineCases: AdverseCaseRecord[];
  generationEvents: GenerationEvent[];
  archiveEntries: ArchiveEntry[];
  forwardCandidates: CompiledForwardCandidate[];
  validationRecords: ValidationRecord[];
  activePilotBranches: CompiledForwardCandidate[];
  evaluatorCounters: {
    oneRoundCandidateEvaluations: number;
    fullMatchValidationEvaluations: number;
  };
  summary: {
    runId: string;
    totalCasesMined: number;
    totalUniqueEvaluations: number;
    archiveSize: number;
    nonDominatedSolutionsCount: number;
    representativesCount: number;
    activePilotBranchesCount: number;
  };
}

export class Generation2OptimizerProgram {
  public static async run(
    config: Partial<OptimizerConfig> = {},
    existingRunId?: string
  ): Promise<OptimizerRunReport> {
    const fullConfig: OptimizerConfig = { ...DEFAULT_OPTIMIZER_CONFIG, ...config };
    const runId = existingRunId ?? `RUN_${Date.now()}_seed${fullConfig.searchSeed}`;
    const outDir = fullConfig.outputDirectory ?? path.join(process.cwd(), 'reports', 'tree-cycle', 'generation2-optimizer', runId);

    Persistence.ensureDir(outDir);
    Persistence.writeJson(path.join(outDir, 'config.json'), fullConfig);

    const resolver = FormationSnapshotResolver.getInstance();
    resolver.init();

    const targetSnap = resolver.resolveFormationSnapshot({ formationId: fullConfig.targetFormationId });
    const oppSnaps = (fullConfig.opponentFormationIds ?? [
      't0:golden_boom',
      't0:all2prayer',
      't0:gift_jungle',
    ]).map(fid => resolver.resolveFormationSnapshot({ formationId: fid }));

    // 检查是否存在历史 Checkpoint
    const checkpointPath = path.join(outDir, 'checkpoint.json');
    const existingCheckpoint = Persistence.readJson<OptimizerCheckpoint>(checkpointPath);

    // 1. Adverse Case Mining
    const { selectedCases: adverseCases, diagnostics } = AdverseCaseMiner.mineAdverseCases(targetSnap, oppSnaps, fullConfig);

    // Manifest
    Persistence.writeJson(path.join(outDir, 'manifest.json'), {
      runId,
      targetFormationId: fullConfig.targetFormationId,
      searchSeed: fullConfig.searchSeed,
      maxGenerations: fullConfig.maxGenerations,
      populationSize: fullConfig.populationSize,
      uniqueCandidatesPerCase: fullConfig.uniqueCandidatesPerCase,
      totalCasesSelected: adverseCases.length,
    });

    // Baseline cases & diagnostics
    Persistence.writeJsonl(path.join(outDir, 'baseline_cases.jsonl'), adverseCases.map(c => ({
      caseId: c.caseId,
      opponentDisplayName: c.opponentDisplayName,
      targetSide: c.targetSide,
      seed: c.seed,
      round: c.round,
      baseStateFingerprint: c.baseState.stateFingerprint,
      roundWinner: c.baselineResult.roundWinner,
      deficit: c.deficit,
      parityPassed: c.parityPassed,
      parityFields: c.parityFields,
    })));

    Persistence.writeJsonl(path.join(outDir, 'diagnostics.jsonl'), diagnostics);

    // 2. Evolutionary Search & Solution Archive (支持断点与追加 Journal)
    const archive = new SolutionArchive();

    // 如果是 Resume，先从历史 archive.jsonl 恢复已有状态
    const archivePath = path.join(outDir, 'archive.jsonl');
    const existingArchiveEntries = Persistence.readJsonl<ArchiveEntry>(archivePath);
    for (const ent of existingArchiveEntries) {
      archive.addEntry(ent);
    }

    const candidatesPath = path.join(outDir, 'candidates.jsonl');
    const evaluationsPath = path.join(outDir, 'evaluations.jsonl');
    const generationsPath = path.join(outDir, 'generations.jsonl');

    const searchResult = EvolutionarySearch.runEvolutionarySearch(
      adverseCases,
      archive,
      fullConfig,
      existingCheckpoint
        ? {
            completedGenerationsByCase: existingCheckpoint.completedGenerationsByCase,
            completedFingerprintsByCase: existingCheckpoint.completedFingerprintsByCase,
          }
        : undefined,
      (c: CandidateRecord) => Persistence.appendJsonl(candidatesPath, [c]),
      (e: EvaluationRecord) => Persistence.appendJsonl(evaluationsPath, [e]),
      (g: GenerationEvent) => Persistence.appendJsonl(generationsPath, [g])
    );

    // 写入全量最新 archive
    Persistence.writeJsonl(archivePath, archive.getEntries());

    // 3. Forward Compilation
    const representatives = archive.getEntries().filter(e => e.isRepresentative);
    const forwardCandidates: CompiledForwardCandidate[] = [];

    if (fullConfig.allowForwardCompilation) {
      for (const rep of representatives) {
        const adverseCase = adverseCases.find(c => c.caseId === rep.caseId)!;
        const oppSnap = oppSnaps.find(o => o.displayName === adverseCase.opponentDisplayName)!;
        const comp = ForwardCompiler.compileRepresentative(rep, adverseCase, oppSnap);
        forwardCandidates.push(comp);
      }
    }

    // 4. Validation & Final Status Update
    const { validations, activeBranches, fullMatchEvaluationsCount } = Validator.runValidation(
      forwardCandidates,
      adverseCases,
      targetSnap,
      oppSnaps,
      fullConfig
    );

    // 写入最终状态的 forward_candidates.jsonl 与 validations.jsonl
    Persistence.writeJsonl(path.join(outDir, 'forward_candidates.jsonl'), forwardCandidates);
    Persistence.writeJsonl(path.join(outDir, 'validations.jsonl'), validations);

    const totalUniqueEvals = Object.values(searchResult.completedFingerprintsByCase).reduce(
      (sum, fps) => sum + Math.max(0, fps.length - 1),
      0
    );

    const summary = {
      runId,
      totalCasesMined: adverseCases.length,
      totalUniqueEvaluations: totalUniqueEvals,
      archiveSize: archive.getEntries().length,
      nonDominatedSolutionsCount: archive.getEntries().filter(e => !e.isDominated).length,
      representativesCount: representatives.length,
      activePilotBranchesCount: activeBranches.length,
    };

    Persistence.writeJson(path.join(outDir, 'summary.json'), summary);
    Persistence.writeJson(path.join(outDir, 'checkpoint.json'), {
      runId,
      config: fullConfig,
      completedGenerationsByCase: searchResult.completedGenerationsByCase,
      completedFingerprintsByCase: searchResult.completedFingerprintsByCase,
      phaseCursor: 'complete',
      summary,
    });

    return {
      runId,
      config: fullConfig,
      baselineCases: adverseCases,
      generationEvents: searchResult.events,
      archiveEntries: archive.getEntries(),
      forwardCandidates,
      validationRecords: validations,
      activePilotBranches: activeBranches,
      evaluatorCounters: {
        oneRoundCandidateEvaluations: searchResult.oneRoundEvaluationsCount,
        fullMatchValidationEvaluations: fullMatchEvaluationsCount,
      },
      summary,
    };
  }

  public static async resume(runId: string): Promise<OptimizerRunReport> {
    const runDir = path.join(process.cwd(), 'reports', 'tree-cycle', 'generation2-optimizer', runId);
    const checkpoint = Persistence.readJson<OptimizerCheckpoint>(path.join(runDir, 'checkpoint.json'));
    if (!checkpoint) {
      throw new Error(`Cannot find checkpoint for runId: ${runId}`);
    }
    // 强制不生成新 runId，并复用相同输出目录与已完成状态，同时解除 stopAfterGeneration 限制
    const resumedConfig = { ...checkpoint.config, outputDirectory: runDir };
    delete resumedConfig.stopAfterGeneration;
    return this.run(resumedConfig, checkpoint.runId);
  }
}
