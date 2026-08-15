# -*- coding: utf-8 -*-
"""
诊断脚本：量化「手写规则脚本（heuristic_prior 贪心）」到底有多强。

核心问题：在线 RL 训练学不进去（vs L1_rule 一直 50% 五五开）。这里做一次对照——
不靠神经网络、不靠 real_sim 战斗搜索，只用 heuristic_prior 贪心（每一步选权重最大的
合法动作，且不看敌方 = 纯自设计阵型），拿它去打 L1_rule（rule_random_place）。

结论判读：
  - 脚本贪心大胜 L1_rule（胜率明显 > 0.5，Elo 明显 > 1200）→ 手写规则本身够强，
    问题纯粹在 RL 监督信号，下一步可直接「离线蒸馏」：把脚本当老师教网络。
  - 脚本贪心也只是五五开 → 手写规则本身也偏弱，得先加强规则再谈蒸馏。

运行：python -m src.engine.train.py.bench_script [局数]
"""
import os
import random
import sys
import math
from collections import Counter

from .bridge_client import EngineClient
from .state import init_meta, COST_BY_ID, BUDGET_LIMITS, State
from .heuristic import init_mon_meta, load_endgame_lib, heuristic_prior
from .selfplay import rule_random_place, bundle_place


def project_root() -> str:
    p = os.path.dirname(os.path.abspath(__file__))
    for _ in range(4):
        p = os.path.dirname(p)
    return p


def script_greedy_place(deck, hand, budget_limit, side, my=()):
    """脚本贪心放置：每步取 heuristic_prior 权重最大的合法动作。
    刻意传入 enemy=[] —— 只做「自设计阵型」，不依赖敌方信息（对应用户判断：
    不考虑对手站位也能摆出优秀阵）。返回本轮新放怪列表。"""
    hand = list(hand)
    budget = budget_limit - sum(COST_BY_ID[m['dbId']] for m in my)
    my_cur = [dict(m) for m in my]
    team = 1 if side == 'p1' else 2
    placed = []
    deck_keys = list(deck.keys())
    while True:
        s = State(side=side, my=my_cur, enemy=[], hand=hand, round=1,
                  budget=budget, budget_limit=budget_limit, deck=deck_keys,
                  score=(0, 0), deck_badges=deck)
        acts = s.legal_actions()
        if not acts:
            break
        prior = heuristic_prior(s)
        db_id, (x, y) = max(acts, key=lambda a: prior.get(a, 1e-9))
        my_cur.append({'dbId': db_id, 'x': x, 'y': y, 'team': team})
        placed.append({'dbId': db_id, 'x': x, 'y': y, 'team': team, 'badgeIds': deck[db_id]})
        hand.remove(db_id)
        budget -= COST_BY_ID[db_id]
    return placed


def play_script_vs_rule(engine, deck_s, deck_r, game_seed, script_side):
    """脚本贪心 vs L1_rule 一局。返回 (wins, draws, losses, scores)。"""
    board = []
    scores = [0, 0]
    hand_s, hand_r = list(deck_s.keys()), list(deck_r.keys())
    for round_ in range(1, 6):
        if max(scores) >= 3:
            break
        bl = BUDGET_LIMITS[round_]
        my_a = [b for b in board if b['team'] == 1]
        my_b = [b for b in board if b['team'] == 2]
        if script_side == 'p1':
            plan_a = script_greedy_place(deck_s, hand_s, bl, 'p1', my_a)
            plan_b = rule_random_place(deck_r, hand_r, bl, 'p2', my_b)
        else:
            plan_a = rule_random_place(deck_r, hand_r, bl, 'p1', my_a)
            plan_b = script_greedy_place(deck_s, hand_s, bl, 'p2', my_b)
        for p in plan_a:
            if p['dbId'] in hand_s:
                hand_s.remove(p['dbId'])
        for p in plan_b:
            if p['dbId'] in hand_r:
                hand_r.remove(p['dbId'])
        full = board + plan_a + plan_b
        res = engine.simulate(full, round_=round_, seed=game_seed * 10 + round_)
        board = res['survivors']
        scores[0] += res['d1']
        scores[1] += res['d2']
    # 从 script 视角判定胜负
    script_score = scores[0] if script_side == 'p1' else scores[1]
    rule_score = scores[1] if script_side == 'p1' else scores[0]
    if script_score == rule_score:
        return 0, 1, 0, scores
    return (1, 0, 0, scores) if script_score > rule_score else (0, 0, 1, scores)


def elo_from(wr: float) -> float:
    wr = min(0.99, max(0.01, wr))
    return 1200.0 + 400.0 * math.log10(wr / (1.0 - wr))


def play_bundle_vs_rule(engine, deck_b, deck_r, bname, game_seed, bundle_side):
    """bundleai（原始网页手写 AI）vs L1_rule 一局。返回 (wins, draws, losses, scores)。"""
    board = []
    scores = [0, 0]
    hand_b, hand_r = list(deck_b.keys()), list(deck_r.keys())
    session = random.randint(1, 10 ** 6)
    for round_ in range(1, 6):
        if max(scores) >= 3:
            break
        bl = BUDGET_LIMITS[round_]
        my_a = [b for b in board if b['team'] == 1]
        my_b = [b for b in board if b['team'] == 2]
        en_a = [b for b in board if b['team'] == 2]
        en_b = [b for b in board if b['team'] == 1]
        if bundle_side == 'p1':
            plan_a, _ = bundle_place(engine, 'p1', my_a, en_a, deck_b, hand_b, round_, bl,
                                     session=session, formation=bname)
            plan_b = rule_random_place(deck_r, hand_r, bl, 'p2', my_b)
        else:
            plan_a = rule_random_place(deck_r, hand_r, bl, 'p1', my_a)
            plan_b, _ = bundle_place(engine, 'p2', my_b, en_b, deck_b, hand_b, round_, bl,
                                     session=session, formation=bname)
        for p in plan_a:
            if p['dbId'] in hand_b:
                hand_b.remove(p['dbId'])
        for p in plan_b:
            if p['dbId'] in hand_r:
                hand_r.remove(p['dbId'])
        full = board + plan_a + plan_b
        res = engine.simulate(full, round_=round_, seed=game_seed * 10 + round_)
        board = res['survivors']
        scores[0] += res['d1']
        scores[1] += res['d2']
    b_score = scores[0] if bundle_side == 'p1' else scores[1]
    r_score = scores[1] if bundle_side == 'p1' else scores[0]
    if b_score == r_score:
        return 0, 1, 0, scores
    return (1, 0, 0, scores) if b_score > r_score else (0, 0, 1, scores)


