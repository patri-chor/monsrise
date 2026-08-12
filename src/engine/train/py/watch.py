# -*- coding: utf-8 -*-
"""
查看新 AI（RL 双头网络 + MCTS）自对弈过程：几局不同卡组配对，
每回合打印开战前布阵图（怪兽两字简称）+ 双方新增 + 比分，最后汇总胜负。
输出同时写入 reports/rl_watch.md（Markdown），终端与文件一致。

运行：python -m src.engine.train.py.watch 4 [num_sim] [--out 路径]
"""
import os
import random
import sys

import torch

from .bridge_client import EngineClient
from .state import (init_meta, State, BUDGET_LIMITS, COST_BY_ID, idx_to_db_id, cell_to_xy)
from .heuristic import init_mon_meta
from .net import DualNet
from .mcts import MCTS
from .selfplay import _sample_p


def project_root() -> str:
    p = os.path.dirname(os.path.abspath(__file__))
    for _ in range(4):
        p = os.path.dirname(p)
    return p


def mulberry32(seed: int):
    """标准 mulberry32：确定性伪随机，与 TS evaluate.ts 同款。"""
    t = (seed + 0x6D2B79F5) & 0xFFFFFFFF
    while True:
        t = (t + 0x6D2B79F5) & 0xFFFFFFFF
        x = t
        x = ((x ^ (x >> 15)) * (x | 1)) & 0xFFFFFFFF
        x = (x ^ (x + ((x ^ (x >> 7)) * (x | 61)) & 0xFFFFFFFF)) & 0xFFFFFFFF
        x = (x ^ (x >> 14)) & 0xFFFFFFFF
        yield x / 4294967296


def short_name(name: str) -> str:
    """两字简称：取名字前两个字。"""
    return name[:2]


def render_board(full, short):
    """开战前完整棋盘 ASCII：两字简称占 4 显示列（2 中文宽度），空位 '....' 4 列，
    中线 '|   ' 4 列，竖向对齐。"""
    grid = [[''] * 11 for _ in range(5)]
    for u in full:
        grid[u['y']][u['x']] = short[u['dbId']]
    lines = ['    ' + ' '.join(f'{x:>4}' for x in range(11))]
    for y in range(5):
        cells = []
        for x in range(11):
            if x == 5:
                cells.append('|   ')
            else:
                c = grid[y][x]
                cells.append(c if c else '....')
        lines.append(f'y{y}  ' + ' '.join(cells))
    return '\n'.join(lines)


def place_with_q(engine, mcts, side, my, enemy, deck, hand, round_, budget_limit, short, emit, greedy=True):
    """回合内放置（查看用）：与 selfplay.mcts_place 同逻辑，但每步打印 MCTS top-3 候选的
    胜率（Q = 子节点平均价值），标注实际选择。返回 placed 列表。"""
    used = sum(COST_BY_ID[m['dbId']] for m in my)
    budget = budget_limit - used
    my_cur = [dict(m) for m in my]
    my_team = 1 if side == 'p1' else 2
    placed = []
    deck_keys = list(deck.keys())
    hand = list(hand)
    while True:
        s = State(side, my_cur, enemy, hand, round_, budget, budget_limit, deck_keys)
        if not s.legal_actions():
            break
        _pm, _pc, joint, greedy_a, _v, _rq, cands = mcts.search_with_cands(s)
        if greedy and greedy_a is not None:
            db_id, x, y = greedy_a
        else:
            mi, ci = _sample_p(joint)
            db_id = idx_to_db_id(mi)
            x, y = cell_to_xy(side, ci)
        shown = [c for c in cands if c[4] > 0] or cands
        shown.sort(key=lambda t: -t[4])
        for k, (cd, cx, cy, q, n) in enumerate(shown[:3]):
            mark = ' ← 选' if (cd == db_id and cx == x and cy == y) else ''
            emit(f'        top{k + 1}: {short[cd]}@{cx},{cy} 胜率 {q:+.2f} (访问{n}){mark}')
        my_cur.append({'dbId': db_id, 'x': x, 'y': y, 'team': my_team})
        placed.append({'dbId': db_id, 'x': x, 'y': y, 'team': my_team, 'badgeIds': deck[db_id]})
        hand.remove(db_id)
        budget -= COST_BY_ID[db_id]
    return placed


