# -*- coding: utf-8 -*-
"""
Self-play 对局驱动：双方各自用 MCTS（网络引导）做回合内放置，
回合结束由 TS 引擎跑真实战斗，收集 (状态, π_mcts, 对局胜负 z) 训练样本。
"""
import random

import numpy as np

from .state import (State, encode_state, BUDGET_LIMITS, COST_BY_ID,
                    idx_to_db_id, db_id_to_idx, cell_to_xy, xy_to_cell,
                    MONSTER_COUNT, CELL_COUNT,
                    canonical_transform, inv_apply_t)
from .heuristic import MON_META, state_feat, act_feat


def _sample_p(p_dict: dict, temperature: float = 1.0) -> int:
    """按概率分布采样。temperature=1 为原始分布；>1 更均匀（探索）；<1 更贪心；
    <=0 直接取最大概率动作（贪心，评估用，避免除零）。"""
    ks = list(p_dict.keys())
    if temperature <= 0:
        m = max(p_dict[k] for k in ks)
        top = [k for k in ks if p_dict[k] == m]
        return random.choice(top)
    if temperature != 1.0:
        ws = [p_dict[k] ** (1.0 / temperature) for k in ks]
    else:
        ws = [p_dict[k] for k in ks]
    return random.choices(ks, weights=ws)[0]


