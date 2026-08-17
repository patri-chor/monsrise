// ============================================================
// 弃用阵型：礼物金猴（gift_golden）
//
// 弃用原因（2026-08 决策）：
//   - 卡组层自爆流派「银狙礼物流」劣于「巫毒炸弹流」：
//     银狙(109)[24,33] 是 1000 血脆皮，炸弹开局剩 200 血，快速死亡触发礼物
//     给金猴 +90 攻；而壕炸金猴的战壕(125)[32,24] 是 2350 血前排，
//     巫毒(32) 前 10 秒免疫死亡 + 炸弹(24) 死亡爆炸 = 自爆流。
//   - 引擎修复（AnimationAnimator 无技能剪辑不再回落基础剪辑）后，
//     金猴 attack(+30 攻) 空窗消除，银狙礼物的边际价值下降，巫毒炸弹价值上升。
//   - 实测分离分：礼物金猴 30.6% vs 壕炸金猴 97.2%。
//     实验：银狙→战壕后 25%→44%，证实短板在卡组层而非 R3+ 树。
//
// 保留定义以便未来重新设计卡组时恢复。
// ============================================================
import type { Formation } from '../types';

export const 礼物金猴: Formation = {
  id: 'gift_golden',
  name: '礼物金猴',
  archetype: 'prayer',
  signatureCards: [120, 110, 105, 124],
  hasFourCost: true,
  fourCostName: '金面猴王',
  team: [
    { monsterId: 110, badgeIds: [23, 27] },
    { monsterId: 105, badgeIds: [8, 17] },
    { monsterId: 106, badgeIds: [32, 24] },
    { monsterId: 124, badgeIds: [25, 9] },
    { monsterId: 120, badgeIds: [22, 21, 2] },
    { monsterId: 109, badgeIds: [24, 33] },
    { monsterId: 103, badgeIds: [8, 18] },
    { monsterId: 116, badgeIds: [32, 24] },
  ],
  tree: {
    id: 'n1', round: 0, label: '开局', comment: '', placement: [],
    children: [{
      id: 'n2', round: 1, label: '局1', comment: '',
      placement: [
        { monsterId: 110, badgeIds: [23, 27], x: 7, y: 2 },
        { monsterId: 105, badgeIds: [8, 17], x: 8, y: 2 },
      ],
      children: [{
        id: 'n3', round: 2, label: '局2', comment: '',
        placement: [
          { monsterId: 120, badgeIds: [22, 21, 2], x: 8, y: 1 },
        ],
        children: [
          { // 主分支（兜底，祷徒等）
            id: 'n4', round: 3, label: '局3', comment: '银狙(8,0)紧贴金猴(8,1)正上方：死亡时金猴是唯一距离1的友方，礼物(+90攻)稳定给金猴',
            placement: [
              { monsterId: 109, badgeIds: [24, 33], x: 8, y: 0 },
              { monsterId: 103, badgeIds: [8, 18], x: 9, y: 3 },
            ],
            children: [{
              id: 'n5', round: 4, label: '局4', comment: '',
              placement: [
                { monsterId: 124, badgeIds: [25, 9], x: 8, y: 3 },
              ],
              children: [{
                id: 'n6', round: 5, label: '局5', comment: '冲锋',
                placement: [
                  { monsterId: 106, badgeIds: [32, 24], x: 9, y: 1 },
                ],
                children: [],
              }],
            }],
          },
          { // 对方全冲：钻头反制咒法
            id: 'n7', round: 3, label: '对方是全冲', comment: '全冲上钻头反制咒法(107)蓄力炮；钻头位置由计算器按关键怪对齐',
            placement: [
              { monsterId: 116, badgeIds: [32, 24], x: 7, y: 1 },
              { monsterId: 103, badgeIds: [8, 18], x: 9, y: 3 },
            ],
            children: [{
              id: 'n8', round: 4, label: '局4', comment: '',
              placement: [
                { monsterId: 124, badgeIds: [25, 9], x: 8, y: 3 },
              ],
              children: [{
                id: 'n9', round: 5, label: '局5', comment: '冲锋',
                placement: [
                  { monsterId: 106, badgeIds: [32, 24], x: 9, y: 1 },
                ],
                children: [],
              }],
            }],
          },
        ],
      }],
    }],
  },
};
