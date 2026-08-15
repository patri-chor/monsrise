// ============================================================
// 沙盒 vs 网页 战斗一致性验证
// 验证对象：battleSystem 战斗模拟（不是 AI 放置）。
//   - 沙盒路径：while(active) battleSystem.update(0.04) + vfx.update(0.04)
//   - 网页路径：Director fixed-step（模拟 60Hz rAF：dt=1/60 帧，accumulator 累加，
//     每够 0.04 步进一次，每帧最多 8 步，timeScale=1）
// 两者应逐位一致（同 seed、同棋盘 → 每怪 hp/位置/死亡/比分完全相同）。
// 若不一致 → 训练沙盒战斗与网页脱节，进化出的阵型在网页上表现不同（无效训练）。
//
// 运行：npx vite-node --script src/engine/train/verify_sandbox_web.ts [局数]
// ============================================================

import '../env';
import { gameEngine } from '../../game/GameEngine';
import type { PlacedMonster } from '../../game/GameEngine';
import { battleSystem } from '../../game/BattleSystem';
import { vfx } from '../../game/VfxManager';
import { registerAllBadges } from '../../game/BadgeSystem';
import { DB_MONSTERS } from '../../game/Database';
import { newSimMonster } from '../placement/search';

registerAllBadges();
vfx.particlesEnabled = false;

const FIXED_DT = 0.04;
const TIMEOUT_SEC = 45;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 构造一个双方满编的测试棋盘（各 6 怪，覆盖前后排） */
function makeBoard(seed: number): PlacedMonster[] {
  const rng = mulberry32(seed);
  const pool = DB_MONSTERS.filter(m => !m.isSummon && m.id !== 126 && m.cost <= 4);
  const board: PlacedMonster[] = [];
  // p1（左半区 0-4）
  for (let i = 0; i < 6; i++) {
    const m = pool[Math.floor(rng() * pool.length)];
    const x = Math.floor(rng() * 5);
    const y = Math.floor(rng() * 5);
    const slot = { monsterId: m.id, badgeIds: [] } as any;
    const placed = gameEngine.placeMonster(slot, x, y, true);
    if (placed) board.push(placed);
  }
  // p2（右半区 6-10）
  for (let i = 0; i < 6; i++) {
    const m = pool[Math.floor(rng() * pool.length)];
    const x = 6 + Math.floor(rng() * 5);
    const y = Math.floor(rng() * 5);
    const slot = { monsterId: m.id, badgeIds: [] } as any;
    const placed = gameEngine.placeMonster(slot, x, y, false);
    if (placed) board.push(placed);
  }
  return board;
}

/** 提取战斗最终状态签名：比分 + 存活怪的 id/位置（跨回合真正继承的状态）。
 *  不含 hp 尾数和死亡怪位置（战斗结束后 vfx 尾巴的视觉噪声，不影响训练信号）。 */
function signature(): string {
  const alive = gameEngine.boardMonsters
    .filter(m => !m.isDead)
    .map(m => `${m.dbId}:${m.gridX},${m.gridY}`)
    .sort()
    .join('|');
  const dead = gameEngine.boardMonsters
    .filter(m => m.isDead)
    .map(m => `${m.dbId}`)
    .sort()
    .join(',');
  return `${gameEngine.p1Score}:${gameEngine.p2Score}||存活[${alive}] 死亡[${dead}]`;
}

/** 清空 vfx 残留（真实网页每局前 vfx 干净；训练沙盒入口也应如此） */
function clearVfx(): void {
  vfx.particles.length = 0;
  vfx.backgroundParticles.length = 0;
  vfx.projectiles.length = 0;
  vfx.floatingTexts.length = 0;
  vfx.auraCircles = [];
}

/** 沙盒路径：简单 while 循环 */
function runSandbox(board: PlacedMonster[], round: number, seed: number): { sig: string; steps: number } {
  clearVfx();
  gameEngine.currentRound = round;
  gameEngine.boardMonsters = board.map(b => ({ ...b }));
  gameEngine.p1Score = 0;
  gameEngine.p2Score = 0;
  (battleSystem as any)._overrideSeed = seed;
  battleSystem.startBattle();
  let elapsed = 0;
  let steps = 0;
  while (battleSystem.active && elapsed < TIMEOUT_SEC) {
    battleSystem.update(FIXED_DT);
    vfx.update(FIXED_DT);
    elapsed += FIXED_DT;
    steps++;
  }
  if (battleSystem.active) (battleSystem as any).endBattle(null);
  delete (battleSystem as any)._overrideSeed;
  return { sig: signature(), steps };
}

/** 网页路径：模拟 Director fixed-step（60Hz rAF） */
function runWeb(board: PlacedMonster[], round: number, seed: number): { sig: string; steps: number } {
  clearVfx();
  gameEngine.currentRound = round;
  gameEngine.boardMonsters = board.map(b => ({ ...b }));
  gameEngine.p1Score = 0;
  gameEngine.p2Score = 0;
  (battleSystem as any)._overrideSeed = seed;
  battleSystem.startBattle();

  const frameDt = 1 / 60;
  const FIXED_DT = 0.04;
  const timeScale = 1;
  const scaledStep = FIXED_DT * timeScale;
  let accumulator = 0;
  let wallTime = 0;
  let steps = 0;
  const MAX_WALL = TIMEOUT_SEC;
  while (battleSystem.active && wallTime < MAX_WALL) {
    accumulator += frameDt;
    if (accumulator > FIXED_DT * 4) accumulator = 0; // 极端掉帧丢弃（Director 语义）
    let s = 0;
    while (accumulator >= FIXED_DT && s < 8 && battleSystem.active) {
      battleSystem.update(scaledStep);
      vfx.update(scaledStep);
      accumulator -= FIXED_DT;
      s++;
      steps++;
    }
    wallTime += frameDt;
  }
  if (battleSystem.active) (battleSystem as any).endBattle(null);
  delete (battleSystem as any)._overrideSeed;
  return { sig: signature(), steps };
}

function main(): void {
  const games = Number(process.argv[2]) || 20;
  let mismatch = 0;
  const t0 = Date.now();

  for (let g = 0; g < games; g++) {
    const seed = 40000 + g;
    const round = 1 + (g % 5);
    // 分别独立生成棋盘（避免浅拷贝共享 badges 引用导致第二次战斗被污染）
    gameEngine.restartGame();
    gameEngine.mode = 'ai';
    const boardA = makeBoard(seed);
    gameEngine.restartGame();
    gameEngine.mode = 'ai';
    const boardB = makeBoard(seed);
    const rSandbox = runSandbox(boardA, round, seed);
    const rWeb = runWeb(boardB, round, seed);
    if (rSandbox.sig !== rWeb.sig) {
      mismatch++;
      if (mismatch <= 5) {
        console.log(`[不一致] seed=${seed} round=${round} 沙盒步=${rSandbox.steps} 网页步=${rWeb.steps}`);
      }
    }
  }

  const ms = Date.now() - t0;
  console.log(`\n=== 沙盒 vs 网页 战斗一致性（${games} 局）===`);
  console.log(`一致 ${games - mismatch}/${games}，不一致 ${mismatch} 局`);
  console.log(`耗时 ${(ms / 1000).toFixed(1)}s`);
  if (mismatch === 0) console.log('✓ 沙盒战斗与网页 fixed-step 逐位一致');
}

main();
