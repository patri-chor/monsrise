# -*- coding: utf-8 -*-
"""
BC 离线蒸馏：拿 bundleai（原网页手写 AI，实测 vs L1_rule 68% 胜率）当老师，
直接教 policy 头（怪兽头 + 格子头）拟合它的落子序列。

背景诊断结论（bench_script.py 实测）：
  - 在线 RL（policy 梯度 + real_sim MCTS）练 30 分钟仍卡 vs L1_rule 50%；
  - 根因：MCTS 叶价值 =「先放一怪 + 贪心补齐整队」的一回合战斗结果，
    第一个动作对战斗结果的影响被贪心补齐稀释到几乎为零 → 访问分布 π 接近噪声；
  - bundleai 不靠网络/搜索就打 68%，是有价值的可学习监督信号。

做法：bundleai 自对弈（双方都出样本），每个决策点记录
  (state, 怪兽 one-hot, 格子 one-hot)，
用交叉熵训练 policy 头（不做价值头，避开价值噪声）。

子命令：
  collect N  生成 N 局 bundleai 自对弈样本 → reports/bc_samples.pkl
  train E    载入样本，交叉熵训练 E 个 epoch → reports/bc_model.pt
  all        收集 + 训练 + 评估（vs L1_rule / vs bundleai）
"""
import os
import sys
import random
import pickle

import numpy as np

from .bridge_client import EngineClient
from .state import (init_meta, COST_BY_ID, BUDGET_LIMITS, State, encode_state,
                    db_id_to_idx, idx_to_db_id, xy_to_cell, cell_to_xy,
                    MONSTER_COUNT, CELL_COUNT, mirror_sample, flip_y_sample)
from .heuristic import init_mon_meta
from .selfplay import bundle_place, play_game, rule_random_place
from .net import DualNet
from .mcts import MCTS
from .bench_ladder import run_benchmark


def project_root() -> str:
    p = os.path.dirname(os.path.abspath(__file__))
    for _ in range(4):
        p = os.path.dirname(p)
    return p


def collect_side_samples(engine, side, my, enemy, deck, hand, round_, bl, session, formation, score):
    """bundleai 在单侧本回合的落子，逐子回放成 (state, 怪兽 one-hot, 格子 one-hot)。
    bundle_place 一次给整回合计划（有序），按计划顺序回放，每个决策点记录 bundleai 的
    选择。返回 (samples, placed)。"""
    hand_work = list(hand)
    placed, _ = bundle_place(engine, side, [dict(m) for m in my], enemy, deck, hand_work,
                             round_, bl, session=session, formation=formation)
    samples = []
    budget = bl - sum(COST_BY_ID[m['dbId']] for m in my)
    my_replay = [dict(m) for m in my]
    hand_replay = list(hand)
    deck_keys = list(deck.keys())
    for p in placed:
        db_id, x, y = p['dbId'], p['x'], p['y']
        s = State(side=side, my=my_replay, enemy=enemy, hand=hand_replay, round=round_,
                  budget=budget, budget_limit=bl, deck=deck_keys, score=score, deck_badges=deck)
        grid, g = encode_state(s)
        pi_m = np.zeros(MONSTER_COUNT, dtype=np.float32)
        pi_c = np.zeros(CELL_COUNT, dtype=np.float32)
        pi_m[db_id_to_idx(db_id)] = 1.0
        pi_c[xy_to_cell(side, x, y)] = 1.0
        samples.append((grid, g, pi_m, pi_c, 0.0, 1.0))
        my_replay.append({'dbId': db_id, 'x': x, 'y': y, 'badgeIds': deck[db_id]})
        hand_replay.remove(db_id)
        budget -= COST_BY_ID[db_id]
    return samples, placed


