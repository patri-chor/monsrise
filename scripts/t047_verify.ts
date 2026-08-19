import { readFileSync } from 'node:fs';

// 快速检测 learning_level_evaluations 中 score=1 的可疑来源
const lle = readFileSync(
  'tests/fixtures/tree/experience_library/product_path_t037/learning_level_evaluations.jsonl', 'utf8'
).trim().split('\n').filter(Boolean).map(l => JSON.parse(l));

// 同时载入 formation_tier_transitions 来看打分来源
const ftt = readFileSync(
  'tests/fixtures/tree/experience_library/product_path_t037/formation_tier_transitions.jsonl', 'utf8'
).trim().split('\n').filter(Boolean).map(l => JSON.parse(l));

// 按 formationId + learningLevel 建索引
const lleByKey: Record<string, any> = {};
for (const r of lle) {
  lleByKey[`${r.formationId}__${r.learningLevel}`] = r;
}

// 找出 formation_tier_transitions 中晋升 T1 的，核查其 L2 score
console.log('=== T2->T1 promotions and their L2 scores ===');
const t2tot1 = ftt.filter((r: any) => r.previousTier === 'T2' && r.newTier === 'T1');
console.log('Total T2->T1 transitions:', t2tot1.length);
for (const t of t2tot1.slice(0, 5) as any[]) {
  const l2key = `${t.formationId}__L2`;
  const l2eval = lleByKey[l2key];
  console.log(`  ${t.formationId}: triggeringScore=${t.triggeringScore} L2eval_score=${l2eval?.score} L2eval_totalGames=${l2eval?.totalGames}`);
}

// 核心问题：score=1 + totalGames>0 的记录，是否有对应的 screen_cells/benchmark_cell_results？
console.log('\n=== Checking if L2-perfect records have cell-level backing ===');
const bcr = readFileSync(
  'tests/fixtures/tree/experience_library/product_path_t037/benchmark_cell_results.jsonl', 'utf8'
).trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
const sc = readFileSync(
  'tests/fixtures/tree/experience_library/product_path_t037/screen_cells.jsonl', 'utf8'
).trim().split('\n').filter(Boolean).map(l => JSON.parse(l));

// screen_cells 是 L3（heldout），benchmark_cell_results 是 L3/L2
// 按 candidateId 汇总 benchmark_cell_results
const bcrByCand: Record<string, {w:number,d:number,l:number,pool:string}[]> = {};
for (const r of bcr as any[]) {
  if (!bcrByCand[r.candidateId]) bcrByCand[r.candidateId] = [];
  bcrByCand[r.candidateId].push({w:r.overallW,d:r.overallD??0,l:r.overallL,pool:r.poolName});
}

// 找 L2-perfect records
const l2Perfect = lle.filter((r: any) => r.learningLevel === 'L2' && r.score === 1);
console.log('L2-perfect records:', l2Perfect.length);
for (const r of l2Perfect.slice(0, 6) as any[]) {
  const bcrData = bcrByCand[r.formationId] ?? [];
  const l2Bcr = bcrData.filter(b => b.pool?.includes('STRONG') || b.pool?.includes('L2'));
  console.log(`  ${r.formationId}: totalGames=${r.totalGames} score=${r.score} BCR_backing=${l2Bcr.length > 0 ? JSON.stringify(l2Bcr) : 'NONE'}`);
}

// 现在看 T045R formation_strength_library 中 T1 的 l2Score
console.log('\n=== T1 formations in strength library with l2Score ===');
const lib = JSON.parse(readFileSync(
  'tests/fixtures/tree/experience_library/product_path_t037/formation_strength_library.json', 'utf8'
));
const t1Forms = (lib.formations as any[]).filter(f => f.currentTier === 'T1').slice(0, 8);
for (const f of t1Forms) {
  console.log(`  ${f.formationId}: l2Score=${f.l2Score} l3Score=${f.l3Score} l1Score=${f.l1Score} l2AttemptsCount=${f.l2AttemptsCount}`);
}
