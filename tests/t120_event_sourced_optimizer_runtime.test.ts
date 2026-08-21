import '../src/engine/env';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  runGeneration2Optimizer,
  resumeGeneration2Optimizer,
  OptimizerRuntime,
  Persistence,
  DEFAULT_OPTIMIZER_CONFIG,
} from '../src/engine/tree/product_training/generation2';

test('T120: Process-Level Event-Sourced Optimizer Runtime & Resume Audit', async () => {
  const baseConfig = {
    targetFormationId: 't0:all2rush',
    opponentFormationIds: ['t0:golden_boom', 't0:all2prayer', 't0:gift_jungle'],
    baselineSeeds: [1, 7, 42],
    validationSeeds: [1, 42],
    maxOpponents: 3,
    maxAdverseCasesPerOpponent: 2,
    populationSize: 8,
    uniqueCandidatesPerCase: 12,
    maxGenerations: 2,
    searchSeed: 120101,
    allowForwardCompilation: true,
  };

  // Run A: Uninterrupted Run
  const runA = await runGeneration2Optimizer(baseConfig);
  assert.strictEqual(runA.currentPhase, 'COMPLETE');

  // Run B: Interrupted at generation 1
  const runBConfig = { ...baseConfig, stopAfterGeneration: 1 };
  const runBInit = await runGeneration2Optimizer(runBConfig);
  assert.strictEqual(runBInit.currentPhase, 'SEARCH');

  const runBDir = path.join(process.cwd(), 'reports', 'tree-cycle', 'generation2-optimizer', runBInit.runId);
  const eventsBeforeResume = Persistence.readJsonl(path.join(runBDir, 'events.jsonl'));

  // Resume B: Run B resumed to completion
  const runBResumed = await resumeGeneration2Optimizer(runBInit.runId);
  assert.strictEqual(runBResumed.runId, runBInit.runId, 'Resume preserves immutable runId');
  assert.strictEqual(runBResumed.currentPhase, 'COMPLETE');

  const eventsAfterResume = Persistence.readJsonl(path.join(runBDir, 'events.jsonl'));
  assert.ok(eventsAfterResume.length > eventsBeforeResume.length, 'Events appended across resume');

  // Verify eventsBeforeResume is strict prefix of eventsAfterResume
  for (let i = 0; i < eventsBeforeResume.length; i++) {
    assert.strictEqual(eventsAfterResume[i].eventId, eventsBeforeResume[i].eventId);
  }

  // Verify Run B resumed matches Run A logically
  assert.strictEqual(runBResumed.summary.totalCasesMined, runA.summary.totalCasesMined);
  assert.strictEqual(runBResumed.summary.totalUniqueEvaluations, runA.summary.totalUniqueEvaluations);
  assert.strictEqual(runBResumed.summary.archiveSize, runA.summary.archiveSize);
  assert.strictEqual(runBResumed.summary.nonDominatedSolutionsCount, runA.summary.nonDominatedSolutionsCount);
  assert.strictEqual(runBResumed.summary.representativesCount, runA.summary.representativesCount);

  // Run C: Resume already-complete B run (idempotent 0-eval)
  const runC = await resumeGeneration2Optimizer(runBInit.runId);
  assert.strictEqual(runC.runId, runBInit.runId);
  assert.strictEqual(runC.summary.totalUniqueEvaluations, runBResumed.summary.totalUniqueEvaluations);

  const eventsAfterRunC = Persistence.readJsonl(path.join(runBDir, 'events.jsonl'));
  assert.strictEqual(eventsAfterRunC.length, eventsAfterResume.length, 'Complete resume adds 0 events');

  // Verify 12 artifacts exist in Run A
  const runADir = path.join(process.cwd(), 'reports', 'tree-cycle', 'generation2-optimizer', runA.runId);
  const requiredArtifacts = [
    'config.json',
    'manifest.json',
    'events.jsonl',
    'baseline_cases.jsonl',
    'candidates.jsonl',
    'evaluations.jsonl',
    'archive.jsonl',
    'generations.jsonl',
    'forward_candidates.jsonl',
    'validations.jsonl',
    'diagnostics.jsonl',
    'checkpoint.json',
    'summary.json',
  ];

  for (const f of requiredArtifacts) {
    assert.ok(fs.existsSync(path.join(runADir, f)), `Artifact ${f} must exist in ${runADir}`);
  }
});
