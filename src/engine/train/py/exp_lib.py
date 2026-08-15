# -*- coding: utf-8 -*-
"""
在线经验库（ExperienceLib）v2：三层单库 + 二段检索 + 锚定链序列记忆。

存储分层（统一单库，key = canonical 对称规范化哈希）：
- endgame 层：静态专家搜索产物（endgame_lib.json 迁移），只读、永不衰减，
  仅 canonical 精确/等价匹配时直接采用（无污染风险）。
- expert 层：在线高置信度经验（置信度门控后入池），可衰减、按胜负回传修正。
  key = canonical_hash（对称规范化：x镜像 / y翻转 / 双翻转等价自动命中）；
  value = {canonical动作: entry}，entry 含动作(canonical坐标)、评分、n、
  决策链元数据（chain_id/chain_pos/chain_len）、局面特征（ANN 检索用）、meta。
- replay 层：训练样本 buffer 在 train.py，不归本类管理。

检索（二段式）：
1. 一段 · canonical 等价：canonical_hash 精确查表（endgame → expert），
   命中后动作从 canonical 坐标反变换回查询局面坐标，并做合法性校验。
2. 二段 · 特征 ANN：局面特征向量最近邻（欧氏距离，阈值内；numpy 线性扫描，
   数据量小不引入 FAISS），动作用相对特征迁移到查询局面的合法格。

序列记忆（跨回合锚定链）：
- 一局自对弈每侧记录一条决策链（跨回合连续）。敌方行动在回合间，链记录的是
  "理想路径"，执行时逐决策点校验，失效则容错回退（不因一步不合法崩掉整条经验）。
- 回传：整局胜负 z 按链内位置时间加权（结局前几步权重最高，锚点保底）。
- 存储时每条决策点独立入库（匹配仍是单步），但带 chain 关联用于加权回传。

置信度门控：仅"最强对局（source='best'）+ 搜索确定（root_visits≥门槛）+
胜负分明（|z|=1）"的决策点入 expert 池，避免弱对局污染。

清洗（save/clean 时）：全局分数衰减（遗忘曲线）、低分条目清除、
同 canonical 同动作合并、同 canonical 保留 top-K 候选。

旧格式迁移：旧 exp_lib.json / endgame_lib.json（字符串 key "r|b|e|m"）→
解析 key 重建状态 → canonical_hash + canonical 动作坐标，自动升级为 v2。
"""
import json
import os

import numpy as np

from .state import State, canonical_transform, inv_apply_t, COST_BY_ID, BUDGET_LIMITS
from .heuristic import state_feat, act_feat


# ---------- 旧格式迁移 ----------
def _parse_key(key: str) -> tuple:
    """旧字符串 key 'r1|b4|e105@10,2|m110@9,2|105@10,2' → (round, budget, enemy, my)。
    注意：怪物之间也用 '|' 连接（与顶层段分隔符相同），必须按前缀归属聚合，
    不能对每个 'e'/'m' 段独立解析，否则多怪时只保留第一只。"""
    parts = key.split('|')
    r = int(parts[0][1:])
    b = int(parts[1][1:])
    enemy: list = []
    my: list = []
    cur = None
    for p in parts[2:]:
        if p.startswith('e'):
            cur = enemy
        elif p.startswith('m'):
            cur = my
        elif cur is None:
            continue
        seg = p[1:] if (p.startswith('e') or p.startswith('m')) else p
        if not seg:
            continue  # 空段（如 'r1|b4|e|m' 的空场）
        db, xy = seg.split('@')
        x, y = xy.split(',')
        cur.append({'dbId': int(db), 'x': int(x), 'y': int(y)})
    return r, b, enemy, my


def _migrate_entry(key: str, act: tuple) -> tuple:
    """旧条目 → (canonical_hash, canonical动作)。canonical 只依赖 my/enemy/round/budget。"""
    r, b, enemy, my = _parse_key(key)
    s = State('p1', my, enemy, [], r, b, BUDGET_LIMITS.get(r, 4), [])
    h, t = canonical_transform(s)
    return h, inv_apply_t(tuple(act), t)


def _json_default(o):
    """json.dump 兜底：numpy 标量/数组 → Python 原生类型。
    经验库字段偶发 np.float32/np.int64 等 numpy 类型（特征数组、索引运算产物），
    直接 dump 会 TypeError 崩掉整个 save（历史多轮训练都在这里失败，经验库从未落盘）。"""
    if isinstance(o, np.ndarray):
        return o.tolist()
    if isinstance(o, np.floating):
        return float(o)
    if isinstance(o, np.integer):
        return int(o)
    if isinstance(o, np.bool_):
        return bool(o)
    raise TypeError(f'Object of type {o.__class__.__name__} is not JSON serializable')