def collect_game(engine, deck_a, deck_b, name_a, name_b, seed):
    """bundleai vs bundleai 一整局，双方都出样本。"""
    board = []
    scores = [0, 0]
    hand_a, hand_b = list(deck_a.keys()), list(deck_b.keys())
    session_a = random.randint(1, 10 ** 6)
    session_b = random.randint(1, 10 ** 6)
    all_samples = []
    for round_ in range(1, 6):
        if max(scores) >= 3:
            break
        bl = BUDGET_LIMITS[round_]
        my_a = [b for b in board if b['team'] == 1]
        my_b = [b for b in board if b['team'] == 2]
        en_a = [b for b in board if b['team'] == 2]
        en_b = [b for b in board if b['team'] == 1]
        sc = tuple(scores)
        sa, placed_a = collect_side_samples(engine, 'p1', my_a, en_a, deck_a, hand_a, round_, bl,
                                            session_a, name_a, sc)
        sb, placed_b = collect_side_samples(engine, 'p2', my_b, en_b, deck_b, hand_b, round_, bl,
                                            session_b, name_b, sc)
        all_samples += sa + sb
        for p in placed_a:
            if p['dbId'] in hand_a:
                hand_a.remove(p['dbId'])
        for p in placed_b:
            if p['dbId'] in hand_b:
                hand_b.remove(p['dbId'])
        full = board + placed_a + placed_b
        res = engine.simulate(full, round_=round_, seed=seed * 10 + round_)
        board = res['survivors']
        scores[0] += res['d1']
        scores[1] += res['d2']
    return all_samples


def collect(engine, decks, deck_names, games):
    samples = []
    n = len(decks)
    for g in range(games):
        di = g % n
        dj = (g + 1) % n
        samples += collect_game(engine, decks[di], decks[dj], deck_names[di], deck_names[dj], g * 1000 + 7)
        if (g + 1) % 20 == 0:
            print(f'  ... 已收集 {g + 1}/{games} 局，累计样本 {len(samples)}', flush=True)
    return samples


def train_bc(samples, device, epochs=10, lr=1e-3, batch_size=256):
    import torch
    net = DualNet().to(device)
    opt = torch.optim.Adam(net.parameters(), lr=lr)
    for ep in range(epochs):
        random.shuffle(samples)
        total_loss = 0.0
        n_batch = 0
        for i in range(0, len(samples), batch_size):
            batch = samples[i:i + batch_size]
            for _i in range(len(batch)):
                mode = random.randrange(4)
                if mode == 1:
                    batch[_i] = mirror_sample(batch[_i])
                elif mode == 2:
                    batch[_i] = flip_y_sample(batch[_i])
                elif mode == 3:
                    batch[_i] = mirror_sample(flip_y_sample(batch[_i]))
            grids = torch.from_numpy(np.stack([b[0] for b in batch])).to(device)
            gs = torch.from_numpy(np.stack([b[1] for b in batch])).to(device)
            pims = torch.from_numpy(np.stack([b[2] for b in batch])).to(device)
            pics = torch.from_numpy(np.stack([b[3] for b in batch])).to(device)
            # 关键修复：cell 头条件到真实怪兽（selected_mon=argmax 目标），
            # 避免 cell 损失经 m_emb=matmul(exp(log_pm),embed) 反向污染 monster 头。
            target_mon = torch.argmax(pims, dim=1)
            log_pm, log_pc, _ = net(grids, gs, selected_mon=target_mon)
            loss_pm = -(pims * log_pm).sum(1).mean()
            loss_pc = -(pics * log_pc).sum(1).mean()
            loss = loss_pm + loss_pc
            opt.zero_grad()
            loss.backward()
            opt.step()
            total_loss += float(loss.item())
            n_batch += 1
        print(f'[bc] epoch {ep + 1}/{epochs} loss={total_loss / max(1, n_batch):.4f}', flush=True)
    return net


def eval_net(engine, net, decks, deck_names, device):
    import torch
    eval_mcts = MCTS(net, num_sim=16, device=device, prior_lambda=0.1, engine=engine, use_real_sim=True)
    bench = run_benchmark(engine, net, eval_mcts, decks, games_per_layer=20)
    r = bench['layers']['L1_rule']
    print(f'[bc] vs L1_rule: 胜{r["wins"]} 平{r["draws"]} 负{r["losses"]} '
          f'胜率 {r["wr"] * 100:.1f}% Elo {r["elo"]:.0f}', flush=True)
    bwins = bdraws = blosses = 0
    for j, bname in enumerate(deck_names):
        d_opp = decks[j]
        for e in range(2):
            if e % 2 == 0:
                _, _, w1, _ = play_game(engine, eval_mcts, None, d_opp, d_opp,
                                        random.randint(0, 10 ** 6), temperature=0.0,
                                        temp_final=0.0, bundle_b=bname)
                bwins += w1 == 1
                bdraws += w1 == 0
                blosses += w1 == 2
            else:
                _, _, w2, _ = play_game(engine, None, eval_mcts, d_opp, d_opp,
                                        random.randint(0, 10 ** 6), temperature=0.0,
                                        temp_final=0.0, bundle_a=bname)
                bwins += w2 == 2
                bdraws += w2 == 0
                blosses += w2 == 1
    bt = bwins + bdraws + blosses
    bwr = (bwins + 0.5 * bdraws) / bt * 100 if bt else 0
    print(f'[bc] vs bundleai: {bwins}胜/{bdraws}平/{blosses}负 胜平率 {bwr:.1f}%', flush=True)


