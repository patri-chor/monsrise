# -*- coding: utf-8 -*-
"""
恒定基准：衡量模型强度的恒定指标（跨版本可比）。
- L1_rule 规则随机：随机选怪 + 位置遵守"坦克/战士/特殊靠前、法师/射手后排"（初级基准，稳定）
- L2_bundle 手工启发式 AI（ai-bundle）：当前已知最强基线（bundle 是 search/RF/RL 的上游），
  训练与 checkpoint 选优以此层为核心指标。
恒定协议：7 套卡组确定性配对 + 固定种子 + 换边抵消先手 → 胜率表 + Elo 强度分。
Elo 锚点：L1=1200（50% 胜率即 1200 分）；L2_bundle 以 bundle 对 L1 实测胜率锚定（~68% → 1331）。
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
from .heuristic import init_mon_meta, load_endgame_lib, init_formations
from .net import DualNet, migrate_state_dict
from .mcts import MCTS
from .selfplay import play_vs_random, play_vs_bundle, free_deck
from .exp_lib import ExperienceLib

ELO_ANCHOR = {'L1_rule': 1200.0, 'L1_free': 1200.0, 'L2_bundle': 1331.0}


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


def run_benchmark(engine, net, mcts, decks, deck_names=None, games_per_layer: int = 20, seed_base: int = 1000,
                  out_path: str = None, step: int = None, exp_lib=None, focused_deck=None) -> dict:
    """恒定基准协议：卡组确定性配对 + 固定种子 + 换边，跑对每层基准对手的胜率。
    层：L1_rule 规则随机（同卡池）/ L1_free 自由卡组规则随机（整体对阵胜率口径）/
        L2_bundle 手工启发式 AI（最强基线，核心指标）。
    deck_names：卡组名列表（L2_bundle 对手需要 formation 名）。
    exp_lib：在线经验库，命中正分候选直接采用（评估"网络+经验库"的组合强度）。
    focused_deck：聚焦训练时传入该卡组——网络侧固定用它（模型只学过它），
    对手卡组轮换提供多样性；为 None 时保持原协议（网络侧卡组轮换）。
    返回 {'elo': 汇总强度分, 'layers': {name: {wins, draws, losses, wr, elo}}}。
    说明：wr = 纯胜率（wins/total）；平局独立报告（不败率 = wins+draws / total）。"""
    layers = {'L1_rule': 'rule', 'L1_free': 'rule_free', 'L2_bundle': 'bundle'}
    results = {}
    total_elo = 0.0
    n_decks = len(decks)
    for name, opp in layers.items():
        wins = draws = losses = 0
        for i in range(games_per_layer):
            b = (i + seed_base) % n_decks
            if opp == 'rule_free':
                # L1_free 自由卡组规则随机：对手从 7 套已知阵型中随机选一套
                # （保留真实徽章），测"模型对整体对阵的放置能力"（不限定卡池）。
                deck_opp = free_deck(seed=(i + seed_base) * 7 + 3)
                if focused_deck is not None:
                    swap = i % 2 == 1
                    deck_a, deck_b = (deck_opp, focused_deck) if swap else (focused_deck, deck_opp)
                else:
                    swap = i % 2 == 1
                    deck_a, deck_b = deck_opp, focused_deck if focused_deck is not None else deck_opp
                seed = i + seed_base
                mcts_side = 'p2' if swap else 'p1'
                w, d, l, _s = play_vs_random(engine, net, mcts, deck_a, deck_b, seed, mcts_side,
                                             opponent='rule', exp_lib=exp_lib)
                wins += w
                draws += d
                losses += l
                continue
            if focused_deck is not None:
                # 聚焦模式：网络侧（MCTS）始终用 focused_deck。换边时交换 deck_a/deck_b，
                # 使 mcts_side 无论 p1/p2 都落在 focused_deck 上（修复：原代码换边时
                # MCTS 误用对手卡组 decks[b]，导致一半评估对局模型用没学过的卡组，
                # L1/bundle 胜率被系统性低估）。
                swap = i % 2 == 1
                if swap:
                    deck_a, deck_b = decks[b], focused_deck
                else:
                    deck_a, deck_b = focused_deck, decks[b]
            else:
                a = (i + seed_base) % n_decks
                b = (a + 1) % n_decks
                deck_a, deck_b = decks[a], decks[b]
                swap = i % 2 == 1
            seed = i + seed_base
            mcts_side = 'p2' if swap else 'p1'
            if opp == 'bundle':
                bname = deck_names[b] if deck_names else None
                w, d, l, _s = play_vs_bundle(engine, net, mcts, deck_a, deck_b, seed, mcts_side,
                                             bname=bname, exp_lib=exp_lib)
            else:
                w, d, l, _s = play_vs_random(engine, net, mcts, deck_a, deck_b, seed, mcts_side,
                                             opponent=opp, exp_lib=exp_lib)
            wins += w
            draws += d
            losses += l
        total = wins + draws + losses
        wr = wins / total if total else 0.0
        elo = elo_from_wr(wr, ELO_ANCHOR[name])
        results[name] = {'wins': wins, 'draws': draws, 'losses': losses,
                         'wr': round(wr, 4), 'nb': round((wins + draws) / total, 4) if total else 0.0,
                         'elo': round(elo, 1)}
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
        init_formations(formations)
        deck_names = [f['name'] for f in formations]
        decks = [{s['monsterId']: s['badgeIds'] for s in f['team']} for f in formations]
        device = 'cuda' if torch.cuda.is_available() else 'cpu'
        net = DualNet().to(device)
        net.load_state_dict(migrate_state_dict(torch.load(model_path, map_location=device)))
        mcts = MCTS(net, num_sim=48, device=device, value_net_weight=0.6)
        exp_lib = ExperienceLib(path=os.path.join(root, 'reports', 'exp_lib.json'))
        n_ent = sum(len(c) for c in exp_lib.lib.values())
        print(f'[bench] 模型 {model_path} | 卡组 {len(decks)} 套 | 经验库 {n_ent}条 | 每层 {games_per_layer} 局', flush=True)
        bench = run_benchmark(engine, net, mcts, decks, deck_names=deck_names,
                              games_per_layer=games_per_layer,
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
