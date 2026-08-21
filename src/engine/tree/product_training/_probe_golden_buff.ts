// ============================================================
// _probe_golden_buff.ts —— 验证金猴(120) buff 的加/移除全生命周期
// 记录金猴 atk 随时间的完整变化，确认：
//   1. cast 后 +30 生效
//   2. 5 秒后 -30 移除回调是否真的执行
//   3. 金猴是否只 cast 一次（是否还保留 buff）
// 运行：npx vite-node --script src/engine/tree/product_training/_probe_golden_buff.ts
// ============================================================
import '../../env';
import { gameEngine } from '../../../game/GameEngine';
import type { TeamSlot } from '../../../game/GameEngine';
import { battleSystem } from '../../../game/BattleSystem';
import { vfx } from '../../../game/VfxManager';
import { registerAllBadges } from '../../../game/BadgeSystem';

registerAllBadges();
vfx.particlesEnabled = false;

gameEngine.restartGame();
gameEngine.mode = 'ai';
const teamA: TeamSlot[] = [
  { monsterId: 120, badgeIds: [8] },   // 金猴 P1
  { monsterId: 110, badgeIds: [23, 30] }, // 帝国 P1（作为金猴 buff 目标 + 挡刀）
];
const teamB: TeamSlot[] = [
  { monsterId: 104, badgeIds: [3, 4] },  // 散弹 P2（敌人）
  { monsterId: 113, badgeIds: [3, 20] }, // 矿爆 P2（敌人）
];
gameEngine.teams = [teamA, teamB];
gameEngine.setReplaySeed(7);
gameEngine.currentRound = 1;

// 金猴(4,2) 帝国(3,2) 紧邻；散弹(6,2) 矿爆(7,2)
gameEngine.placeMonster(teamA[0], 4, 2, true);
gameEngine.placeMonster(teamA[1], 3, 2, true);
gameEngine.placeMonster(teamB[0], 6, 2, false);
gameEngine.placeMonster(teamB[1], 7, 2, false);

const castLog: string[] = [];
const atkLog: string[] = [];
let lastSample = 0;
let goldAttacks = 0;
const gold = () => gameEngine.boardMonsters.find(m => m.dbId === 120);
const imp = () => gameEngine.boardMonsters.find(m => m.dbId === 110);

const origCastSkill = (battleSystem as any).castSkill.bind(battleSystem);
(battleSystem as any).castSkill = (m: any) => {
  const res = origCastSkill(m);
  if (m.dbId === 120) {
    const elapsed = 40 - (battleSystem as any).timeLeft;
    castLog.push(`t=${elapsed.toFixed(1)}s 金猴cast 自身atk=${m.atk} cdProg=${(m as any).skillCdProgress?.toFixed(2)}`);
  }
  return res;
};
const origPerformNormalAttack = (battleSystem as any).performNormalAttack.bind(battleSystem);
(battleSystem as any).performNormalAttack = (m: any) => {
  if (m.dbId === 120) goldAttacks++;
  return origPerformNormalAttack(m);
};
// 移除回调 hook：直接包 scheduler.schedule 记录
const origSchedule = (battleSystem as any).scheduler.schedule.bind((battleSystem as any).scheduler);
(battleSystem as any).scheduler.schedule = (cb: () => void, delay: number, key?: string) => {
  const id = origSchedule(cb, delay, key);
  if (delay === 5.0) {
    const elapsed = 40 - (battleSystem as any).timeLeft;
    castLog.push(`t=${elapsed.toFixed(1)}s [调度] 5s 后移除 buff (task=${id})`);
  }
  return id;
};

const origUpdate = (battleSystem as any).update.bind(battleSystem);
(battleSystem as any).update = (dt: number) => {
  const g = gold();
  const im = imp();
  if (g) {
    const elapsed = 40 - (battleSystem as any).timeLeft;
    if (elapsed >= lastSample + 0.5) {
      lastSample = elapsed;
      atkLog.push(`t=${elapsed.toFixed(1)}s 金猴atk=${g.atk} state=${g.state} 帝国atk=${im?.atk ?? '?'} hp金猴=${Math.round(g.hp)}`);
    }
  }
  return origUpdate(dt);
};

battleSystem.startBattle();
let elapsed = 0;
while (battleSystem.active && elapsed < 30) {
  battleSystem.update(0.04);
  vfx.update(0.04);
  elapsed += 0.04;
}
if (battleSystem.active) (battleSystem as any).endBattle(null);

console.log('=== 金猴 cast / 调度 记录 ===');
for (const l of castLog) console.log('  ' + l);
console.log('\n=== 金猴 atk 时间线 (0.5s 采样) ===');
for (const l of atkLog) console.log('  ' + l);
console.log(`\n金猴普攻次数: ${goldAttacks}`);
const g = gameEngine.boardMonsters.find(m => m.dbId === 120);
console.log(`战斗结束: 金猴 hp=${g ? Math.round(g.hp) : '?'}/${g?.maxHp} 死=${g?.isDead} atk=${g?.atk}`);