def raw_greedy_place(net, side, my, enemy, deck, hand, round_, bl, score, device):
    """BC 模型的裸 policy 贪心放置：argmax 怪兽，再在该怪兽条件下 argmax 格子（联合解码），不套 MCTS。"""
    import torch
    from .state import action_mask
    my_cur = [dict(m) for m in my]
    hand_cur = list(hand)
    budget = bl - sum(COST_BY_ID[m['dbId']] for m in my)
    placed = []
    deck_keys = list(deck.keys())
    team = 1 if side == 'p1' else 2
    while True:
        s = State(side=side, my=my_cur, enemy=enemy, hand=hand_cur, round=round_,
                  budget=budget, budget_limit=bl, deck=deck_keys, score=score, deck_badges=deck)
        if not s.legal_actions():
            break
        pm, _, _ = net.eval_state(s, device)
        mi = int(np.argmax(pm))
        db_id = idx_to_db_id(mi)
        # 条件化 cell：给定已选怪兽 mi，重算 cell 分布（联合解码）
        m_mask, c_mask = action_mask(s)
        grid, g = encode_state(s)
        gt = torch.from_numpy(grid).unsqueeze(0).to(device)
        gv = torch.from_numpy(g).unsqueeze(0).to(device)
        with torch.no_grad():
            _, log_pc_cond, _ = net(gt, gv, selected_mon=torch.tensor([mi], device=device))
        lp_c = log_pc_cond[0].cpu().numpy()
        lp_c = np.where(c_mask > 0, lp_c, -1e9)
        pc = np.exp(lp_c)
        if pc.sum() <= 0:
            pc[:] = 1.0 / CELL_COUNT
        pc = pc / pc.sum()
        ci = int(np.argmax(pc))
        x, y = cell_to_xy(side, ci)
        my_cur.append({'dbId': db_id, 'x': x, 'y': y, 'badgeIds': deck[db_id]})
        placed.append({'dbId': db_id, 'x': x, 'y': y, 'team': team, 'badgeIds': deck[db_id]})
        hand_cur.remove(db_id)
        budget -= COST_BY_ID[db_id]
    return placed


def _opp_place(engine, opp, side, my, enemy, deck, hand, round_, bl, session, formation):
    if opp == 'rule':
        return rule_random_place(deck, hand, bl, side, my)
    p, _ = bundle_place(engine, side, my, enemy, deck, hand, round_, bl,
                        session=session, formation=formation)
    return p


