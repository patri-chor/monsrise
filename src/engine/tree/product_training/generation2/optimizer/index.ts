export * from './config';
export * from './bulk_config';
export * from './run_events';
export * from './runtime_state';
export * from './runtime';
export * from './objective';
export * from './adverse_case_miner';
export * from './candidate_space';
export * from './solution_archive';
export * from './evolutionary_search';
export * from './forward_compiler';
export * from './validation';
export * from './persistence';
export * from './program';
export * from './bulk_runner';

import { Generation2OptimizerProgram } from './program';
import { BulkOptimizerRunner } from './bulk_runner';

export const runGeneration2Optimizer = Generation2OptimizerProgram.run.bind(Generation2OptimizerProgram);
export const resumeGeneration2Optimizer = Generation2OptimizerProgram.resume.bind(Generation2OptimizerProgram);
export const runBulkOptimizerValidation = BulkOptimizerRunner.runBulkOptimization.bind(BulkOptimizerRunner);
