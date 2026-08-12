# -*- coding: utf-8 -*-
"""
状态编码：自走棋局面 → 张量（网格 11x5 通道 + 全局特征）。
与 TS 训练特征解耦，供 PyTorch 双头网络（策略 π + 价值 v）使用。
"""
from dataclasses import dataclass, field

# 怪兽 id 101..126 → 索引 0..25
MONSTER_OFFSET = 101
MONSTER_COUNT = 26

GRID_W = 11  # 列
GRID_H = 5   # 行
GRID_CH = 2 + MONSTER_COUNT  # 我方/敌方 + dbId one-hot = 28
CELL_COUNT = 25              # 己方半区 5x5
GRID_FLAT = GRID_W * GRID_H * GRID_CH  # 1540
GLOBAL_DIM = 58  # 5 标量 + 手牌 one-hot 26 + 卡组 one-hot 26 + 比分差 1

BUDGET_LIMITS = {1: 4, 2: 8, 3: 12, 4: 14, 5: 16}


def db_id_to_idx(db_id: int) -> int:
    return db_id - MONSTER_OFFSET


def idx_to_db_id(idx: int) -> int:
    return idx + MONSTER_OFFSET


def cell_to_xy(side: str, cell: int):
    """己方半区格子索引 → (x, y)。p1 半区 x∈[0,4]，p2 x∈[6,10]"""
    y = cell // 5
    col = cell % 5
    x = col if side == 'p1' else 6 + col
    return x, y


def xy_to_cell(side: str, x: int, y: int) -> int:
    col = x if side == 'p1' else x - 6
    return y * 5 + col


@dataclass
class State:
    """己方视角放置局面（雾战：敌我半场可见，敌方本轮放置不可见）"""
    side: str                     # 'p1' | 'p2'
    my: list                      # 己方半场怪 [{dbId,x,y}]
    enemy: list                   # 敌方半场怪（上回合结束可见）[{dbId,x,y}]
    hand: list                    # 手牌 dbId 列表（卡组未放置）
    round: int
    budget: int                   # 剩余预算
    budget_limit: int
    deck: list                    # 完整卡组 dbId 列表（one-hot 用）
    score: tuple = (0, 0)         # 当前比分 (p1_score, p2_score)，影响策略（领先保守/落后激进）
                                  # 默认 (0,0)：旧代码/迁移路径（残局库旧 key 无比分）不传也能跑

    def legal_monsters(self):
        return [m for m in self.hand if self._cost(m) <= self.budget]

    def legal_cells(self):
        occupied = {(m['x'], m['y']) for m in self.my}
        lo = 0 if self.side == 'p1' else 6
        hi = 4 if self.side == 'p1' else 10
        return [
            (x, y)
            for y in range(GRID_H)
            for x in range(lo, hi + 1)
            if (x, y) not in occupied
        ]

    def legal_actions(self):
        cells = self.legal_cells()
        return [(m, c) for m in self.legal_monsters() for c in cells]

    def _cost(self, db_id: int) -> int:
        return COST_BY_ID.get(db_id, 4)


# 怪兽基础属性表（由引擎 db 请求填充，见 init_meta）
COST_BY_ID: dict[int, int] = {}


def init_meta(db: dict) -> None:
    """从引擎 db 请求填充怪兽属性表（进程内单次调用）。"""
    global COST_BY_ID
    for m in db['monsters']:
        COST_BY_ID[m['id']] = m['cost']