class ExperienceLib:
    def __init__(self, lr: float = 0.1, boost_k: float = 2.0, adopt_min: float = 0.0,
                 path: str = None, endgame_path: str = None,
                 ann_topk: int = 5, ann_thresh: float = 2.2, visits_min: int = 20,
                 mode: str = 'avoid'):
        """在线经验库 v2（三层单库）。mode：
        - 'avoid'（默认，负反馈）：输局决策点负分入库（"这个动作让我输过，避免它"），
          查询/先验注入时对负分候选压低权重；赢局不入库（避免"记住正确"被弱对手污染）。
        - 'store'（旧正反馈）：仅赢局正分入库（历史行为，A/B 对照用）。
        - 'off'：完全禁用在线学习（仅 endgame 静态层）。"""
        self.expert: dict = {}          # canonical_hash -> {act_tuple: entry}
        self.lib = self.expert          # 向后兼容别名（旧代码统计条数用）
        self.endgame: dict = {}         # canonical_hash -> act_tuple（静态专家，只读）
        self.lr = lr
        self.boost_k = boost_k
        self.adopt_min = adopt_min
        self.ann_topk = ann_topk
        self.ann_thresh = ann_thresh
        self.visits_min = visits_min
        self.mode = mode
        self.path = path
        self._dirty = True
        self._feat_arr = None
        self._ref_arr = []
        if path and os.path.exists(path):
            self.load(path)
        if endgame_path and os.path.exists(endgame_path):
            self.seed_from_endgame_lib(endgame_path)

    # ---------- 特征索引（ANN 线性扫描，数据量小不引入 FAISS） ----------
    def _rebuild_index(self):
        feats, refs = [], []
        dim = 0
        for cands in self.expert.values():
            for e in cands.values():
                f = np.asarray(e['feat'], dtype=np.float32)
                dim = max(dim, f.shape[0])
                feats.append(f)
                refs.append(e)
        if feats and dim > 0:
            # 旧数据 feat 维度 < 新特征维度（state_feat 演进）→ 低位补 0（缺失特征按中性值）
            self._feat_arr = np.stack([np.pad(f, (0, dim - f.shape[0])) for f in feats])
        else:
            self._feat_arr = None
        self._ref_arr = refs
        self._dirty = False

    def _index_query(self, f, topk: int = 5):
        if self._dirty:
            self._rebuild_index()
        if self._feat_arr is None or self._feat_arr.shape[1] == 0 or len(self._ref_arr) == 0:
            return []
        if f.shape[0] < self._feat_arr.shape[1]:
            f = np.concatenate([f, np.zeros(self._feat_arr.shape[1] - f.shape[0], dtype=np.float32)])
        d = np.sqrt(((self._feat_arr - f) ** 2).sum(1))
        k = min(topk, len(d))
        idx = np.argpartition(d, k - 1)[:k]
        idx = idx[np.argsort(d[idx])]
        return [(self._ref_arr[i], float(d[i])) for i in idx]

    # ---------- 动作合法性校验（快速版，等价于 legal_actions 成员检查） ----------
    @staticmethod
    def _legal(s, act) -> bool:
        db, x, y = act
        if db not in s.hand:
            return False
        if COST_BY_ID.get(db, 4) > s.budget:
            return False
        return not any(m['x'] == x and m['y'] == y for m in s.my)

    # ---------- 动作迁移（ANN 相似局面命中后，把条目动作迁移到查询局面） ----------
    def _transfer(self, e, s):
        db = e['act'][0]
        if db not in s.hand or COST_BY_ID.get(db, 4) > s.budget:
            return None
        tf = np.asarray(e['act_feat'], dtype=np.float32)
        best, best_d = None, None
        for (x, y) in s.legal_cells():
            f = act_feat(s, db, x, y)
            d = float(((f - tf) ** 2).sum())
            if best_d is None or d < best_d:
                best_d, best = d, (db, x, y)
        return best

    # ---------- 查询（二段检索） ----------
    def lookup(self, s) -> tuple | None:
        """返回 (db_id, x, y, score) 或 None。
        己方空场（开局首手）不查经验库：开局由网络+启发式（卡组感知）决定，
        避免公共状态被弱对局污染成次优动作并永久锁定。
        顺序：endgame canonical 精确 → expert canonical 精确 → ANN 相似。"""
        if not s.my:
            return None
        h, t = canonical_transform(s)
        # 1) endgame 层：canonical 等价 → 直接采用（专家搜索产物，零污染风险）
        a = self.endgame.get(h)
        if a is not None:
            act = inv_apply_t(a, t)
            if self._legal(s, act):
                return (*act, 3.0)
        # 2) expert 层：canonical 等价 → 最高分候选。
        #    avoid 模式（负反馈）：负分候选绝不直接采用（只用于压低先验），
        #    仅当存在正分候选（历史 store 数据残留）且 > adopt_min 时采用。
        cands = self.expert.get(h)
        if cands:
            best_act, best_e = None, None
            for act, e in cands.items():
                if e['score'] > self.adopt_min and (best_e is None or e['score'] > best_e['score']):
                    best_act, best_e = act, e
            if best_act is not None and self.mode != 'off':
                a2 = inv_apply_t(best_act, t)
                if self._legal(s, a2):
                    return (*a2, best_e['score'])
        # 3) ANN：相似局面 → 动作迁移 + 校验；信任度随距离衰减
        f = state_feat(s)
        for e, d in self._index_query(f, self.ann_topk):
            if d > self.ann_thresh:
                break
            a3 = self._transfer(e, s)
            if a3 is not None:
                return (*a3, e['score'] * (1.0 - d / self.ann_thresh))
        return None

    # ---------- 先验注入（只加权不覆盖，保留概率式） ----------
    def boost(self, s, priors: dict) -> None:
        """把库中正分候选加权注入先验。与 lookup 一致：空场不注入；
        顺序：endgame canonical → expert canonical → ANN 相似（top1，成本控制）。"""
        if not s.my:
            return
        h, t = canonical_transform(s)
        # endgame 层
        a = self.endgame.get(h)
        if a is not None:
            act = inv_apply_t(a, t)
            k = (act[0], (act[1], act[2]))
            if k in priors:
                priors[k] *= 1.0 + self.boost_k
        # expert 层：canonical 等价。avoid 模式（负反馈）下负分候选压低先验
        # （"这个动作输过，避免它"）；store 模式下正分候选加权。endgame 层不变。
        cands = self.expert.get(h)
        if cands:
            for act, e in cands.items():
                if self.mode == 'avoid':
                    # 负反馈：score<0 的候选压低（分越负压得越狠），score>=0 忽略
                    if e['score'] < 0:
                        a2 = inv_apply_t(act, t)
                        k = (a2[0], (a2[1], a2[2]))
                        if k in priors:
                            priors[k] *= 1.0 / (1.0 + self.boost_k * abs(e['score']) / (1.0 + abs(e['score'])))
                    continue
                if e['score'] <= 0:
                    continue
                a2 = inv_apply_t(act, t)
                k = (a2[0], (a2[1], a2[2]))
                if k in priors:
                    w = 1.0 + self.boost_k * e['score'] / (1.0 + e['score'])
                    priors[k] *= w
        # ANN 相似（top1）
        f = state_feat(s)
        hits = self._index_query(f, 1)
        if hits:
            e, d = hits[0]
            if d <= self.ann_thresh:
                a3 = self._transfer(e, s)
                if a3 is not None:
                    k = (a3[0], (a3[1], a3[2]))
                    if k in priors:
                        decay = 1.0 - d / self.ann_thresh
                        if self.mode == 'avoid':
                            # 负反馈：相似局面输过的候选也压低
                            if e['score'] < 0:
                                priors[k] *= 1.0 / (1.0 + self.boost_k * decay * abs(e['score']) / (1.0 + abs(e['score'])))
                        else:
                            # store 模式：正分候选加权（score<=0 跳过，防除零/负权重）
                            if e['score'] > 0:
                                priors[k] *= 1.0 + self.boost_k * decay * e['score'] / (1.0 + e['score'])

    # ---------- 学习（决策链胜负回传，跨回合时间加权；负反馈模式） ----------
    def update_batch(self, chain, z: float, w: float = 1.0, source: str = 'best') -> None:
        """对局结束回传：chain = 该侧整局决策点记录列表（跨回合），
        z = ±1/0（该侧胜负视角）；w = 对局质量权重（0~1）。
        时间加权：越接近结局的决策点权重越高（直接决定胜负），锚点保底。
        模式门控：
        - avoid（默认负反馈）：仅接收净负战局 (z < 0) + 强对手对局（'bundle'），
          负分入库 = "这些动作导致失败，避免它们"。赢局不入库（弱对手的"正确"不可靠）。
        - store（旧正反馈）：仅接收净胜战局 (z > 0) + 强对手对局，正分入库（A/B 对照）。
        - off：直接跳过。"""
        if not chain or self.mode == 'off':
            return
        if source not in ('best', 'bundle', 'pool'):
            return
        if self.mode == 'avoid' and z >= 0:
            return
        if self.mode == 'store' and z <= 0:
            return
        n = len(chain)
        for i, rec in enumerate(chain):
            if rec.get('visits', 0) < self.visits_min:
                continue
            pos_w = 1.0 + 1.0 * (i / max(1, n - 1))   # 最后一步 ×2，第一步 ×1
            self._update_rec(rec, z * w * pos_w)

    def _update_rec(self, rec: dict, delta: float) -> None:
        h = rec['canonical']
        act = tuple(rec['act'])
        cands = self.expert.setdefault(h, {})
        e = cands.get(act)
        if e is None:
            e = {'act': act, 'act_feat': list(rec['act_feat']), 'feat': list(rec['feat']),
                 'score': 0.0, 'n': 0, 'chain': rec.get('chain'), 'chain_pos': rec.get('chain_pos'),
                 'chain_len': rec.get('chain_len'), 'meta': rec.get('meta', {})}
            cands[act] = e
        e['score'] += self.lr * delta
        e['n'] += 1
        self._dirty = True

    # ---------- 清洗（去重/合并/淘汰，可选衰减） ----------
    def clean(self, top_k: int = 3, decay: float = 1.0, min_score: float = 0.05) -> int:
        """轻量在线清洗：同 canonical 保留 top-K 候选（防污染）、同动作合并、
        分数衰减后可选的低分清除。返回清除条目数。"""
        removed = 0
        for h, cands in self.expert.items():
            kept = []
            for act, e in cands.items():
                e['score'] = e['score'] * decay
                if abs(e['score']) < min_score:
                    removed += 1
                    continue
                kept.append((act, e))
            kept.sort(key=lambda t: -abs(t[1]['score']))
            self.expert[h] = dict(kept[:top_k])
        self._dirty = True
        return removed

    # ---------- 持久化（v2 分层格式 + 旧格式迁移） ----------
    def load(self, path: str) -> int:
        try:
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except Exception as e:
            print(f'[exp_lib] 警告: 读取 {path} 失败 ({e})，重新建立空经验库', flush=True)
            return 0
        n = 0
        if data.get('type') == 'exp_lib_v2':
            for e in data.get('entries', []):
                cands = self.expert.setdefault(int(e['canonical']), {})
                act = (e['act'][0], e['act'][1], e['act'][2])
                cands[act] = {'act': act, 'act_feat': e.get('act_feat', []),
                              'feat': e.get('feat', []), 'score': float(e['score']),
                              'n': int(e['n']), 'chain': e.get('chain'),
                              'chain_pos': e.get('chain_pos'), 'chain_len': e.get('chain_len'),
                              'meta': e.get('meta', {})}
                n += 1
            for e in data.get('endgame', []):
                self.endgame[int(e['canonical'])] = (e['act'][0], e['act'][1], e['act'][2])
        else:
            # 旧格式：字符串 key → canonical 迁移
            for e in data.get('entries', []):
                h, cact = _migrate_entry(e['key'], e['act'])
                cands = self.expert.setdefault(h, {})
                cands[cact] = {'act': cact, 'act_feat': [], 'feat': [],
                               'score': float(e['score']), 'n': int(e['n']),
                               'chain': None, 'chain_pos': 0, 'chain_len': 1, 'meta': {}}
                n += 1
        self._dirty = True
        return n

    def save(self, path: str = None, decay: float = 0.9, min_score: float = 0.3,
             top_k: int = 3) -> None:
        """保存前全库衰减（遗忘曲线）+ 低分清除 + 同 canonical 保留 top-K。"""
        path = path or self.path
        if not path:
            return
        self.clean(top_k=top_k, decay=decay, min_score=min_score)
        entries = []
        for h, cands in self.expert.items():
            for act, e in cands.items():
                entries.append({'canonical': h, 'act': list(act), 'score': round(float(e['score']), 4),
                                'n': e['n'], 'act_feat': [float(x) for x in e['act_feat']],
                                'feat': [float(x) for x in e['feat']],
                                'chain': e.get('chain'), 'chain_pos': e.get('chain_pos'),
                                'chain_len': e.get('chain_len'), 'meta': e.get('meta', {})})
        endgame_entries = [{'canonical': h, 'act': list(a)} for h, a in self.endgame.items()]
        os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
        with open(path, 'w', encoding='utf-8') as f:
            json.dump({'type': 'exp_lib_v2', 'entries': entries, 'endgame': endgame_entries},
                      f, ensure_ascii=False, default=_json_default)

    def seed_from_endgame_lib(self, path: str) -> int:
        """把专家搜索残局库迁移为 endgame 层（canonical 化，只读）；
        同 canonical 多条冲突取 count 最大的动作（先写大 count，小的不覆盖）。返回迁移条数。"""
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        entries = sorted(data.get('entries', []), key=lambda e: -e.get('count', 1))
        n = 0
        for e in entries:
            h, cact = _migrate_entry(e['key'], (e['monsterId'], e['x'], e['y']))
            if h not in self.endgame:
                self.endgame[h] = cact
                n += 1
        return n
