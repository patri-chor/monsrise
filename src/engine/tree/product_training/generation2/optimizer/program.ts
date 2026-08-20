import * as path from 'node:path';
import type { OptimizerConfig } from './config';
import { DEFAULT_OPTIMIZER_CONFIG } from './config';
import { OptimizerRuntime } from './runtime';
import type { DerivedRuntimeState } from './runtime_state';

export interface OptimizerRunReport {
  runId: string;
  config: OptimizerConfig;
  currentPhase: string;
  baselineCases: any[];
  generationEvents: any[];
  archiveEntries: any[];
  forwardCandidates: any[];
  validationRecords: any[];
  activePilotBranches: any[];
  evaluatorCounters: {
    baselineProductMatches: number;
    oneRoundCandidateEvaluations: number;
    fullMatchSourceValidationEvaluations: number;
    fullMatchBenchmarkValidationEvaluations: number;
  };
  summary?: any;
}

export class Generation2OptimizerProgram {
  public static async run(
    config: Partial<OptimizerConfig> = {},
    existingRunId?: string
  ): Promise<OptimizerRunReport> {
    const fullConfig: OptimizerConfig = { ...DEFAULT_OPTIMIZER_CONFIG, ...config };
    const runId = existingRunId ?? `RUN_${Date.now()}_seed${fullConfig.searchSeed}`;
    const outDir = fullConfig.outputDirectory ?? path.join(process.cwd(), 'reports', 'tree-cycle', 'generation2-optimizer', runId);

    const runtime = existingRunId
      ? OptimizerRuntime.loadExisting(outDir, fullConfig)
      : OptimizerRuntime.createNew(outDir, fullConfig, runId);

    // 如果已经是 COMPLETE 状态，直接幂等返回，0 新计算
    if (runtime.getState().currentPhase === 'COMPLETE') {
      return this.buildReport(runtime.getState());
    }

    const finalState = await runtime.advanceStateMachine();
    return this.buildReport(finalState);
  }

  public static async resume(runId: string): Promise<OptimizerRunReport> {
    const runDir = path.join(process.cwd(), 'reports', 'tree-cycle', 'generation2-optimizer', runId);
    const runtime = OptimizerRuntime.loadExisting(runDir, DEFAULT_OPTIMIZER_CONFIG);

    // 如果未完成，继续推进状态机
    if (runtime.getState().currentPhase !== 'COMPLETE') {
      const finalState = await runtime.advanceStateMachine();
      return this.buildReport(finalState);
    }

    // 幂等返回
    return this.buildReport(runtime.getState());
  }

  private static buildReport(state: DerivedRuntimeState): OptimizerRunReport {
    return {
      runId: state.runId,
      config: state.config,
      currentPhase: state.currentPhase,
      baselineCases: state.baselineCases,
      generationEvents: state.generations,
      archiveEntries: state.archiveEntries,
      forwardCandidates: state.forwardCandidates,
      validationRecords: state.validations,
      activePilotBranches: state.activePilotBranches,
      evaluatorCounters: state.evaluatorCounters,
      summary: state.summary,
    };
  }
}
