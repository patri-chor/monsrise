// ============================================================
// 人工检查：读取 branch_induct_result.json，展示进化后的阵型树结构，
// 并可对某对手打一局（先/后手可选）打印每回合棋盘，验证分支真实命中。
//
// 运行：
//   npx vite-node --script src/engine/tree/inspect_branch.ts [json路径] [对手阵型名] [侧1先/2后] [seed]
//   例：npx vite-node --script src/engine/tree/inspect_branch.ts reports/branch_induct_result.json 全二冲 2 100
// ============================================================

import '../env';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { registerAllBadges } from '../../game/BadgeSystem';
import { gameEngine } from '../../game/GameEngine';
import type { TeamSlot } from '../../game/GameEngine';
import { battleSystem } from '../../game/BattleSystem';
import { vfx } from '../../game/VfxManager';
import { DB_MONSTERS } from '../../game/Database';
import { FORMATION_LIBRARY } from '../../ai/formation_library';
import type { EvolFormation, EvolNode, FeatureMask } from './evol_gene';
import { summarizeEvolFormation, maskToLabel, isEmptyMask, evolToBundleFormation, buildConditionMap, formationToEvol } from './evol_gene';
import { patchBranchSelection } from './arena';

registerAllBadges();
vfx.particlesEnabled = false;

// 怪名简称（1 字符）
const ABBR: Record<number, string> = {};
const NAME: Record<number, string> = {};
for (const m of DB_MONSTERS) {
  const map: Record<number, string> = {
    110: '帝', 124: '振', 101: '肃', 105: '祈', 106: '冲', 116: '钻', 107: '咒',
    114: '突', 113: '爆', 104: '散', 117: '铁', 118: '塞', 108: '救', 125: '壕',
    119: '忍', 112: '守', 103: '徒', 102: '祭', 111: '习', 109: '狙', 115: '铲',
    120: '金', 121: '僧', 122: '丛', 123: '棒', 126: '猴',
  };
  ABBR[m.id] = map[m.id] ?? m.name.slice(0, 1);
  NAME[m.id] = m.name;
}
const abbr = (id: number) => ABBR[id] ?? String(id);
const name = (id: number) => NAME[id] ?? String(id);
const costOf = (id: number) => DB_MONSTERS.find(m => m.id === id)?.cost ?? 0;

function loadBundle(): any {
  const w = globalThis as any;
  const code = readFileSync(resolve('public/ai-bundle.iife.js'), 'utf8');
  const factory = new Function('window', 'globalThis', '"use strict";\n' + code + '\n;return BattleAI;');
  const b = factory(w, w);
  return b?.BattleAI ?? w.BattleAI;
}

/** JSON → EvolFormation */
function reviveNode(raw: any): EvolNode {
  const cond: FeatureMask = {
    side: raw.condition?.side ?? null,
    main: raw.condition?.main ?? null,
    subs: raw.condition?.subs ?? [],
    keys: raw.condition?.keys ?? [],
  };
  return {
    id: raw.id,
    round: raw.round,
    condition: cond,
    placements: (raw.placements ?? []).map((p: any) => ({ monsterId: p.monsterId, x: p.x, y: p.y })),
    children: (raw.children ?? []).map((c: any) => reviveNode(c)),
  };
}
function reviveFormation(raw: any): EvolFormation {
  return {
    name: raw.name ?? 'evolved',
    archetype: raw.archetype ?? 'half_rush',
    team: (raw.team ?? []).map((s: any) => ({ monsterId: s.monsterId, badgeIds: [...(s.badgeIds ?? [])] })),
    root: reviveNode(raw.tree ?? raw.root),
  };
}

