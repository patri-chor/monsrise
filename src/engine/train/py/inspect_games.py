# -*- coding: utf-8 -*-
"""
人工检查对弈：MD 表格展示每回合双方布阵（本轮新增 * 标注 + 战前完整棋盘 ASCII 网格）。
两种模式：自对弈（当前网络 vs 当前网络）与 对战规则随机（vs L1 初级基准）。
固定配对 + 固定种子，可复现。输出到 reports/inspect_games.md 并同步打印。

运行：python -m src.engine.train.py.inspect_games [rl_model.pt] [selfplay局数] [vsrandom局数]
"""
import os
import sys

import torch

from .bridge_client import EngineClient
from .state import init_meta, BUDGET_LIMITS, COST_BY_ID
from .heuristic import init_mon_meta
from .net import DualNet, migrate_state_dict
from .mcts import MCTS
from .selfplay import mcts_place, rule_random_place, random_place, bundle_place
from .exp_lib import ExperienceLib


def project_root() -> str:
    p = os.path.dirname(os.path.abspath(__file__))
    for _ in range(4):
        p = os.path.dirname(p)
    return p


def short_name(name: str) -> str:
    return name[:2]


def render_board(full, short) -> str:
    """开战前完整棋盘 ASCII：两字简称，空位 '....'，中线 '|   '。"""
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


def fmt_side(units, new_dbids, short) -> str:
    """一侧布阵：按 (y,x) 排序，本轮新放标 *。units 含本轮新增（战前完整棋盘）。"""
    parts = []
    for u in sorted(units, key=lambda u: (u['y'], u['x'])):
        mark = '*' if u['dbId'] in new_dbids else ''
        parts.append(f'{short[u["dbId"]]}@{u["x"]},{u["y"]}{mark}')
    return ' '.join(parts) or '(空)'


def play_one(engine, mcts, deck_a, deck_b, seed, opponent, short, emit, exp_lib=None, bname=None):
    """跑一场并输出 MD 表格 + 网格。opponent=None 自对弈；'bundle' 为真实手写 Bundle 策略树；'rule'/'random' 为对应随机策略。
    返回 (scores, tag)。"""
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
        plan_a, _ = mcts_place(engine, mcts, 'p1', my_a, en_a, deck_a, hand_a, round_, bl, greedy=True,
                               exp_lib=exp_lib, score=(scores[0], scores[1]))
        for p in plan_a:
            if p['dbId'] in hand_a:
                hand_a.remove(p['dbId'])
        if opponent == 'bundle':
            plan_b, _ = bundle_place(engine, 'p2', my_b, en_b, deck_b, hand_b, round_, bl, formation=bname)
        elif opponent is None:
            plan_b, _ = mcts_place(engine, mcts, 'p2', my_b, en_b, deck_b, hand_b, round_, bl, greedy=True,
                                   exp_lib=exp_lib, score=(scores[0], scores[1]))
        else:
            fn = rule_random_place if opponent == 'rule' else random_place
            plan_b = fn(deck_b, hand_b, bl, 'p2', my_b)
        for p in plan_a:
            p['team'] = 1
        for p in plan_b:
            p['team'] = 2
            mid = p['dbId']
            if mid in hand_b:
                hand_b.remove(mid)
        full = board + plan_a + plan_b
        res = engine.simulate(full, round_=round_, seed=seed * 10 + round_)
        d1, d2 = res['d1'], res['d2']
        tag = '平' if d1 == d2 else ('P1胜' if d1 > d2 else 'P2胜')
        new_a = {p['dbId'] for p in plan_a}
        new_b = {p['dbId'] for p in plan_b}
        p1_units = [u for u in full if u['team'] == 1]
        p2_units = [u for u in full if u['team'] == 2]
        emit(f'| R{round_} | {fmt_side(p1_units, new_a, short)} | {fmt_side(p2_units, new_b, short)} | {tag} | {scores[0] + d1}:{scores[1] + d2} |')
        emit('```')
        emit(render_board(full, short))
        emit('```')
        board = res['survivors']
        scores[0] += d1
        scores[1] += d2
    winner = 0 if scores[0] == scores[1] else (1 if scores[0] > scores[1] else 2)
    tag = '平局' if winner == 0 else ('P1胜' if winner == 1 else 'P2胜')
    return scores, tag


