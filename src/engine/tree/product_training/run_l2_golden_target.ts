// ============================================================
// run_l2_golden_target.ts —— 金猴开局 15s 攻击目标 vs 胜率分析
// 测试壕炸金猴(golden_boom) vs 其余 10 个 T0 冻结源（双向）
// 每局记录：金猴(120) 开局 15s 内普攻目标集合（是否含冲锋 106），关联该局胜/平/负
// 运行：npx vite-node --script src/engine/tree/product_training/run_l2_golden_target.ts [--games 5]
// ============================================================
import '../../env';
import { battleSystem } from '../../../game/BattleSystem';
import { loadCurrentStrong11Opponents } from './benchmark_pools';
import {
  playSingleGameSymmetric,
  normalizeToEvalSpec,
  type EvalOpponentSpec,
} from './eval_engine';

function parseArgs(): { targetId: string; games: number } {
  const args = process.argv.slice(2);
  const targetId = args.find(a => a.startsWith('--target='))?.split('=')[1] ?? 'golden_boom';
  const games = parseInt(args.find(a => a.startsWith('--games='))?.split('=')[1] ?? '5', 10);
  return { targetId, games };
}

function main() {
  const { targetId, games } = parseArgs();
  const { opponents } = loadCurrentStrong11Opponents();

  const targetFormation = opponents.find(o => (o as any).id === targetId);
  if (!targetFormation) {
    console.error(`目标 ${targetId} 不存在。可用: ${opponents.map(o => (o as any).id).join(', ')}`);
    process.exit(1);
  }
  const target = normalizeToEvalSpec(targetFormation as any);
  const restOpponents: EvalOpponentSpec[] = opponents
    .filter(o => (o as any).id !== targetId)
    .map(o => normalizeToEvalSpec(o as any) as EvalOpponentSpec);

  console.log(`\n=== 金猴开局15s攻击目标分析: ${target.name} vs ${restOpponents.length} 个T0 (${games}局/side) ===`);

  // 统计结构
  interface Cell {
    oppId: string;
    hitRush: boolean;   // 15s 内金猴是否攻击过冲锋(106)
    result: 'W' | 'D' | 'L';
    side: 1 | 2;
    targets: Record<number, number>; // 15s 内攻击目标 dbId -> 次数
  }
  const cells: Cell[] = [];

  const origFindClosestEnemy = (battleSystem as any).findClosestEnemy.bind(battleSystem);
  let curCell: Cell | null = null;
  (battleSystem as any).findClosestEnemy = (m: any, isAttacking: boolean) => {
    const t = origFindClosestEnemy(m, isAttacking);
    if (m?.dbId === 120 && t && curCell) {
      const elapsed = 40 - (battleSystem as any).timeLeft;
      if (elapsed <= 15) {
        curCell.targets[t.dbId] = (curCell.targets[t.dbId] ?? 0) + 1;
        if (t.dbId === 106) curCell.hitRush = true;
      }
    }
    return t;
  };

  let total = 0;
  for (const opp of restOpponents) {
    for (const side of [1, 2] as (1 | 2)[]) {
      for (let g = 0; g < games; g++) {
        const seed = 100000 + restOpponents.indexOf(opp) * 1000 + side * 100 + g;
        curCell = { oppId: opp.id, hitRush: false, result: 'L', side, targets: {} };
        const outcome = playSingleGameSymmetric(target, opp, side, seed);
        curCell.result = outcome;
        cells.push(curCell);
        total++;
      }
    }
  }
  (battleSystem as any).findClosestEnemy = origFindClosestEnemy;

  // ---- 统计 ----
  console.log(`共 ${total} 局\n`);
  console.log('=== 按对手：金猴15s内攻击冲锋(106) 与否 的胜率 ===');
  console.log('对手'.padEnd(16) + '| 攻冲锋: W/D/L (score70)   | 未攻冲锋: W/D/L (score70)');
  console.log('-'.repeat(70));
  const aggHit: Record<string, { w: number; d: number; l: number }> = {};
  const aggNoHit: Record<string, { w: number; d: number; l: number }> = {};
  for (const c of cells) {
    const bucket = c.hitRush ? aggHit : aggNoHit;
    const key = c.oppId;
    if (!bucket[key]) bucket[key] = { w: 0, d: 0, l: 0 };
    if (c.result === 'W') bucket[key].w++;
    else if (c.result === 'D') bucket[key].d++;
    else bucket[key].l++;
  }
  for (const opp of restOpponents) {
    const h = aggHit[opp.id] ?? { w: 0, d: 0, l: 0 };
    const n = aggNoHit[opp.id] ?? { w: 0, d: 0, l: 0 };
    const hTotal = h.w + h.d + h.l;
    const nTotal = n.w + n.d + n.l;
    const hScore = hTotal > 0 ? ((h.w + 0.7 * h.d) / hTotal * 100).toFixed(0) : '-';
    const nScore = nTotal > 0 ? ((n.w + 0.7 * n.d) / nTotal * 100).toFixed(0) : '-';
    console.log(
      `${opp.id.padEnd(16)}| ${h.w}/${h.d}/${h.l} (${hScore}%)  [${hTotal}局] | ${n.w}/${n.d}/${n.l} (${nScore}%)  [${nTotal}局]`,
    );
  }

  // 总聚合
  const totHit = { w: 0, d: 0, l: 0 };
  const totNoHit = { w: 0, d: 0, l: 0 };
  for (const c of cells) {
    const b = c.hitRush ? totHit : totNoHit;
    if (c.result === 'W') b.w++;
    else if (c.result === 'D') b.d++;
    else b.l++;
  }
  const score = (b: { w: number; d: number; l: number }) => {
    const t = b.w + b.d + b.l;
    return t > 0 ? ((b.w + 0.7 * b.d) / t * 100).toFixed(1) : '-';
  };
  console.log('\n=== 总聚合 ===');
  console.log(`  15s内攻击冲锋(106): W${totHit.w}/D${totHit.d}/L${totHit.l}  (${totHit.w + totHit.d + totHit.l}局) score70=${score(totHit)}%`);
  console.log(`  15s内未攻击冲锋   : W${totNoHit.w}/D${totNoHit.d}/L${totNoHit.l}  (${totNoHit.w + totNoHit.d + totNoHit.l}局) score70=${score(totNoHit)}%`);

  // 目标分布（重点：三个 fullrush 对手）
  const NAME: Record<number, string> = { 110: '帝国', 116: '钻头', 117: '铁甲', 118: '塞雷', 113: '矿爆', 114: '突突', 106: '冲锋', 107: '咒法', 105: '祈祷', 108: '救星', 104: '散弹', 119: '忍猴', 120: '金猴', 124: '金刚', 125: '金猴2', 103: '三振', 115: '铲土', 101: '肃清', 112: '守卫' };
  const focus = ['all2rush', 'classicsavior', 'laddersel'];
  console.log('\n=== 金猴 15s 内攻击目标分布（3个 fullrush 对手）===');
  for (const oppId of focus) {
    const oppCells = cells.filter(c => c.oppId === oppId);
    const agg: Record<number, { n: number; w: number; d: number; l: number }> = {};
    for (const c of oppCells) {
      for (const [dbId, cnt] of Object.entries(c.targets)) {
        const d = Number(dbId);
        if (!agg[d]) agg[d] = { n: 0, w: 0, d: 0, l: 0 };
        agg[d].n += cnt;
        if (c.result === 'W') agg[d].w++;
        else if (c.result === 'D') agg[d].d++;
        else agg[d].l++;
      }
    }
    console.log(`\n${oppId} (${oppCells.length}局):`);
    const sorted = Object.entries(agg).sort((a, b) => b[1].n - a[1].n);
    for (const [dbId, v] of sorted) {
      const t = v.w + v.d + v.l;
      const s = t > 0 ? ((v.w + 0.7 * v.d) / t * 100).toFixed(0) : '-';
      console.log(`  攻击 ${(NAME[Number(dbId)] ?? dbId).padEnd(4)}(id${dbId}): ${v.n}次 | 该对手${t}局 score70=${s}%`);
    }
  }
  console.log('');
}

main();
