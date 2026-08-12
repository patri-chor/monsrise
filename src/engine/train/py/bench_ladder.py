# -*- coding: utf-8 -*-
"""
恒定基准：衡量模型强度的恒定指标（跨版本可比）。
- L1_rule 规则随机：随机选怪 + 位置遵守"坦克/战士/特殊靠前、法师/射手后排"（初级基准，稳定）
  （不再使用 L0 纯随机：其强度随卡组不同忽强忽弱，有失偏颇，不适合做恒定基准。）
恒定协议：7 套卡组确定性配对 + 固定种子 + 换边抵消先手 → 胜率表 + Elo 强度分。
Elo 锚点：L1=1200（50% 胜率即 1200 分）。
输出 append 到 reports/benchmark_ladder.jsonl（跨版本曲线）。

运行：python -m src.engine.train.py.bench_ladder <rl_model.pt> [games_per_layer] [out_dir]
"""
import json
import math
import os
import sys
import time

from .bridge_client import EngineClient
from .state import init_meta
from .heuristic import init_mon_meta, load_endgame_lib
from .net import DualNet
from .mcts import MCTS
from .selfplay import play_vs_random
from .exp_lib import ExperienceLib

ELO_ANCHOR = {'L1_rule': 1200.0}


def project_root() -> str:
    p = os.path.dirname(os.path.abspath(__file__))
    for _ in range(4):
        p = os.path.dirname(p)
    return p


def elo_from_wr(wr: float, anchor: float) -> float:
    """由对层胜率反推模型 Elo：由 Elo 期望公式 E = 1/(1+10^((R_opp-R_model)/400)) 反解。
    WR=0.5 → R_model=anchor；WR 越高模型分越高。clip 防除零/对数爆炸。"""
    wr = min(0.99, max(0.01, wr))
    return anchor + 400.0 * math.log10(wr / (1.0 - wr))


def run_benchmark(engine, net, mcts, decks, games_per_layer: int = 20, seed_base: int = 1000,
                  out_path: str = None, step: int = None, exp_lib=None, focused_deck=None) -> dict:
    """恒定基准协议：卡组确定性配对 + 固定种子 + 换边，跑对每层基准对手的胜率。
    exp_lib：在线经验库，命中正分候选直接采用（评估"网络+经验库"的组合强度）。
    focused_deck：聚焦训练时传入该卡组——网络侧固定用它（模型只学过它），
    对手卡组轮换提供多样性；为 None 时保持原协议（网络侧卡组轮换）。
    返回 {'elo': 汇总强度分, 'layers': {name: {wins, draws, losses, wr, elo}}}。"""
    layers = {'L1_rule': 'rule'}
    results = {}
    total_elo = 0.0
    n_decks = len(decks)
    for name, opp in layers.items():
        wins = draws = losses = 0
        for i in range(games_per_layer):
            b = (i + seed_base) % n_decks
            if focused_deck is not None:
                deck_a, deck_b = focused_deck, decks[b]
            else:
                a = (i + seed_base) % n_decks
                b = (a + 1) % n_decks
                deck_a, deck_b = decks[a], decks[b]
            seed = i + seed_base
            swap = i % 2 == 1
            mcts_side = 'p2' if swap else 'p1'
            w, d, l, _s = play_vs_random(engine, net, mcts, deck_a, deck_b, seed, mcts_side,
                                         opponent=opp, exp_lib=exp_lib)
            wins += w
            draws += d
            losses += l
        total = wins + draws + losses
        wr = wins / total if total else 0.0
        elo = elo_from_wr(wr, ELO_ANCHOR[name])
        results[name] = {'wins': wins, 'draws': draws, 'losses': losses,
                         'wr': round(wr, 4), 'elo': round(elo, 1)}
        total_elo += elo
    bench = {'ts': time.strftime('%Y-%m-%d %H:%M:%S'), 'step': step,
             'elo': round(total_elo / len(layers), 1), 'layers': results}
    if out_path:
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        with open(out_path, 'a', encoding='utf-8') as f:
            f.write(json.dumps(bench, ensure_ascii=False) + '\n')
    return bench


def main(model_path: str, games_per_layer: int = 20, out_dir: str = 'reports'):
    import torch
    root = project_root()
    engine = EngineClient(root)
    engine.start()
    try:
        db = engine.db()
        init_meta(db)
        init_mon_meta(db)
        load_endgame_lib(os.path.join(root, 'reports', 'endgame_lib.json'))
        formations = engine.formations()['formations']
        decks = [{s['monsterId']: s['badgeIds'] for s in f['team']} for f in formations]
        device = 'cuda' if torch.cuda.is_available() else 'cpu'
        net = DualNet().to(device)
        net.load_state_dict(torch.load(model_path, map_location=device))
        mcts = MCTS(net, num_sim=48, device=device, value_net_weight=0.6)
        exp_lib = ExperienceLib(path=os.path.join(root, 'reports', 'exp_lib.json'))
        n_ent = sum(len(c) for c in exp_lib.lib.values())
        print(f'[bench] 模型 {model_path} | 卡组 {len(decks)} 套 | 经验库 {n_ent}条 | 每层 {games_per_layer} 局', flush=True)
        bench = run_benchmark(engine, net, mcts, decks, games_per_layer=games_per_layer,
                              out_path=os.path.join(out_dir, 'benchmark_ladder.jsonl'), exp_lib=exp_lib)
        for name, r in bench['layers'].items():
            print(f'  {name}: 胜{r["wins"]} 平{r["draws"]} 负{r["losses"]} '
                  f'胜率 {r["wr"] * 100:.1f}% Elo {r["elo"]:.0f}')
        print(f'  汇总 Elo 强度分 = {bench["elo"]:.0f}', flush=True)
    finally:
        engine.close()


if __name__ == '__main__':
    model_path = sys.argv[1] if len(sys.argv) > 1 else 'reports/rl_model.pt'
    games = int(sys.argv[2]) if len(sys.argv) > 2 else 20
    out_dir = sys.argv[3] if len(sys.argv) > 3 else 'reports'
    main(model_path, games, out_dir)