def mcts_place(engine, mcts, side, my, enemy, deck, hand, round_, budget_limit, greedy=False, temperature=1.0,
               exp_lib=None, path=None, chain_id=None, source='best', exp_hard=0.85, score=(0, 0),
               force_tree=None):
    """回合内放置：MCTS 逐步决策直到预算/手牌用尽。返回 (placed, samples)。
    hand：全局未放置手牌（调用方维护；本函数在副本上操作并移除已放置的 dbId）。
    budget_limit 为回合累计上限；剩余预算 = 上限 - 场上已有怪（幸存者）总费用，与引擎一致。
    greedy=True 取访问数最大动作（评估/部署用）；否则按 joint 分布温度采样（训练探索用）。
    exp_lib：在线经验库。greedy 时命中正分候选以 exp_hard 概率直接采用（软采用：
    保留 1-exp_hard 概率走 MCTS 动作，防止经验库锁死局部最优，如"救星卡右上角"）。
    path：传入列表则记录每步决策点（canonical 化 + 特征 + 元数据）供对局结束回传更新经验库。
    score：当前比分 (p1, p2)，进入状态特征（比分差影响保守/激进策略）。
    force_tree：本回合树计划动作列表 [{monsterId, x, y}]（己方视角坐标）。非 None 时
    作为强制动作队列：可放置且预算足够则直接采用（先学自身布阵策略），用尽后回退 MCTS。
    与 TS search.ts forceTreeAction 语义一致（搜索照跑保留样本，提交优先树动作）。"""
    used = sum(COST_BY_ID[m['dbId']] for m in my)
    budget = budget_limit - used
    my_cur = [dict(m) for m in my]
    my_team = 1 if side == 'p1' else 2
    placed = []
    samples = []
    deck_keys = list(deck.keys())
    hand = list(hand)
    force_queue = list(force_tree) if force_tree else []
    while True:
        s = State(side, my_cur, enemy, hand, round_, budget, budget_limit, deck_keys, score,
                  deck_badges=deck)
        if not s.legal_actions():
            break
        pm, pc, joint, greedy_a, _v, root_q = mcts.search(s)
        pi_m = np.zeros(MONSTER_COUNT, dtype=np.float32)
        pi_c = np.zeros(CELL_COUNT, dtype=np.float32)
        for k, p in pm.items():
            pi_m[k] = p
        for k, p in pc.items():
            pi_c[k] = p
        grid, g = encode_state(s)
        samples.append((grid, g, pi_m, pi_c, float(root_q)))  # root_q 随样本存储
        # 强制树计划动作优先（先学自身布阵策略）：可放置则直接采用
        if force_queue:
            idx = next((i for i, ta in enumerate(force_queue)
                        if ta['monsterId'] in hand
                        and COST_BY_ID.get(ta['monsterId'], 4) <= budget
                        and not any(m['x'] == ta['x'] and m['y'] == ta['y'] for m in my_cur)), None)
            if idx is not None:
                ta = force_queue.pop(idx)
                db_id, x, y = ta['monsterId'], ta['x'], ta['y']
                # 训练标签向树动作倾斜（先学自身布阵策略的核心）：
                # 强制采用树动作时，把该决策点的 π 重设为"树动作 0.9 + 其余均匀 0.1"，
                # 彻底消除原网络先验的残留偏好（如帝国@1,2 角落），确保正确开局
                # 在策略分布中占绝对主导。评估/部署（greedy、path=None）不改 π。
                if not greedy and path is not None:
                    mi = db_id_to_idx(db_id)
                    ci = xy_to_cell(side, x, y)
                    pi_m = np.full(MONSTER_COUNT, 0.1 / MONSTER_COUNT, dtype=np.float32)
                    pi_m[mi] = 0.9
                    pi_c = np.full(CELL_COUNT, 0.1 / CELL_COUNT, dtype=np.float32)
                    pi_c[ci] = 0.9
                    samples[-1] = (grid, g, pi_m, pi_c, float(root_q))
                if path is not None:
                    h, t = canonical_transform(s)
                    ent = -float(sum(p * np.log(p + 1e-12) for p in pm.values()))
                    path.append({
                        'canonical': h,
                        'act': list(inv_apply_t((db_id, x, y), t)),
                        'act_feat': list(act_feat(s, db_id, x, y)),
                        'feat': list(state_feat(s)),
                        'chain': chain_id, 'chain_pos': len(path), 'chain_len': -1,
                        'visits': mcts.num_sim, 'entropy': float(ent), 'source': source,
                    })
                my_cur.append({'dbId': db_id, 'x': x, 'y': y, 'team': my_team})
                placed.append({'dbId': db_id, 'x': x, 'y': y, 'team': my_team, 'badgeIds': deck[db_id]})
                hand.remove(db_id)
                budget -= COST_BY_ID[db_id]
                continue
        if greedy and exp_lib is not None:
            hit = exp_lib.lookup(s)
            if hit is not None and random.random() < exp_hard:
                db_id, x, y = hit[0], hit[1], hit[2]
            elif greedy_a is not None:
                db_id, x, y = greedy_a
            else:
                mi, ci = _sample_p(joint, temperature)
                db_id = idx_to_db_id(mi)
                x, y = cell_to_xy(side, ci)
        elif greedy and greedy_a is not None:
            db_id, x, y = greedy_a
        else:
            mi, ci = _sample_p(joint, temperature)
            db_id = idx_to_db_id(mi)
            x, y = cell_to_xy(side, ci)
        if path is not None:
            # 决策点记录（canonical 化存储；执行动作与 canonical 坐标同时记录，
            # 供经验库等价匹配后反变换还原 + ANN 动作迁移）
            h, t = canonical_transform(s)
            ent = -float(sum(p * np.log(p + 1e-12) for p in pm.values()))
            path.append({
                'canonical': h,
                'act': list(inv_apply_t((db_id, x, y), t)),
                'act_feat': list(act_feat(s, db_id, x, y)),
                'feat': list(state_feat(s)),
                'chain': chain_id, 'chain_pos': len(path), 'chain_len': -1,
                'visits': mcts.num_sim, 'entropy': float(ent), 'source': source,
            })
        my_cur.append({'dbId': db_id, 'x': x, 'y': y, 'team': my_team})
        placed.append({'dbId': db_id, 'x': x, 'y': y, 'team': my_team, 'badgeIds': deck[db_id]})
        hand.remove(db_id)
        budget -= COST_BY_ID[db_id]
    return placed, samples


