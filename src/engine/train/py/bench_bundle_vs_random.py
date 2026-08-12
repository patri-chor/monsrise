# -*- coding: utf-8 -*-
"""
基准：ai-bundle（原网页手工启发式 AI）vs 随机合法策略。
用于验证"手工录入的纯启发式 AI"的真实强度，作为 RL 训练的教师/基线参考。

运行：python -m src.engine.train.py.bench_bundle_vs_random [局数]
"""
import argparse
import os
import random

from .bridge_client import EngineClient
from .state import init_meta
from .heuristic import init_mon_meta
from .selfplay import bundle_place, random_place, BUDGET_LIMITS
from .train import project_root


def play_bundle_vs_random(engine, name_a, deck_a, name_b, deck_b, game_seed, bundle_side='p1'):
    """ai-bundle（贪心，强制卡组对应阵型）vs 随机合法策略。
    返回 (bundle_wins, bundle_draws, bundle_losses, scores)。"""
    session = f'g{game_seed}s{bundle_side}'
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
        if bundle_side == 'p1':
            plan_a, _ = bundle_place(engine, 'p1', my_a, en_a, deck_a, hand_a, round_, bl, session, name_a)
            plan_b = random_place(deck_b, hand_b, bl, 'p2', my_b)
        else:
            plan_a = random_place(deck_a, hand_a, bl, 'p1', my_a)
            plan_b, _ = bundle_place(engine, 'p2', my_b, en_b, deck_b, hand_b, round_, bl, session, name_b)
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


def main(games: int = 20, mirror: bool = False):
    root = project_root()
    engine = EngineClient(root)
    engine.start()
    try:
        db = engine.db()
        init_meta(db)
        init_mon_meta(db)
        decks = [({s['monsterId']: s['badgeIds'] for s in f['team']}, f['name'])
                 for f in engine.formations()['formations']]
        wins = draws = losses = 0
        for g in range(games):
            (d_a, name_a) = random.choice(decks)
            (d_b, name_b) = (d_a, name_a) if mirror else random.choice([x for x in decks if x[0] is not d_a])
            seed = random.randint(0, 10 ** 6)
            w, d, l, _ = play_bundle_vs_random(engine, name_a, d_a, name_b, d_b, seed, 'p1')
            wins += w
            draws += d
            losses += l
            w2, d2, l2, _ = play_bundle_vs_random(engine, name_a, d_a, name_b, d_b, seed + 7, 'p2')
            wins += w2
            draws += d2
            losses += l2
        ev = wins + draws + losses
        tag = '同卡组镜像' if mirror else '随机卡组'
        print(f'[bundle-bench/{tag}] vs随机 {ev}局（先手{games}+后手{games}）胜{wins} 平{draws} 负{losses} '
              f'胜率={wins / ev * 100 if ev else 0:.1f}%', flush=True)
    finally:
        engine.close()


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('games', type=int, nargs='?', default=20)
    ap.add_argument('--mirror', action='store_true', help='双方同卡组（镜像），隔离纯放置水平')
    args = ap.parse_args()
    main(games=args.games, mirror=args.mirror)
