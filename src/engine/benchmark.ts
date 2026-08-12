// ============================================================
// 自对弈基准：冒烟 N 局 + 基准 M 局，测局/秒 + 胜率 + 确定性校验
// 运行：npx vite-node --script src/engine/benchmark.ts <冒烟局数> <基准局数> [planner] [searchN] [searchSide] [csvPath或-] [showBoardN]
// SEARCH_ROUNDS 仅通过环境变量设置
// 例：npx vite-node --script src/engine/benchmark.ts 10 500 search 2 both reports/both500.csv 3
// ============================================================

import './env';
import fs from 'node:fs';
import path from 'node:path';
import { playFullGame } from './play_full_game';
import { getBadgePreset } from './badge_presets';
import { DB_MONSTERS, DB_BADGES } from '../game/Database';
import type { PlacedMonster, TeamSlot } from '../game/GameEngine';
import type { Placement } from './types';

// 16 费基准阵容（旧阵型库 team 配置，第 8 张为替补位）
// TEAM_A = 全二冲（rush），TEAM_B = 全二永平（祷徒）
const TEAM_A: TeamSlot[] = [110, 117, 107, 113, 114, 116, 106, 104].map(id => ({
  monsterId: id,
  badgeIds: getBadgePreset(id),
}));
const TEAM_B: TeamSlot[] = [110, 105, 103, 116, 106, 104, 114, 112].map(id => ({
  monsterId: id,
  badgeIds: getBadgePreset(id),
}));

// 每回合 ASCII 布阵图（战前完整棋盘：幸存者 + 本轮新增）+ 本轮新增/全盘佩章
// swap=true 时 A 在右侧（p2），胜者标签按 A/B 视角校正
function renderBoard(info: {
  round: number;
  boardMonsters: PlacedMonster[];
  preBattle: { dbId: number; gridX: number; gridY: number; badges: { id: number; name: string }[] }[];
  planA: Placement[];
  planB: Placement[];
  p1Score: number;
  p2Score: number;
  winner: 1 | 2 | 0;
}, swap: boolean): void {
  const aWonRound = swap ? info.winner === 2 : info.winner === 1;
  const w = info.winner === 0 ? '平' : aWonRound ? 'A胜' : 'B胜';
  console.log(`    R${info.round} ${info.p1Score}:${info.p2Score} (${w})  ← 开战前布阵`);
  // 战前完整棋盘：幸存者恢复原位 + 本轮新增（战斗前无死亡，不画 xx）
  const grid: string[][] = Array.from({ length: 5 }, () => Array(11).fill('..'));
  for (const m of info.preBattle) {
    grid[m.gridY][m.gridX] = String(m.dbId).padStart(2, '0').slice(-2);
  }
  const header = '       ' + Array.from({ length: 11 }, (_, x) => String(x).padStart(3, ' ')).join('');
  console.log(header);
  for (let y = 0; y < 5; y++) {
    // 列 5 为中线：布阵阶段两侧不越线，恒为分隔线
    const row = grid[y].map((c, x) => {
      if (x === 5) return c !== '..' ? c.padStart(3, ' ') : ' |';
      return c.padStart(3, ' ');
    }).join('');
    console.log(`    y${y}  ${row}`);
  }
  const badgeName = (id: number) => DB_BADGES.find(b => b.id === id)?.name ?? `?${id}`;
  const fmtBadges = (badges: { id: number; name: string }[]) =>
    badges.map(b => `${b.id}${b.name}`).join('/') || '无徽章';
  const fmtPlan = (plan: Placement[]) =>
    plan.length === 0
      ? '(无)'
      : plan.map(p => {
          const db = DB_MONSTERS.find(m => m.id === p.monsterId);
          const badges = p.badgeIds.map(id => `${id}${badgeName(id)}`).join('/');
          return `${p.monsterId}${db ? db.name : ''}@${p.x},${p.y}[${badges}]`;
        }).join(' ');
  const fmtAll = (list: { dbId: number; gridX: number; gridY: number; badges: { id: number; name: string }[] }[]) =>
    list.length === 0
      ? '(空)'
      : list.map(m => {
          const db = DB_MONSTERS.find(d => d.id === m.dbId);
          return `${m.dbId}${db ? db.name : ''}@${m.gridX},${m.gridY}[${fmtBadges(m.badges)}]`;
        }).join(' ');
  console.log(`    本轮新增A: ${fmtPlan(info.planA)}`);
  console.log(`    本轮新增B: ${fmtPlan(info.planB)}`);
  console.log(`    全盘A: ${fmtAll(info.preBattle.filter(m => m.gridX < 5))}`);
  console.log(`    全盘B: ${fmtAll(info.preBattle.filter(m => m.gridX >= 6))}`);
}

