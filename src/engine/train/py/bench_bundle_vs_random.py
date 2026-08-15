# -*- coding: utf-8 -*-
"""
基准：ai-bundle（原网页手工启发式 AI）vs 对手。
bundle 始终使用"与自身阵型匹配的卡组"（卡组与策略头分离，通过 formation 名精确绑定）。

对手可选：
  opponent=random    （默认）真正随机卡组：8 张不同怪兽 + 随机徽章，随机站位
  opponent=formation 从 7 套成型阵型卡组中随机挑一套（旧行为，用于对照）
  --mirror           双方同卡组镜像（隔离纯放置水平）

运行：python -m src.engine.train.py.bench_bundle_vs_random [局数] [--mirror] [--opponent random|formation]
"""
import argparse
import os
import random

from .bridge_client import EngineClient
from .state import init_meta, COST_BY_ID, BADGE_IDS
from .heuristic import init_mon_meta
from .selfplay import bundle_place, random_place, BUDGET_LIMITS
from .train import project_root

# 排除召唤物 126（小猴子），与真实卡组一致
VALID_DECK_MONSTERS = [i for i in range(101, 127) if i != 126]


def random_deck(rng=None):
    """真正随机卡组：8 张不同怪兽 + 随机徽章（2费2徽章 / 4费3徽章，与游戏配表一致）。"""
    rng = rng or random
    deck = {}
    for mid in rng.sample(VALID_DECK_MONSTERS, 8):
        n = 3 if COST_BY_ID.get(mid, 2) >= 4 else 2
        deck[mid] = rng.sample(BADGE_IDS, n)
    return deck


def play_bundle_vs_random(engine, name_bundle, deck_bundle, deck_opp, game_seed, bundle_side='p1'):
    """bundle（贪心，强制卡组对应阵型）vs 对手（随机合法策略，deck_opp 为对手卡组）。
    返回 (bundle_wins, bundle_draws, bundle_losses, scores)。scores 为 (p1, p2) 比分。"""
    session = f'g{game_seed}s{bundle_side}'
    board = []
    scores = [0, 0]
    if bundle_side == 'p1':
        deck_p1, deck_p2 = deck_bundle, deck_opp
        name_p1, name_p2 = name_bundle, '对手'
    else:
        deck_p1, deck_p2 = deck_opp, deck_bundle
        name_p1, name_p2 = '对手', name_bundle
    hand_p1, hand_p2 = list(deck_p1.keys()), list(deck_p2.keys())
    for round_ in range(1, 6):
        if max(scores) >= 3:
            break
        bl = BUDGET_LIMITS[round_]
        my_p1 = [b for b in board if b['team'] == 1]
        en_p1 = [b for b in board if b['team'] == 2]
        my_p2 = [b for b in board if b['team'] == 2]
        en_p2 = [b for b in board if b['team'] == 1]
        if bundle_side == 'p1':
            plan_p1, _ = bundle_place(engine, 'p1', my_p1, en_p1, deck_p1, hand_p1, round_, bl,
                                      session, name_p1)
            plan_p2 = random_place(deck_p2, hand_p2, bl, 'p2', my_p2)
        else:
            plan_p1 = random_place(deck_p1, hand_p1, bl, 'p1', my_p1)
            plan_p2, _ = bundle_place(engine, 'p2', my_p2, en_p2, deck_p2, hand_p2, round_, bl,
                                      session, name_p2)
        for p in plan_p1:
            if p['dbId'] in hand_p1:
                hand_p1.remove(p['dbId'])
        for p in plan_p2:
            if p['dbId'] in hand_p2:
                hand_p2.remove(p['dbId'])
        full = board + plan_p1 + plan_p2
        res = engine.simulate(full, round_=round_, seed=game_seed * 10 + round_)
        board = res['survivors']
        scores[0] += res['d1']
        scores[1] += res['d2']
    bundle_score = scores[0] if bundle_side == 'p1' else scores[1]
    opp_score = scores[1] if bundle_side == 'p1' else scores[0]
    if bundle_score == opp_score:
        return 0, 1, 0, scores
    return (1, 0, 0, scores) if bundle_score > opp_score else (0, 0, 1, scores)


def main(games: int = 20, mirror: bool = False, opponent: str = 'random'):
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
        rng = random.Random()
        for g in range(games):
            (d_a, name_a) = random.choice(decks)
            if mirror:
                (d_b, name_b) = (d_a, name_a)
            elif opponent == 'formation':
                (d_b, name_b) = random.choice([x for x in decks if x[0] is not d_a])
            else:
                (d_b, name_b) = (random_deck(rng), '随机卡组')
            seed = random.randint(0, 10 ** 6)
            w, d, l, _ = play_bundle_vs_random(engine, name_a, d_a, d_b, seed, 'p1')
            wins += w
            draws += d
            losses += l
            w2, d2, l2, _ = play_bundle_vs_random(engine, name_a, d_a, d_b, seed + 7, 'p2')
            wins += w2
            draws += d2
            losses += l2
        ev = wins + draws + losses
        tag = '同卡组镜像' if mirror else ('随机卡组' if opponent == 'random' else '成型阵型卡组')
        print(f'[bundle-bench/{tag}] {ev}局（先手{games}+后手{games}）胜{wins} 平{draws} 负{losses} '
              f'胜率={wins / ev * 100 if ev else 0:.1f}%', flush=True)
    finally:
        engine.close()


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('games', type=int, nargs='?', default=20)
    ap.add_argument('--mirror', action='store_true', help='双方同卡组（镜像），隔离纯放置水平')
    ap.add_argument('--opponent', choices=['random', 'formation'], default='random',
                    help='random=真正随机卡组；formation=成型阵型卡组')
    args = ap.parse_args()
    main(games=args.games, mirror=args.mirror, opponent=args.opponent)
