#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
引擎桥接 Python 客户端（RL 训练栈专用）。
启动 Node 桥接服务（src/engine/bridge.ts），stdio JSONL 通信。

用法：
    engine = EngineClient(cwd); engine.start()
    engine.simulate(board, round_=1, seed=1)
    engine.db()          # 怪兽/徽章数据库（静态）
    engine.formations()  # 阵型库卡组
    engine.close()
"""
import json
import os
import subprocess
import sys
import threading


class EngineClient:
    def __init__(self, cwd: str):
        self.cwd = cwd
        self.proc = None
        self._next_id = 0

    def start(self) -> None:
        npx = 'npx.cmd' if os.name == 'nt' else 'npx'
        self.proc = subprocess.Popen(
            [npx, 'vite-node', '--script', 'src/engine/bridge.ts'],
            cwd=self.cwd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding='utf-8',
            errors='replace',
            bufsize=1,
        )
        # 排空 bridge stderr（其日志/调试信息转发到本进程 stderr；
        # 不排空会积压管道缓冲区，长训练时可能阻塞 bridge 进程）
        def _drain():
            assert self.proc and self.proc.stderr
            for line in self.proc.stderr:
                sys.stderr.write(line)
                sys.stderr.flush()

        threading.Thread(target=_drain, args=(), daemon=True).start()
        self.request({'type': 'ping'})  # 冷启动约 1s，阻塞等待就绪

    def request(self, req: dict) -> dict:
        assert self.proc and self.proc.stdin and self.proc.stdout, 'engine not started'
        req['id'] = self._next_id
        self._next_id += 1
        self.proc.stdin.write(json.dumps(req, ensure_ascii=False) + '\n')
        self.proc.stdin.flush()
        line = self.proc.stdout.readline()
        if not line:
            err = self.proc.stderr.read() if self.proc.stderr else ''
            raise RuntimeError(f'engine closed unexpectedly: {err}')
        res = json.loads(line)
        if not res.get('ok'):
            raise RuntimeError(res.get('error', 'engine error'))
        return res

    def simulate(self, board, round_=1, seed=None, timeout=120) -> dict:
        """回合战斗模拟。board: [{dbId,x,y,team,hp?,badgeIds}]。
        返回 {d1,d2,hpP1,hpP2,killsP1,killsP2,survivors:[{dbId,x,y,team,hp,maxHp,badgeIds}]}"""
        req = {'type': 'simulate', 'board': board, 'round': round_, 'timeout': timeout}
        if seed is not None:
            req['seed'] = seed
        return self.request(req)

    def db(self) -> dict:
        return self.request({'type': 'db'})

    def formations(self) -> dict:
        return self.request({'type': 'formations'})

    def close(self) -> None:
        if self.proc:
            try:
                self.proc.terminate()
            except Exception:
                pass
            self.proc = None


if __name__ == '__main__':
    import sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from bridge_client import EngineClient

    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
    engine = EngineClient(root)
    engine.start()
    try:
        board = [
            {'dbId': 110, 'x': 4, 'y': 2, 'team': 1, 'badgeIds': []},
            {'dbId': 110, 'x': 6, 'y': 2, 'team': 2, 'badgeIds': []},
        ]
        out = engine.simulate(board, round_=1, seed=7)
        print(f'[ok] simulate → d1={out["d1"]} d2={out["d2"]} survivors={len(out["survivors"])}')
        db = engine.db()
        print(f'[ok] db → monsters={len(db["monsters"])} badges={len(db["badges"])}')
        fs = engine.formations()
        print(f'[ok] formations → {[f["name"] for f in fs["formations"]]}')
    finally:
        engine.close()
