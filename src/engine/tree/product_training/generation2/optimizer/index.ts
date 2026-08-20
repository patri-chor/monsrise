export * from './config';
export * from './objective';
export * from './adverse_case_miner';
export * from './candidate_space';
export * from './solution_archive';
export * from './evolutionary_search';
export * from './forward_compiler';
export * from './validation';
export * from './persistence';
export * from './program';
import { Generation2OptimizerProgram } from './program';

export const runGeneration2Optimizer = Generation2OptimizerProgram.run.bind(Generation2OptimizerProgram);
export const resumeGeneration2Optimizer = Generation2OptimizerProgram.resume.bind(Generation2OptimizerProgram);