def bundle_place(engine, side, my, enemy, deck, hand, round_, budget_limit, session=None, formation=None, debug=False):
    """ai-bundle（原网页手工启发式 AI）回合内放置：整回合计划一次从 bridge 取回。
    deck: {dbId: badgeIds}；hand: 全局未放置列表；my: 己方场上(含本轮已放)。
    session: 同局唯一 id（跨回合复用同一 AI 实例，保持阵型与 deployedIds 一致）；
    formation: 卡组名（引擎已知 deck→阵型 精确映射，绕开 bundle matcher 误识别）。
    返回 (placed, samples=[])。"""
    used = sum(COST_BY_ID[m['dbId']] for m in my)
    budget = budget_limit - used
    my_cur = [dict(m) for m in my]
    placed = []
    if not hand:
        return placed, []
    res = engine.request({
        'type': 'bundle_plan', 'side': side, 'round': round_, 'budget': budget,
        'session': session, 'formation': formation, 'debug': debug,
        'hand': [{'monsterId': db, 'badgeIds': deck[db]} for db in hand],
        'my': [{'dbId': m['dbId'], 'x': m['x'], 'y': m['y']} for m in my_cur],
        'enemy': [{'dbId': e['dbId'], 'x': e['x'], 'y': e['y']} for e in enemy],
    })
    plan = res['plan']
    team = 1 if side == 'p1' else 2
    for a in plan:
        db_id = a['monsterId']
        if db_id not in hand or COST_BY_ID[db_id] > budget:
            continue
        if any(m['x'] == a['x'] and m['y'] == a['y'] for m in my_cur):
            continue
        my_cur.append({'dbId': db_id, 'x': a['x'], 'y': a['y']})
        placed.append({'dbId': db_id, 'x': a['x'], 'y': a['y'], 'team': team, 'badgeIds': deck[db_id]})
        hand.remove(db_id)
        budget -= COST_BY_ID[db_id]
    return placed, []