def encode_state(s: State):
    """返回 (grid_tensor, global_tensor)。grid: (28,5,11) float32；global: (58,)"""
    import numpy as np
    grid = np.zeros((GRID_CH, GRID_H, GRID_W), dtype=np.float32)
    my_team = 1 if s.side == 'p1' else 2
    for m in s.my:
        idx = db_id_to_idx(m['dbId'])
        y, x = m['y'], m['x']
        grid[0, y, x] = 1.0
        grid[2 + idx, y, x] = 1.0
    for m in s.enemy:
        idx = db_id_to_idx(m['dbId'])
        y, x = m['y'], m['x']
        grid[1, y, x] = 1.0
        grid[2 + idx, y, x] = 1.0

    hand_oh = np.zeros(MONSTER_COUNT, dtype=np.float32)
    for m in s.hand:
        hand_oh[db_id_to_idx(m)] = 1.0
    deck_oh = np.zeros(MONSTER_COUNT, dtype=np.float32)
    for m in s.deck:
        deck_oh[db_id_to_idx(m)] = 1.0
    # 比分态势：比分差归一化（先到3胜 → ±3 → ±1），指导保守/激进
    score_diff = float(s.score[0] - s.score[1]) / 3.0 if s.score else 0.0
    g = np.concatenate([
        np.array([s.round / 5.0, s.budget / 16.0, s.budget_limit / 16.0,
                 len(s.my) / 16.0, len(s.enemy) / 16.0], dtype=np.float32),
        hand_oh,
        deck_oh,
        np.array([score_diff], dtype=np.float32),
    ])
    return grid, g


def action_mask(s: State):
    """动作掩码：monster 合法（26，按手牌+cost），cell 合法（25，按空格）。"""
    import numpy as np
    m_mask = np.zeros(MONSTER_COUNT, dtype=np.float32)
    for m in s.legal_monsters():
        m_mask[db_id_to_idx(m)] = 1.0
    c_mask = np.zeros(CELL_COUNT, dtype=np.float32)
    for x, y in s.legal_cells():
        c_mask[xy_to_cell(s.side, x, y)] = 1.0
    return m_mask, c_mask


# ======================================================================
# Zobrist 哈希 + 对称性 canonicalization（经验库精确/等价匹配用）
# 局面哈希 = XOR(我方怪表, 敌方怪表, 回合, 预算)；我方/敌方用不同随机数区分归属。
# canonical：4 种空间变换（原始 / x镜像 / y翻转 / 双翻转）中取哈希最小者 →
# 一次查表同时覆盖所有对称等价局面（x镜像与 y 翻转对整局面语义保持）。
# 换边（p1/p2 视角互换）会使"我方动作"变成"敌方动作"，无法直接复用，故不进 canonical。
# 用固定种子生成随机数表 → 跨进程/跨会话哈希一致（可复现）。
# ======================================================================
import random as _random

_ZOB_RNG = _random.Random(20260812)
ZOB_MY: dict = {}      # (dbId, x, y) -> 64位随机数（我方怪）
ZOB_EN: dict = {}      # (dbId, x, y) -> 64位随机数（敌方怪）
ZOB_ROUND: dict = {}
ZOB_BUDGET: dict = {}


def _ensure_zobrist() -> None:
    if ZOB_MY:
        return
    for db in range(101, 127):
        for x in range(11):
            for y in range(GRID_H):
                ZOB_MY[(db, x, y)] = _ZOB_RNG.getrandbits(64)
                ZOB_EN[(db, x, y)] = _ZOB_RNG.getrandbits(64)
    for r in range(1, 6):
        ZOB_ROUND[r] = _ZOB_RNG.getrandbits(64)
    for b in range(0, 17):
        ZOB_BUDGET[b] = _ZOB_RNG.getrandbits(64)


def _apply_t(units, t: int) -> list:
    """空间变换：t bit0=1 → x 镜像(10-x)；t bit1=1 → y 翻转(4-y)。"""
    if t == 0:
        return units
    out = []
    for m in units:
        x, y = m['x'], m['y']
        if t & 1:
            x = 10 - x
        if t & 2:
            y = 4 - y
        out.append({'dbId': m['dbId'], 'x': x, 'y': y})
    return out


def canonical_hash(s) -> int:
    """对称规范化哈希：4 种空间变换取最小（不含换边）。"""
    _ensure_zobrist()
    best = None
    for t in range(4):
        h = ZOB_ROUND.get(s.round, 0) ^ ZOB_BUDGET.get(s.budget, 0)
        for m in _apply_t(s.my, t):
            h ^= ZOB_MY[(m['dbId'], m['x'], m['y'])]
        for e in _apply_t(s.enemy, t):
            h ^= ZOB_EN[(e['dbId'], e['x'], e['y'])]
        best = h if best is None else min(best, h)
    return best