def main(games: int = 40):
    root = project_root()
    engine = EngineClient(root)
    engine.start()
    try:
        db = engine.db()
        init_meta(db)
        init_mon_meta(db)
        load_endgame_lib(os.path.join(root, 'reports', 'endgame_lib.json'))
        formations = engine.formations()['formations']
        deck_names = [f['name'] for f in formations]
        decks = [{s['monsterId']: s['badgeIds'] for s in f['team']} for f in formations]
        print(f'[bench_script] 卡组池 {len(decks)} 套: {deck_names}', flush=True)

        wins = draws = losses = 0
        for g in range(games):
            di = g % len(decks)
            dj = random.randrange(len(decks))
            script_side = 'p1' if g % 2 == 0 else 'p2'
            w, d, l, _ = play_script_vs_rule(engine, decks[di], decks[dj], g * 1000 + 7, script_side)
            wins += w
            draws += d
            losses += l
            if (g + 1) % 8 == 0:
                print(f'  ... {g + 1}/{games} 局', flush=True)
        total = wins + draws + losses
        wr = wins / total
        wpr = (wins + 0.5 * draws) / total
        print(f'[bench_script] 结果：{games} 局 胜{wins} 平{draws} 负{losses} | '
              f'严格胜率={wr:.2f} 胜平率={wpr:.2f} Elo(严格胜率)={elo_from(wr):.0f}', flush=True)
    finally:
        engine.close()


def main_bundle(games: int = 40):
    root = project_root()
    engine = EngineClient(root)
    engine.start()
    try:
        db = engine.db()
        init_meta(db)
        init_mon_meta(db)
        formations = engine.formations()['formations']
        deck_names = [f['name'] for f in formations]
        decks = [{s['monsterId']: s['badgeIds'] for s in f['team']} for f in formations]
        print(f'[bench_bundle] 卡组池 {len(decks)} 套: {deck_names}', flush=True)

        wins = draws = losses = 0
        for g in range(games):
            di = g % len(decks)
            dj = random.randrange(len(decks))
            bundle_side = 'p1' if g % 2 == 0 else 'p2'
            w, d, l, _ = play_bundle_vs_rule(engine, decks[di], decks[dj], deck_names[di],
                                             g * 1000 + 7, bundle_side)
            wins += w
            draws += d
            losses += l
            if (g + 1) % 8 == 0:
                print(f'  ... {g + 1}/{games} 局', flush=True)
        total = wins + draws + losses
        wr = wins / total
        wpr = (wins + 0.5 * draws) / total
        print(f'[bench_bundle] 结果：{games} 局 胜{wins} 平{draws} 负{losses} | '
              f'严格胜率={wr:.2f} 胜平率={wpr:.2f} Elo(严格胜率)={elo_from(wr):.0f}', flush=True)
    finally:
        engine.close()


def main_rng(trials=30):
    """战斗随机性天花板测试：固定一个终局 board，用不同战斗随机种子重复模拟，
    看同一阵容的胜负是否随 RNG 大幅摆动。若摆动大 → reward 本质是噪声，难学。"""
    root = project_root()
    engine = EngineClient(root)
    engine.start()
    try:
        db = engine.db()
        init_meta(db)
        init_mon_meta(db)
        formations = engine.formations()['formations']
        deck_names = [f['name'] for f in formations]
        decks = [{s['monsterId']: s['badgeIds'] for s in f['team']} for f in formations]
        di, dj = 0, 1
        session = random.randint(1, 10 ** 6)
        full = []
        for side, deck, dname, opp in (('p1', decks[di], deck_names[di], decks[dj]),
                                       ('p2', decks[dj], deck_names[dj], decks[di])):
            my = [b for b in full if b['team'] == (1 if side == 'p1' else 2)]
            en = [b for b in full if b['team'] != (1 if side == 'p1' else 2)]
            plan, _ = bundle_place(engine, side, my, en, deck, list(deck.keys()), 5, 16,
                                   session=session, formation=dname)
            full += plan
        results = Counter()
        for t in range(trials):
            res = engine.simulate(full, round_=5, seed=t * 7919 + 13)
            d = res['d1'] - res['d2']
            if d > 0:
                results['p1胜'] += 1
            elif d < 0:
                results['p2胜'] += 1
            else:
                results['平'] += 1
        print(f'[bench_rng] {deck_names[di]} vs {deck_names[dj]}，固定终局 board，'
              f'{trials} 次不同战斗种子：{dict(results)}', flush=True)
    finally:
        engine.close()


if __name__ == '__main__':
    args = sys.argv[1:]
    mode = 'script'
    n = 40
    for a in args:
        if a == 'bundle':
            mode = 'bundle'
        elif a == 'rng':
            mode = 'rng'
        elif a.isdigit():
            n = int(a)
    if mode == 'bundle':
        main_bundle(n)
    elif mode == 'rng':
        main_rng(n)
    else:
        main(n)