def play_game(engine, mcts_a, mcts_b, deck_a, deck_b, game_seed, on_round=None, temperature=1.0, exp_lib=None,
              update_w: float = 1.0, bundle_a=None, bundle_b=None, temp_final: float = 0.3, temp_rounds: int = 2,
              sample_w: float = 1.0, exp_source: str = 'best', force_tree_a=None, force_tree_b=None):
    """一场 self-play：A 用 mcts_a、B 用 mcts_b（训练时传同一实例 = 自对弈；
    评估时 B 用历史最佳网络 = 当前 vs 最佳）。返回 (样本A, 样本B, winner(1/2/0), scores)。
    bundle_a/bundle_b：非 None（formation 名）时对应侧用游戏启发式 AI（TS bundle）替代 MCTS，
    提供强对手对抗信号；bundle 侧不产生训练样本（样本只收集网络侧）。
    force_tree_a/force_tree_b：该侧本回合强制树计划动作列表（己方视角坐标），
    传 None 不强制；R1-R2 开局先学自身布阵策略用。
    on_round(round_, full, plan_a, plan_b, res, scores)：每回合战斗后回调（查看对局过程用，训练不传）。
    样本 = (grid, g, π_m, π_c, v_target, sample_w)，v_target = clip(全局 z + 回合双向稠密信号, -1, 1)。
    temperature：前 temp_rounds 回合 MCTS 采样温度（探索）；之后用 temp_final（低温度 → 策略尖锐，
    借鉴 alpha-zero-general 的 temp 衰减：前 30 步探索、之后贪心）。
    评估传 temperature=0.0、temp_final=0.0 = 全程贪心。
    exp_lib：在线经验库，对局结束把双方决策链（跨回合锚定链）按胜负回传修正。
    update_w：经验库更新质量权重（0~1，按对手强度）：弱对手对局权重低，经验库只留强阵经验。
    exp_source：经验库来源门控（'best'=最强对局才入库，见 ExperienceLib.update_batch）。
    sample_w：本局训练样本权重（受控混合：best 对局样本权重高、多样性对局低）。"""
    board = []
    scores = [0, 0]
    all_samples = []  # (grid, g, pi_m, pi_c, round_, side)
    round_res = {}
    path_a, path_b = [], []
    chain_a = random.randint(1, 10 ** 9)
    chain_b = random.randint(1, 10 ** 9)
    session = random.randint(1, 10 ** 6)
    hand_a, hand_b = list(deck_a.keys()), list(deck_b.keys())
    for round_ in range(1, 6):
        if max(scores) >= 3:
            break
        temp = temperature if round_ <= temp_rounds else temp_final
        bl = BUDGET_LIMITS[round_]
        my_a = [b for b in board if b['team'] == 1]
        en_a = [b for b in board if b['team'] == 2]
        if bundle_a is not None:
            plan_a, sa = bundle_place(engine, 'p1', my_a, en_a, deck_a, hand_a, round_, bl,
                                      session=session, formation=bundle_a)
        else:
            plan_a, sa = mcts_place(engine, mcts_a, 'p1', my_a, en_a, deck_a, hand_a, round_, bl,
                                    temperature=temp, path=path_a, chain_id=chain_a, source=exp_source,
                                    score=(scores[0], scores[1]),
                                    force_tree=force_tree_a.get(round_) if force_tree_a else None)
        for p in plan_a:
            if p['dbId'] in hand_a:
                hand_a.remove(p['dbId'])
        my_b = [b for b in board if b['team'] == 2]
        en_b = [b for b in board if b['team'] == 1]
        if bundle_b is not None:
            plan_b, sb = bundle_place(engine, 'p2', my_b, en_b, deck_b, hand_b, round_, bl,
                                      session=session, formation=bundle_b)
        else:
            plan_b, sb = mcts_place(engine, mcts_b, 'p2', my_b, en_b, deck_b, hand_b, round_, bl,
                                    temperature=temp, path=path_b, chain_id=chain_b, source=exp_source,
                                    score=(scores[0], scores[1]),
                                    force_tree=force_tree_b.get(round_) if force_tree_b else None)
        for p in plan_b:
            if p['dbId'] in hand_b:
                hand_b.remove(p['dbId'])
        full = board + plan_a + plan_b
        res = engine.simulate(full, round_=round_, seed=game_seed * 10 + round_)
        if on_round is not None:
            on_round(round_, full, plan_a, plan_b, res, list(scores))
        board = res['survivors']
        scores[0] += res['d1']
        scores[1] += res['d2']
        round_res[round_] = res
        for x in sa:
            all_samples.append((*x, round_, 'p1'))
        for x in sb:
            all_samples.append((*x, round_, 'p2'))
    if scores[0] == scores[1]:
        winner = 0
    else:
        winner = 1 if scores[0] > scores[1] else 2
    za = 1 if winner == 1 else (-1 if winner == 2 else 0)
    zb = -za
    # 回填决策链长度（时间加权回传需要）；经验库只回传最强对局（exp_lib 仅在 learn 时传入）
    if exp_lib is not None:
        for p in path_a:
            p['chain_len'] = len(path_a)
        for p in path_b:
            p['chain_len'] = len(path_b)
        exp_lib.update_batch(path_a, za, update_w, source=exp_source)
        exp_lib.update_batch(path_b, zb, update_w, source=exp_source)
    samples_a, samples_b = [], []
    for (grid, g, pim, pic, rq, round_, side) in all_samples:
        z = za if side == 'p1' else zb
        # Value target：纯全局胜负 z（AlphaZero 标准）。不再混入回合级 dense——
        # dense 的 d_round(0.40) 是"本回合即时胜负"，与当前放置决策的长期胜负仅弱相关，
        # 且战斗随机性大，等于给价值目标注入高方差噪声，导致价值头学不到干净的区分度
        #（MSE 卡 0.27、分离度 0.6 封顶）。亦不再混入 root_q 防止循环自证。
        vt = z
        item = (grid, g, pim, pic, vt, sample_w)
        (samples_a if side == 'p1' else samples_b).append(item)
    return samples_a, samples_b, winner, scores