/** 打印树结构（带分支标签 + 费用 + 怪名） */
function printTree(e: EvolFormation): void {
  console.log(`\n=== 进化阵型树：${e.name} (archetype=${e.archetype}) ===`);
  console.log(`卡组: ${e.team.map(s => `${name(s.monsterId)}(${s.monsterId})费${costOf(s.monsterId)}`).join(' ')} 合计${e.team.reduce((a, s) => a + costOf(s.monsterId), 0)}费`);
  const walk = (n: EvolNode, depth: number): void => {
    if (n.round === 0) {
      for (const c of n.children) walk(c, depth);
      return;
    }
    const indent = '  '.repeat(depth);
    const cond = isEmptyMask(n.condition) ? '' : `  ⬅ 触发条件 [${maskToLabel(n.condition)}]`;
    const ps = n.placements.map(p => `${name(p.monsterId)}@(${p.x},${p.y})`).join(', ');
    const cost = n.placements.reduce((a, p) => a + costOf(p.monsterId), 0);
    console.log(`${indent}R${n.round}  ${ps}  (费${cost})${cond}`);
    for (const c of n.children) walk(c, depth + 1);
  };
  walk(e.root, 0);
}

// ---- 棋盘可视化（复用 board_view 逻辑）----
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
      row.push(id !== null ? `[${abbr(id)}]` : '[  ]');
    }
    console.log(row.join(''));
  }
}

function playOneGame(BundleAI: any, evolved: EvolFormation, oppName: string, evolvedSide: 1 | 2, seed: number): void {
  const opp = FORMATION_LIBRARY.find(f => f.name === oppName)!;
  gameEngine.restartGame();
  gameEngine.mode = 'ai';
  gameEngine.teams = [opp.team as TeamSlot[], evolved.team as TeamSlot[]];
  gameEngine.setReplaySeed(seed);
  const aiEvol = new BundleAI();
  const aiOpp = new BundleAI();
  const scores = [0, 0];

  const evolvedP2 = evolvedSide === 2;

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

    // P1 侧（opp 若 evolvedSide=1 则 evolved 在 P1，否则 opp 在 P1）
    const p1IsEvol = evolvedSide === 1;
    const p1Spec = p1IsEvol ? { kind: 'evol', f: evolved } : { kind: 'native', f: opp };
    const p1Team = p1IsEvol ? evolved.team.filter(s => s.monsterId > 0) : opp.team.filter(s => s.monsterId > 0);
    const p1Hand = p1Team;
    const myP1 = gameEngine.boardMonsters.filter(m => m.team === 1).map(m => ({ dbId: m.dbId, x: m.gridX, y: m.gridY }));
    const enP1 = gameEngine.boardMonsters.filter(m => m.team === 2).map(m => ({ dbId: m.dbId, x: m.gridX, y: m.gridY }));
    const p1OppHand = p1IsEvol ? opp.team.filter(s => s.monsterId > 0) : evolved.team.filter(s => s.monsterId > 0);
    const planP1 = planFor(p1IsEvol ? aiEvol : aiOpp, p1Spec, 'p1', gameEngine.p1RemainingBudget, p1Hand, myP1, enP1, p1OppHand);

    const p2IsEvol = evolvedSide === 2;
    const p2Spec = p2IsEvol ? { kind: 'evol', f: evolved } : { kind: 'native', f: opp };
    const p2Team = p2IsEvol ? evolved.team.filter(s => s.monsterId > 0) : opp.team.filter(s => s.monsterId > 0);
    const myP2 = gameEngine.boardMonsters.filter(m => m.team === 2).map(m => ({ dbId: m.dbId, x: m.gridX, y: m.gridY }));
    const enP2 = gameEngine.boardMonsters.filter(m => m.team === 1).map(m => ({ dbId: m.dbId, x: m.gridX, y: m.gridY }));
    const p2OppHand = p2IsEvol ? opp.team.filter(s => s.monsterId > 0) : evolved.team.filter(s => s.monsterId > 0);
    const planP2 = planFor(p2IsEvol ? aiEvol : aiOpp, p2Spec, 'p2', gameEngine.p2RemainingBudget, p2Team, myP2, enP2, p2OppHand);
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
    place(planP1, 'p1', p1Team);
    place(planP2, 'p2', p2Team);

    const p1Name = p1IsEvol ? `${evolved.name}(进化)` : opp.name;
    const p2Name = p2IsEvol ? `${evolved.name}(进化)` : opp.name;
    printBoard(`R${round} 布阵后（战前）`, p1Name, p2Name);

    const s1 = gameEngine.p1Score, s2 = gameEngine.p2Score;
    battleSystem.startBattle();
    let elapsed = 0;
    while (battleSystem.active && elapsed < 45) { battleSystem.update(0.04); vfx.update(0.04); elapsed += 0.04; }
    if (battleSystem.active) (battleSystem as any).endBattle(null);
    const d1 = gameEngine.p1Score - s1, d2 = gameEngine.p2Score - s2;
    scores[0] += d1; scores[1] += d2;
    const rw = d1 === d2 ? '平' : d1 > d2 ? `${p1Name}胜` : `${p2Name}胜`;
    console.log(`  → R${round} ${rw}(${d1}:${d2}) 总比分 ${scores[0]}:${scores[1]}`);
    vfx.particles.length = 0; vfx.backgroundParticles.length = 0; vfx.projectiles.length = 0;
    vfx.floatingTexts.length = 0; vfx.auraCircles = [];
    gameEngine.resetBoardForNextRound();
  }
  const p1Name = evolvedSide === 1 ? `${evolved.name}(进化)` : opp.name;
  const p2Name = evolvedSide === 2 ? `${evolved.name}(进化)` : opp.name;
  console.log(`\n最终 ${scores[0]}:${scores[1]} ${scores[0] === scores[1] ? '平' : scores[0] > scores[1] ? `${p1Name}胜` : `${p2Name}胜`}`);
}

