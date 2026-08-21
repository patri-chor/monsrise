// ============================================================
// 全冲步阵检查：打一局「全冲+塞雷(P2) vs 全二永平(P1)」，
// 打印每回合布阵后棋盘，肉眼确认特殊怪是否被 computeSpecialPosition 正确索敌。
// 运行：npx vite-node --script src/engine/tree/inspect_fullrush.ts [seed]
// ============================================================

import '../env';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { registerAllBadges } from '../../game/BadgeSystem';
import { gameEngine } from '../../game/GameEngine';
import type { TeamSlot } from '../../game/GameEngine';
import { battleSystem } from '../../game/BattleSystem';
import { vfx } from '../../game/VfxManager';
import { DB_MONSTERS } from '../../game/Database';
import { FORMATION_LIBRARY } from '../../ai/formation_library';
import type { EvolFormation } from './evol_gene';
import { formationToEvol, cloneEvolFormation, walkEvolNodes, evolToBundleFormation, buildConditionMap } from './evol_gene';
import { roleOf, costOf } from './tree_ops';
import { patchBranchSelection } from './arena';

registerAllBadges();
vfx.particlesEnabled = false;

const ABBR: Record<number, string> = {};
for (const m of DB_MONSTERS) {
  const map: Record<number, string> = {
    110: '帝', 124: '振', 101: '肃', 105: '祈', 106: '冲', 116: '钻', 107: '咒',
    114: '突', 113: '爆', 104: '散', 117: '铁', 118: '塞', 108: '救', 125: '壕',
    119: '忍', 112: '守', 103: '徒', 102: '祭', 115: '铲', 120: '金',
  };
  ABBR[m.id] = map[m.id] ?? m.name.slice(0, 1);
}

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
function buildBundleState(side: string, round: number, my: any[], enemy: any[], budget: number): any {
  const board: any[][] = [];
  for (let y = 0; y < 5; y++) board.push(new Array(11).fill(null));
  const toP2 = (m: any) => side === 'p1' ? { dbId: m.dbId, x: 10 - m.x, y: m.y } : m;
  const myV = my.map(toP2), enemyV = enemy.map(toP2);
  const fill = (list: any[], owner: string): any[] => {
    const d: any[] = [];
    list.forEach((m, i) => { const inst = { instanceId: i + 1, monsterId: m.dbId, badgeIds: [], position: { x: m.x, y: m.y }, owner }; board[m.y][m.x] = inst; d.push(inst); });
    return d;
  };
  const players: any = { p1: { side: 'p1', deployed: [], remainingBudget: 4 }, p2: { side: 'p2', deployed: [], remainingBudget: 4 } };
  players.p1.deployed = fill(enemyV, 'p1');
  players.p2.deployed = fill(myV, 'p2');
  players.p2.remainingBudget = budget;
  return { board, players, round, phase: 'placing', currentPlayer: side, nextInstanceId: 99 };
}
function relocateNear(x: number, y: number, side: string, occupied: Set<number>): [number, number] | null {
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
const PRIORITY: Record<number, number> = { 113: 0, 107: 1, 118: 2, 114: 3, 117: 4, 106: 5, 116: 6 };

function printBoard(title: string, p1Name: string, p2Name: string): void {
  const grid: (number | null)[][] = Array.from({ length: 5 }, () => new Array(11).fill(null));
  for (const m of gameEngine.boardMonsters) {
    if (!m.isDead) grid[m.gridY][m.gridX] = m.dbId;
  }
  console.log(`\n  ${title}`);
  console.log(`        |—— ${p1Name}(P1) ——|  |—— ${p2Name}(P2) ——|`);
  console.log('    y\\x  0   1   2   3   4   |   6   7   8   9   10');
  for (let y = 0; y < 5; y++) {
    const row: string[] = [`    ${y} `];
    for (let x = 0; x < 11; x++) {
      if (x === 5) { row.push(' | '); continue; }
      const id = grid[y][x];
      row.push(id !== null ? `[${ABBR[id]}]` : '[  ]');
    }
    console.log(row.join(''));
  }
}

const FOUR_COST = new Set([101, 102, 108, 115, 118, 120]);

/** 同 deck_separation 的映射（含四费怪必须落 R1-R3 约束） */
function mapRefTreeToDeck(ref: EvolFormation, deckTeam: { monsterId: number; badgeIds: number[] }[]): EvolFormation {
  const out = cloneEvolFormation(ref);
  out.team = deckTeam.map(s => ({ monsterId: s.monsterId, badgeIds: [...s.badgeIds] }));
  const slots: { nodeId: string; round: number; refId: number }[] = [];
  for (const n of walkEvolNodes(ref.root)) {
    for (const p of n.placements) slots.push({ nodeId: n.id, round: n.round, refId: p.monsterId });
  }
  const pool = deckTeam.map(s => s.monsterId);
  const used = new Set<number>();
  const dRole = (id: number) => roleOf(id);
  const dCost = (id: number) => costOf(id);
  const assign = (pred: (rid: number, d: number) => boolean): void => {
    for (const s of slots) {
      if (used.has(s.refId)) continue;
      const cands = pool.filter(d => !used.has(d) && pred(s.refId, d) && (!FOUR_COST.has(d) || s.round < 4));
      if (cands.length === 0) continue;
      const c = cands[0];
      const node = walkEvolNodes(out.root).find(n => n.id === s.nodeId)!;
      const p = node.placements.find(q => q.monsterId === s.refId);
      if (p) { p.monsterId = c; used.add(c); }
    }
  };
  assign((rid, d) => d === rid);
  assign((rid, d) => dCost(d) === costOf(rid) && dRole(d) === roleOf(rid));
  assign((rid, d) => dCost(d) === costOf(rid));
  assign((rid, d) => dRole(d) === roleOf(rid));
  assign(() => true);
  return out;
}

function main(): void {
  const seed = Number(process.argv[2] ?? 100);

  // 全冲+塞雷 卡组
  const data = JSON.parse(readFileSync(resolve('reports/deck_candidates_v2.json'), 'utf8'));
  const c = data.candidates.find((x: any) => x.template === '全冲+塞雷')!;
  const ref = formationToEvol(FORMATION_LIBRARY.find(f => f.name === '全二冲')!);
  const fullrush = mapRefTreeToDeck(ref, c.team);

  console.log('全冲+塞雷 映射后树:');
  for (const n of walkEvolNodes(fullrush.root)) {
    if (n.round === 0) continue;
    const ps = n.placements.map(p => `${p.monsterId}@(${p.x},${p.y})`).join(', ');
    const cond = n.condition && (n.condition.main || n.condition.keys?.length) ? ` [${n.condition.main ?? n.condition.keys}]` : '';
    console.log(`  R${n.round}: ${ps}${cond}`);
  }

  const BundleAI = loadBundle();
  const target = FORMATION_LIBRARY.find(f => f.name === '全二永平')!;

  gameEngine.restartGame();
  gameEngine.mode = 'ai';
  gameEngine.teams = [target.team as TeamSlot[], fullrush.team as TeamSlot[]];
  gameEngine.setReplaySeed(seed);
  const aiFull = new BundleAI();
  const aiTarget = new BundleAI();
  const scores = [0, 0];

  for (let round = 1; round <= 5; round++) {
    if (gameEngine.isGameOver()) break;
    gameEngine.currentRound = round;
    const rng = mulberry32(seed * 2654435761 + round);
    const realRandom = Math.random; Math.random = rng;

    const planFor = (ai: any, spec: any, side: string, budget: number, hand: any[], my: any[], enemy: any[], oppHand: any[]): any[] => {
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
    const planP1 = planFor(aiTarget, { kind: 'native', f: target }, 'p1', gameEngine.p1RemainingBudget, target.team.filter(s => s.monsterId > 0), myP1, enP1, fullrush.team.filter(s => s.monsterId > 0));
    const myP2 = gameEngine.boardMonsters.filter(m => m.team === 2).map(m => ({ dbId: m.dbId, x: m.gridX, y: m.gridY }));
    const enP2 = gameEngine.boardMonsters.filter(m => m.team === 1).map(m => ({ dbId: m.dbId, x: m.gridX, y: m.gridY }));
    const planP2 = planFor(aiFull, { kind: 'evol', f: fullrush }, 'p2', gameEngine.p2RemainingBudget, fullrush.team.filter(s => s.monsterId > 0), myP2, enP2, target.team.filter(s => s.monsterId > 0));
    Math.random = realRandom;

    const place = (plan: any[], side: string, team: any[]): void => {
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
    place(planP1, 'p1', target.team.filter(s => s.monsterId > 0));
    place(planP2, 'p2', fullrush.team.filter(s => s.monsterId > 0));

    printBoard(`R${round} 布阵后（战前）`, '全二永平', '全冲+塞雷');

    const s1 = gameEngine.p1Score, s2 = gameEngine.p2Score;
    battleSystem.startBattle();
    let elapsed = 0;
    while (battleSystem.active && elapsed < 45) { battleSystem.update(0.04); vfx.update(0.04); elapsed += 0.04; }
    if (battleSystem.active) (battleSystem as any).endBattle(null);
    const d1 = gameEngine.p1Score - s1, d2 = gameEngine.p2Score - s2;
    scores[0] += d1; scores[1] += d2;
    const rw = d1 === d2 ? '平' : d1 > d2 ? '全二永平胜' : '全冲+塞雷胜';
    console.log(`  → R${round} ${rw}(${d1}:${d2}) 总比分 ${scores[0]}:${scores[1]}`);
    vfx.particles.length = 0; vfx.backgroundParticles.length = 0; vfx.projectiles.length = 0;
    vfx.floatingTexts.length = 0; vfx.auraCircles = [];
    gameEngine.resetBoardForNextRound();
  }
  console.log(`\n最终 ${scores[0]}:${scores[1]} ${scores[0] === scores[1] ? '平' : scores[0] > scores[1] ? '全二永平胜' : '全冲+塞雷胜'}`);
}

main();