def canonical_transform(s) -> tuple:
    """返回 (canonical_hash, t*)，t* 为取到最小哈希的变换（动作还原用）。"""
    _ensure_zobrist()
    best_h, best_t = None, 0
    for t in range(4):
        h = ZOB_ROUND.get(s.round, 0) ^ ZOB_BUDGET.get(s.budget, 0)
        for m in _apply_t(s.my, t):
            h ^= ZOB_MY[(m['dbId'], m['x'], m['y'])]
        for e in _apply_t(s.enemy, t):
            h ^= ZOB_EN[(e['dbId'], e['x'], e['y'])]
        if best_h is None or h < best_h:
            best_h, best_t = h, t
    return best_h, best_t


def inv_apply_t(act: tuple, t: int) -> tuple:
    """动作反变换（与 _apply_t 同变换，幂等）：canonical 坐标 → 原视角坐标。"""
    db_id, x, y = act
    if t & 1:
        x = 10 - x
    if t & 2:
        y = 4 - y
    return (db_id, x, y)


def mirror_sample(sample) -> tuple:
    """镜像扩增：棋盘左右对称（x→10-x），从对侧视角看同一局面。
    样本 (grid, g, π_m, π_c, z) 或 (grid, g, π_m, π_c, z, w) → (grid', g', π_m, π_c', -z[, w])。
      - grid：x 轴翻转 + 我方/敌方通道互换（镜像后原我方半区在新视角为敌方）
      - g：len(my)/len(enemy) 互换；round/budget 不变（同回合双方同预算）；
        hand/deck 保持原视角（雾战无对手手牌，近似扩增）
      - π_m：怪物分布不变（同一只怪）；π_c：半区 col→4-col 翻转
      - z：胜负视角取反；w（若有）不变"""
    import numpy as np
    has_w = len(sample) == 6
    grid, g, pi_m, pi_c, z = sample[:5]
    w = sample[5] if has_w else None
    gr = np.ascontiguousarray(grid[:, :, ::-1])
    gr[[0, 1]] = gr[[1, 0]]           # 我方↔敌方通道互换
    g2 = np.ascontiguousarray(g)
    g2[3], g2[4] = g[4], g[3]         # len(my) ↔ len(enemy)
    if g2.shape[0] > 57:
        g2[57] = -g[57]               # 比分差视角取反（p1 视角差 = p2 视角负差）
    pc = np.ascontiguousarray(pi_c.reshape(5, 5)[:, ::-1].reshape(-1))
    if has_w:
        return gr, g2, pi_m, pc, -z, w
    return gr, g2, pi_m, pc, -z


def flip_y_sample(sample) -> tuple:
    """上下镜像（Y 轴翻转 y -> 4-y）数据增强。
    样本 (grid, g, pi_m, pi_c, z[, w]) → (grid', g, pi_m, pi_c', z[, w])。
      - grid: y 轴翻转 (shape为 (CH, H, W)，H=5 沿 dim 1 翻转)
      - g: 全局特征完全不变
      - pi_m: 选怪分布不变
      - pi_c: 25 格位置分布按 y 轴 (5,5) 翻转
      - z: 胜负判定不变 (上下物理对称)"""
    import numpy as np
    has_w = len(sample) == 6
    grid, g, pi_m, pi_c, z = sample[:5]
    w = sample[5] if has_w else None
    gr = np.ascontiguousarray(grid[:, ::-1, :])
    g2 = np.ascontiguousarray(g)
    pc = np.ascontiguousarray(pi_c.reshape(5, 5)[::-1, :].reshape(-1))
    if has_w:
        return gr, g2, pi_m, pc, z, w
    return gr, g2, pi_m, pc, z