def play_vs_random(engine, net, mcts, deck_a, deck_b, game_seed, mcts_side='p1', opponent='random', exp_lib=None):
    """MCTS（贪心）vs 基线对手（opponent='random' 基础随机 / 'rule' 规则随机）。
    exp_lib：在线经验库，评估时命中正分候选直接采用（跳过 MCTS 搜索）。
    返回 (mcts_wins, mcts_draws, mcts_losses, scores)。"""
    def opp_place(deck, hand, bl, side, my):
        return rule_random_place(deck, hand, bl, side, my) if opponent == 'rule' else random_place(deck, hand, bl, side, my)

    board = []
    scores = [0, 0]
    hand_a, hand_b = list(deck_a.keys()), list(deck_b.keys())
    for round_ in range(1, 6):
        if max(scores) >= 3:
            break
        bl = BUDGET_LIMITS[round_]
        my_a = [b for b in board if b['team'] == 1]
        en_a = [b for b in board if b['team'] == 2]
        my_b = [b for b in board if b['team'] == 2]
        en_b = [b for b in board if b['team'] == 1]
        if mcts_side == 'p1':
            plan_a, _ = mcts_place(engine, mcts, 'p1', my_a, en_a, deck_a, hand_a, round_, bl, greedy=True,
                                   exp_lib=exp_lib, score=(scores[0], scores[1]))
            plan_b = opp_place(deck_b, hand_b, bl, 'p2', my_b)
        else:
            plan_a = opp_place(deck_a, hand_a, bl, 'p1', my_a)
            plan_b, _ = mcts_place(engine, mcts, 'p2', my_b, en_b, deck_b, hand_b, round_, bl, greedy=True,
                                   exp_lib=exp_lib, score=(scores[0], scores[1]))
        for p in plan_a:
            if p['dbId'] in hand_a:
                hand_a.remove(p['dbId'])
        for p in plan_b:
            if p['dbId'] in hand_b:
                hand_b.remove(p['dbId'])
        full = board + plan_a + plan_b
        res = engine.simulate(full, round_=round_, seed=game_seed * 10 + round_)
        board = res['survivors']
        scores[0] += res['d1']
        scores[1] += res['d2']
    if scores[0] == scores[1]:
        return 0, 1, 0, scores
    return (1, 0, 0, scores) if scores[0] > scores[1] else (0, 0, 1, scores)


def play_vs_bundle(engine, net, mcts, deck_a, deck_b, game_seed, mcts_side='p1', bname=None, exp_lib=None):
    """MCTS（贪心）vs 手工启发式 AI（bundleai，当前最强基线）。
    bname：对手卡组名（formation 名，引擎精确映射）。bundle 侧不产生样本。
    返回 (mcts_wins, mcts_draws, mcts_losses, scores)。"""
    board = []
    scores = [0, 0]
    hand_a, hand_b = list(deck_a.keys()), list(deck_b.keys())
    session = random.randint(1, 10 ** 6)
    for round_ in range(1, 6):
        if max(scores) >= 3:
            break
        bl = BUDGET_LIMITS[round_]
        my_a = [b for b in board if b['team'] == 1]
        en_a = [b for b in board if b['team'] == 2]
        my_b = [b for b in board if b['team'] == 2]
        en_b = [b for b in board if b['team'] == 1]
        if mcts_side == 'p1':
            plan_a, _ = mcts_place(engine, mcts, 'p1', my_a, en_a, deck_a, hand_a, round_, bl, greedy=True,
                                   exp_lib=exp_lib, score=(scores[0], scores[1]))
            plan_b, _ = bundle_place(engine, 'p2', my_b, en_b, deck_b, hand_b, round_, bl,
                                     session=session, formation=bname)
        else:
            plan_a, _ = bundle_place(engine, 'p1', my_a, en_a, deck_a, hand_a, round_, bl,
                                     session=session, formation=bname)
            plan_b, _ = mcts_place(engine, mcts, 'p2', my_b, en_b, deck_b, hand_b, round_, bl, greedy=True,
                                   exp_lib=exp_lib, score=(scores[0], scores[1]))
        for p in plan_a:
            if p['dbId'] in hand_a:
                hand_a.remove(p['dbId'])
        for p in plan_b:
            if p['dbId'] in hand_b:
                hand_b.remove(p['dbId'])
        full = board + plan_a + plan_b
        res = engine.simulate(full, round_=round_, seed=game_seed * 10 + round_)
        board = res['survivors']
        scores[0] += res['d1']
        scores[1] += res['d2']
    if scores[0] == scores[1]:
        return 0, 1, 0, scores
    return (1, 0, 0, scores) if scores[0] > scores[1] else (0, 0, 1, scores)


