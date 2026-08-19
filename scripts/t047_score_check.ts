import { readFileSync } from 'node:fs';

// 取几个关键候选，检查 l3/l2/l1 是否真的相等，以及是否 screen_cells 里有 L3 数据对应
const lib = JSON.parse(readFileSync(
  'tests/fixtures/tree/experience_library/product_path_t037/formation_strength_library.json', 'utf8'
));

// 找出 l2Score !== l3Score 的候选
console.log('=== Candidates where l2Score differs from l3Score ===');
let sameCount = 0, diffCount = 0;
for (const f of lib.formations as any[]) {
  if (f.l2Score === null) continue;
  if (f.l2Score === f.l3Score) sameCount++;
  else {
    diffCount++;
    console.log(`  ${f.formationId}: l3=${f.l3Score?.toFixed(4)} l2=${f.l2Score?.toFixed(4)} l1=${f.l1Score?.toFixed(4)} tier=${f.currentTier}`);
  }
}
console.log(`Same l3==l2: ${sameCount}, Different: ${diffCount}`);

// 比较 learning_level_evaluations 中同一候选的 L3 vs L2 scores
const lle = readFileSync(
  'tests/fixtures/tree/experience_library/product_path_t037/learning_level_evaluations.jsonl', 'utf8'
).trim().split('\n').filter(Boolean).map(l => JSON.parse(l));

// 建索引
const lleByFidLevel: Record<string, number> = {};
for (const r of lle as any[]) {
  lleByFidLevel[`${r.formationId}__${r.learningLevel}`] = r.score;
}

console.log('\n=== LLE: L3 vs L2 vs L1 for same formation ===');
const formationIds = [...new Set((lle as any[]).map((r:any) => r.formationId))];
let lleAllSame = 0, lleDiff = 0;
for (const fid of formationIds) {
  const l3 = lleByFidLevel[`${fid}__L3`];
  const l2 = lleByFidLevel[`${fid}__L2`];
  const l1 = lleByFidLevel[`${fid}__L1`];
  if (l3 !== undefined && l2 !== undefined) {
    if (l3 === l2) lleAllSame++;
    else {
      lleDiff++;
      console.log(`  ${fid}: L3=${l3?.toFixed(4)} L2=${l2?.toFixed(4)} L1=${l1?.toFixed(4)}`);
    }
  }
}
console.log(`LLE same L3==L2: ${lleAllSame}, different: ${lleDiff}`);

// 验证对于 PANEL_SATURATED 来说 l3=l2=1 是否合理
console.log('\n=== L2 evalulation pool check: strong11 contains T0 formations ===');
// screen_cells 使用的是 heldout pool（L3）
// 看 benchmark_cell_results 的 pool
const bcr = readFileSync(
  'tests/fixtures/tree/experience_library/product_path_t037/benchmark_cell_results.jsonl','utf8'
).trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));
for (const r of bcr as any[]) {
  console.log(`  ${r.candidateId}: pool=${r.poolName} W=${r.overallW} D=${r.overallD??0} L=${r.overallL} score=${r.trainingScore}`);
}
console.log('BCR total:', bcr.length);
