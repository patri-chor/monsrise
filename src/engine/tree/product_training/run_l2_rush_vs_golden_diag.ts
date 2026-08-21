// ============================================================
// run_l2_rush_vs_golden_diag.ts —— 诊断全冲三阵打金猴(壕炸金猴)的每局差异
// 站在全冲角度：全二冲(all2rush)/经典救星(classicsavior)/梯子塞雷(laddersel) 打 金猴(golden_boom)
// 输出：每局 5 回合得分、金猴被谁打、金猴存活、双方分数曲线
// 运行：npx vite-node --script src/engine/tree/product_training/run_l2_rush_vs_golden_diag.ts [--games 3]
// ============================================================
import '../../env';
import { loadCurrentStrong11Opponents } from './benchmark_pools';
import {
  playSingleGameSymmetric,
  normalizeToEvalSpec,
  type EvalOpponentSpec,
} from './eval_engine';
import { treeStrategyFor } from '../product_tree_strategy';
import { playFullGame } from '../../play_full_game';
import { battleSystem } from '../../../game/BattleSystem';
import { gameEngine } from '../../../game/GameEngine';

const NAME: Record<number, string> = { 110: '帝国', 116: '钻头', 117: '铁甲', 118: '塞雷', 113: '矿爆', 114: '突突', 106: '冲锋', 107: '咒法', 105: '祈祷', 108: '救星', 104: '散弹', 119: '忍猴', 120: '金猴', 124: '金刚', 125: '金猴2', 103: '三振', 115: '铲土', 101: '肃清', 112: '守卫' };

function main() {
  const args = process.argv.slice(2);
  const games = parseInt(args.find(a => a.startsWith('--games='))?.split('=')[1] ?? '3', 10);
  const { opponents } = loadCurrentStrong11Opponents();
  const golden = normalizeToEvalSpec(opponents.find(o => (o as any).id === 'golden_boom') as any);
  const rushIds = ['all2rush', 'classicsavior', 'laddersel'];

  for (const rushId of rushIds) {
    const rush = normalizeToEvalSpec(opponents.find(o => (o as any).id === rushId) as any);
    console.log(`\n========== ${rush.name}(${rushId}) 打 金猴(${golden.id}) ==========`);

    // 从全冲视角看：rush 作为 target，金猴作为 opponent
    for (const side of [1, 2] as (1 | 2)[]) {
      for (let g = 0; g < games; g++) {
        const seed = 100000 + rushIds.indexOf(rushId) * 1000 + side * 100 + g;
        const roundScores: string[] = [];
        const events: string[] = [];
        let goldKilledBy: string | null = null;
        let goldSurvived = false;
        let goldRound: number | null = null;

        const rushStrat = treeStrategyFor(rush.evol);
        const goldStrat = treeStrategyFor(golden.evol);

        const origFindClosestEnemy = (battleSystem as any).findClosestEnemy.bind(battleSystem);
        (battleSystem as any).findClosestEnemy = (m: any, isAttacking: boolean) => {
          const t = origFindClosestEnemy(m, isAttacking);
          if (t?.dbId === 120 && !goldKilledBy) {
            // 记录谁在攻击金猴（攻击方 m 是金猴的敌人 = 全冲方）
            const elapsed = 40 - (battleSystem as any).timeLeft;
            const killed = gameEngine.boardMonsters.find((x: any) => x.dbId === 120)?.isDead;
            if (killed) {
              goldKilledBy = `${NAME[m.dbId] ?? m.dbId}@t=${elapsed.toFixed(1)}s`;
            }
          }
          return t;
        };

        if (side === 1) {
          // 全冲 P1, 金猴 P2
          const res = playFullGame(rush.team, golden.team, {
            seed,
            identityA: rush.id,
            identityB: golden.id,
            strategyA: rushStrat,
            strategyB: goldStrat,
            onRoundEnd: (info) => {
              const myPlans = info.planA.map(p => `${NAME[p.monsterId] ?? p.monsterId}@(${p.x},${p.y})`).join(' ');
              const enPlans = info.planB.map(p => `${NAME[p.monsterId] ?? p.monsterId}@(${p.x},${p.y})`).join(' ');
              events.push(`R${info.round} 得分${info.p1Score}-${info.p2Score} | 全冲:[${myPlans}] | 金猴:[${enPlans}]`);
            },
          });
          const goldAlive = gameEngine.boardMonsters.find((x: any) => x.dbId === 120 && x.team === 2 && !x.isDead);
          goldSurvived = !!goldAlive;
          goldRound = null;
          events.push(`结果: ${res.winner === 1 ? '全冲赢' : res.winner === 2 ? '金猴赢' : '平'}`);
          events.push(`金猴: ${goldKilledBy ? `被${goldKilledBy}杀` : goldSurvived ? '存活' : '死亡'}`);
        } else {
          // 金猴 P1, 全冲 P2
          const res = playFullGame(golden.team, rush.team, {
            seed,
            identityA: golden.id,
            identityB: rush.id,
            strategyA: goldStrat,
            strategyB: rushStrat,
            onRoundEnd: (info) => {
              const myPlans = info.planA.map(p => `${NAME[p.monsterId] ?? p.monsterId}@(${p.x},${p.y})`).join(' ');
              const enPlans = info.planB.map(p => `${NAME[p.monsterId] ?? p.monsterId}@(${p.x},${p.y})`).join(' ');
              events.push(`R${info.round} 得分${info.p1Score}-${info.p2Score} | 金猴:[${myPlans}] | 全冲:[${enPlans}]`);
            },
          });
          const goldAlive = gameEngine.boardMonsters.find((x: any) => x.dbId === 120 && x.team === 1 && !x.isDead);
          goldSurvived = !!goldAlive;
          events.push(`结果: ${res.winner === 2 ? '全冲赢' : res.winner === 1 ? '金猴赢' : '平'}`);
          events.push(`金猴: ${goldKilledBy ? `被${goldKilledBy}杀` : goldSurvived ? '存活' : '死亡'}`);
        }
        (battleSystem as any).findClosestEnemy = origFindClosestEnemy;

        console.log(`  [${side==1?'P1':'P2'} seed=${seed}] ${events.join(' | ')}`);
      }
    }
  }
  console.log('');
}

main();
