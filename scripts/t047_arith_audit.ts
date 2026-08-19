import { readFileSync } from 'node:fs';

// === Part 1: learning_level_evaluations - 深度检查 ===
const lle = readFileSync('tests/fixtures/tree/experience_library/product_path_t037/learning_level_evaluations.jsonl','utf8')
  .trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));

console.log('=== Part 1: learning_level_evaluations deep check ===');
const perfectLle = lle.filter((r:any) => r.score===1);
console.log('total:', lle.length, 'score=1:', perfectLle.length);

// evidenceClass breakdown
const byClass: Record<string,{total:number,perfect:number}> = {};
for (const r of lle as any[]) {
  byClass[r.evidenceClass] = byClass[r.evidenceClass] || {total:0, perfect:0};
  byClass[r.evidenceClass].total++;
  if (r.score===1) byClass[r.evidenceClass].perfect++;
}
console.log('By evidenceClass:');
for (const [cls, s] of Object.entries(byClass)) console.log('  '+cls+': total='+s.total+' perfect='+s.perfect);

// totalGames for perfect records
const gameGroups: Record<number,number> = {};
for (const r of perfectLle as any[]) {
  const tg = r.totalGames ?? 0;
  gameGroups[tg] = (gameGroups[tg]||0)+1;
}
console.log('totalGames distribution in score=1 records:');
for (const [g,c] of Object.entries(gameGroups).sort((a,b)=>Number(a[0])-Number(b[0]))) {
  console.log('  totalGames='+g+': count='+c);
}

// === Part 2: screen_cells - 独立算术重算 ===
console.log('\n=== Part 2: screen_cells arithmetic recomputation ===');
const sc = readFileSync('tests/fixtures/tree/experience_library/product_path_t037/screen_cells.jsonl','utf8')
  .trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));

// aggregate by entityId
const aggById: Record<string,{w:number,d:number,l:number,cells:number,opps:Set<string>,sides:Set<number>}> = {};
for (const r of sc as any[]) {
  const id = r.entityId ?? r.id;
  if (!aggById[id]) aggById[id] = {w:0,d:0,l:0,cells:0,opps:new Set(),sides:new Set()};
  aggById[id].w += r.w||0;
  aggById[id].d += r.d||0;
  aggById[id].l += r.l||0;
  aggById[id].cells++;
  if (r.opponentId) aggById[id].opps.add(r.opponentId);
  if (r.sourceSide) aggById[id].sides.add(r.sourceSide);
}

// compare with screen_observations
const so = readFileSync('tests/fixtures/tree/experience_library/product_path_t037/screen_observations.jsonl','utf8')
  .trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));
const soById: Record<string,any> = {};
for (const r of so as any[]) soById[r.id] = r;

console.log('Entities with recomputed score=1 vs reported score:');
let arithMismatch = 0;
for (const [id, agg] of Object.entries(aggById)) {
  const total = agg.w + agg.d + agg.l;
  const computed = total > 0 ? (agg.w + 0.5*agg.d)/total : 0;
  const obs = soById[id];
  const reported = obs ? obs.score : 'NO_OBS';
  if (computed === 1 || reported === 1) {
    const mismatch = obs && Math.abs(computed - (obs.score||0)) > 0.001;
    if (mismatch) arithMismatch++;
    console.log('  '+id+': computed='+computed.toFixed(4)+' reported='+reported+' cells='+agg.cells+' opps='+agg.opps.size+' sides='+agg.sides.size+(mismatch?' !! MISMATCH':''));
  }
}
console.log('Arithmetic mismatches:', arithMismatch);

// === Part 3: 检查对手覆盖是否是同构（springsword vs springsword_heldout 类） ===
console.log('\n=== Part 3: opponent identity in screen_cells ===');
const oppIds = new Set((sc as any[]).map((r:any)=>r.opponentId));
console.log('Unique opponent IDs:', oppIds.size, [...oppIds].join(', '));
const selfOpp = (sc as any[]).filter((r:any)=>r.entityId===r.opponentId||r.id===r.opponentId);
console.log('Self-opponent cells:', selfOpp.length);
// check if entityId family === opponent family
const sameFam = (sc as any[]).filter((r:any)=>{
  const eid = (r.entityId||r.id||'').split(':')[1]||'';
  const oid = (r.opponentId||'').split('_')[0]||'';
  return eid && oid && eid===oid;
});
console.log('Same-family cells (entityId.root===opponentId.root):', sameFam.length);

// === Part 4: Historic 11x11 ===
console.log('\n=== Part 4: Historic round-robin matrix reference ===');
try {
  const rr = readFileSync('tests/fixtures/tree/experience_library/round_robin_optimization/head_to_head_matrix.jsonl','utf8')
    .trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));
  const perfRR = rr.filter((r:any)=>r.score===1||r.winRate===1);
  console.log('head_to_head_matrix total:', rr.length, 'perfect:', perfRR.length);
  if (rr.length > 0) console.log('keys:', Object.keys(rr[0]).join(', '));
  if (perfRR.length > 0) console.log('sample:', JSON.stringify(perfRR[0]).slice(0,300));
} catch(e:any) { console.log('ERROR:', e.message); }
