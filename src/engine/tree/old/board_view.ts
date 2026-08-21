// ============================================================
// 棋盘可视化：打一局「肃清(后手p2) vs 全二冲(先手p1)」，每回合战斗前
// 用 ASCII 表格打印双方棋盘（含怪名简称），供人工检查布局。
// 运行：npx vite-node --script src/engine/tree/board_view.ts [seed] [--r3variant]
//   --r3variant: 实验性改动——肃清 R3 改放「祈祷+钻头」替代原「祈祷+突突」
// ============================================================

import '../env';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gameEngine } from '../../game/GameEngine';
import type { TeamSlot } from '../../game/GameEngine';
import { battleSystem } from '../../game/BattleSystem';
import { vfx } from '../../game/VfxManager';
import { registerAllBadges } from '../../game/BadgeSystem';
import { DB_MONSTERS } from '../../game/Database';
import { FORMATION_LIBRARY } from '../../ai/formation_library';
import { formationToEvol, evolToBundleFormation, buildConditionMap } from './evol_gene';
import { patchBranchSelection } from './arena';

registerAllBadges();
vfx.particlesEnabled = false;

// 怪名简称（1 字符）
const ABBR: Record<number, string> = {};
for (const m of DB_MONSTERS) {
  const map: Record<number, string> = {
    110: '帝', 124: '振', 101: '肃', 105: '祈', 106: '冲', 116: '钻', 107: '咒',
    114: '突', 113: '爆', 104: '散', 117: '铁', 118: '塞', 108: '救', 125: '壕',
    119: '忍', 112: '守', 103: '徒', 102: '祭', 111: '习', 109: '狙', 115: '铲',
    120: '金', 121: '僧', 122: '丛', 123: '棒', 126: '猴',
  };
  ABBR[m.id] = map[m.id] ?? m.name.slice(0, 1);
}
const abbr = (id: number) => ABBR[id] ?? String(id);

function loadBundle(): any {
  const w = globalThis as any;
  const code = readFileSync(resolve('public/ai-bundle.iife.js'), 'utf8');
  const factory = new Function('window', 'globalThis', '"use strict";\n' + code + '\n;return BattleAI;');
  const b = factory(w, w);
  return b?.BattleAI ?? w.BattleAI;
}

function quiet<T>(fn: () => T): T {
  const log = console.log, warn = console.warn, err = console.error;
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  try { return fn(); } finally { console.log = log; console.warn = warn; console.error = err; }
}
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function buildBundleState(side, round, my, enemy, budget): any {
  const board = [];
  for (let y = 0; y < 5; y++) board.push(new Array(11).fill(null));
  const toP2 = m => side === 'p1' ? { dbId: m.dbId, x: 10 - m.x, y: m.y } : m;
  const myV = my.map(toP2), enemyV = enemy.map(toP2);
  const fill = (list, owner) => { const d = []; list.forEach((m, i) => { const inst = { instanceId: i + 1, monsterId: m.dbId, badgeIds: [], position: { x: m.x, y: m.y }, owner }; board[m.y][m.x] = inst; d.push(inst); }); return d; };
  const players = { p1: { side: 'p1', deployed: [], remainingBudget: 4 }, p2: { side: 'p2', deployed: [], remainingBudget: 4 } };
  players.p1.deployed = fill(enemyV, 'p1');
  players.p2.deployed = fill(myV, 'p2');
  players.p2.remainingBudget = budget;
  return { board, players, round, phase: 'placing', currentPlayer: side, nextInstanceId: 99 };
}
function relocateNear(x, y, side, occupied) {
  const lo = side === 'p1' ? 0 : 6, hi = side === 'p1' ? 4 : 10;
  for (let d = 1; d <= 8; d++) for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) {
    if (Math.abs(dx) + Math.abs(dy) !== d) continue;
    const nx = x + dx, ny = y + dy;
    if (nx < lo || nx > hi || ny < 0 || ny > 4) continue;
    if (occupied.has(nx * 10 + ny)) continue;
    return [nx, ny];
  }
  return null;
}
const PRIORITY = { 113: 0, 107: 1, 118: 2, 114: 3, 117: 4, 106: 5, 116: 6 };

/** 打印当前棋盘（ASCII 表格） */
function printBoard(title: string): void {
  const grid: (number | null)[][] = Array.from({ length: 5 }, () => new Array(11).fill(null));
  for (const m of gameEngine.boardMonsters) {
    if (!m.isDead) grid[m.gridY][m.gridX] = m.dbId;
  }
  console.log(`\n  ${title}`);
  console.log('        |—— 全二冲(P1) ——|  |—— 肃清(P2) ——|');
  console.log('    y\\x  0   1   2   3   4   |   6   7   8   9   10');
  for (let y = 0; y < 5; y++) {
    const row: string[] = [`    ${y} `];
    for (let x = 0; x < 11; x++) {
      if (x === 5) { row.push(' | '); continue; }
      const id = grid[y][x];
      row.push(id !== null ? `[${abbr(id)}]` : '[  ]');
    }
    console.log(row.join(''));
  }
}

