import './mock_setup';

import { gameEngine } from '../src/game/GameEngine';
import { battleSystem } from '../src/game/BattleSystem';
import { registerAllBadges, getMonsterBadges } from '../src/game/BadgeSystem';
import { vfx } from '../src/game/VfxManager';

let nextTimerId = 1;
let fakeTimers: { id: number; callback: Function; time: number; interval?: number }[] = [];
let fakeTimeElapsed = 0;

// const origSetTimeout = globalThis.setTimeout;
// const origClearTimeout = globalThis.clearTimeout;
// const origSetInterval = globalThis.setInterval;
// const origClearInterval = globalThis.clearInterval;

function mockTimers() {
  globalThis.setTimeout = ((cb: Function, delay: number = 0, ...args: any[]) => {
    const id = nextTimerId++;
    fakeTimers.push({ id, callback: () => cb(...args), time: fakeTimeElapsed + delay });
    return id as any;
  }) as any;
  globalThis.clearTimeout = ((id: any) => { fakeTimers = fakeTimers.filter(t => t.id !== id); }) as any;
  globalThis.setInterval = ((cb: Function, delay: number = 0, ...args: any[]) => {
    const id = nextTimerId++;
    fakeTimers.push({ id, callback: () => cb(...args), time: fakeTimeElapsed + delay, interval: delay });
    return id as any;
  }) as any;
  globalThis.clearInterval = ((id: any) => { fakeTimers = fakeTimers.filter(t => t.id !== id); }) as any;
}

function tickTime(dtSeconds: number) {
  const dtMs = dtSeconds * 1000;
  const targetTime = fakeTimeElapsed + dtMs;
  while (true) {
    fakeTimers.sort((a, b) => a.time - b.time);
    const next = fakeTimers[0];
    if (next && next.time <= targetTime) {
      fakeTimeElapsed = next.time;
      if (next.interval !== undefined) next.time = fakeTimeElapsed + next.interval;
      else fakeTimers.shift();
      try { next.callback(); } catch (e) { console.error('timer error:', e); }
    } else break;
  }
  fakeTimeElapsed = targetTime;
}

function runBattleTicks(seconds: number, step: number = 0.05) {
  let elapsed = 0;
  while (elapsed < seconds && battleSystem.active) {
    tickTime(step);
    battleSystem.update(step);
    vfx.update(step);
    elapsed += step;
  }
}

registerAllBadges();
mockTimers();

function resetAll() {
  gameEngine.restartGame();
  vfx.clear();
  fakeTimers = [];
  fakeTimeElapsed = 0;
}

// ============ Test 1: 鲁莽 badge stacking on 108's normal attacks ============
resetAll();
const m = gameEngine.placeMonster({ monsterId: 108, badgeIds: [3, 22, 21] }, 4, 2, true)!;
const target = gameEngine.placeMonster({ monsterId: 103, badgeIds: [] }, 6, 2, false)!;
battleSystem.startBattle();
(globalThis as any).__dbg = true;
console.log('  ats=', m.ats, 'interval=', 1 / m.ats);
// frame-level trace of atkTimer between t=1.2 and t=3.2
const origUpdate = battleSystem.update.bind(battleSystem);
(battleSystem as any).update = (dt: number) => {
  const t = fakeTimeElapsed / 1000;
  if (t >= 1.2 && t <= 3.3) {
    const atkTimer = (battleSystem as any)._attackTimers.get(m.id) || 0;
    console.log(`  [FRAME] t=${t.toFixed(2)} atkTimer=${atkTimer.toFixed(2)} state=${m.state} hp=${m.hp}`);
  }
  origUpdate(dt);
};
const reckless = getMonsterBadges(m).find(b => b.id === 22);
const origOnAfter = (reckless as any).onAfterDealDamage.bind(reckless);
(reckless as any).onAfterDealDamage = (mm: any, ctx: any) => {
  console.log(`  [STACK] t=${fakeTimeElapsed.toFixed(2)} stacks before=${(reckless as any)._state.get(mm.id)?.stacks ?? 0}`);
  origOnAfter(mm, ctx);
  const s = (reckless as any)._state.get(mm.id);
  console.log(`  [STACK] t=${fakeTimeElapsed.toFixed(2)} stacks after=${s?.stacks} timer=${s?.timer?.toFixed(2)}`);
};
// track stacking progression each second
for (let s = 1; s <= 6; s++) {
  runBattleTicks(1.0);
  const state = (reckless as any)?._state?.get(m.id);
  const atkTimer = (battleSystem as any)._attackTimers.get(m.id);
  console.log(`t=${s}s stacks=${state?.stacks ?? 0} timer=${state?.timer?.toFixed(1) ?? '-'} atkTimer=${atkTimer?.toFixed(2)} state=${m.state} hp=${m.hp}`);
}
console.log('  target hp:', target.hp, 'maxHp:', target.maxHp);