def play_raw_game(engine, net, deck_net, deck_opp, net_side, opp, device, seed, opp_formation=None):
    """裸 policy vs 对手（rule/bundle）一整局。返回 (wins, draws, losses)。"""
    board = []
    scores = [0, 0]
    p1_deck = deck_net if net_side == 'p1' else deck_opp
    p2_deck = deck_opp if net_side == 'p1' else deck_net
    p1_hand = list(p1_deck.keys())
    p2_hand = list(p2_deck.keys())
    session_opp = random.randint(1, 10 ** 6)
    for round_ in range(1, 6):
        if max(scores) >= 3:
            break
        bl = BUDGET_LIMITS[round_]
        my_a = [b for b in board if b['team'] == 1]
        my_b = [b for b in board if b['team'] == 2]
        en_a = [b for b in board if b['team'] == 2]
        en_b = [b for b in board if b['team'] == 1]
        sc = tuple(scores)
        if net_side == 'p1':
            plan_a = raw_greedy_place(net, 'p1', my_a, en_a, p1_deck, p1_hand, round_, bl, sc, device)
        else:
            plan_a = _opp_place(engine, opp, 'p1', my_a, en_a, p1_deck, p1_hand, round_, bl, session_opp, opp_formation)
        if net_side == 'p2':
            plan_b = raw_greedy_place(net, 'p2', my_b, en_b, p2_deck, p2_hand, round_, bl, sc, device)
        else:
            plan_b = _opp_place(engine, opp, 'p2', my_b, en_b, p2_deck, p2_hand, round_, bl, session_opp, opp_formation)
        for p in plan_a:
            if p['dbId'] in p1_hand:
                p1_hand.remove(p['dbId'])
        for p in plan_b:
            if p['dbId'] in p2_hand:
                p2_hand.remove(p['dbId'])
        full = board + plan_a + plan_b
        res = engine.simulate(full, round_=round_, seed=seed * 10 + round_)
        board = res['survivors']
        scores[0] += res['d1']
        scores[1] += res['d2']
    net_score = scores[0] if net_side == 'p1' else scores[1]
    opp_score = scores[1] if net_side == 'p1' else scores[0]
    if net_score == opp_score:
        return 0, 1, 0
    return (1, 0, 0) if net_score > opp_score else (0, 0, 1)


def eval_raw(engine, net, decks, deck_names, device, games=40):
    for opp, opp_name in (('rule', 'L1_rule'), ('bundle', 'bundleai')):
        wins = draws = losses = 0
        for g in range(games):
            di = g % len(decks)
            dj = (g + 1) % len(decks)
            net_side = 'p1' if g % 2 == 0 else 'p2'
            opp_formation = deck_names[dj] if opp == 'bundle' else None
            w, d, l = play_raw_game(engine, net, decks[di], decks[dj], net_side, opp, device,
                                    g * 1000 + 7, opp_formation=opp_formation)
            wins += w
            draws += d
            losses += l
        total = wins + draws + losses
        wr = wins / total if total else 0.0
        print(f'[bc-raw] vs {opp_name}: 胜{wins} 平{draws} 负{losses} 胜率 {wr * 100:.1f}%', flush=True)


def debug_predictions(engine, net, decks, deck_names, device, n_decks=3):
    """对比：初始局面下网络的 argmax(怪兽, 格子) vs bundleai 的真实首落。"""
    from .selfplay import bundle_place
    for di in range(min(n_decks, len(decks))):
        deck = decks[di]
        hand = list(deck.keys())
        bl = BUDGET_LIMITS[1]
        s = State(side='p1', my=[], enemy=[], hand=hand, round=1, budget=bl, budget_limit=bl,
                  deck=list(deck.keys()), score=(0, 0), deck_badges=deck)
        pm, pc, _ = net.eval_state(s, device)
        mi = int(np.argmax(pm))
        ci = int(np.argmax(pc))
        db_id = idx_to_db_id(mi)
        x, y = cell_to_xy('p1', ci)
        # bundleai 首落（取 plan 第一条）
        plan, _ = bundle_place(engine, 'p1', [], [], deck, list(hand), 1, bl, formation=deck_names[di])
        first = plan[0] if plan else None
        topm = np.argsort(pm)[::-1][:3]
        topc = np.argsort(pc)[::-1][:3]
        def mname(i):
            return f'{idx_to_db_id(i)}({pm[i]:.2f})'
        def cname(i):
            cx, cy = cell_to_xy('p1', i)
            return f'({cx},{cy})={pc[i]:.2f}'
        print(f'[dbg] {deck_names[di]}: 网络首落 怪{db_id}@{x},{y} | '
              f'怪物top={[mname(i) for i in topm]} 格子top={[cname(i) for i in topc]} | '
              f'bundleai首落={first["dbId"]}@{first["x"]},{first["y"]} (计划{len(plan)}步)', flush=True)


