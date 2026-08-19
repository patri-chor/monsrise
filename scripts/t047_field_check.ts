import { readFileSync } from 'node:fs';

// 修复候选写入代码的字段名问题：检查 run_cycle.ts 里 libraryEntries.push 用的字段
// 以及实际 JSON 里用的字段，确认是否有映射层

// 1. 确认候选 JSON 里 learningPermissions 是否等于 allowedLearningLevels
const lib = JSON.parse(readFileSync(
  'tests/fixtures/tree/experience_library/product_path_t037/formation_strength_library.json', 'utf8'
));
const t1forms = lib.formations.filter((f:any)=>f.currentTier==='T1');
console.log('T1 formation fields:', Object.keys(t1forms[0]));

// 2. 确认 l2Score === l3Score 的分布
let allSame=0, someNull=0, l2Higher=0, l2Lower=0;
for (const f of lib.formations as any[]) {
  if (f.l2Score === null) { someNull++; continue; }
  if (f.l2Score === f.l3Score) allSame++;
  else if (f.l2Score > f.l3Score) l2Higher++;
  else l2Lower++;
}
console.log('\nScore comparison (all formations):');
console.log('  l2Score===l3Score:', allSame);
console.log('  l2Score===null:', someNull);
console.log('  l2Score>l3Score:', l2Higher);
console.log('  l2Score<l3Score:', l2Lower);

// 3. 验证候选写入代码是否真的使用错误字段名
// 看 saveFormationStrengthLibrary 是否有字段映射
// 通过查看候选 entry 是否有 l1Status/allowedLearningLevels 字段
const hasWrongField = lib.formations.some((f:any)=>'l1Status' in f || 'allowedLearningLevels' in f);
console.log('\nHas legacy wrong field (l1Status/allowedLearningLevels):', hasWrongField);

// 4. 确认问题: T0 的 l2Score 是否真的来自 L3 数据
// screen_observations 的 baseline.springsword trainingScore
const so = readFileSync(
  'tests/fixtures/tree/experience_library/product_path_t037/screen_observations.jsonl','utf8'
).trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));
const baselineSo: Record<string,number> = {};
for (const r of so as any[]) {
  if (r.entityKind === 'baseline') baselineSo[r.sourceId||r.id?.replace('baseline:','')] = r.trainingScore;
}
console.log('\nBaseline scores from screen_observations (L3 heldout pool):');
for (const [id, score] of Object.entries(baselineSo)) {
  const t0 = lib.formations.find((f:any)=>f.formationId===`t0:${id}`);
  console.log(`  ${id}: screen_obs=${score?.toFixed(4)} library_l3=${t0?.l3Score?.toFixed(4)} library_l2=${t0?.l2Score?.toFixed(4)}`);
}
