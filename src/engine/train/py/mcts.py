# -*- coding: utf-8 -*-
"""
MCTS（网络引导，AlphaZero 式）：己方单 agent 回合内放置序列优化。
节点评估用价值网络 v（不做 rollout，避免引擎 IPC 成为瓶颈）；
根节点访问计数分布 π 作为训练目标。

use_real_sim=True 时（推荐，实测 vs 随机 100% 的 TS search 同思路）：
每个扩展节点用"贪心补齐剩余预算 → bridge 真实回合战斗模拟"得到叶价值，
价值 = 回合胜负(±0.85) + 存活血量占比(±0.15)，让搜索直接感知真实战斗结果。
"""
import math

import numpy as np

from .state import State, db_id_to_idx, idx_to_db_id, cell_to_xy
from .heuristic import heuristic_prior, script_value


class Node:
    __slots__ = ('s', 'parent', 'P', 'N', 'W', 'children', 'expanded', 'v_leaf')

    def __init__(self, s: State, parent=None, P: float = 0.0):
        self.s = s
        self.parent = parent
        self.P = P
        self.N = 0
        self.W = 0.0
        self.children: dict[tuple[int, int], 'Node'] = {}
        self.expanded = False
        self.v_leaf = 0.0


class MCTS:
    def __init__(self, net, num_sim: int = 24, c_puct: float = 1.5, device='cpu',
                 cache_cap: int = 50000, prior_lambda: float = 0.7, value_net_weight: float = 0.3,
                 engine=None, deck=None, use_real_sim: bool = False,
                 dirichlet_alpha: float = 0.0, dirichlet_eps: float = 0.25, exp_lib=None):
        self.net = net
        self.num_sim = num_sim
        self.c_puct = c_puct
        self.device = device
        # 领域启发式先验混合系数：P_final ∝ (P_net)^(1-λ)·(P_heur)^λ。
        # 冷启动阶段网络乱放，靠启发式把决策拉向"相对合理"（坦克前排/远程后排/相邻协同/四费优先）；
        # 网络学好后可调低 λ 让网络主导（train.py 随训练进度衰减 self.prior_lambda）。
        self.prior_lambda = prior_lambda
        # 叶节点价值混合：v = (1-w)·理性基线 + w·网络价值。
        # 欠训练网络价值"倒挂"（坦克后排分高、前排分低）会带偏搜索，
        # 理性基线（战力+站位结构）保证选中动作在常识上合理；网络学好后再逐步提高 w。
        # use_real_sim=True 时价值直接用真实战斗模拟，不再混合。
        self.value_net_weight = value_net_weight
        # 局面价值缓存（残局库式去重）：相同局面只做一次网络前向，避免重复计算。
        # key = 状态关键字段元组；value = (pm, pc, v_blend)。容量满则整体清空（局面重复度高，可接受）。
        self.cache: dict = {}
        self.cache_cap = cache_cap
        # 真实战斗模拟评估（bridge）：engine=EngineClient，deck={dbId: badgeIds}
        self.engine = engine
        self.deck = deck or {}
        self.use_real_sim = use_real_sim
        # 根节点 Dirichlet 噪声（AlphaZero 式探索，仅自对弈训练时开启）：
        # P_root(a) = (1-ε)·P(a) + ε·η_a，η ~ Dir(α)。评估/部署传 dirichlet_alpha=0 关闭。
        self.dirichlet_alpha = dirichlet_alpha
        self.dirichlet_eps = dirichlet_eps
        # 在线经验库（可选）：精确记忆"局面→动作"，命中正分候选作为强先验加权（只加权不覆盖）。
        self.exp_lib = exp_lib

    @staticmethod
    def _state_key(s: State):
        from .state import canonical_hash
        return (
            canonical_hash(s),
            s.budget,
            s.round,
            s.score,
            tuple(sorted(s.hand))
        )

    def _greedy_fill(self, s: State):
        """贪心补齐剩余预算（TS search evaluateCandidate 同思路）：
        反复取启发式权重最大的合法动作，直到无牌可放。返回补齐后的己方列表。"""
        my = [dict(m) for m in s.my]
        hand = list(s.hand)
        budget = s.budget
        while True:
            ss = State(s.side, my, s.enemy, hand, s.round, budget, s.budget_limit, s.deck)
            acts = ss.legal_actions()
            if not acts:
                break
            h = heuristic_prior(ss)
            db_id, (x, y) = max(acts, key=lambda a: h.get(a, 1.0))
            my.append({'dbId': db_id, 'x': x, 'y': y})
            hand.remove(db_id)
            budget -= ss._cost(db_id)
        return my

    def _real_sim_value(self, s: State) -> float:
        """真实回合战斗模拟叶价值：补齐棋盘 → bridge simulate → 组合信号。
        价值 = 0.85·回合胜负(±1) + 0.15·(2·己方血量占比-1)，clip 到 [-1,1]。"""
        filled = self._greedy_fill(s)
        my_team = 1 if s.side == 'p1' else 2
        en_team = 2 if s.side == 'p1' else 1
        board = []
        for m in filled:
            board.append({
                'dbId': m['dbId'], 'x': m['x'], 'y': m['y'], 'team': my_team,
                'badgeIds': m.get('badgeIds') or self.deck.get(m['dbId'], []),
            })
        for e in s.enemy:
            board.append({
                'dbId': e['dbId'], 'x': e['x'], 'y': e['y'], 'team': en_team,
                'badgeIds': e.get('badgeIds') or self.deck.get(e['dbId'], []),
            })
        res = self.engine.simulate(board, round_=s.round)
        d_self = (res['d1'] - res['d2']) if s.side == 'p1' else (res['d2'] - res['d1'])
        hp_self = res['hpP1'] if s.side == 'p1' else res['hpP2']
        hp_en = res['hpP2'] if s.side == 'p1' else res['hpP1']
        tot = hp_self + hp_en
        frac = hp_self / tot if tot > 0 else 0.5
        v = d_self * 0.85 + 0.15 * (2.0 * frac - 1.0)
        return float(np.clip(v, -1.0, 1.0))

    def _cached_eval(self, s: State):
        """网络前向 + 启发式先验 + 局面缓存：命中直接返回 (pm, pc, v_blend, heur)，
        未命中评估后入缓存。heuristic_prior 每次展开都重算（CPU 瓶颈），并入缓存复用。
        默认 v_blend = (1-w)·script_value(s) + w·v_net；
        use_real_sim=True 时 v_blend = 真实战斗模拟（地面真值，不混合网络价值）。"""
        key = self._state_key(s)
        hit = self.cache.get(key)
        if hit is not None:
            return hit
        pm, pc, v = self.net.eval_state(s, self.device)
        heur = heuristic_prior(s)
        if self.use_real_sim and self.engine is not None:
            v_blend = self._real_sim_value(s)
        else:
            w = self.value_net_weight
            v_blend = (1.0 - w) * script_value(s) + w * v
        if len(self.cache) >= self.cache_cap:
            self.cache.clear()
        self.cache[key] = (pm, pc, v_blend, heur)
        return pm, pc, v_blend, heur

    def _leaf_value(self, s: State) -> float:
        """叶节点价值：理性基线 + 网络价值的混合（走缓存）。"""
        _pm, _pc, v_blend, _h = self._cached_eval(s)
        return v_blend

    def _expand(self, node: Node) -> float:
        """扩展叶节点：网络前向设先验与叶价值；返回 v。"""
        if not node.s.legal_actions():
            # 预算/手牌用尽（本回合放置完毕）：价值 = 当前棋盘的理性评估
            node.expanded = True
            node.v_leaf = self._leaf_value(node.s)
            return node.v_leaf
        pm, pc, v, heur = self._cached_eval(node.s)
        node.v_leaf = v
        node.expanded = True
        side = node.s.side
        if self.exp_lib is not None:
            self.exp_lib.boost(node.s, heur)
        for (db_id, (x, y)) in node.s.legal_actions():
            mi = db_id_to_idx(db_id)
            ci = x_to_cell_local(side, x, y)
            P = pm[mi] * pc[ci]
            if P <= 0:
                continue
            # 领域启发式混合：冷启动网络乱放时靠启发式引导先验
            h = heur.get((db_id, (x, y)), 1.0)
            P_clipped = max(1e-8, min(1.0, float(P)))
            h_clipped = max(1e-8, min(1.0, float(h)))
            P = (P_clipped ** (1.0 - self.prior_lambda)) * (h_clipped ** self.prior_lambda)
            if not (P > 0) or not math.isfinite(P):
                # 启发式/经验库先验异常（NaN/负值）时放弃该动作，防止污染 UCT 选择
                continue
            ns = State(
                side=node.s.side,
                my=list(node.s.my),
                enemy=node.s.enemy,
                hand=[h for h in node.s.hand if h != db_id],
                round=node.s.round,
                budget=node.s.budget - node.s._cost(db_id),
                budget_limit=node.s.budget_limit,
                deck=node.s.deck,
            )
            ns.my.append({'dbId': db_id, 'x': x, 'y': y})
            node.children[(mi, ci)] = Node(ns, parent=node, P=P)
        # 根节点 Dirichlet 噪声（AlphaZero 式，训练探索用）：混合在最终先验上，
        # 保证自对弈覆盖罕见分支；评估/部署 dirichlet_alpha=0 自动跳过。
        if node.parent is None and self.dirichlet_alpha > 0 and node.children:
            n_act = len(node.children)
            eta = np.random.dirichlet([self.dirichlet_alpha] * n_act)
            for c, e in zip(node.children.values(), eta):
                c.P = (1.0 - self.dirichlet_eps) * c.P + self.dirichlet_eps * e
        return v

    def _select(self, node: Node) -> Node:
        """UCT 选择。"""
        best = None
        best_q = -1e18
        log_n = math.log(max(1, node.N))
        for a, child in node.children.items():
            q = child.W / child.N if child.N > 0 else 0.0
            u = self.c_puct * child.P * math.sqrt(log_n) / (1 + child.N)
            score = q + u
            if score > best_q:
                best_q = score
                best = a
        assert best is not None
        return node.children[best]

    def _backup(self, path: list[Node], v: float) -> None:
        for node in reversed(path):
            node.N += 1
            node.W += v

    def _search_root(self, s: State) -> Node:
        """对根状态跑 num_sim 次模拟，返回根节点（候选/分布从根节点提取）。"""
        root = Node(s)
        for _ in range(self.num_sim):
            node = root
            path = [node]
            while node.expanded and node.children:
                node = self._select(node)
                path.append(node)
            if not node.expanded:
                v = self._expand(node)
            else:
                v = node.v_leaf
            self._backup(path, v)
        return root

    @staticmethod
    def _root_dist(root: Node, side: str):
        """从根节点提取 (π_m, π_c, π_joint, action, v_leaf, root_q)。
        root_q = 所有子节点按访问数加权的 Q 均值（真实模拟的期望回报），
        比 v_leaf（根节点自身单次评估）更稳定，直接用作 value head 的训练目标。"""
        total = sum(c.N for c in root.children.values())
        if total == 0:
            return {0: 1.0}, {0: 1.0}, {(0, 0): 1.0}, None, root.v_leaf, root.v_leaf
        pm: dict[int, float] = {}
        pc: dict[int, float] = {}
        joint: dict[tuple[int, int], float] = {}
        # root_q：子节点加权平均 Q（real_sim 产出的期望回报，比单局 z 更干净）
        root_q = 0.0
        for (mi, ci), c in root.children.items():
            p = c.N / total
            pm[mi] = pm.get(mi, 0.0) + p
            pc[ci] = pc.get(ci, 0.0) + p
            joint[(mi, ci)] = p
            if c.N > 0:
                root_q += p * (c.W / c.N)
        # 贪婪动作（评估用）：访问数最多的 (m,c)
        mi, ci = max(root.children.items(), key=lambda kv: kv[1].N)[0]
        db_id = idx_to_db_id(mi)
        x, y = cell_local_to_xy(side, ci)
        return pm, pc, joint, (db_id, x, y), root.v_leaf, root_q

    def search(self, s: State) -> tuple[dict, dict, dict, tuple, float, float]:
        """对根状态跑 num_sim 次模拟。返回 (π_m, π_c, π_joint, action, v_leaf, root_q)。
        π_m/π_c 为边缘分布（训练标签）；π_joint 为联合动作 (mi,ci) 分布（self-play 采样用，
        保证执行的组合是 MCTS 访问过的最优组合）；action = (dbId, x, y)；
        root_q = 子节点按访问数加权的 Q 均值（真实模拟期望回报，value head 训练目标）。"""
        root = self._search_root(s)
        return self._root_dist(root, s.side)

    def search_with_cands(self, s: State):
        """同 search，另返回候选动作胜率列表（watch 决策展示用），只跑一次搜索。
        返回 (pm, pc, joint, action, v_leaf, root_q, cands)，cands = [(dbId, x, y, Q, N)] 按 Q 降序。"""
        root = self._search_root(s)
        pm, pc, joint, action, v, root_q = self._root_dist(root, s.side)
        cands = []
        for (mi, ci), c in root.children.items():
            q = c.W / c.N if c.N > 0 else 0.0
            db_id = idx_to_db_id(mi)
            x, y = cell_local_to_xy(s.side, ci)
            cands.append((db_id, x, y, q, c.N))
        cands.sort(key=lambda t: -t[3])
        return pm, pc, joint, action, v, root_q, cands


def x_to_cell_local(side: str, x: int, y: int) -> int:
    from .state import xy_to_cell
    return xy_to_cell(side, x, y)


def cell_local_to_xy(side: str, cell: int):
    from .state import cell_to_xy
    return cell_to_xy(side, cell)