def play_vs_fn(engine, mcts, deck_a, deck_b, game_seed, opp_fn, mcts_side='p1', temperature=1.0,
               temp_final: float = 0.3, temp_rounds: int = 2, path_a=None, chain_a=None,
               exp_lib=None, exp_source: str = 'pool', sample_w: float = 1.0, force_tree=None):
    """训练对局：网络侧（MCTS 温度采样）vs Python 基线对手函数 opp_fn(deck, hand, bl, side, my)。
    force_tree：{round: [{monsterId,x,y}]}（网络侧己方视角），R1-R2 先学自身布阵强制用。
    网络侧收集训练样本（与 play_game 同构：v_target = clip(胜负 z + 回合稠密信号)）；
    对手侧不产样本（随机/规则随机是弱对手，只提供对抗多样性）。
    经验库按门控默认不收（exp_source='pool' 被 ExperienceLib 拒绝，弱对手经验无价值）。
    返回 (samples, winner(1/2/0), scores)。"""
    board = []
    scores = [0, 0]
    all_samples = []
    round_res = {}
    path_a = [] if path_a is None else path_a
    hand_a, hand_b = list(deck_a.keys()), list(deck_b.keys())
    for round_ in range(1, 6):
        if max(scores) >= 3:
            break
        temp = temperature if round_ <= temp_rounds else temp_final
        bl = BUDGET_LIMITS[round_]
        my_a = [b for b in board if b['team'] == 1]
        en_a = [b for b in board if b['team'] == 2]
        my_b = [b for b in board if b['team'] == 2]
        en_b = [b for b in board if b['team'] == 1]
        if mcts_side == 'p1':
            plan_a, sa = mcts_place(engine, mcts, 'p1', my_a, en_a, deck_a, hand_a, round_, bl,
                                    temperature=temp, path=path_a, chain_id=chain_a, source=exp_source,
                                    score=(scores[0], scores[1]),
                                    force_tree=force_tree.get(round_) if force_tree else None)
            plan_b = opp_fn(deck_b, hand_b, bl, 'p2', my_b)
        else:
            plan_a = opp_fn(deck_a, hand_a, bl, 'p1', my_a)
            plan_b, sa = mcts_place(engine, mcts, 'p2', my_b, en_b, deck_b, hand_b, round_, bl,
                                    temperature=temp, path=path_a, chain_id=chain_a, source=exp_source,
                                    score=(scores[0], scores[1]),
                                    force_tree=force_tree.get(round_) if force_tree else None)
        for p in plan_a:
            if p['dbId'] in hand_a:
                hand_a.remove(p['dbId'])
        for p in plan_b:
            if p['dbId'] in hand_b:
                hand_b.remove(p['dbId'])
        full = board + plan_a + plan_b
        res = engine.simulate(full, round_=round_, seed=game_seed * 10 + round_)
        board = res['survivors']
        scores[0] += res['d1']
        scores[1] += res['d2']
        round_res[round_] = res
        side = 'p1' if mcts_side == 'p1' else 'p2'
        for (g_, gg, pim, pic, rq) in sa:
            all_samples.append((g_, gg, pim, pic, rq, round_, side))
    winner = 1 if scores[0] > scores[1] else (2 if scores[1] > scores[0] else 0)
    za = 1 if winner == 1 else (-1 if winner == 2 else 0)
    samples = []
    for (g_, gg, pim, pic, rq, round_, side) in all_samples:
        # 修复符号 bug：side='p2' 时价值目标必须是 p2 视角（-za），原代码误用 p1 视角 za，
        # 导致 mcts_side='p2' 的样本价值标签反向。同时去掉回合级 dense 噪声（同 play_game）。
        z = za if side == 'p1' else -za
        vt = z
        samples.append((g_, gg, pim, pic, vt, sample_w))
    if exp_lib is not None and path_a:
        for p in path_a:
            p['chain_len'] = len(path_a)
        exp_lib.update_batch(path_a, za, 1.0, source=exp_source)
    return samples, winner, scores