// ============ Test 2: Leap skill landing damage ============
resetAll();
gameEngine.currentRound = 3;
const m2 = gameEngine.placeMonster({ monsterId: 108, badgeIds: [] }, 4, 2, true)!;
const ally = gameEngine.placeMonster({ monsterId: 101, badgeIds: [] }, 4, 0, true)!;
// enemy near the ally (ally at 4,0, enemy at 6,0)
const enemy = gameEngine.placeMonster({ monsterId: 110, badgeIds: [] }, 6, 0, false)!;
const enemyHpBefore = enemy.hp;
battleSystem.startBattle();
battleSystem._lastDamagedFriendlyIdP1 = ally.id;
const casted = (battleSystem as any).castSkill(m2!);
console.log('=== Test 2: Leap skill damage ===');
console.log('  casted:', casted);
console.log('  enemy hp before:', enemyHpBefore, 'after cast:', enemy.hp);
runBattleTicks(1.0); // LEAP_DURATION = 0.6
console.log('  enemy hp after 1s:', enemy.hp);
console.log('  m2 grid:', m2.gridX, m2.gridY);

// ============ Test 3: 鲁莽对救星骑士跃击技能伤害的加成 ============
// 精确验证：无友军（targetAlly 回退为自身），无旁路伤害，手动播种鲁莽层数
function runLeapSkillDmg(badgeIds: number[], seedStacks: number, label: string): void {
  resetAll();
  gameEngine.currentRound = 3;
  const c = gameEngine.placeMonster({ monsterId: 108, badgeIds }, 4, 2, true)!;
  // 101 肃清哥无护盾技能，便于精确计算落地伤害
  const e = gameEngine.placeMonster({ monsterId: 101, badgeIds: [] }, 6, 0, false)!;
  battleSystem.startBattle(); // startBattle 会 resetBadgeBattleState 清空徽章状态
  if (seedStacks > 0) {
    const reckless = getMonsterBadges(c).find(b => b.id === 22);
    (reckless as any)._state.set(c.id, { stacks: seedStacks, timer: 2.0 });
  }
  const casted = (battleSystem as any).castSkill(c);
  if (!casted) { console.log(`  [${label}] cast failed`); return; }
  const hpBeforeLand = e.hp;
  runBattleTicks(0.7); // LEAP_DURATION=0.6，0.7s 足够落地且不引入普攻
  const dmg = hpBeforeLand - e.hp;
  console.log(`[Test3 ${label}] 落地伤害=${dmg}`);
}
console.log('=== Test 3: 鲁莽对跃击技能伤害加成 ===');
runLeapSkillDmg([], 0, '无徽章(0层)');
runLeapSkillDmg([22], 0, '鲁莽(0层)');
runLeapSkillDmg([22], 3, '鲁莽(3层)');
console.log('  预期：0层=540，3层=540*1.48=799');

// ============ Test 4: 真实流程下，技能自动施放时鲁莽层数是否存活 ============
function runRealSkill(badgeIds: number[], label: string): void {
  resetAll();
  gameEngine.currentRound = 3;
  const c = gameEngine.placeMonster({ monsterId: 108, badgeIds }, 4, 2, true)!;
  const e = gameEngine.placeMonster({ monsterId: 101, badgeIds: [] }, 6, 2, false)!;
  battleSystem.startBattle();

  // 监听 castSkill
  const origCast = (battleSystem as any).castSkill.bind(battleSystem);
  (battleSystem as any).castSkill = (mm: any) => {
    const r = origCast(mm);
    if (mm?.dbId === 108 && r) {
      console.log(`  [${label}] t=${(fakeTimeElapsed / 1000).toFixed(2)} castSkill(108) 成功`);
    }
    return r;
  };
  // 监听跃击落点的大额伤害（raw=基础技能伤害，实际扣血=鲁莽加成后的最终伤害）
  const origApply2 = battleSystem.applyDamage.bind(battleSystem);
  (battleSystem as any).applyDamage = (target: any, amount: number, attacker: any, options?: any) => {
    const hpBefore = target.hp;
    const r = origApply2(target, amount, attacker, options);
    if (target === e && amount >= 400) {
      const reckless = getMonsterBadges(c).find(b => b.id === 22);
      const s = reckless ? (reckless as any)?._state?.get(c.id) : undefined;
      console.log(`  [${label}] t=${(fakeTimeElapsed / 1000).toFixed(2)} 技能落点 raw=${amount} 实际扣血=${hpBefore - target.hp} stacks=${s?.stacks ?? 0}`);
    }
    return r;
  };

  // 每 1s 打印层数
  const reckless = getMonsterBadges(c).find(b => b.id === 22);
  for (let s = 1; s <= 12; s++) {
    runBattleTicks(1.0);
    const st = reckless ? (reckless as any)?._state?.get(c.id) : undefined;
    console.log(`  [${label}] t=${s}s stacks=${st?.stacks ?? 0} timer=${st?.timer?.toFixed(2) ?? '-'} enemyHp=${e.hp}`);
  }
}
console.log('=== Test 4: 技能自动施放时鲁莽层数 ===');
runRealSkill([22], '带鲁莽');

console.log('\nDONE');
process.exit(0);