def check_accuracy(net, samples, device):
    import torch
    net.eval()
    correct_m = correct_c = total = 0
    r1_correct_m = r1_total = 0
    with torch.no_grad():
        for i in range(0, len(samples), 256):
            batch = samples[i:i + 256]
            grids = torch.from_numpy(np.stack([b[0] for b in batch])).to(device)
            gs = torch.from_numpy(np.stack([b[1] for b in batch])).to(device)
            pims = np.stack([b[2] for b in batch])
            pics = np.stack([b[3] for b in batch])
            t_m = np.argmax(pims, axis=1)
            t_c = np.argmax(pics, axis=1)
            target_mon = torch.from_numpy(t_m).to(device)
            log_pm, log_pc, _ = net(grids, gs, selected_mon=target_mon)
            pred_m = torch.argmax(log_pm, dim=1).cpu().numpy()
            pred_c = torch.argmax(log_pc, dim=1).cpu().numpy()
            correct_m += int((pred_m == t_m).sum())
            correct_c += int((pred_c == t_c).sum())
            total += len(batch)
            for j, b in enumerate(batch):
                g = b[1]
                if g[0] < 0.21 and g[3] == 0.0 and g[4] == 0.0:
                    r1_total += 1
                    r1_correct_m += int(pred_m[j] == t_m[j])
    print(f'[acc] 总样本 {total} | 怪兽acc={correct_m / total:.3f} 格子acc={correct_c / total:.3f}', flush=True)
    print(f'[acc] round1空场 {r1_total} | 怪兽acc={r1_correct_m / max(1, r1_total):.3f}', flush=True)


def main():
    args = sys.argv[1:]
    cmd = 'all'
    num = 0
    if args and args[0] in ('collect', 'train', 'all', 'evalraw', 'debug', 'check'):
        cmd = args[0]
        rest = args[1:]
    else:
        rest = args
    for a in rest:
        if a.isdigit():
            num = int(a)
    games = num if num else 200
    epochs = num if (cmd == 'train' and num) else 10
    eval_games = num if num else 40
    root = project_root()
    sample_path = os.path.join(root, 'reports', 'bc_samples.pkl')
    model_path = os.path.join(root, 'reports', 'bc_model.pt')

    import torch
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    print(f'[bc] 设备 {device} | 命令 {cmd}', flush=True)

    samples = None
    net = None
    if cmd in ('collect', 'all'):
        engine = EngineClient(root)
        engine.start()
        try:
            db = engine.db()
            init_meta(db)
            init_mon_meta(db)
            formations = engine.formations()['formations']
            deck_names = [f['name'] for f in formations]
            decks = [{s['monsterId']: s['badgeIds'] for s in f['team']} for f in formations]
            print(f'[bc] 卡组 {len(decks)} 套，收集 {games} 局 bundleai 自对弈样本...', flush=True)
            samples = collect(engine, decks, deck_names, games)
            with open(sample_path, 'wb') as f:
                pickle.dump(samples, f)
            print(f'[bc] 已保存 {len(samples)} 条样本 → {sample_path}', flush=True)
        finally:
            engine.close()

    if cmd in ('train', 'all'):
        if samples is None:
            with open(sample_path, 'rb') as f:
                samples = pickle.load(f)
            print(f'[bc] 载入 {len(samples)} 条样本', flush=True)
        net = train_bc(samples, device, epochs=epochs)
        torch.save(net.state_dict(), model_path)
        print(f'[bc] 模型已保存 → {model_path}', flush=True)

    if cmd in ('all', 'evalraw', 'debug', 'check'):
        if net is None:
            net = DualNet().to(device)
            net.load_state_dict(torch.load(model_path, map_location=device))
            print(f'[bc] 载入模型 {model_path}', flush=True)
        if cmd == 'check':
            with open(sample_path, 'rb') as f:
                samples = pickle.load(f)
            check_accuracy(net, samples, device)
            return
        engine = EngineClient(root)
        engine.start()
        try:
            db = engine.db()
            init_meta(db)
            init_mon_meta(db)
            formations = engine.formations()['formations']
            deck_names = [f['name'] for f in formations]
            decks = [{s['monsterId']: s['badgeIds'] for s in f['team']} for f in formations]
            if cmd == 'evalraw':
                eval_raw(engine, net, decks, deck_names, device, games=eval_games)
            elif cmd == 'debug':
                debug_predictions(engine, net, decks, deck_names, device)
            else:
                eval_net(engine, net, decks, deck_names, device)
        finally:
            engine.close()


if __name__ == '__main__':
    main()