function runBatch(n: number, label: string, csvPath?: string, showBoardN: number = 0): void {
  const t0 = Date.now();
  let aWins = 0;
  let bWins = 0;
  let draws = 0;
  let abnormal = 0;
  let totalMs = 0;
  let csvFd: number | null = null;

  if (csvPath) {
    fs.mkdirSync(path.dirname(csvPath), { recursive: true });
    // 仅首次写表头，冒烟/基准批追加共用同一文件
    if (!fs.existsSync(csvPath)) {
      fs.writeFileSync(csvPath, 'seed,swap,winner,winnerA,aScore,bScore,roundResults,elapsedMs\n', 'utf8');
    }
    csvFd = fs.openSync(csvPath, 'a');
  }

  for (let i = 0; i < n; i++) {
    const swap = i % 2 === 1; // 每局换边，抵消先后手偏差
    const showBoard = showBoardN > 0 && i < showBoardN;
    const r = playFullGame(swap ? TEAM_B : TEAM_A, swap ? TEAM_A : TEAM_B, {
      seed: i + 1,
      onRoundEnd: showBoard
        ? (info) => {
            if (info.round === 1) console.log(`  #${i + 1} ${swap ? '换边' : '正边'}`);
            renderBoard(info, swap);
          }
        : undefined,
    });
    const aWon = (r.winner === 1 && !swap) || (r.winner === 2 && swap);
    if (r.winner === 0) draws++;
    else if (aWon) aWins++;
    else bWins++;
    totalMs += r.elapsedMs;

    // 合法性校验：回合数 1..5，比分与每回合结果一致
    if (r.roundsPlayed < 1 || r.roundsPlayed > 5 || r.p1Score + r.p2Score !== r.roundResults.filter(x => x !== 0).length) {
      abnormal++;
      console.log(`  异常局 #${i + 1}: ${JSON.stringify(r)}`);
    }
    if (i < 3) {
      console.log(`  #${i + 1} ${swap ? '换边' : '正边'} winner=${r.winner} 比分 ${r.p1Score}:${r.p2Score} 回合${r.roundsPlayed} ${r.roundResults.join('')}`);
    }
    if (csvFd !== null) {
      fs.writeSync(csvFd, `${i + 1},${swap ? 1 : 0},${r.winner},${aWon ? 1 : 0},${r.p1Score},${r.p2Score},${JSON.stringify(r.roundResults)},${r.elapsedMs}\n`);
    }
  }

  if (csvFd !== null) fs.closeSync(csvFd);
  const totalMsAll = Date.now() - t0;
  console.log(`[${label}] ${n} 局 ${totalMsAll}ms | ${(n / (totalMsAll / 1000)).toFixed(2)} 局/秒 | 平均 ${(totalMs / n).toFixed(0)}ms/局`);
  console.log(`  胜率 A=${((aWins / n) * 100).toFixed(1)}% B=${((bWins / n) * 100).toFixed(1)}% 平=${((draws / n) * 100).toFixed(1)}% | 异常 ${abnormal} 局`);
}

function checkDeterminism(): void {
  // 同 seed 必须同结果（训练流水线可复现性的基础保障）
  const results: string[] = [];
  for (let i = 1; i <= 5; i++) {
    const r1 = playFullGame(TEAM_A, TEAM_B, { seed: i });
    const r2 = playFullGame(TEAM_A, TEAM_B, { seed: i });
    results.push(JSON.stringify({ winner: r1.winner, roundResults: r1.roundResults }));
    if (r1.winner !== r2.winner || JSON.stringify(r1.roundResults) !== JSON.stringify(r2.roundResults)) {
      console.log(`  ✗ 种子 ${i} 不可复现: ${JSON.stringify(r1)} vs ${JSON.stringify(r2)}`);
      return;
    }
  }
  console.log(`  ✓ 5 组同种子对局结果完全一致（${results.join(' | ')}）`);
}

const smoke = process.argv[2] ? Number(process.argv[2]) : 10;
const main = process.argv[3] ? Number(process.argv[3]) : 100;
// 服务器/跨平台运行：CLI 参数映射到环境变量（Linux 直接设 env 亦可）
// 用法：npx vite-node --script src/engine/benchmark.ts <冒烟局数> <基准局数> [planner] [searchN] [searchSide] [csvPath或-] [showBoardN]
// SEARCH_ROUNDS 仅通过环境变量设置（避免空占位参数被 shell 吞掉）
// 例：npx vite-node --script src/engine/benchmark.ts 10 500 search 2 both reports/both500.csv 3
if (process.argv[4]) process.env.PLANNER = process.argv[4];
if (process.argv[5]) process.env.SEARCH_N = process.argv[5];
if (process.argv[6]) process.env.SEARCH_SIDE = process.argv[6];
const csvArg = process.argv[7];
const csvPath = csvArg && csvArg !== '-' ? csvArg : process.env.REPORT_CSV || undefined;
const showBoardN = Number(process.argv[8] || process.env.SHOW_BOARD) || 0;
checkDeterminism();
runBatch(smoke, `冒烟 ${smoke} 局`, csvPath, showBoardN);
runBatch(main, `基准 ${main} 局`, csvPath, showBoardN);
