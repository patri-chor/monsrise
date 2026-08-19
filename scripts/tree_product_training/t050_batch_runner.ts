// ============================================================
// scripts/tree_product_training/t050_batch_runner.ts
// Subprocess worker for evaluating a slice of targets
// ============================================================

import '../../src/engine/env';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runTargetEvaluation, type TargetTaskData, type TargetTaskResult } from './t050_worker';

const args = process.argv.slice(2);
const sliceFile = args[0];

if (!sliceFile) {
  console.error('Usage: npx tsx t050_batch_runner.ts <slice_json_path>');
  process.exit(1);
}

const tasks: TargetTaskData[] = JSON.parse(readFileSync(sliceFile, 'utf8'));
const results: TargetTaskResult[] = [];

for (const task of tasks) {
  const res = runTargetEvaluation(task);
  results.push(res);
}

const outFile = sliceFile.replace('.json', '.out.json');
writeFileSync(outFile, JSON.stringify(results), 'utf8');
