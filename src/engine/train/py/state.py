# -*- coding: utf-8 -*-
"""
状态编码：自走棋局面 → 张量（网格 11x5 通道 + 全局特征）。
与 TS 训练特征解耦，供 PyTorch 双头网络（策略 π + 价值 v）使用。
"""
from dataclasses import dataclass, field
import os

# 怪兽 id 101..126 → 索引 0..25
MONSTER_OFFSET = 101
MONSTER_COUNT = 26

# 有效徽章（已实现的，14/15/19/31/34 为未实现空类，与 BadgeSystem.ts / evolution.ts 一致）
BADGE_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 16, 17, 18,
             20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 32, 33, 35, 36]
BADGE_COUNT = len(BADGE_IDS)
BADGE_IDX = {bid: i for i, bid in enumerate(BADGE_IDS)}

# 关联特征维度（无损三件套：徽章 multiset one-hot + 首徽章 one-hot + carry 标志）。
# 与身份 embedding 解耦：同一怪兽 id 在不同卡组里带不同徽章，必须显式喂给网络。
MON_FEAT_DIM = 2 * BADGE_COUNT + 1

# 状态特征 = 无损身份 + 几何拓扑（不含语义抽象；A/B 实测语义抽象对核心指标无增益）。
GRID_W = 11  # 列
GRID_H = 5   # 行
# 32 基础通道（2 归属 + 26 怪兽 one-hot + 4 拓扑几何） + BADGE_COUNT 徽章落格通道
GRID_CH = 32 + BADGE_COUNT
CELL_COUNT = 25              # 己方半区 5x5
GRID_FLAT = GRID_W * GRID_H * GRID_CH
# 无损关联三件套开关（A/B 验证用）：MON_ASSOC=0 关闭 → 回到旧维度（纯身份 + 几何）。
MON_ASSOC_ON = os.environ.get('MON_ASSOC', '1') != '0'
# 58 基础全局（5 标量 + 手牌 26 + 卡组 26 + 比分差 1）
#  + 卡组徽章直方图 BADGE_COUNT + 手牌徽章直方图 BADGE_COUNT
#  + 每怪兽无损关联表 MONSTER_COUNT * MON_FEAT_DIM（徽章集合 + 首徽章 + carry）
GLOBAL_DIM = 58 + 2 * BADGE_COUNT + (MONSTER_COUNT * MON_FEAT_DIM if MON_ASSOC_ON else 0)

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
    my: list                      # 己方半场怪 [{dbId,x,y}]（可含 badgeIds）
    enemy: list                   # 敌方半场怪（上回合结束可见）[{dbId,x,y}]（可含 badgeIds）
    hand: list                    # 手牌 dbId 列表（卡组未放置）
    round: int
    budget: int                   # 剩余预算
    budget_limit: int
    deck: list                    # 完整卡组 dbId 列表（one-hot 用）
    score: tuple = (0, 0)         # 当前比分 (p1_score, p2_score)
    deck_badges: dict = field(default_factory=dict)  # dbId -> badgeIds（己方卡组徽章映射）

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
ROLE_BY_ID: dict[int, str] = {}
TYPE_BY_ID: dict[int, str] = {}


def init_meta(db: dict) -> None:
    """从引擎 db 请求填充怪兽属性表（进程内单次调用）。"""
    global COST_BY_ID, ROLE_BY_ID, TYPE_BY_ID
    for m in db['monsters']:
        COST_BY_ID[m['id']] = m['cost']
        ROLE_BY_ID[m['id']] = m.get('role', '')
        TYPE_BY_ID[m['id']] = m.get('type', 'melee')


def _mon_badge_table(s: State):
    """每怪兽无损关联特征表 (MONSTER_COUNT, MON_FEAT_DIM)：
    [0:31] 徽章集合 one-hot；[31:62] 首徽章 one-hot（接力 35 转移首个徽章，顺序有语义）；
    [62] carry 标志（4 费核心/3 徽章主力，锚定站位）。
    仅卡组内怪兽非零；同一 id 在不同卡组带不同徽章，必须显式喂给网络（与身份 one-hot 解耦）。"""
    import numpy as np
    table = np.zeros((MONSTER_COUNT, MON_FEAT_DIM), dtype=np.float32)
    for db in s.deck:
        idx = db_id_to_idx(db)
        bids = s.deck_badges.get(db, [])
        for b in bids:
            bi = BADGE_IDX.get(b)
            if bi is not None:
                table[idx, bi] = 1.0
        if bids:
            b0 = BADGE_IDX.get(bids[0])
            if b0 is not None:
                table[idx, BADGE_COUNT + b0] = 1.0
        if COST_BY_ID.get(db, 4) == 4:
            table[idx, MON_FEAT_DIM - 1] = 1.0
    return table


