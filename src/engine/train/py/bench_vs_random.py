# -*- coding: utf-8 -*-
"""
基准：MCTS（当前模型 + 启发式先验）vs 随机合法策略。
A/B 开关：--no-endgame 关闭残局库先验，对比残局库接入的即时效果。

运行：python -m src.engine.train.py.bench_vs_random [局数] [--sim 48] [--no-endgame]
"""
import argparse
import os
import random

import torch

from . import heuristic as H
from .bridge_client import EngineClient
from .state import init_meta
from .heuristic import init_mon_meta, load_endgame_lib
from .net import DualNet, migrate_state_dict
from .mcts import MCTS
from .selfplay import play_vs_random, play_vs_random_policy_only
from .train import project_root


def main(games: int = 10, num_sim: int = 48, use_endgame: bool = True, use_model: bool = True,
         real_sim: bool = False, policy_only: bool = False):
    root = project_root()
    engine = EngineClient(root)
    engine.start()
    try:
        db = engine.db()
        init_meta(db)
        init_mon_meta(db)
        if use_endgame:
            n = load_endgame_lib(os.path.join(root, 'reports', 'endgame_lib.json'))
            print(f'[bench] 残局库: 开（{n} 条，镜像近似也可命中）')
        else:
            H._ENDGAME_LIB = {}
            print('[bench] 残局库: 关')
        decks = [{s['monsterId']: s['badgeIds'] for s in f['team']} for f in engine.formations()['formations']]
        device = 'cuda' if torch.cuda.is_available() else 'cpu'
        net = DualNet().to(device)
        if use_model:
            ck = os.path.join(root, 'reports', 'rl_model.pt')
            if os.path.exists(ck):
                net.load_state_dict(migrate_state_dict(torch.load(ck, map_location=device)))
                print(f'[bench] 模型: {ck}')
            else:
                print('[bench] 模型: 无（随机初始化网络）')
        else:
            print('[bench] 模型: 随机初始化（纯启发式先验强度）')
        wins = draws = losses = 0
        mcts_plain = None
        for g in range(games):
            d_a, d_b = random.sample(decks, 2)
            if real_sim:
                # 真实战斗模拟价值：桥接引擎每扩展节点模拟一次（卡组随对局变化，故每局新建）
                mcts = MCTS(net, num_sim=num_sim, device=device, engine=engine, deck=d_a, use_real_sim=True)
            else:
                if mcts_plain is None:
                    mcts_plain = MCTS(net, num_sim=num_sim, device=device)
                mcts = mcts_plain
            seed = random.randint(0, 10 ** 6)
            w, d, l, _ = play_vs_random(engine, net, mcts, d_a, d_b, seed, 'p1')
            wins += w
            draws += d
            losses += l
            w2, d2, l2, _ = play_vs_random(engine, net, mcts, d_a, d_b, seed + 7, 'p2')
            wins += w2
            draws += d2
            losses += l2
        ev = wins + draws + losses
        mode = '真实模拟价值' if real_sim else '启发式价值'
        print(f'[bench/{mode}] vs随机 {ev}局（先手{games}+后手{games}）胜{wins} 平{draws} 负{losses} '
              f'胜率={wins / ev * 100 if ev else 0:.1f}%', flush=True)

        # Policy-Only 评估（可选）：与 MCTS 评估并列，只测 policy head 质量
        if policy_only:
            pw = pd = pl = 0
            for g in range(games):
                d_a, d_b = random.sample(decks, 2)
                seed = random.randint(0, 10 ** 6)
                w, d, l, _ = play_vs_random_policy_only(engine, net, d_a, d_b, seed, 'p1',
                                                        device=device)
                pw += w; pd += d; pl += l
                w2, d2, l2, _ = play_vs_random_policy_only(engine, net, d_a, d_b, seed + 7, 'p2',
                                                           device=device)
                pw += w2; pd += d2; pl += l2
            pev = pw + pd + pl
            print(f'[bench/policy-only] vs随机 {pev}局 胜{pw} 平{pd} 负{pl} '
                  f'胜率={pw / pev * 100 if pev else 0:.1f}% '
                  f'（若此项↑而MCTS项↓ → value head是瓶颈）', flush=True)
    finally:
        engine.close()


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('games', type=int, nargs='?', default=10)
    ap.add_argument('--sim', type=int, default=48)
    ap.add_argument('--no-endgame', action='store_true')
    ap.add_argument('--rand-net', action='store_true')
    ap.add_argument('--real-sim', action='store_true', help='MCTS 叶价值用真实战斗模拟（vs 随机冲击 90% 的关键）')
    ap.add_argument('--policy-only', action='store_true', help='额外跑 policy-only 对局，诊断 value head 是否是瓶颈')
    args = ap.parse_args()
    main(games=args.games, num_sim=args.sim, use_endgame=not args.no_endgame,
         use_model=not args.rand_net, real_sim=args.real_sim, policy_only=args.policy_only)
