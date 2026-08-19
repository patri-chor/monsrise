import { readFileSync } from 'node:fs';

// 1. ZERO_GAMES records in learning_level_evaluations
const lle = readFileSync('tests/fixtures/tree/experience_library/product_path_t037/learning_level_evaluations.jsonl','utf8')
  .trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));

const zeroGames = lle.filter((r:any) => r.score===1 && (r.w===0||r.w===undefined) && (r.d===0||r.d===undefined) && (r.l===0||r.l===undefined));
console.log('=== learning_level_evaluations ===');
console.log('total:', lle.length, 'zero-games-perfect:', zeroGames.length);
if (zeroGames.length > 0) {
  console.log('keys:', Object.keys(zeroGames[0]).join(', '));
  console.log('sample[0]:', JSON.stringify(zeroGames[0]).slice(0,400));
  console.log('sample[1]:', JSON.stringify(zeroGames[1]).slice(0,400));
}

// 2. screen_cells - who has perfect cells
const sc = readFileSync('tests/fixtures/tree/experience_library/product_path_t037/screen_cells.jsonl','utf8')
  .trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));
const perfectCells = sc.filter((r:any) => r.score===1 || (r.w>0 && r.d===0 && r.l===0));
const byId: Record<string,number> = {};
for (const r of perfectCells as any[]) {
  const id = r.id ?? r.entityId ?? 'UNKNOWN';
  byId[id] = (byId[id]||0) + 1;
}
console.log('\n=== screen_cells ===');
console.log('total:', sc.length, 'perfect:', perfectCells.length);
const sorted = Object.entries(byId).sort((a,b)=>b[1]-a[1]);
for (const [id, cnt] of sorted.slice(0,15)) console.log('  '+id+':', cnt);
const gameCounts = (perfectCells as any[]).map((r:any)=>(r.w||0)+(r.d||0)+(r.l||0));
const distinct = [...new Set(gameCounts)].sort((a:any,b:any)=>a-b);
console.log('games per cell distinct:', distinct);

// 3. screen_observations opponent coverage
const so = readFileSync('tests/fixtures/tree/experience_library/product_path_t037/screen_observations.jsonl','utf8')
  .trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));
const perfectObs = so.filter((r:any) => r.score===1);
console.log('\n=== screen_observations ===');
console.log('total:', so.length, 'perfect:', perfectObs.length);
for (const r of perfectObs.slice(0,6) as any[]) {
  console.log('  id='+r.id+' W='+r.w+' D='+r.d+' L='+r.l+' games='+((r.w||0)+(r.d||0)+(r.l||0))+' opp='+r.opponentId+' side='+r.side);
}
const oppSet = new Set((perfectObs as any[]).map((r:any)=>r.opponentId||r.opponent||'?'));
console.log('opponents:', [...oppSet].join(', '));
const selfOpp = (perfectObs as any[]).filter((r:any)=>r.id===r.opponentId);
console.log('self-opponent count:', selfOpp.length);

// 4. Check if screen_cells has opponent field
console.log('\n=== screen_cells sample ===');
if (sc.length > 0) {
  console.log('keys:', Object.keys(sc[0]).join(', '));
  console.log('sample:', JSON.stringify(sc[0]).slice(0,400));
}
