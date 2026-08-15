# -*- coding: utf-8 -*-
"""
AlphaZero 式 self-play 训练主循环（30 分钟定长）：
  1. self-play：随机配对卡组，双方 MCTS（网络引导）放置，TS 引擎跑真实回合战斗
  2. 训练：MCTS 访问分布 π 作策略目标（CE），对局结果 z 作价值目标（MSE）
  3. 评估：每 N 轮 vs 随机合法策略看胜率
  4. 定时截止，保存模型 state_dict 到 reports/rl_model.pt

运行：python -m src.engine.train.py.train 30
"""
import os
import random
import sys
import time
import copy

# Windows 控制台用系统代码页（如 GBK）解码 stdout；强制 utf-8 反而会与终端编码不一致导致乱码。
# 这里只把 errors 改成 replace 防止生僻字符导致打印崩溃，编码保持系统默认。
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(errors='replace')
    sys.stderr.reconfigure(errors='replace')

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

from .bridge_client import EngineClient
from .state import init_meta, MONSTER_COUNT, CELL_COUNT, mirror_sample, flip_y_sample
from .heuristic import init_mon_meta, load_endgame_lib, init_formations
from .net import DualNet, migrate_state_dict
from .mcts import MCTS
from .selfplay import play_game, play_vs_random, play_vs_fn, rule_random_place, random_place, free_deck
from .bench_ladder import run_benchmark
from .exp_lib import ExperienceLib


def project_root() -> str:
    p = os.path.dirname(os.path.abspath(__file__))
    for _ in range(4):
        p = os.path.dirname(p)
    return p


def _timestamp_stem() -> str:
    """时间戳命名 stem：如 813.15.1（月日.时.分），模型与 inspect 报告成对命名。"""
    lt = time.localtime()
    return f'{lt.tm_mon}{lt.tm_mday}.{lt.tm_hour}.{lt.tm_min}'


