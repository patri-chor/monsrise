// ============================================================
// _probe_golden_skill.ts —— 验证金猴(120)范围增幅技能行为
// 检查：cast 频率、buff 叠加、持续时间是否生效、范围 2 内友方数量
// 运行：npx vite-node --script src/engine/tree/product_training/_probe_golden_skill.ts
// ============================================================
import '../../env';
import { gameEngine } from '../../../game/GameEngine';
import type { TeamSlot } from '../../../game/GameEngine';
import { battleSystem } from '../../../game/BattleSystem';
import { vfx } from '../../../game/VfxManager';
import { registerAllBadges } from '../../../game/BadgeSystem';
import { AttackSkill } from '../../../game/SkillSystem';
import { DB_MONSTERS } from '../../../game/Database';

registerAllBadges();
vfx.particlesEnabled = false;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 直接测 AttackSkill（金猴）：手工构造 caster + battle mock
function directTest() {
  console.log('\n=== 直接调用 AttackSkill.onCast 测试 ===');
  const skill = new AttackSkill();
  const castLog: string[] = [];
  const fakeScheduler = {
    schedule: (cb: () => void, delay: number) => {
      castLog.push(`  [调度] ${delay.toFixed(1)}s 后回调`);
      // 记录回调但不执行（验证调度时间）
      return `sched_${castLog.length}`;
    },
  };
  const caster: any = { gridX: 7, gridY: 2, team: 2, id: 'c1', atk: 48, isDead: false };
  const ally1: any = { gridX: 8, gridY: 2, team: 2, id: 'a1', atk: 50, isDead: false };
  const ally2: any = { gridX: 5, gridY: 2, team: 2, id: 'a2', atk: 102, isDead: false }; // 距离3
  const enemy: any = { gridX: 4, gridY: 2, team: 1, id: 'e1', atk: 30, isDead: false };
  const battle: any = {
    scheduler: fakeScheduler,
    getMonstersInGridRange: (x: number, y: number, range: number) => {
      const monsters = [caster, ally1, ally2, enemy];
      return monsters.filter(m => Math.abs(m.gridX - x) + Math.abs(m.gridY - y) <= range);
    },
    screenPositions: new Map(),
  };
  console.log('cast 前 atk: caster=', caster.atk, ' ally1=', ally1.atk, ' ally2=', ally2.atk);
  skill.onCast(caster, battle);
  console.log('cast 后 atk: caster=', caster.atk, ' ally1=', ally1.atk, ' ally2=', ally2.atk);
  console.log('调度记录:');
  for (const l of castLog) console.log(l);
}

// 完整战斗测试：金猴 vs 敌人，hook castSkill
function battleTest() {
  console.log('\n=== 完整战斗：金猴(120) 单人 vs 单人 ===');
  gameEngine.restartGame();
  gameEngine.mode = 'ai';
  const teamA: TeamSlot[] = [
    { monsterId: 120, badgeIds: [8] },
  ];
  const teamB: TeamSlot[] = [
    { monsterId: 104, badgeIds: [3, 4] },
  ];
  gameEngine.teams = [teamA, teamB];
  gameEngine.setReplaySeed(42);
  gameEngine.currentRound = 1;

  // 放置：金猴 P1 侧 x=4,y=2；散弹 P2 侧 x=6,y=2
  gameEngine.placeMonster(teamA[0], 4, 2, true);
  gameEngine.placeMonster(teamB[0], 6, 2, false);

  // hook castSkill 记录金猴 cast 时的 atk
  const origCastSkill = (battleSystem as any).castSkill.bind(battleSystem);
  const origPerformNormalAttack = (battleSystem as any).performNormalAttack.bind(battleSystem);
  const castLog: string[] = [];
  const cdLog: string[] = [];
  let goldAttacks = 0;
  let lastCdSample = 0;
  (battleSystem as any).castSkill = (m: any) => {
    const res = origCastSkill(m);
    if (m.dbId === 120) {
      const elapsed = 40 - (battleSystem as any).timeLeft;
      const allies = battleSystem.getMonstersInGridRange(m.gridX, m.gridY, 2)
        .filter((a: any) => a.team === m.team && !a.isDead);
      castLog.push(`t=${elapsed.toFixed(1)}s 金猴cast 自身atk=${m.atk} 范围内友方=${allies.map((a: any) => `${a.dbId}(atk${a.atk})`).join(',') || '无'}`);
    }
    return res;
  };
  (battleSystem as any).performNormalAttack = (m: any) => {
    if (m.dbId === 120) goldAttacks++;
    return origPerformNormalAttack(m);
  };
  // 记录 skillCdProgress 采样
  const gold = () => gameEngine.boardMonsters.find(mm => mm.dbId === 120);
  const origUpdate = (battleSystem as any).update.bind(battleSystem);
  (battleSystem as any).update = (dt: number) => {
    const g = gold();
    if (g) {
      const elapsed = 40 - (battleSystem as any).timeLeft;
      if (elapsed >= lastCdSample + 1.0) {
        lastCdSample = elapsed;
        cdLog.push(`t=${elapsed.toFixed(1)}s 金猴 cdProg=${(g as any).skillCdProgress?.toFixed(2)} state=${g.state} atkTimer=${(battleSystem as any)._attackTimers.get(g.id)?.toFixed(2)}`);
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

  console.log('金猴 cast 记录:');
  for (const l of castLog.slice(0, 12)) console.log('  ' + l);
  console.log(`金猴普攻次数: ${goldAttacks}`);
  console.log('金猴 CD/状态采样:');
  for (const l of cdLog.slice(0, 12)) console.log('  ' + l);
  const g = gameEngine.boardMonsters.find(mm => mm.dbId === 120);
  console.log(`战斗结束: 金猴 hp=${g ? Math.round(g.hp) : '?'}/${g?.maxHp} 死=${g?.isDead}`);
}

directTest();
battleTest();