def random_place(deck, hand, budget_limit, side, my=()):
    """随机合法放置（评估基线）。返回本轮新放怪列表。
    hand：全局未放置手牌（调用方维护；本函数在副本上操作）。
    budget_limit 为回合累计上限；剩余预算 = 上限 - 场上已有怪总费用。"""
    hand = list(hand)
    budget = budget_limit - sum(COST_BY_ID[m['dbId']] for m in my)
    placed = []
    lo, hi = (0, 4) if side == 'p1' else (6, 10)
    team = 1 if side == 'p1' else 2
    occupied = {(m['x'], m['y']) for m in my}
    while True:
        affordable = [m for m in hand if COST_BY_ID[m] <= budget]
        free = [(x, y) for y in range(5) for x in range(lo, hi + 1) if (x, y) not in occupied]
        if not affordable or not free:
            break
        m = random.choice(affordable)
        x, y = random.choice(free)
        occupied.add((x, y))
        placed.append({'dbId': m, 'x': x, 'y': y, 'team': team, 'badgeIds': deck[m]})
        hand.remove(m)
        budget -= COST_BY_ID[m]
    return placed


def policy_only_place(net, side, my, enemy, deck, hand, round_, budget_limit, device='cpu', score=(0, 0)):
    """纯策略放置（无 MCTS，无 Value Head）：直接取 policy 最高概率的合法动作。
    用于 policy-only 评估基准：该指标只反映 policy head 质量，与 value head 无关。
    若 policy-only 指标持续上升而 MCTS 指标下降 → value head 出问题。
    若两者同时下降 → policy head 本身在退化。"""
    import torch
    from .state import encode_state, action_mask
    used = sum(COST_BY_ID[m['dbId']] for m in my)
    budget = budget_limit - used
    my_cur = [dict(m) for m in my]
    my_team = 1 if side == 'p1' else 2
    placed = []
    hand = list(hand)
    deck_keys = list(deck.keys())
    while True:
        s = State(side, my_cur, enemy, hand, round_, budget, budget_limit, deck_keys, score,
                  deck_badges=deck)
        acts = s.legal_actions()
        if not acts:
            break
        # 网络前向（仅 policy 头，不用 value）
        grid, g = encode_state(s)
        m_mask, c_mask = action_mask(s)
        with torch.no_grad():
            gt = torch.from_numpy(grid).unsqueeze(0).to(device)
            gv = torch.from_numpy(g).unsqueeze(0).to(device)
            log_pm, log_pc, _ = net(gt, gv)
            lp_m = log_pm[0].cpu().numpy()
            lp_c = log_pc[0].cpu().numpy()
        import numpy as np
        lp_m = np.where(m_mask > 0, lp_m, -1e9)
        lp_c = np.where(c_mask > 0, lp_c, -1e9)
        # 联合最优：穷举合法动作，取 pm*pc 最高（合法动作数目小，可枚举）
        best_score, best_act = -1e18, None
        for (db_id, (x, y)) in acts:
            from .state import db_id_to_idx, xy_to_cell
            mi = db_id_to_idx(db_id)
            ci = xy_to_cell(side, x, y)
            sc = float(lp_m[mi]) + float(lp_c[ci])
            if sc > best_score:
                best_score, best_act = sc, (db_id, x, y)
        if best_act is None:
            break
        db_id, x, y = best_act
        my_cur.append({'dbId': db_id, 'x': x, 'y': y, 'team': my_team})
        placed.append({'dbId': db_id, 'x': x, 'y': y, 'team': my_team, 'badgeIds': deck[db_id]})
        hand.remove(db_id)
        budget -= COST_BY_ID[db_id]
    return placed