def main(games: int = 4, num_sim: int = 24, model_path: str = 'reports/rl_model.pt',
         out_path: str = 'reports/rl_watch.md'):
    root = project_root()
    # 固定全局随机种子：同参数（局数/num_sim）→ 同配对同落位，可复现
    random.seed(20260810)
    engine = EngineClient(root)
    engine.start()
    out = []  # markdown 行（终端与文件共用）
    try:
        def emit(s=''):
            print(s)
            out.append(s)

        db = engine.db()
        init_meta(db)
        init_mon_meta(db)
        mon_name = {m['id']: m['name'] for m in db['monsters']}
        short = {mid: short_name(name) for mid, name in mon_name.items()}
        formations = engine.formations()['formations']
        decks = [{s['monsterId']: s['badgeIds'] for s in f['team']} for f in formations]
        names = [f['name'] for f in formations]

        net = DualNet()
        ckpt = os.path.join(root, model_path)
        net.load_state_dict(torch.load(ckpt, map_location='cpu'))
        net.eval()
        mcts = MCTS(net, num_sim=num_sim, device='cpu', value_net_weight=0.6)

        emit('# RL 自对弈查看（新 AI）')
        emit(f'- 模型：`{model_path}`')
        emit(f'- 卡组池 {len(decks)} 套：' + '、'.join(names))
        emit(f'- num_sim={num_sim}')
        emit('- 怪兽编号 → 名字：' + '；'.join(f'{mid} {mon_name[mid]}' for mid in sorted(mon_name)))
        emit('- 每步放置打印 MCTS top-3 候选的胜率（Q）与访问数')
        emit()

        summary = []
        for i in range(games):
            # 确定性不同配对（同 seed 同配对，第 i+1 局与之前不同）
            rng = mulberry32(1000 + i)
            ia = int(next(rng) * len(decks))
            ib = int(next(rng) * (len(decks) - 1))
            if ib >= ia:
                ib += 1
            deck_a, deck_b = decks[ia], decks[ib]
            emit(f'## 局 {i + 1}：{names[ia]}（P1） vs {names[ib]}（P2）')

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
                emit(f'**R{round_}** P1 决策：')
                plan_a = place_with_q(engine, mcts, 'p1', my_a, en_a, deck_a, hand_a, round_, bl, short, emit)
                for p in plan_a:
                    if p['dbId'] in hand_a:
                        hand_a.remove(p['dbId'])
                emit(f'P2 决策：')
                plan_b = place_with_q(engine, mcts, 'p2', my_b, en_b, deck_b, hand_b, round_, bl, short, emit)
                for p in plan_b:
                    if p['dbId'] in hand_b:
                        hand_b.remove(p['dbId'])
                full = board + plan_a + plan_b
                res = engine.simulate(full, round_=round_, seed=i * 10 + round_)
                emit(f'新增 A({len(plan_a)})：'
                     + ' '.join(f'{short[u["dbId"]]}@{u["x"]},{u["y"]}' for u in plan_a)
                     + f'　|　B({len(plan_b)})：'
                     + ' '.join(f'{short[u["dbId"]]}@{u["x"]},{u["y"]}' for u in plan_b))
                emit('```')
                emit(render_board(full, short))
                emit('```')
                wins = res['d1'], res['d2']
                if wins[0] == wins[1]:
                    tag = '平'
                elif wins[0] > wins[1]:
                    tag = 'P1胜'
                else:
                    tag = 'P2胜'
                surv = '、'.join(f'{short[u["dbId"]]}@{u["x"]},{u["y"]}' for u in res['survivors']) or '全灭'
                emit(f'→ 本回合 {scores[0] + wins[0]}:{scores[1] + wins[1]}（{tag}）｜场上：{surv}')
                emit()
                board = res['survivors']
                scores[0] += wins[0]
                scores[1] += wins[1]

            winner = 0 if scores[0] == scores[1] else (1 if scores[0] > scores[1] else 2)
            tag = '平局' if winner == 0 else ('P1胜' if winner == 1 else 'P2胜')
            emit(f'**局 {i + 1} 结果**：{scores[0]}:{scores[1]} {tag}')
            emit()
            summary.append((f'{names[ia]} vs {names[ib]}', scores, tag))

        emit('## 汇总')
        for name, scores, tag in summary:
            emit(f'- {name}：{scores[0]}:{scores[1]} {tag}')

        abs_out = os.path.join(root, out_path)
        os.makedirs(os.path.dirname(abs_out), exist_ok=True)
        with open(abs_out, 'w', encoding='utf-8') as f:
            f.write('\n'.join(out) + '\n')
        emit(f'\n已保存：{abs_out}')
    finally:
        engine.close()


if __name__ == '__main__':
    games = int(sys.argv[1]) if len(sys.argv) > 1 else 4
    num_sim = int(sys.argv[2]) if len(sys.argv) > 2 else 24
    out_path = 'reports/rl_watch.md'
    if '--out' in sys.argv:
        out_path = sys.argv[sys.argv.index('--out') + 1]
    main(games=games, num_sim=num_sim, out_path=out_path)
