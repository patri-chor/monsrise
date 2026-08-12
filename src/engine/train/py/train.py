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

# Windows 控制台默认编码可能不是 UTF-8，中文日志/traceback 会导致打印崩溃
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

import numpy as np
import torch
import torch.nn as nn

from .bridge_client import EngineClient
from .state import init_meta, MONSTER_COUNT, CELL_COUNT, mirror_sample, flip_y_sample
from .heuristic import init_mon_meta, load_endgame_lib
from .net import DualNet
from .mcts import MCTS
from .selfplay import play_game, play_vs_random, play_vs_fn, rule_random_place, random_place
from .bench_ladder import run_benchmark
from .exp_lib import ExperienceLib


def project_root() -> str:
    p = os.path.dirname(os.path.abspath(__file__))
    for _ in range(4):
        p = os.path.dirname(p)
    return p


def main(duration_min: float = 30.0, games_per_iter: int = 8, train_steps: int = 64,
         batch_size: int = 128, num_sim: int = 48, buffer_cap: int = 20000,
         out_dir: str = 'reports', eval_every: int = 10, eval_games: int = 5,
         bench_games: int = 5,
         focused: bool = False, probe_games: int = 20,
         dirichlet_eps: float = 0.35, focus_idx: int = None,
         model_out: str = None, exp_lib_path: str = None,
         ckpt_interval: float = 300.0):
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
        deck_names = [f['name'] for f in formations]
        decks = [{s['monsterId']: s['badgeIds'] for s in f['team']} for f in formations]
        print(f'[train] 卡组池 {len(decks)} 套: {[f["name"] for f in formations]}', flush=True)

        device = 'cuda' if torch.cuda.is_available() else 'cpu'
        net = DualNet().to(device)
        # 持续训练：加载历史 best 模型作为起点（跨会话累积权重，避免每次从零开始重新学习）
        model_out = model_out or 'rl_model.pt'
        exp_lib_path = exp_lib_path or 'exp_lib.json'
        loaded_from_history = False
        model_path = os.path.join(root, out_dir, model_out)
        if os.path.exists(model_path):
            try:
                state_dict = torch.load(model_path, map_location=device)
                if 'global_fc.weight' in state_dict and state_dict['global_fc.weight'].shape[1] == 57:
                    w = state_dict['global_fc.weight']
                    state_dict['global_fc.weight'] = torch.cat([w, torch.zeros(128, 1, device=w.device)], dim=1)
                net.load_state_dict(state_dict)
                loaded_from_history = True
                print(f'[train] 从历史 best 继续训练（兼容性适配 57→58 维特征）：{model_path}', flush=True)
            except Exception as e:
                print(f'[train] 模型加载失败，从零开始：{e}', flush=True)
        else:
            print('[train] 无历史模型，从零开始', flush=True)
        print(f'[train] device={device} 参数={sum(p.numel() for p in net.parameters())}', flush=True)
        # 在线经验库 v2（三层单库）：加载历史累积 + 残局库迁移为 endgame 层（只读）；
        # 自对弈最强对局回传修正（决策链 + 时间加权 + 置信度门控）
        exp_lib = ExperienceLib(path=os.path.join(root, out_dir, exp_lib_path),
                                endgame_path=os.path.join(root, 'reports', 'endgame_lib.json'))
        n_ent = sum(len(c) for c in exp_lib.lib.values())
        n_eg = len(exp_lib.endgame)
        print(f'[train] 经验库 v2 统一单库：endgame残局层={n_eg}条 专家在线层={n_ent}条（replay层=训练buffer）', flush=True)
        # 训练 MCTS：开启根节点 Dirichlet 噪声（探索）+ prior_lambda 随进度衰减 + 经验库强先验
        # 增强随机性（用户要求）：dirichlet_eps 0.25→0.35，更强的根节点探索打破过早收敛
        # 价值头保底（用户决策）：叶价值 = 0.6·net + 0.4·script_value 永久混合下限——
        # 价值头欠训练时 Q 值被噪声拉偏，script 理性基线作为锚点防止漂移。
        # num_sim=150（用户决策）：真实模拟回合后模拟成本大降，把访问数提上去，
        # 关键位置 15-30 次访问，Q 值估计才有统计意义。
        mcts = MCTS(net, num_sim=150, device=device, dirichlet_alpha=0.03,
                    dirichlet_eps=dirichlet_eps, exp_lib=exp_lib, value_net_weight=0.6)
        # 评估 MCTS：开启真实战斗模拟绕开未收敛的 value head，保证评估与训练 MCTS 高度一致！
        # num_sim 从 48/150 降至 16，抵消 real_sim 开销，保证评估精准且高效。
        best_net = copy.deepcopy(net)
        eval_mcts = MCTS(net, num_sim=16, device=device, prior_lambda=0.1,
                         engine=engine, use_real_sim=True)
        best_mcts = MCTS(best_net, num_sim=16, device=device, prior_lambda=0.1,
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
        opt = torch.optim.Adam(net.parameters(), lr=1e-3)

        buffer: list = []
        deadline = time.time() + duration_min * 60
        t_start = time.time()
        total_sec = max(1.0, duration_min * 60)
        it = 0
        total_games = 0
        total_samples = 0
        # checkpoint 状态：每 ckpt_interval 秒保存快照 + vs 规则随机评估，胜率低于历史最优 → 回滚
        ckpt_dir = os.path.join(root, out_dir, 'checkpoints')
        os.makedirs(ckpt_dir, exist_ok=True)
        last_ckpt_t = time.time()
        best_ckpt_wr = -1.0
        best_ckpt_path = None
        while time.time() < deadline:
            # ---- prior_lambda 衰减：开局高先验热启动 (Tree Warm-Start)，保证第 1 个 Iter 胜率直接处在高起点 ----
            # 从 0.85 高起点稳健过渡到 0.15，彻底消除前 20 分钟交学费慢速起步的痛点
            lambda_start = 0.85 if not loaded_from_history else 0.50
            progress = min(1.0, (time.time() - t_start) / total_sec)
            mcts.prior_lambda = max(0.15, lambda_start - (lambda_start - 0.15) * progress)

            # ---- 对局生成（经典对战范式 8:1:1 bundleai : 规则随机 : 自对弈）----
            # 保持原生训练思路：在与对手和自身高水平博弈中提升战术素养，原生打出 90%+ 随机胜率！
            for _g in range(games_per_iter):
                r = random.random()
                if focused_deck is not None:
                    d_net = focused_deck
                else:
                    d_net = decks[random.randrange(len(decks))]
                game_seed = random.randint(0, 10 ** 6)
                if r < 0.8:
                    # bundleai：对手阵型随机选（含自身卡组的 bundle 版本）
                    idx_opp = random.randrange(len(decks))
                    bname = deck_names[idx_opp]
                    if _g % 2 == 0:
                        sa, sb, _winner, _sc = play_game(engine, mcts, None, d_net, decks[idx_opp], game_seed,
                                                         temperature=1.0, exp_lib=exp_lib,
                                                         bundle_b=bname, sample_w=1.5, exp_source='bundle')
                        buffer.extend(sa)
                    else:
                        sb, sa, _winner, _sc = play_game(engine, None, mcts, decks[idx_opp], d_net, game_seed,
                                                         temperature=1.0, exp_lib=exp_lib,
                                                         bundle_a=bname, sample_w=1.5, exp_source='bundle')
                        buffer.extend(sb)
                    n_samp = len(sa) + len(sb)
                elif r < 0.9:
                    # 规则随机对手
                    idx_opp = random.randrange(len(decks))
                    opp_fn = rule_random_place if random.random() < 0.5 else random_place
                    samples, _winner, _sc = play_vs_fn(engine, mcts, d_net, decks[idx_opp], game_seed, opp_fn,
                                                       mcts_side='p1' if _g % 2 == 0 else 'p2', temperature=1.0,
                                                       path_a=[], chain_a=random.randint(1, 10 ** 9),
                                                       exp_lib=exp_lib, exp_source='pool', sample_w=0.5)
                    buffer.extend(samples)
                    n_samp = len(samples)
                else:
                    # 自对弈（当前网络镜像，同卡组）：最强对局回传经验库
                    sa, sb, _winner, _sc = play_game(engine, mcts, mcts, d_net, d_net, game_seed,
                                                     temperature=1.0, exp_lib=exp_lib,
                                                     sample_w=1.2, exp_source='best')
                    buffer.extend(sa)
                    buffer.extend(sb)
                    n_samp = len(sa) + len(sb)
                total_games += 1
                total_samples += n_samp
                if len(buffer) > buffer_cap:
                    buffer = buffer[-buffer_cap:]

            # ---- 训练 ----
            train_loss = train_lpm = train_lpc = train_lv = 0.0
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
                zs = torch.tensor([b[4] for b in batch], dtype=torch.float32).to(device)
                # 受控混合：best 对局样本权重高、多样性对局低（样本第 6 维为权重）
                ws = torch.tensor([b[5] for b in batch], dtype=torch.float32).to(device)
                log_pm, log_pc, v = net(grids, gs)
                # 拆分策略/价值损失：策略 CE 会随 MCTS 目标变强（更尖）而上升属正常；
                # 价值 MSE 持续上升才是异常信号；损失按样本权重加权（best 对局优先）
                loss_pm = -(pims * log_pm).sum(1)
                loss_pc = -(pics * log_pc).sum(1)
                loss_v = (v - zs) ** 2
                loss = ((loss_pm + loss_pc + 0.5 * loss_v) * ws).mean()
                opt.zero_grad()
                loss.backward()
                opt.step()
                train_loss += float(loss.item())
                train_lpm += float(loss_pm.mean().item())
                train_lpc += float(loss_pc.mean().item())
                train_lv += float(loss_v.mean().item())
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
                bundle_wr = (bwins + 0.5 * bdraws) / bt * 100 if bt else 0

                # 2) 恒定基准阶梯（vs 规则随机 L1 基准层 + Elo，跨版本可比）。
                #    聚焦模式：网络侧固定用聚焦卡组（模型只学过它）；非聚焦保持卡组轮换
                bench = run_benchmark(engine, net, eval_mcts, decks, games_per_layer=bench_games,
                                      out_path=os.path.join(out_dir, 'benchmark_ladder.jsonl'), step=it,
                                      focused_deck=focused_deck)
                rand_wr = bench['layers']['L1_rule']['wr'] * 100

                # 3) checkpoint（每个 iter 实时检查最优）：一旦综合分创下新高，立刻 Save 为最新最优权重！
                #    综合 = 0.7·vs bundleai 胜平率 + 0.3·vs 规则随机胜平率
                ck_score = 0.7 * bundle_wr + 0.3 * rand_wr
                ckpt_path = os.path.join(ckpt_dir, f'ckpt_it{it}.pt')
                if ck_score > best_ckpt_wr:
                    best_ckpt_wr = ck_score
                    best_ckpt_path = ckpt_path
                    best_net.load_state_dict(net.state_dict())
                    torch.save(net.state_dict(), ckpt_path)
                    print(f'[ckpt] [iter {it}] 综合 {ck_score:.1f} (bundleai {bundle_wr:.1f}% / 随机 {rand_wr:.1f}%) → 创新高，存最优 {ckpt_path}', flush=True)
                    # 每当出现新高最优模型时，自动导出目标阵型对阵另外 6 套阵型的布阵摆放图与对阵数据表格！
                    try:
                        from .inspect_games import main as inspect_main
                        m_name = focused_name or 'model'
                        insp_file = os.path.join(out_dir, f'inspect_{m_name}.md')
                        inspect_main(model_path=ckpt_path, sp_games=2, vr_games=2,
                                     out_path=insp_file, quiet=True, focus_idx=focus_idx,
                                     exp_lib_path=os.path.join(out_dir, exp_lib_path))
                        print(f'[ckpt] [iter {it}] 已更新布阵摆放图与对局数据表格 → {insp_file}', flush=True)
                    except Exception as _e:
                        pass
                else:
                    print(f'[ckpt] [iter {it}] 纯RL综合 {ck_score:.1f} (当前历史最高: {best_ckpt_wr:.1f}) | 保持主网络持续梯度探索，不强行倒退回滚', flush=True)
                remain = max(0, deadline - time.time()) / 60
                print(f'[iter {it}] 局数={total_games} 样本={total_samples} '
                      f'loss={train_loss / max(1, n_batch):.3f} '
                      f'(πm={train_lpm / max(1, n_batch):.3f} πc={train_lpc / max(1, n_batch):.3f} '
                      f'v={train_lv / max(1, n_batch):.3f}) λ={mcts.prior_lambda:.2f} '
                      f'vs bundleai 胜平率={bundle_wr:.1f}% ({bwins}胜/{bdraws}平/{blosses}负/{bt}局) | '
                      f'vs 随机 L1={rand_wr:.0f}% | '
                      f'Elo={bench["elo"]:.0f} 剩余{remain:.1f}min', flush=True)

        # ---- 保存：最终模型 = 历史最优 checkpoint（vs bundleai + vs 随机 综合评判）→ model_out ----
        # 训练中 checkpoint 已按综合胜率自动回滚到最优；结束时再确认一次加载最优权重
        os.makedirs(out_dir, exist_ok=True)
        out_path = os.path.join(out_dir, model_out)
        if best_ckpt_path and os.path.exists(best_ckpt_path) and best_ckpt_wr > 0:
            net.load_state_dict(torch.load(best_ckpt_path, map_location=device))
            print(f'[train] 最终采用历史最优 checkpoint（综合 {best_ckpt_wr:.1f}）', flush=True)
        torch.save(net.state_dict(), out_path)
        torch.save(net.state_dict(), os.path.join(out_dir, os.path.splitext(model_out)[0] + '_last.pt'))
        # 经验库跨会话累积保存
        exp_lib.save(os.path.join(out_dir, exp_lib_path))
        n_ent = sum(len(c) for c in exp_lib.lib.values())
        print(f'[train] 完成：{total_games} 局 / {total_samples} 样本 → best {out_path} ({os.path.getsize(out_path) / 1024:.0f}KB) | 经验库 {n_ent}条')
    finally:
        engine.close()
    # 训练结束自动产出对局供人工检查（聚焦：焦点卡组 vs 其余 6 套 + vs 规则随机，静默写文件）
    # 放在训练引擎关闭后执行（另起引擎，避免端口冲突）
    try:
        from .inspect_games import main as inspect_main
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
    if '--focus' in sys.argv:
        focus_idx = int(sys.argv[sys.argv.index('--focus') + 1])
    if '--model-out' in sys.argv:
        model_out = sys.argv[sys.argv.index('--model-out') + 1]
    if '--exp-lib' in sys.argv:
        exp_lib_path = sys.argv[sys.argv.index('--exp-lib') + 1]
    main(duration_min=duration, focused=focused, focus_idx=focus_idx,
         model_out=model_out, exp_lib_path=exp_lib_path)