function main(): void {
  const ARGV: Record<string, string> = {};
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a.startsWith('--')) { ARGV[a.slice(2)] = 'true'; }
  }
  const seed = Number(process.argv[2] ?? 100);
  const r3variant = ARGV.r3variant === 'true';

  const BundleAI = loadBundle();
  const suqing = formationToEvol(FORMATION_LIBRARY.find(f => f.name === '肃清')!);
  const rush = FORMATION_LIBRARY.find(f => f.name === '全二冲')!;

  // 实验：R3 改放 祈祷+钻头（把钻头116从R5提前到R3，替代原突突）
  if (r3variant) {
    // 找到肃清树的 R3 节点（走"钻头分支" n48 的 R3 = 祈祷+突突，把突突换成钻头）
    const walk = (n: any): any => {
      if (n.round === 3 && n.placements.some((p: any) => p.monsterId === 105)) {
        // 该 R3 节点含祈祷，把突突(114)替换为钻头(116)
        for (const p of n.placements) {
          if (p.monsterId === 114) { p.monsterId = 116; }
        }
      }
      for (const c of n.children) walk(c);
    };
    walk(suqing.root);
    console.log('[实验] 肃清 R3 已改为 祈祷+钻头');
  }

  gameEngine.restartGame();
  gameEngine.mode = 'ai';
  gameEngine.teams = [rush.team as TeamSlot[], suqing.team as TeamSlot[]];
  gameEngine.setReplaySeed(seed);
  const aiRush = new BundleAI();
  const aiSuqing = new BundleAI();
  const scores = [0, 0];

  for (let round = 1; round <= 5; round++) {
    if (gameEngine.isGameOver()) break;
    gameEngine.currentRound = round;
    const rng = mulberry32(seed * 2654435761 + round);
    const realRandom = Math.random; Math.random = rng;

    const planFor = (ai, spec, side, budget, hand, my, enemy, oppHand) => {
      const fe = ai.pipeline.getFormationEngine();
      if (fe.getSelectedFormation()?.name !== spec.f.name) {
        ai.buildTeam(hand);
        if (spec.kind === 'evol') {
          quiet(() => fe.loadCustomFormation(evolToBundleFormation(spec.f)));
          patchBranchSelection(fe, buildConditionMap(spec.f.root));
        } else {
          quiet(() => fe.loadCustomFormation(spec.f as any));
        }
        (fe as any).variant = 'original';
      }
      quiet(() => fe.setOpponentHand(oppHand.slice(0, 4)));
      const st = buildBundleState(side, round, my, enemy, budget);
      const raw = quiet(() => ai.pipeline.decideWithFormation(hand, round, st));
      return (raw?.placements ?? []).map((a: any) => ({ monsterId: a.monsterId, x: a.x, y: a.y }));
    };

    const myP1 = gameEngine.boardMonsters.filter(m => m.team === 1).map(m => ({ dbId: m.dbId, x: m.gridX, y: m.gridY }));
    const enP1 = gameEngine.boardMonsters.filter(m => m.team === 2).map(m => ({ dbId: m.dbId, x: m.gridX, y: m.gridY }));
    const planP1 = planFor(aiRush, { kind: 'native', f: rush }, 'p1', gameEngine.p1RemainingBudget, rush.team.filter(s => s.monsterId > 0), myP1, enP1, suqing.team.filter(s => s.monsterId > 0));
    const myP2 = gameEngine.boardMonsters.filter(m => m.team === 2).map(m => ({ dbId: m.dbId, x: m.gridX, y: m.gridY }));
    const enP2 = gameEngine.boardMonsters.filter(m => m.team === 1).map(m => ({ dbId: m.dbId, x: m.gridX, y: m.gridY }));
    const planP2 = planFor(aiSuqing, { kind: 'evol', f: suqing }, 'p2', gameEngine.p2RemainingBudget, suqing.team.filter(s => s.monsterId > 0), myP2, enP2, rush.team.filter(s => s.monsterId > 0));
    Math.random = realRandom;

    const place = (plan, side, team) => {
      const teamId = side === 'p1' ? 1 : 2;
      const occ = new Set(gameEngine.boardMonsters.filter(m => m.team === teamId).map(m => m.gridX * 10 + m.gridY));
      const ordered = [...plan].sort((a, b) => (PRIORITY[a.monsterId] ?? 9) - (PRIORITY[b.monsterId] ?? 9));
      for (const p of ordered) {
        const slot = team.find(s => s.monsterId === p.monsterId);
        if (!slot) continue;
        let px = side === 'p1' ? 10 - p.x : p.x, py = p.y;
        if (occ.has(px * 10 + py) || !gameEngine.placeMonster(slot, px, py, side === 'p1')) {
          const r = relocateNear(px, py, side, occ);
          if (!r) continue;
          px = r[0]; py = r[1];
          if (occ.has(px * 10 + py)) continue;
          if (!gameEngine.placeMonster(slot, px, py, side === 'p1')) continue;
        }
        occ.add(px * 10 + py);
      }
    };
    place(planP1, 'p1', rush.team.filter(s => s.monsterId > 0));
    place(planP2, 'p2', suqing.team.filter(s => s.monsterId > 0));

    printBoard(`R${round} 布阵后（战前）`);

    const s1 = gameEngine.p1Score, s2 = gameEngine.p2Score;
    battleSystem.startBattle();
    let elapsed = 0;
    while (battleSystem.active && elapsed < 45) { battleSystem.update(0.04); vfx.update(0.04); elapsed += 0.04; }
    if (battleSystem.active) (battleSystem as any).endBattle(null);
    const d1 = gameEngine.p1Score - s1, d2 = gameEngine.p2Score - s2;
    scores[0] += d1; scores[1] += d2;
    const rw = d1 === d2 ? '平' : d1 > d2 ? '全二冲胜' : '肃清胜';
    console.log(`  → R${round} 结果 ${rw}(${d1}:${d2}) 总比分 ${scores[0]}:${scores[1]}`);
    vfx.particles.length = 0; vfx.backgroundParticles.length = 0; vfx.projectiles.length = 0;
    vfx.floatingTexts.length = 0; vfx.auraCircles = [];
    gameEngine.resetBoardForNextRound();
  }
  console.log(`\n最终 ${scores[0]}:${scores[1]} ${scores[0] === scores[1] ? '平' : scores[0] > scores[1] ? '全二冲胜' : '肃清胜'}`);
}

main();
