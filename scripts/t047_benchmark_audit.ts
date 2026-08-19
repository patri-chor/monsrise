import { readFileSync, existsSync } from 'node:fs';

// === Part A: benchmark_cell_results - 完整审计 ===
console.log('=== benchmark_cell_results ===');
const bcr = readFileSync('tests/fixtures/tree/experience_library/product_path_t037/benchmark_cell_results.jsonl','utf8')
  .trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));
console.log('total:', bcr.length);
for (const r of bcr as any[]) {
  console.log(JSON.stringify(r).slice(0,400));
}

// === Part B: learning_level_evaluations - 对哪个benchmark revision做的 ===
console.log('\n=== learning_level_evaluations by benchmarkRevision ===');
const lle = readFileSync('tests/fixtures/tree/experience_library/product_path_t037/learning_level_evaluations.jsonl','utf8')
  .trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));
const byRev: Record<string,{total:number,perfect:number,minGames:number,maxGames:number}> = {};
for (const r of lle as any[]) {
  const rev = r.benchmarkRevision || 'UNKNOWN';
  byRev[rev] = byRev[rev] || {total:0,perfect:0,minGames:999,maxGames:0};
  byRev[rev].total++;
  byRev[rev].minGames = Math.min(byRev[rev].minGames, r.totalGames||0);
  byRev[rev].maxGames = Math.max(byRev[rev].maxGames, r.totalGames||0);
  if (r.score===1) byRev[rev].perfect++;
}
for (const [rev, s] of Object.entries(byRev)) {
  console.log('  '+rev+': total='+s.total+' perfect='+s.perfect+' games='+s.minGames+'-'+s.maxGames);
}

// === Part C: formation_strength_library ===
console.log('\n=== formation_strength_library.json ===');
const fsLibPaths = [
  'tests/fixtures/tree/experience_library/product_path_t037/formation_strength_library.json',
  'tests/fixtures/tree/experience_library/formation_strength_library.json',
  'src/engine/tree/product_training/formation_tiers.ts',
];
for (const p of fsLibPaths) {
  if (existsSync(p)) {
    const content = readFileSync(p,'utf8').slice(0,600);
    console.log('['+p+']:', content);
  } else {
    console.log('['+p+']: NOT FOUND');
  }
}

// === Part D: 检查 screen_cells 的 "same-family" 是否真的是利益冲突 ===
console.log('\n=== Same-family cells detail (first 5) ===');
const sc = readFileSync('tests/fixtures/tree/experience_library/product_path_t037/screen_cells.jsonl','utf8')
  .trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));
const sameFam = (sc as any[]).filter(r=>{
  const eid = (r.entityId||r.id||'').split(':')[1]||'';
  const oid = (r.opponentId||'').replace('_heldout','');
  return eid && oid && eid===oid;
});
for (const r of sameFam.slice(0,5) as any[]) {
  console.log('  entityId='+r.entityId+' opponentId='+r.opponentId+' side='+r.sourceSide+' W='+r.w+' D='+r.d+' L='+r.l);
}

// === Part E: T044/T045 formation_tier_transitions ===
console.log('\n=== formation_tier_transitions ===');
const ftt = readFileSync('tests/fixtures/tree/experience_library/product_path_t037/formation_tier_transitions.jsonl','utf8')
  .trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));
console.log('total:', ftt.length);
const perfectTrans = ftt.filter((r:any)=>r.currentScore===1||r.triggeringScore===1);
console.log('perfect-score transitions:', perfectTrans.length);
for (const r of (ftt as any[]).slice(0,3)) {
  console.log('  '+JSON.stringify(r).slice(0,300));
}