def main(duration_min: float = 30.0, games_per_iter: int = 12, train_steps: int = 64,
         batch_size: int = 128, num_sim: int = 16, buffer_cap: int = 20000,
         out_dir: str = 'reports', eval_every: int = 10, eval_games: int = 20,
         bench_games: int = 40,
         focused: bool = False, probe_games: int = 20,
         dirichlet_eps: float = 0.2, focus_idx: int = None,
         model_out: str = None, exp_lib_path: str = None,
         base_model: str = None, tag: str = '', ckpt_interval: float = 300.0,
         temp_rounds: int = 1,
         kl_weight: float = 0.05, prior_lambda_floor: float = 0.15,
         force_tree_rounds: tuple = (1, 2),
         burst_every: int = 30, burst_len: int = 5,
         self_ratio_by_round: dict = None):
    # 回合级"基于自身 vs 基于对方"比重（可训练指标）：前 2-3 回合以自身卡组设计为主，
    # 后 2 回合以对方卡组针对性调整为主（人类经验）；--self-ratio 可覆盖为可学习初值。
    if self_ratio_by_round is None:
        self_ratio_by_round = {1: 0.8, 2: 0.7, 3: 0.6, 4: 0.4, 5: 0.3}
    root = project_root()
    engine = EngineClient(root)
    engine.start()
    try:
        db = engine.db()
        init_meta(db)
        init_mon_meta(db)
        # 残局库 = 统一经验库的 endgame 层（ExperienceLib 内部迁移），此处加载是给
        # heuristic_prior 先验加权用（MCTS 冷启动引导，覆盖无 exp_lib 的评估路径）
        load_endgame_lib(os.path.join(root, 'reports', 'endgame_lib.json'))
        formations = engine.formations()['formations']
        # 卡组树先验：加载 bundle 阵型树（先学自身布阵策略），heuristic_prior 强加权树计划动作
        init_formations(formations)
        deck_names = [f['name'] for f in formations]
        decks = [{s['monsterId']: s['badgeIds'] for s in f['team']} for f in formations]
        print(f'[train] 卡组池 {len(decks)} 套: {[f["name"] for f in formations]}', flush=True)

        device = 'cuda' if torch.cuda.is_available() else 'cpu'
        net = DualNet().to(device)
        # 输出模型按时间命名（如 813.15.1.pt），保留各次实验版本；可用 --model-out 覆盖。
        # --tag 用于双进程/多实验并行：给模型/经验库/checkpoint/benchmark 加后缀，避免互相覆盖。
        _tag = f'_{tag}' if tag else ''
        model_out = model_out or f'{_timestamp_stem()}{_tag}.pt'
        exp_lib_path = exp_lib_path or f'exp_lib{_tag}.json'
        loaded_from_history = False
        # 续训 base：--base 可指定从某次实验版本继续（如 813.15.33.pt），默认 rl_model.pt（历史最优/稳定起点）；
        # 输出另存为时间戳版本，互不覆盖。
        base_model = base_model or 'rl_model.pt'
        base_path = os.path.join(root, out_dir, base_model)
        if os.path.exists(base_path):
            try:
                state_dict = torch.load(base_path, map_location=device)
                net.load_state_dict(migrate_state_dict(state_dict))
                loaded_from_history = True
                print(f'[train] 从历史 base 继续训练（维度自动迁移）：{base_path}', flush=True)
            except Exception as e:
                print(f'[train] base 模型加载失败，从零开始：{e}', flush=True)
        else:
            print('[train] 无历史 base，从零开始', flush=True)
        print(f'[train] device={device} 参数={sum(p.numel() for p in net.parameters())}', flush=True)
        # 在线经验库 v2（三层单库，负反馈模式）：加载历史累积 + 残局库迁移为 endgame 层（只读）；
        # avoid（默认）：只回传对 bundle 输局的决策点负分（"避免犯过的错"），
        # 查询/先验注入时压低负分候选。visits_min 按训练 num_sim 修复（原 20 > num_sim=16 死锁，
        # 导致 expert 层训练中永远不累积——inspect 报告"在线经验库 0 条"即此 bug）。
        exp_lib = ExperienceLib(path=os.path.join(root, out_dir, exp_lib_path),
                                endgame_path=os.path.join(root, 'reports', 'endgame_lib.json'),
                                mode='avoid',
                                visits_min=max(8, num_sim // 2))
        n_ent = sum(len(c) for c in exp_lib.lib.values())
        n_eg = len(exp_lib.endgame)
        print(f'[train] 经验库 v2 统一单库：endgame残局层={n_eg}条 专家在线层={n_ent}条（replay层=训练buffer）', flush=True)
        # 训练 MCTS：开启根节点 Dirichlet 噪声（探索）+ prior_lambda 随进度衰减 + 经验库强先验
        # 纯 policy + real_sim（价值头冻结）：叶价值用真实回合战斗模拟（use_real_sim）
        mcts = MCTS(net, num_sim=num_sim, device=device, dirichlet_alpha=0.03,
                    dirichlet_eps=dirichlet_eps, exp_lib=exp_lib, engine=engine, use_real_sim=True,
                    self_ratio_by_round=self_ratio_by_round)
        # 评估 MCTS：开启真实战斗模拟绕开未收敛的 value head，保证评估与训练 MCTS 高度一致！
        best_net = copy.deepcopy(net)
        eval_mcts = MCTS(net, num_sim=num_sim, device=device, prior_lambda=0.1,
                         engine=engine, use_real_sim=True)
        best_mcts = MCTS(best_net, num_sim=num_sim, device=device, prior_lambda=0.1,
                         engine=engine, use_real_sim=True)

        # ---- 聚焦模式：focus_idx 直接指定卡组（连续训练用）；否则探针选最强（单次训练用）----
        focused_deck = None
        focused_name = None
        if focus_idx is not None:
            focused_deck, focused_name = decks[focus_idx], deck_names[focus_idx]
            print(f'[train] 聚焦卡组：{focused_name}（指定索引 {focus_idx}），'
                  f'全程用该卡组对阵全体 bundleai/规则随机/自对弈（8:1:1）', flush=True)
        elif focused:
            print('[probe] 评估 7 套卡组 vs 规则随机（各 20 局）…', flush=True)
            wr_list = []
            for i, d in enumerate(decks):
                w = dd = ll = 0
                for _e in range(probe_games):
                    w_, dd_, ll_, _s = play_vs_random(engine, net, eval_mcts, d, random.choice(decks),
                                                      random.randint(0, 10 ** 6), 'p1', opponent='rule')
                    w += w_
                    dd += dd_
                    ll += ll_
                wr = w / max(1, w + dd + ll) * 100
                wr_list.append(wr)
                print(f'[probe] {deck_names[i]}: vs规则随机 {wr:.0f}%', flush=True)
            best_i = max(range(len(decks)), key=lambda i: wr_list[i])
            focused_deck, focused_name = decks[best_i], deck_names[best_i]
            print(f'[train] 聚焦卡组：{focused_name}（vs随机 {wr_list[best_i]:.0f}%），'
                  f'全程只打该卡组自对弈', flush=True)
        # 整体对战范式（用户决策）：评判 = vs 全部 bundleai + vs 规则随机，不用同阵型自对弈 Arena。
        # 不维护 Arena 冠军/对手池，best 由 checkpoint 综合胜率（vs bundleai+随机）决定。
        opt = torch.optim.Adam(net.parameters(), lr=1e-4)

        # ---- 卡组树强制计划（先学自身布阵策略）：R1-R2 按 bundle 树计划执行 ----
        # 树坐标为 AI 侧（p2）视角；p1 侧镜像 x'=10-x。force_tree[i] = {round: [{monsterId,x,y}]}
        from .heuristic import tree_plan_for
        force_tree: list = [None] * len(decks)
        for i, d in enumerate(decks):
            plans = {}
            for r in range(1, 6):
                if r not in force_tree_rounds:
                    continue
                tp = tree_plan_for(list(d.keys()), r)
                if not tp:
                    continue
                p2_plan = [{'monsterId': p['monsterId'], 'x': p['x'], 'y': p['y']} for p in tp]
                p1_plan = [{'monsterId': p['monsterId'], 'x': 10 - p['x'], 'y': p['y']} for p in tp]
                plans[r] = {'p1': p1_plan, 'p2': p2_plan}
            force_tree[i] = plans or None
        print(f'[train] 卡组树强制计划 R{list(force_tree_rounds)}：肃清 R1 = '
              f'{tree_plan_for(list(decks[5].keys()), 1)}（p2 视角）', flush=True)

        # 模仿学习参考策略网络（用于计算 KL 散度约束，限制 RL 不离套路）
        bc_net = None
        bc_model_path = os.path.join(root, out_dir, 'bc_warmstart_model.pt')
        if os.path.exists(bc_model_path):
            bc_net = DualNet().to(device)
            try:
                bc_net.load_state_dict(migrate_state_dict(torch.load(bc_model_path, map_location=device)))
                bc_net.eval()
                print(f'[train] 成功载入 BC 模仿学习参考策略模型: {bc_model_path} (开启 KL 散度偏离约束)', flush=True)
            except Exception as e:
                print(f'[train] 加载 BC 参考模型失败: {e}', flush=True)
                bc_net = None

        buffer: list = []
        deadline = time.time() + duration_min * 60
        t_start = time.time()
        total_sec = max(1.0, duration_min * 60)
        it = 0
        total_games = 0
        total_samples = 0
        # KL 衰减调度：训练后期逐步放开 BC 约束（0.05 → 0.01），让 RL 有机会超越 bundle 教师。
        # 前期锚定（防止开局漂移），后期放开（发现优于 bundle 的摆法）。
        kl_start = kl_weight
        kl_final = min(kl_weight, 0.01)
        # checkpoint 状态：每 ckpt_interval 秒保存快照 + vs 规则随机评估，胜率低于历史最优 → 回滚
        ckpt_dir = os.path.join(root, out_dir, f'checkpoints{_tag}')
        os.makedirs(ckpt_dir, exist_ok=True)
        last_ckpt_t = time.time()
        best_ckpt_wr = -1.0
        best_ckpt_path = None
        while time.time() < deadline:
            # ---- 探索突发（打破局部最优）：每 burst_every iter 的 burst_len 个 iter 内，
            #      提高 Dirichlet 噪声 + 采样温度 + 压低启发式 λ，强制覆盖罕见分支，
            #      防止模型锁死在"镜像 bundle"的局部最优（L1 卡 60-75% 的怀疑根因之一）。
            in_burst = burst_len > 0 and (it // burst_every) % 2 == 1
            burst_eps = 0.6 if in_burst else dirichlet_eps
            burst_temp = 1.5 if in_burst else 1.0
            mcts.dirichlet_eps = burst_eps
            # ---- prior_lambda 衰减：开局高先验热启动 (Tree Warm-Start)，保证第 1 个 Iter 胜率直接处在高起点 ----
            # 从 0.85 高起点稳健过渡到 prior_lambda_floor（默认 0.15），彻底消除前 20 分钟交学费慢速起步的痛点
            lambda_start = 0.85 if not loaded_from_history else 0.50
            progress = min(1.0, (time.time() - t_start) / total_sec)
            base_lambda = max(prior_lambda_floor, lambda_start - (lambda_start - prior_lambda_floor) * progress)
            mcts.prior_lambda = min(base_lambda, 0.08) if in_burst else base_lambda

            # ---- 对局生成（先学自身布阵策略）：同卡组 bundle 镜像 40% / 异卡组 bundle 40% /
            #      规则随机 10% / 自对弈 10% ----
            # 网络侧 R1-R2 强制按自己卡组的树计划执行（force_tree），先学会"自己该怎么摆"，
            # 再在与 bundle 对局中验证/反制；同卡组镜像局让模型直接对照自己卡组的标准打法。
            for _g in range(games_per_iter):
                r = random.random()
                if focused_deck is not None:
                    d_net = focused_deck
                    d_net_idx = focus_idx
                else:
                    d_net_idx = random.randrange(len(decks))
                    d_net = decks[d_net_idx]
                game_seed = random.randint(0, 10 ** 6)
                # force_tree 按侧拆分：ft_p1/ft_p2 = {round: 该侧视角计划}（None 回合不强制）
                ft_p1 = ft_p2 = None
                if force_tree[d_net_idx]:
                    ft_p1, ft_p2 = {}, {}
                    for round_ in range(1, 6):
                        rp = force_tree[d_net_idx].get(round_)
                        ft_p1[round_] = rp['p1'] if rp else None
                        ft_p2[round_] = rp['p2'] if rp else None
                if r < 0.3:
                    # 同卡组 bundle 镜像：网络侧学自己卡组的标准摆法（先学自身布阵）。
                    # sample_w=2.5：开局树监督样本权重高，防止被自由对局稀释回错误开局。
                    bname = deck_names[d_net_idx]
                    if _g % 2 == 0:
                        sa, sb, _winner, _sc = play_game(engine, mcts, None, d_net, d_net, game_seed,
                                                         temperature=burst_temp, exp_lib=exp_lib, temp_rounds=temp_rounds,
                                                         bundle_b=bname, sample_w=2.5, exp_source='bundle',
                                                         force_tree_a=ft_p1)
                        buffer.extend(sa)
                    else:
                        sb, sa, _winner, _sc = play_game(engine, None, mcts, d_net, d_net, game_seed,
                                                         temperature=burst_temp, exp_lib=exp_lib, temp_rounds=temp_rounds,
                                                         bundle_a=bname, sample_w=2.5, exp_source='bundle',
                                                         force_tree_b=ft_p2)
                        buffer.extend(sb)
                    n_samp = len(sa) + len(sb)
                elif r < 0.5:
                    # 自由卡组规则随机对手（整体对阵胜率口径）：从 7 套已知阵型随机选一套
                    # （带真实徽章），让模型学会应对不同卡组，而非只会打固定配对的卡组。
                    opp_deck = free_deck(seed=game_seed)
                    samples, _winner, _sc = play_vs_fn(engine, mcts, d_net, opp_deck, game_seed,
                                                       rule_random_place,
                                                       mcts_side='p1' if _g % 2 == 0 else 'p2',
                                                       temperature=burst_temp, temp_rounds=temp_rounds,
                                                       path_a=[], chain_a=random.randint(1, 10 ** 9),
                                                       exp_lib=exp_lib, exp_source='pool', sample_w=0.5,
                                                       force_tree=ft_p1 if _g % 2 == 0 else ft_p2)
                    buffer.extend(samples)
                    n_samp = len(samples)
                elif r < 0.7:
                    # 异卡组 bundleai：对手阵型随机选（学反制/对位）
                    idx_opp = random.randrange(len(decks))
                    bname = deck_names[idx_opp]
                    if _g % 2 == 0:
                        sa, sb, _winner, _sc = play_game(engine, mcts, None, d_net, decks[idx_opp], game_seed,
                                                         temperature=burst_temp, exp_lib=exp_lib, temp_rounds=temp_rounds,
                                                         bundle_b=bname, sample_w=1.5, exp_source='bundle',
                                                         force_tree_a=ft_p1)
                        buffer.extend(sa)
                    else:
                        sb, sa, _winner, _sc = play_game(engine, None, mcts, decks[idx_opp], d_net, game_seed,
                                                         temperature=burst_temp, exp_lib=exp_lib, temp_rounds=temp_rounds,
                                                         bundle_a=bname, sample_w=1.5, exp_source='bundle',
                                                         force_tree_b=ft_p2)
                        buffer.extend(sb)
                    n_samp = len(sa) + len(sb)
                elif r < 0.9:
                    # 同卡池规则随机对手（L1_rule 口径）
                    idx_opp = random.randrange(len(decks))
                    opp_fn = rule_random_place if random.random() < 0.5 else random_place
                    samples, _winner, _sc = play_vs_fn(engine, mcts, d_net, decks[idx_opp], game_seed, opp_fn,
                                                       mcts_side='p1' if _g % 2 == 0 else 'p2', temperature=burst_temp,
                                                       temp_rounds=temp_rounds,
                                                       path_a=[], chain_a=random.randint(1, 10 ** 9),
                                                       exp_lib=exp_lib, exp_source='pool', sample_w=0.5,
                                                       force_tree=ft_p1 if _g % 2 == 0 else ft_p2)
                    buffer.extend(samples)
                    n_samp = len(samples)
                else:
                    # 自对弈（当前网络镜像，同卡组）：双方都按自己卡组树强制开局
                    sa, sb, _winner, _sc = play_game(engine, mcts, mcts, d_net, d_net, game_seed,
                                                     temperature=burst_temp, exp_lib=exp_lib, temp_rounds=temp_rounds,
                                                     sample_w=1.2, exp_source='best',
                                                     force_tree_a=ft_p1, force_tree_b=ft_p2)
                    buffer.extend(sa)
                    buffer.extend(sb)
                    n_samp = len(sa) + len(sb)
                total_games += 1
                total_samples += n_samp
                if len(buffer) > buffer_cap:
                    buffer = buffer[-buffer_cap:]

            # ---- 训练 ----
            train_loss = train_lpm = train_lpc = 0.0
            n_batch = 0
            for _t in range(train_steps):
                if len(buffer) < batch_size:
                    break
                batch = random.sample(buffer, batch_size)
                # 空间对称数据增强（4 种几何变体：原图、左右镜像、上下翻转、对角对称）
                # 彻底解决死坐标记忆，赋予神经网络强悍的 Y 轴平移/翻转空间泛化能力
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
                # 受控混合：best 对局样本权重高、多样性对局低（样本第 6 维为权重）
                ws = torch.tensor([b[5] for b in batch], dtype=torch.float32).to(device)
                log_pm, log_pc, _v = net(grids, gs)
                loss_pm = -(pims * log_pm).sum(1)
                loss_pc = -(pics * log_pc).sum(1)
                # 价值头冻结：价值标签（z）是噪声，会污染共享 conv trunk，不参与训练。
                # 策略偏离约束 (KL-Divergence Penalty)：限制网络输出不离开 BC 参考先验
                if bc_net is not None:
                    with torch.no_grad():
                        bc_log_pm, bc_log_pc, _ = bc_net(grids, gs)
                        bc_pm = torch.exp(bc_log_pm)
                        bc_pc = torch.exp(bc_log_pc)
                    loss_kl_m = F.kl_div(log_pm, bc_pm, reduction='none').sum(1)
                    loss_kl_c = F.kl_div(log_pc, bc_pc, reduction='none').sum(1)
                    loss_kl = loss_kl_m + loss_kl_c
                else:
                    loss_kl = 0.0
                # 纯 policy：KL 权重随进度衰减（kl_start → kl_final），后期放开 BC 约束
                kl_w_cur = kl_start + (kl_final - kl_start) * progress
                loss = ((loss_pm + loss_pc + kl_w_cur * loss_kl) * ws).mean()
                opt.zero_grad()
                loss.backward()
                opt.step()
                train_loss += float(loss.item())
                train_lpm += float(loss_pm.mean().item())
                train_lpc += float(loss_pc.mean().item())
                n_batch += 1
            it += 1

            # ---- 评估：vs 全部 bundleai（核心指标）+ vs 规则随机（基准阶梯）----
            if it % eval_every == 0:
                # 经验库在线清洗（同 canonical 保留 top-K，防污染）
                _n_rem = exp_lib.clean(top_k=3)
                # 1) 核心指标：网络侧 vs 全部 7 套 bundleai（贪心，e%2 轮换先手抵消先手偏差；
                #    胜平率 = 胜×1 + 平×0.5，防守阵型平局多不能只看胜率）
                #    网络侧卡组 = 聚焦卡组（每卡组独立训练）或逐套轮换（非聚焦）
                bwins = bdraws = blosses = 0
                for j, bname in enumerate(deck_names):
                    d_opp = decks[j]
                    d_net = focused_deck if focused_deck is not None else d_opp
                    for e in range(eval_games):
                        if e % 2 == 0:
                            _, _, w1, _ = play_game(engine, eval_mcts, None, d_net, d_opp, random.randint(0, 10 ** 6),
                                                    temperature=0.0, temp_final=0.0, bundle_b=bname)
                            bwins += w1 == 1
                            bdraws += w1 == 0
                            blosses += w1 == 2
                        else:
                            _, _, w2, _ = play_game(engine, None, eval_mcts, d_opp, d_net, random.randint(0, 10 ** 6),
                                                    temperature=0.0, temp_final=0.0, bundle_a=bname)
                            bwins += w2 == 2
                            bdraws += w2 == 0
                            blosses += w2 == 1
                bt = bwins + bdraws + blosses
                # 遵从用户指示：胜利和平局直接相加 (wins + draws)，平局升高代表生存不败率升高
                bundle_wr = (bwins + bdraws) / bt * 100 if bt else 0

                # 2) 恒定基准阶梯（vs 规则随机 L1 + vs bundleai L2，聚合 Elo，跨版本可比）。
                #    聚焦模式：网络侧固定用聚焦卡组（模型只学过它）；非聚焦保持卡组轮换
                bench = run_benchmark(engine, net, eval_mcts, decks, deck_names=deck_names,
                                      games_per_layer=bench_games,
                                      out_path=os.path.join(out_dir, f'benchmark_ladder{_tag}.jsonl'), step=it,
                                      focused_deck=focused_deck)
                rand_wr = bench['layers']['L1_rule']['wr'] * 100
                bundle_bench_wr = bench['layers']['L2_bundle']['wr'] * 100

                # 3) checkpoint（每个 iter 实时检查最优）：一旦聚合 Elo（含 L2_bundle 层）创下新高，
                #    立刻 Save 为最新最优权重！聚合 Elo = 20 局/层 × 2 层，比 35 局小样本稳定。
                ck_score = bench['elo']
                ckpt_path = os.path.join(ckpt_dir, f'ckpt_it{it}.pt')
                if ck_score > best_ckpt_wr:
                    best_ckpt_wr = ck_score
                    best_ckpt_path = ckpt_path
                    best_net.load_state_dict(net.state_dict())
                    torch.save(net.state_dict(), ckpt_path)
                    print(f'[ckpt] iter {it} 聚合Elo {ck_score:.0f} (vs bundle {bundle_bench_wr:.0f}% / vs L1 {rand_wr:.0f}%) → 新高，存 {ckpt_path}', flush=True)
                    # 每当出现新高最优模型时，自动导出目标阵型对阵另外 6 套阵型的布阵摆放图与对阵数据表格！
                    try:
                        from .inspect_games import main as inspect_main
                        m_name = focused_name or 'model'
                        insp_file = os.path.join(out_dir, f'inspect_{m_name}.md')
                        inspect_main(model_path=ckpt_path, sp_games=2, vr_games=2,
                                     out_path=insp_file, quiet=True, focus_idx=focus_idx,
                                     exp_lib_path=os.path.join(out_dir, exp_lib_path))
                        print(f'[ckpt] iter {it} 已更新布阵摆放图 → {insp_file}', flush=True)
                    except Exception as _e:
                        pass
                else:
                    print(f'[ckpt] iter {it} 聚合Elo {ck_score:.0f} (历史最高 {best_ckpt_wr:.0f}) | 保持主网梯度探索', flush=True)
                remain = max(0, deadline - time.time()) / 60
                print(f'[iter {it}] 局={total_games} 样本={total_samples} loss={train_loss / max(1, n_batch):.3f} '
                      f'(πm={train_lpm / max(1, n_batch):.3f} πc={train_lpc / max(1, n_batch):.3f}) '
                      f'vs bundleai 胜平率={bundle_wr:.1f}%({bwins}/{bdraws}/{blosses}) | '
                      f'阶梯 L1={rand_wr:.0f}% L2_bundle={bundle_bench_wr:.0f}% | '
                      f'Elo={bench["elo"]:.0f} 剩余{remain:.1f}min', flush=True)

        # ---- 保存：最终模型 = 历史最优 checkpoint（vs bundleai + vs 随机 综合评判）→ model_out ----
        # 训练中 checkpoint 已按综合胜率自动回滚到最优；结束时再确认一次加载最优权重
        os.makedirs(out_dir, exist_ok=True)
        out_path = model_out if os.path.isabs(model_out) or model_out.startswith(out_dir) else os.path.join(out_dir, model_out)
        exp_path = exp_lib_path if os.path.isabs(exp_lib_path) or exp_lib_path.startswith(out_dir) else os.path.join(out_dir, exp_lib_path)
        if best_ckpt_path and os.path.exists(best_ckpt_path) and best_ckpt_wr > 0:
            net.load_state_dict(torch.load(best_ckpt_path, map_location=device))
            print(f'[train] 最终采用历史最优 checkpoint（综合 {best_ckpt_wr:.1f}）', flush=True)
        torch.save(net.state_dict(), out_path)
        torch.save(net.state_dict(), os.path.splitext(out_path)[0] + '_last.pt')
        # 经验库跨会话累积保存
        exp_lib.save(exp_path)
        n_ent = sum(len(c) for c in exp_lib.lib.values())
        print(f'[train] 完成：{total_games} 局 / {total_samples} 样本 → best {out_path} ({os.path.getsize(out_path) / 1024:.0f}KB) | 经验库 {n_ent}条')
    finally:
        engine.close()
    # 训练结束自动产出对局供人工检查（聚焦：焦点卡组 vs 其余 6 套 + vs 规则随机，静默写文件）
    # 放在训练引擎关闭后执行（另起引擎，避免端口冲突）
    try:
        from .inspect_games import main as inspect_main
        # inspect 文件名按模型类型命名（focused 卡组名 或 games），正文头部会写明具体是哪个模型
        if focused_name:
            insp_out = os.path.join(out_dir, f'inspect_{focused_name}.md')
        else:
            insp_out = os.path.join(out_dir, 'inspect_games.md')
        inspect_path = inspect_main(model_path=os.path.join(out_dir, model_out), sp_games=2, vr_games=2,
                                    out_path=insp_out, quiet=True, focus_idx=focus_idx,
                                    exp_lib_path=os.path.join(out_dir, exp_lib_path))
        print(f'[train] 对局检查报告 → {inspect_path}', flush=True)
    except Exception as e:
        print(f'[train] 对局检查生成失败（可手动运行 inspect_games）：{e}', flush=True)


if __name__ == '__main__':
    duration = float(sys.argv[1]) if len(sys.argv) > 1 else 30.0
    focused = '--focused' in sys.argv
    focus_idx = None
    model_out = None
    exp_lib_path = None
    base_model = None
    tag = ''
    num_sim = 16
    dirichlet_eps = 0.2
    temp_rounds = 1
    kl_weight = 0.05
    prior_lambda_floor = 0.15
    if '--focus' in sys.argv:
        focus_idx = int(sys.argv[sys.argv.index('--focus') + 1])
    if '--model-out' in sys.argv:
        model_out = sys.argv[sys.argv.index('--model-out') + 1]
    if '--exp-lib' in sys.argv:
        exp_lib_path = sys.argv[sys.argv.index('--exp-lib') + 1]
    if '--base' in sys.argv:
        base_model = sys.argv[sys.argv.index('--base') + 1]
    if '--tag' in sys.argv:
        tag = sys.argv[sys.argv.index('--tag') + 1]
    if '--num-sim' in sys.argv:
        num_sim = int(sys.argv[sys.argv.index('--num-sim') + 1])
    if '--dirichlet-eps' in sys.argv:
        dirichlet_eps = float(sys.argv[sys.argv.index('--dirichlet-eps') + 1])
    if '--temp-rounds' in sys.argv:
        temp_rounds = int(sys.argv[sys.argv.index('--temp-rounds') + 1])
    if '--kl-weight' in sys.argv:
        kl_weight = float(sys.argv[sys.argv.index('--kl-weight') + 1])
    if '--prior-lambda-floor' in sys.argv:
        prior_lambda_floor = float(sys.argv[sys.argv.index('--prior-lambda-floor') + 1])
    self_ratio_by_round = None
    if '--self-ratio' in sys.argv:
        vals = [float(x) for x in sys.argv[sys.argv.index('--self-ratio') + 1].split(',')]
        self_ratio_by_round = {i + 1: vals[i] for i in range(min(5, len(vals)))}
    main(duration_min=duration, focused=focused, focus_idx=focus_idx,
         model_out=model_out, exp_lib_path=exp_lib_path, base_model=base_model, tag=tag,
         num_sim=num_sim, dirichlet_eps=dirichlet_eps, temp_rounds=temp_rounds,
         kl_weight=kl_weight, prior_lambda_floor=prior_lambda_floor,
         self_ratio_by_round=self_ratio_by_round)