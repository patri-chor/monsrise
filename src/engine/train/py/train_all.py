# -*- coding: utf-8 -*-
"""
连续训练 7 套卡组（每套独立模型 + 独立经验库，各训练 duration_min 分钟）。
- 断点续训：rl_model_{卡组}.pt 已存在则跳过该套（避免重复训练）
- 每套训练结束由 train.main 自动产出 inspect_{卡组}.md（该卡组 vs 其余 6 套 + vs 规则随机）
- 全程日志追加到 reports/train_all.log，自包含运行，无需人工监督

运行：python -m src.engine.train.py.train_all [每套时长分钟，默认 60]
"""
import os
import re
import sys
import time

from .bridge_client import EngineClient
from .train import main as train_main


def project_root() -> str:
    p = os.path.dirname(os.path.abspath(__file__))
    for _ in range(4):
        p = os.path.dirname(p)
    return p


def safe_name(name: str) -> str:
    """卡组名 → 文件名安全（去空白/非法字符）。"""
    s = re.sub(r'[\\/:*?"<>|]', '_', name.strip())
    return s or 'deck'


def main(duration_min: float = 30.0):
    root = project_root()
    log_path = os.path.join(root, 'reports', 'train_all.log')
    os.makedirs(os.path.join(root, 'reports'), exist_ok=True)

    # 取卡组名单（训练本身各自新建引擎，这里只读一次用于文件命名）
    engine = EngineClient(root)
    engine.start()
    try:
        formations = engine.formations()['formations']
        names = [f['name'] for f in formations]
    finally:
        engine.close()
    print(f'[train_all] 卡组（{len(names)}套）: {list(enumerate(names))}', flush=True)

    results = []
    for i, name in enumerate(names):
        mname = safe_name(name)
        # 传相对 out_dir 的文件名（train.py 内部统一拼 reports/），避免路径重复拼接
        model_rel = f'rl_model_{mname}.pt'
        exp_lib_rel = f'exp_lib_{mname}.json'
        inspect_path = os.path.join(root, 'reports', f'inspect_{mname}.md')
        if os.path.exists(os.path.join(root, 'reports', model_rel)):
            msg = f'[train_all] [{i}] {name}: 模型已存在 reports/{model_rel}，跳过（断点续训）'
            print(msg, flush=True)
            results.append((name, 'skip', msg))
            continue
        t0 = time.time()
        print(f'[train_all] [{i}] {name}: 开始训练 {duration_min} 分钟 → reports/{model_rel}', flush=True)
        try:
            train_main(duration_min=duration_min, focus_idx=i, model_out=model_rel,
                       exp_lib_path=exp_lib_rel)
        except Exception as e:
            used = (time.time() - t0) / 60
            msg = f'[train_all] [{i}] {name}: 训练异常 {e} 用时{used:.1f}min'
            print(msg, flush=True)
            results.append((name, 'fail', msg))
            with open(log_path, 'a', encoding='utf-8') as f:
                f.write(f'[{time.strftime("%Y-%m-%d %H:%M:%S")}] {msg}\n')
            continue
        used = (time.time() - t0) / 60
        ok = os.path.exists(os.path.join(root, 'reports', model_rel))
        msg = f'[train_all] [{i}] {name}: {"完成" if ok else "失败"} 用时{used:.1f}min ' \
              f'模型=reports/{model_rel} 检查={inspect_path}'
        print(msg, flush=True)
        results.append((name, 'done' if ok else 'fail', msg))
        # 每套完成立即写日志（防止中途崩溃丢失进度记录）
        with open(log_path, 'a', encoding='utf-8') as f:
            f.write(f'[{time.strftime("%Y-%m-%d %H:%M:%S")}] {msg}\n')

    with open(log_path, 'a', encoding='utf-8') as f:
        f.write(f'\n===== train_all 会话 {time.strftime("%Y-%m-%d %H:%M:%S")} =====\n')
        for _name, _status, msg in results:
            f.write(msg + '\n')
    print(f'[train_all] 汇总: {[f"{n}={s}" for n, s, _ in results]}', flush=True)
    print(f'[train_all] 日志 → {log_path}', flush=True)


if __name__ == '__main__':
    dur = float(sys.argv[1]) if len(sys.argv) > 1 else 30.0
    main(duration_min=dur)
