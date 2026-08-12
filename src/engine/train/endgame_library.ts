// ============================================================
// 残局库：记录"残局状态 → 搜索最优动作"（如国际象棋残局表）
// 状态 = 回合 + 预算 + 双方存活怪(位置)，哈希去重、按出现次数加权
// 建库：npx vite-node --script src/engine/train/endgame_library.ts <局数> [searchN] [输出路径]
// 决策层查库：搜索每步先查库，命中免模拟直接采用（供参考/加速）
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { playFullGame } from '../play_full_game';
import { FORMATION_LIBRARY } from '../../ai/formation_library';
import type { Formation } from '../../ai/types';

interface KeyedMonster {
  dbId: number;
  x: number;
  y: number;
}

/** 残局状态哈希：确定性（怪兽排序后拼串） */
export function endgameKey(
  myMonsters: KeyedMonster[],
  enemyMonsters: KeyedMonster[],
  round: number,
  budget: number,
): string {
  const fmt = (arr: KeyedMonster[]) =>
    arr.map(m => `${m.dbId}@${m.x},${m.y}`).sort().join('|');
  return `r${round}|b${budget}|e${fmt(enemyMonsters)}|m${fmt(myMonsters)}`;
}

export interface EndgameEntry {
  key: string;
  monsterId: number;
  x: number;
  y: number;
  count: number;
}

export interface EndgameLib {
  entries: EndgameEntry[];
  /** key → entry 索引 */
  index: Map<string, number>;
}

export function emptyLib(): EndgameLib {
  return { entries: [], index: new Map() };
}

export function addEntry(lib: EndgameLib, key: string, monsterId: number, x: number, y: number): void {
  const idx = lib.index.get(key);
  if (idx !== undefined) {
    const e = lib.entries[idx];
    // 同一状态出现不同动作：计数高的胜出（多数共识）
    if (e.monsterId === monsterId && e.x === x && e.y === y) {
      e.count++;
    } else if (e.count === 1) {
      e.monsterId = monsterId;
      e.x = x;
      e.y = y;
    } else {
      // 保留原动作；次数不增
    }
  } else {
    lib.index.set(key, lib.entries.length);
    lib.entries.push({ key, monsterId, x, y, count: 1 });
  }
}

export function lookupEndgame(lib: EndgameLib | null, key: string): EndgameEntry | null {
  if (!lib) return null;
  const idx = lib.index.get(key);
  return idx === undefined ? null : lib.entries[idx];
}

export function saveLib(lib: EndgameLib, outPath: string): void {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ type: 'endgame_lib', entries: lib.entries }, null, 1), 'utf8');
}

export function loadLib(inPath: string): EndgameLib {
  const j = JSON.parse(fs.readFileSync(inPath, 'utf8')) as { entries: EndgameEntry[] };
  const lib = emptyLib();
  for (const e of j.entries) lib.index.set(e.key, lib.entries.length);
  lib.entries = j.entries;
  return lib;
}

// ---------- 建库（确定性：同 seed 同库） ----------

const FORMATIONS = FORMATION_LIBRARY;

function mulberry32(seed: number): () => number {
  let t = seed + 0x6D2B79F5;
  return () => {
    t += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickPair(seed: number): [Formation, Formation] {
  const rng = mulberry32(seed);
  const a = Math.floor(rng() * FORMATIONS.length);
  let b = Math.floor(rng() * (FORMATIONS.length - 1));
  if (b >= a) b++;
  return [FORMATIONS[a], FORMATIONS[b]];
}

export function buildEndgameLib(games: number, searchN: number, outPath: string): { entries: number; games: number; elapsedMs: number } {
  process.env.PLANNER = 'search';
  process.env.SEARCH_N = String(searchN);
  process.env.SEARCH_SIDE = 'both';
  const lib = emptyLib();
  const t0 = Date.now();
  for (let i = 0; i < games; i++) {
    const swap = i % 2 === 1;
    const [fa, fb] = pickPair(i + 1);
    const teamA = swap ? fb.team : fa.team;
    const teamB = swap ? fa.team : fb.team;
    playFullGame(teamA, teamB, {
      seed: i + 1,
      treeA: swap ? fb.tree : fa.tree,
      treeB: swap ? fa.tree : fb.tree,
      // 与训练一致：R1 强制阵型树计划（开局坦克），残局库记录的是真实有效打法
      forceTreeRounds: [1],
      onCandidate: undefined,
      onSearchStep: ({ myMonsters, enemyMonsters, round, budget, action }) => {
        addEntry(lib, endgameKey(myMonsters, enemyMonsters, round, budget), action.monsterId, action.x, action.y);
      },
    });
    if ((i + 1) % 20 === 0 || i === games - 1) {
      console.log(`  #${i + 1} 残局条目 ${lib.entries.length}`);
    }
  }
  saveLib(lib, outPath);
  const elapsedMs = Date.now() - t0;
  console.log(`残局库 ${lib.entries.length} 条（${games} 局）耗时 ${(elapsedMs / 1000).toFixed(1)}s → ${outPath}`);
  return { entries: lib.entries.length, games, elapsedMs };
}

// CLI 入口
if (process.argv[1] && process.argv[1].endsWith('endgame_library.ts')) {
  const games = Number(process.argv[2]) || 100;
  const searchN = Number(process.argv[3]) || 2;
  const outPath = process.argv[4] || 'reports/endgame_lib.json';
  buildEndgameLib(games, searchN, outPath);
}