def encode_state(s: State):
    """返回 (grid_tensor, global_tensor)。grid: (GRID_CH,5,11) float32；global: (GLOBAL_DIM,)
    包含 Tier-1 基础物理通道 + Tier-2 拓扑几何高层引导特征 + Tier-3 徽章协同通道。"""
    import numpy as np
    grid = np.zeros((GRID_CH, GRID_H, GRID_W), dtype=np.float32)
    my_team = 1 if s.side == 'p1' else 2
    badge_ch_base = 32  # 徽章通道起始下标
    for m in s.my:
        idx = db_id_to_idx(m['dbId'])
        y, x = m['y'], m['x']
        grid[0, y, x] = 1.0
        grid[2 + idx, y, x] = 1.0
        # 徽章协同通道：己方怪优先取自身 badgeIds，缺失时回退卡组映射
        bids = m.get('badgeIds') or s.deck_badges.get(m['dbId'], [])
        for b in bids:
            bi = BADGE_IDX.get(b)
            if bi is not None:
                grid[badge_ch_base + bi, y, x] = 1.0
    for m in s.enemy:
        idx = db_id_to_idx(m['dbId'])
        y, x = m['y'], m['x']
        grid[1, y, x] = 1.0
        grid[2 + idx, y, x] = 1.0
        for b in (m.get('badgeIds') or []):
            bi = BADGE_IDX.get(b)
            if bi is not None:
                grid[badge_ch_base + bi, y, x] = 1.0

    # ---- Tier-2 拓扑几何高层引导特征矩阵计算 (Two-Tier Guided Features) ----
    my_pos = {(m['x'], m['y']) for m in s.my}
    en_pos = {(m['x'], m['y']) for m in s.enemy}
    
    for y in range(GRID_H):
        for x in range(GRID_W):
            # 1. Density_Radius_1 (周围 8 格密度，回答"怪兽周围有几个人")
            r1_my = sum(1 for dy in (-1, 0, 1) for dx in (-1, 0, 1) if (dx != 0 or dy != 0) and (x + dx, y + dy) in my_pos)
            r1_en = sum(1 for dy in (-1, 0, 1) for dx in (-1, 0, 1) if (dx != 0 or dy != 0) and (x + dx, y + dy) in en_pos)
            grid[28, y, x] = (r1_my - r1_en) / 8.0
            
            # 2. Density_Radius_2 (周围 24 格中距离密度)
            r2_my = sum(1 for dy in range(-2, 3) for dx in range(-2, 3) if (dx != 0 or dy != 0) and (x + dx, y + dy) in my_pos)
            grid[29, y, x] = r2_my / 24.0
            
            # 3. Adjacency_Degree (正交上下左右 4 格邻接度，引导护盾与接力必相邻)
            adj_4 = sum(1 for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)) if (x + dx, y + dy) in my_pos)
            grid[30, y, x] = adj_4 / 4.0
            
            # 4. Frontline_Depth (战场相对前线深度梯度)
            rel_x = x if s.side == 'p1' else 10 - x
            grid[31, y, x] = rel_x / 10.0

    hand_oh = np.zeros(MONSTER_COUNT, dtype=np.float32)
    for m in s.hand:
        hand_oh[db_id_to_idx(m)] = 1.0
    deck_oh = np.zeros(MONSTER_COUNT, dtype=np.float32)
    for m in s.deck:
        deck_oh[db_id_to_idx(m)] = 1.0
    # 卡组 / 手牌徽章直方图（流派的隐性连接画像：卡组携带哪些徽章、当前手牌还有哪些徽章）
    deck_badge_hist = np.zeros(BADGE_COUNT, dtype=np.float32)
    for db in s.deck:
        for b in s.deck_badges.get(db, []):
            bi = BADGE_IDX.get(b)
            if bi is not None:
                deck_badge_hist[bi] += 1.0
    hand_badge_hist = np.zeros(BADGE_COUNT, dtype=np.float32)
    for db in s.hand:
        for b in s.deck_badges.get(db, []):
            bi = BADGE_IDX.get(b)
            if bi is not None:
                hand_badge_hist[bi] += 1.0
    # 比分态势：比分差归一化（先到3胜 → ±3 → ±1），指导保守/激进
    score_diff = float(s.score[0] - s.score[1]) / 3.0 if s.score else 0.0
    parts = [
        np.array([s.round / 5.0, s.budget / 16.0, s.budget_limit / 16.0,
                 len(s.my) / 16.0, len(s.enemy) / 16.0], dtype=np.float32),
        hand_oh,
        deck_oh,
        np.array([score_diff], dtype=np.float32),
        deck_badge_hist,
        hand_badge_hist,
    ]
    # 无损关联三件套：每怪兽徽章集合 + 首徽章 + carry，展平接入全局特征
    if MON_ASSOC_ON:
        parts.append(_mon_badge_table(s).reshape(-1))
    g = np.concatenate(parts)
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
