import * as path from 'node:path';
import { FormationSnapshotResolver, type ResolvedFormationSnapshot } from '../../snapshot_resolver';
import type { OptimizerConfig } from './config';
import { DEFAULT_OPTIMIZER_CONFIG } from './config';
import { AdverseCaseMiner, type AdverseCaseRecord } from './adverse_case_miner';
import { SolutionArchive, type ArchiveEntry } from './solution_archive';
import { EvolutionarySearch, type GenerationEvent } from './evolutionary_search';
import { ForwardCompiler, type CompiledForwardCandidate } from './forward_compiler';
import { Validator, type ValidationRecord } from './validation';
import { Persistence } from './persistence';

export interface OptimizerRunReport {
  runId: string;
  config: OptimizerConfig;
  baselineCases: AdverseCaseRecord[];
  generationEvents: GenerationEvent[];
  archiveEntries: ArchiveEntry[];
  forwardCandidates: CompiledForwardCandidate[];
  validationRecords: ValidationRecord[];
  activePilotBranches: CompiledForwardCandidate[];
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
    config: Partial<OptimizerConfig> = {}
  ): Promise<OptimizerRunReport> {
    const fullConfig: OptimizerConfig = { ...DEFAULT_OPTIMIZER_CONFIG, ...config };
    const runId = `RUN_${Date.now()}_seed${fullConfig.searchSeed}`;
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

    // 1. Adverse Case Mining
    const adverseCases = AdverseCaseMiner.mineAdverseCases(targetSnap, oppSnaps, fullConfig);
    Persistence.writeJsonl(path.join(outDir, 'baseline_cases.jsonl'), adverseCases.map(c => ({
      caseId: c.caseId,
      opponentDisplayName: c.opponentDisplayName,
      targetSide: c.targetSide,
      seed: c.seed,
      round: c.round,
      baseStateFingerprint: c.baseState.stateFingerprint,
      roundWinner: c.baselineResult.roundWinner,
      deficit: c.deficit,
    })));

    // 2. Evolutionary Search & Solution Archive
    const archive = new SolutionArchive();
    const { events, allEvaluatedFingerprints } = EvolutionarySearch.runEvolutionarySearch(adverseCases, archive, fullConfig);

    Persistence.writeJsonl(path.join(outDir, 'generations.jsonl'), events);
    Persistence.writeJsonl(path.join(outDir, 'archive.jsonl'), archive.getEntries());

    // 3. Forward Compilation & Validation
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

    Persistence.writeJsonl(path.join(outDir, 'forward_candidates.jsonl'), forwardCandidates);

    // 4. Validation
    const { validations, activeBranches } = Validator.runValidation(
      forwardCandidates,
      adverseCases,
      targetSnap,
      oppSnaps,
      fullConfig
    );

    Persistence.writeJsonl(path.join(outDir, 'validations.jsonl'), validations);

    const summary = {
      runId,
      totalCasesMined: adverseCases.length,
      totalUniqueEvaluations: allEvaluatedFingerprints.size,
      archiveSize: archive.getEntries().length,
      nonDominatedSolutionsCount: archive.getEntries().filter(e => !e.isDominated).length,
      representativesCount: representatives.length,
      activePilotBranchesCount: activeBranches.length,
    };

    Persistence.writeJson(path.join(outDir, 'summary.json'), summary);
    Persistence.writeJson(path.join(outDir, 'checkpoint.json'), {
      runId,
      completedGenerations: fullConfig.maxGenerations,
      allEvaluatedFingerprints: Array.from(allEvaluatedFingerprints),
      summary,
    });

    return {
      runId,
      config: fullConfig,
      baselineCases: adverseCases,
      generationEvents: events,
      archiveEntries: archive.getEntries(),
      forwardCandidates,
      validationRecords: validations,
      activePilotBranches: activeBranches,
      summary,
    };
  }

  public static async resume(runId: string): Promise<OptimizerRunReport> {
    const runDir = path.join(process.cwd(), 'reports', 'tree-cycle', 'generation2-optimizer', runId);
    const config = Persistence.readJson<OptimizerConfig>(path.join(runDir, 'config.json'));
    if (!config) {
      throw new Error(`Cannot find config for runId: ${runId}`);
    }
    return this.run({ ...config, outputDirectory: runDir });
  }
}