def main(model_path: str = 'reports/rl_model.pt', sp_games: int = 3, vr_games: int = 3,
         out_path: str = None, quiet: bool = False, focus_idx: int = None,
         exp_lib_path: str = 'reports/exp_lib.json'):
    root = project_root()
    engine = EngineClient(root)
    engine.start()
    out = []

    def emit(s=''):
        if not quiet:
            print(s)
        out.append(s)

    try:
        db = engine.db()
        init_meta(db)
        init_mon_meta(db)
        mon_name = {m['id']: m['name'] for m in db['monsters']}
        short = {mid: short_name(name) for mid, name in mon_name.items()}
        formations = engine.formations()['formations']
        decks = [{s['monsterId']: s['badgeIds'] for s in f['team']} for f in formations]
        names = [f['name'] for f in formations]

        net = DualNet()
        try:
            mp = model_path if os.path.isabs(model_path) else os.path.join(root, model_path)
            net.load_state_dict(migrate_state_dict(torch.load(mp, map_location='cpu')), strict=False)
        except Exception as _e:
            print(f'[inspect] 警告: 加载历史模型权重警告 ({_e})，使用初始网络结构做测试', flush=True)
        net.eval()
        mcts = MCTS(net, num_sim=24, device='cpu', value_net_weight=0.6, prior_lambda=0.1)
        # 训练后检查应反映真实组合强度：网络 + 在线经验库（命中正分候选直接采用）
        exp_p = exp_lib_path if os.path.isabs(exp_lib_path) else os.path.join(root, exp_lib_path)
        exp_lib = ExperienceLib(path=exp_p)
        n_ent = sum(len(c) for c in exp_lib.lib.values())

        emit('# AI 对弈检查')
        emit(f'- 模型：`{model_path}`')
        emit(f'- 在线经验库：{n_ent}条（训练时按胜负回传累积；评估时命中正分候选直接采用）')
        emit(f'- 怪兽：' + '；'.join(f'{mid} {mon_name[mid]}' for mid in sorted(mon_name)))
        emit(f'- 卡组：' + '；'.join(f'{i} {n}' for i, n in enumerate(names)))
        emit('- 格式：P1 半区 x0-4（左），P2 半区 x6-10（右）；本轮新放标 `*`，未标为存活者原位')
        emit()

        if focus_idx is not None:
            # 聚焦模式：焦点卡组（P1 RL 模型） vs 其余 6 套（P2 真实 BundleAI 策略树）+ vs 规则随机
            others = [j for j in range(len(decks)) if j != focus_idx]
            emit(f'## 一、{names[focus_idx]}（RL模型） vs 其余 {len(others)} 套（真实 BundleAI 策略树）')
            emit()
            for k, j in enumerate(others):
                emit(f'### 局 {k + 1}：{names[focus_idx]}（P1 RL模型） vs {names[j]}（P2 BundleAI 策略树）')
                emit('| 回合 | P1 布阵 (x0-4) | P2 布阵 (x6-10) | 回合结果 | 比分 |')
                emit('|---|---|---|---|---|')
                scores, tag = play_one(engine, mcts, decks[focus_idx], decks[j], 101 + k, 'bundle', short, emit, exp_lib=exp_lib, bname=names[j])
                emit(f'**结果：{scores[0]}:{scores[1]} {tag}**')
                emit()
            emit(f'## 二、{names[focus_idx]} vs 规则随机（L1 基准）')
            emit()
            for i in range(vr_games):
                j = (focus_idx + 1 + i) % len(decks)
                emit(f'### 局 {i + 1}：{names[focus_idx]}（P1 AI） vs {names[j]}（P2 规则随机）')
                emit('| 回合 | P1 布阵 (x0-4) | P2 布阵 (x6-10) | 回合结果 | 比分 |')
                emit('|---|---|---|---|---|')
                scores, tag = play_one(engine, mcts, decks[focus_idx], decks[j], 201 + i, 'rule', short, emit, exp_lib=exp_lib)
                emit(f'**结果：{scores[0]}:{scores[1]} {tag}**')
                emit()
        else:
            emit('## 一、自对弈（当前网络 vs 当前网络，MCTS 贪心）')
            emit()
            for i in range(sp_games):
                ia, ib = i * 2, i * 2 + 1
                emit(f'### 局 {i + 1}：{names[ia]}（P1） vs {names[ib]}（P2）')
                emit('| 回合 | P1 布阵 (x0-4) | P2 布阵 (x6-10) | 回合结果 | 比分 |')
                emit('|---|---|---|---|---|')
                scores, tag = play_one(engine, mcts, decks[ia], decks[ib], 101 + i, None, short, emit, exp_lib=exp_lib)
                emit(f'**结果：{scores[0]}:{scores[1]} {tag}**')
                emit()

            emit('## 二、对战规则随机（当前网络 vs L1 规则随机：坦克/战士前排、法师/射手后排）')
            emit()
            for i in range(vr_games):
                ia, ib = 1 + i * 2, 2 + i * 2
                emit(f'### 局 {i + 1}：{names[ia]}（P1 AI） vs {names[ib]}（P2 规则随机）')
                emit('| 回合 | P1 布阵 (x0-4) | P2 布阵 (x6-10) | 回合结果 | 比分 |')
                emit('|---|---|---|---|---|')
                scores, tag = play_one(engine, mcts, decks[ia], decks[ib], 201 + i, 'rule', short, emit, exp_lib=exp_lib)
                emit(f'**结果：{scores[0]}:{scores[1]} {tag}**')
                emit()

        if out_path is None:
            if focus_idx is not None:
                out_path = os.path.join('reports', f'inspect_{names[focus_idx]}.md')
            else:
                out_path = 'reports/inspect_games.md'
        abs_out = os.path.join(root, out_path)
        os.makedirs(os.path.dirname(abs_out), exist_ok=True)
        with open(abs_out, 'w', encoding='utf-8') as f:
            f.write('\n'.join(out) + '\n')
        emit(f'\n已保存：{abs_out}')
        return abs_out
    finally:
        engine.close()


if __name__ == '__main__':
    model_path = sys.argv[1] if len(sys.argv) > 1 else 'reports/rl_model.pt'
    sp_games = int(sys.argv[2]) if len(sys.argv) > 2 else 3
    vr_games = int(sys.argv[3]) if len(sys.argv) > 3 else 3
    focus_idx = None
    exp_lib_path = 'reports/exp_lib.json'
    if '--focus' in sys.argv:
        focus_idx = int(sys.argv[sys.argv.index('--focus') + 1])
    if '--exp-lib' in sys.argv:
        exp_lib_path = sys.argv[sys.argv.index('--exp-lib') + 1]
    main(model_path, sp_games, vr_games, None, False, focus_idx, exp_lib_path)