function main(): void {
  const jsonPath = process.argv[2] || 'reports/branch_induct_result.json';
  const oppName = process.argv[3] || '全二冲';
  const side: 1 | 2 = Number(process.argv[4] || 2) === 1 ? 1 : 2;
  const seed = Number(process.argv[5] ?? 100);

  const raw = JSON.parse(readFileSync(resolve(jsonPath), 'utf8'));
  const evolved = reviveFormation(raw.formation);
  const BundleAI = loadBundle();

  // 收集全部输出，末尾写入 markdown 报告（用户可直接打开看）
  const report: string[] = [];
  const origLog = console.log;
  console.log = (...a: any[]) => { report.push(a.map(x => String(x)).join(' ')); origLog(...a); };

  console.log(`# 进化阵型检查报告`);
  console.log('');
  console.log(`- 检查产物: \`${jsonPath}\``);
  console.log(`- 触发标签: **${raw.maskLabel}**，分叉回合 R${raw.forkRound}，侧 ${raw.side === 1 ? '先手' : '后手'}`);
  if (raw.before && raw.after) {
    console.log(`- 命中对手整局不败率: ${(raw.before.undefeated * 100).toFixed(0)}% → **${(raw.after.undefeated * 100).toFixed(0)}%**`);
  }
  console.log('');

  console.log('## 一、进化后树结构');
  console.log('```');
  printTree(evolved);
  console.log('```');

  console.log('\n## 二、原始摘要（含 id）');
  console.log('```');
  console.log(summarizeEvolFormation(evolved));
  console.log('```');

  console.log(`\n## 三、打一局验证分支命中: ${evolved.name}(${side === 1 ? '先手P1' : '后手P2'}) vs ${oppName}`);
  console.log('```');
  playOneGame(BundleAI, evolved, oppName, side, seed);
  console.log('```');

  console.log = origLog;
  const reportPath = resolve('reports/branch_inspect_report.md');
  writeFileSync(reportPath, report.join('\n'));
  console.log(`\n报告已保存 → ${reportPath}`);
}

main();
