// T047 data fix script - 修正 formation_strength_library.json 中 T0 的错误分数
// 修复：T0 l3Score 从 1.0 硬编码修正为 screen_observations 真实测量值
// 修复：T0 l2Score 从 screen_obs（L3 heldout 分数）修正为 null（T0 无独立 L2 评测）
// 不修改 append-only JSONL 文件，只修正可重新生成的 formation_strength_library.json

import { readFileSync, writeFileSync, renameSync } from 'node:fs';

const LIB_PATH = 'tests/fixtures/tree/experience_library/product_path_t037/formation_strength_library.json';
const SO_PATH = 'tests/fixtures/tree/experience_library/product_path_t037/screen_observations.jsonl';

// 从 screen_observations 获取 baseline L3 真实分数
const so = readFileSync(SO_PATH, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
const baselineL3Scores: Record<string, number> = {};
for (const r of so as any[]) {
  if (r.entityKind === 'baseline' && r.sourceId) {
    baselineL3Scores[r.sourceId] = r.trainingScore;
  }
}
console.log('Baseline L3 scores from screen_observations:', baselineL3Scores);

// 修正 formation_strength_library.json
const lib = JSON.parse(readFileSync(LIB_PATH, 'utf8'));
let fixedCount = 0;

for (const f of lib.formations as any[]) {
  if (f.currentTier !== 'T0') continue;
  const srcId = f.rootT0SourceId;
  const trueL3 = baselineL3Scores[srcId] ?? null;

  const oldL3 = f.l3Score;
  const oldL2 = f.l2Score;

  // 修复 l3Score：从硬编码 1.0 改为 screen_observations 真实值
  if (trueL3 !== null && f.l3Score !== trueL3) {
    f.l3Score = trueL3;
    fixedCount++;
    console.log(`Fixed l3Score for ${f.formationId}: ${oldL3} -> ${trueL3}`);
  }

  // 修复 l2Score：T0 没有独立 L2 评测，应为 null
  if (f.l2Score !== null) {
    f.l2Score = null;
    fixedCount++;
    console.log(`Fixed l2Score for ${f.formationId}: ${oldL2} -> null (T0 has no independent L2 evaluation)`);
  }

  // l1Score 已经是 null（正确）
  if (f.l1Score !== null) {
    f.l1Score = null;
    fixedCount++;
    console.log(`Fixed l1Score for ${f.formationId}: -> null`);
  }
}

console.log(`\nTotal fields fixed: ${fixedCount}`);

if (fixedCount > 0) {
  lib.updatedAt = new Date().toISOString();
  lib.auditNote = 'T047: Fixed T0 l3Score (hardcoded 1.0 -> true L3 screen_obs measurement), l2Score (L3-heldout value -> null, T0 has no independent L2 evaluation)';
  const tmp = LIB_PATH + '.tmp';
  writeFileSync(tmp, JSON.stringify(lib, null, 2), 'utf8');
  renameSync(tmp, LIB_PATH);
  console.log('Library updated successfully.');
} else {
  console.log('No fixes needed.');
}

// 验证修复后 T0 条目
console.log('\n=== Post-fix T0 entries ===');
const libAfter = JSON.parse(readFileSync(LIB_PATH, 'utf8'));
for (const f of libAfter.formations.filter((f:any)=>f.currentTier==='T0') as any[]) {
  console.log(`  ${f.formationId}: l3=${f.l3Score} l2=${f.l2Score} l1=${f.l1Score}`);
}