def play_vs_random_policy_only(engine, net, deck_a, deck_b, game_seed, mcts_side='p1',
                               opponent='rule', device='cpu'):
    """Policy-Only（无 MCTS）vs 规则随机基线。只测 policy head，与 value head 无关。
    对比 play_vs_random（MCTS 版），若该指标持续上升而 MCTS 版下降，则 value head 是瓶颈。
    返回 (wins, draws, losses, scores)。"""
    def opp_place(deck, hand, bl, side, my):
        return rule_random_place(deck, hand, bl, side, my) if opponent == 'rule' else random_place(deck, hand, bl, side, my)

    board = []
    scores = [0, 0]
    hand_a, hand_b = list(deck_a.keys()), list(deck_b.keys())
    for round_ in range(1, 6):
        if max(scores) >= 3:
            break
        bl = BUDGET_LIMITS[round_]
        my_a = [b for b in board if b['team'] == 1]
        en_a = [b for b in board if b['team'] == 2]
        my_b = [b for b in board if b['team'] == 2]
        en_b = [b for b in board if b['team'] == 1]
        if mcts_side == 'p1':
            plan_a = policy_only_place(net, 'p1', my_a, en_a, deck_a, hand_a, round_, bl,
                                       device=device, score=(scores[0], scores[1]))
            plan_b = opp_place(deck_b, hand_b, bl, 'p2', my_b)
        else:
            plan_a = opp_place(deck_a, hand_a, bl, 'p1', my_a)
            plan_b = policy_only_place(net, 'p2', my_b, en_b, deck_b, hand_b, round_, bl,
                                       device=device, score=(scores[0], scores[1]))
        for p in plan_a:
            if p['dbId'] in hand_a:
                hand_a.remove(p['dbId'])
        for p in plan_b:
            if p['dbId'] in hand_b:
                hand_b.remove(p['dbId'])
        full = board + plan_a + plan_b
        res = engine.simulate(full, round_=round_, seed=game_seed * 10 + round_)
        board = res['survivors']
        scores[0] += res['d1']
        scores[1] += res['d2']
    if scores[0] == scores[1]:
        return 0, 1, 0, scores
    return (1, 0, 0, scores) if scores[0] > scores[1] else (0, 0, 1, scores)


def rule_random_place(deck, hand, budget_limit, side, my=()):
    """规则随机放置（初级基准 L1，恒定指标用）：
    决策随机（随机选怪），位置遵守基本站位——坦克/战士/特殊在前三列（靠近中线一侧）
    随机选列、法师/射手在后三列（远离中线一侧）随机选列，y 行 0-4 均匀随机。
    避免纯随机因卡组不同忽强忽弱。返回本轮新放怪列表。"""
    hand = list(hand)
    budget = budget_limit - sum(COST_BY_ID[m['dbId']] for m in my)
    placed = []
    lo, hi = (0, 4) if side == 'p1' else (6, 10)
    team = 1 if side == 'p1' else 2
    occupied = {(m['x'], m['y']) for m in my}
    front_cols = (2, 3, 4) if side == 'p1' else (6, 7, 8)
    back_cols = (0, 1, 2) if side == 'p1' else (8, 9, 10)
    while True:
        affordable = [m for m in hand if COST_BY_ID[m] <= budget]
        free = [(x, y) for y in range(5) for x in range(lo, hi + 1) if (x, y) not in occupied]
        if not affordable or not free:
            break
        m = random.choice(affordable)
        meta = MON_META.get(m, {})
        role = meta.get('role', '战士')
        cols = back_cols if role in ('法师', '射手') else front_cols
        candidates = [c for c in free if c[0] in cols] or free
        x, y = random.choice(candidates)
        occupied.add((x, y))
        placed.append({'dbId': m, 'x': x, 'y': y, 'team': team, 'badgeIds': deck[m]})
        hand.remove(m)
        budget -= COST_BY_ID[m]
    return placed


def free_deck(seed: int = None) -> dict:
    """从 7 套已知阵型中随机选一套作为对手卡组（保留真实徽章）。
    用于 L1_free 层：规则随机使用任意已知阵型（而非只用与测试方配对的卡组），
    测"模型对整体对阵的放置能力"。返回 {dbId: badgeIds}。"""
    import random as _r
    from .heuristic import FORMATION_DECKS
    if FORMATION_DECKS is None:
        return {}
    rng = _r.Random(seed) if seed is not None else _r
    return dict(rng.choice(FORMATION_DECKS))
