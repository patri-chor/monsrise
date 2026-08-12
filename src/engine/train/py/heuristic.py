# -*- coding: utf-8 -*-
"""
领域启发式先验（卡组感知）+ 理性基线价值：为 MCTS 提供"合理"的放置引导。

核心思想（用户要求）：决策必须考虑当前手牌与卡组——每套卡组有它自己的策略。
  1. 角色站位：坦克/战士/突进怪贴前（坦克尽量居中），法师/射手贴后
  2. 相邻协同：技能/徽章多为"相邻触发"→ 同种族相邻放置，治疗/链接怪必须贴队友
  3. 费用：4 费核心卡优先上场（卡组强度所在），尽早上吃满预算
  4. 卡组画像：主种族亲和、祈祷流聚集、冲脸流前排压制
  5. 残局库先验：精确状态（或镜像近似状态）命中专家搜索动作 → 强加权（只加权不覆盖，保持概率式）
  6. 敌情针对性：对位压制——近战怪冲敌方有怪的行，射手贴敌方后排行输出，突进怪直切后排

script_value()：欠训练网络价值"倒挂"（坦克后排 v 高、前排 v 低）时的理性基线，
  与网络价值混合后作为 MCTS 叶节点评估，保证搜索选出的动作在常识上合理。
"""
import json
import os
from collections import Counter

# 怪兽属性表（由桥接 db 请求填充，见 init_mon_meta）
MON_META: dict[int, dict] = {}

# 突进/钻地类：冲最前才能发挥价值
RUSH_IDS = {106, 116, 117, 119}
# 治疗/链接类：必须贴队友才生效（学徒生命链接/祈祷回血连线/守卫治疗剑）
SUPPORT_IDS = {103, 105, 112}

# ---------- 残局库（endgame_lib.json，TS 端 buildEndgameLib 产物） ----------
# key = "r回合|b剩余预算|e敌怪(排序)|m我怪(排序)"，与 TS endgameKey 完全一致；
# value = (monsterId, x, y, count)，count 为专家搜索选中该动作的次数（置信度）。
_ENDGAME_LIB: dict | None = None
_ENDGAME_LIB_PATH = os.path.abspath(os.path.join(
    os.path.dirname(__file__), *(['..'] * 5), 'reports', 'endgame_lib.json'))


def load_endgame_lib(path: str) -> int:
    """加载残局库 JSON。返回条目数（0 = 未命中任何）。"""
    global _ENDGAME_LIB
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    lib = {}
    for e in data.get('entries', []):
        lib[e['key']] = (e['monsterId'], e['x'], e['y'], e['count'])
    _ENDGAME_LIB = lib
    return len(lib)


def _get_endgame_lib() -> dict:
    """懒加载残局库（首次调用读入，之后缓存）。"""
    global _ENDGAME_LIB
    if _ENDGAME_LIB is None:
        try:
            load_endgame_lib(_ENDGAME_LIB_PATH)
        except (FileNotFoundError, json.JSONDecodeError):
            _ENDGAME_LIB = {}
    return _ENDGAME_LIB or {}


def _fmt_pos(ms) -> str:
    # 注意：必须按 (dbId, x, y) 数值排序，字符串排序会把 "105@10,2" 排在 "105@9,2" 前
    # （'1'<'9'），同一局面可能生成两个 key（x=10 列序错乱 bug）。
    return '|'.join(f"{m['dbId']}@{m['x']},{m['y']}"
                    for m in sorted(ms, key=lambda m: (m['dbId'], m['x'], m['y'])))


def _endgame_key(s) -> str:
    """与 TS endgameKey 相同格式：r回合|b剩余预算|e敌怪|m我怪（排序后拼串）。"""
    return f"r{s.round}|b{s.budget}|e{_fmt_pos(s.enemy)}|m{_fmt_pos(s.my)}"


def _endgame_key_mirror(s) -> str:
    """镜像状态的残局键（x→10-x）。棋盘左右对称，同一局面可从对侧视角命中。"""
    def mf(m):
        return {'dbId': m['dbId'], 'x': 10 - m['x'], 'y': m['y']}
    return f"r{s.round}|b{s.budget}|e{_fmt_pos(mf(e) for e in s.enemy)}|m{_fmt_pos(mf(x) for x in s.my)}"


def init_mon_meta(db: dict) -> None:
    """从引擎 db 请求填充怪兽属性表（type/range/role/race/cost/skill）。"""
    MON_META.clear()
    for m in db['monsters']:
        MON_META[m['id']] = m


def _near(my, x: int, y: int, d: int = 1) -> bool:
    return any(abs(m['x'] - x) <= d and abs(m['y'] - y) <= d for m in my)


def _deck_profile(s):
    """卡组画像：角色/种族分布、4 费核心、风格（祈祷流/冲脸流）。"""
    roles: Counter = Counter()
    races: Counter = Counter()
    deck_ids = set(s.deck)
    for d in s.deck:
        m = MON_META.get(d)
        if not m:
            continue
        roles[m.get('role', '战士')] += 1
        races[m.get('race', '')] += 1
    return {
        'roles': roles,
        'races': races,
        'main_race': races.most_common(1)[0][0] if races else '',
        'n_rush': sum(1 for d in deck_ids if d in RUSH_IDS),
        'prayer_style': 105 in deck_ids and 103 in deck_ids,
        'four_cost': [d for d in deck_ids if MON_META.get(d, {}).get('cost', 2) >= 4],
    }


def heuristic_prior(s) -> dict:
    """对每个合法动作 (db_id, (x, y)) 返回先验权重（>0）。
    只对 s.hand 中预算可负担的怪 + 空位产生先验 → 天然"考虑当前手牌"。"""
    front_x = 4 if s.side == 'p1' else 6
    back_x = 0 if s.side == 'p1' else 10
    prof = _deck_profile(s)
    main_race = prof['main_race']
    my = s.my
    priors: dict = {}

    # 残局库先验：精确状态优先，未命中再试镜像状态（镜像命中动作需翻回己方坐标，权重打折 0.7）
    eg = None  # (monsterId, x, y, weight)
    lib = _get_endgame_lib()
    if lib:
        eg = lib.get(_endgame_key(s))
        if eg is None:
            m = lib.get(_endgame_key_mirror(s))
            if m is not None:
                eg = (m[0], 10 - m[1], m[2], m[3] * 0.7)

    # 敌情针对性：行分布（我方怪与敌方怪同行的对位压制）
    en_row_count = Counter(e['y'] for e in s.enemy)
    en_back_rows = {e['y'] for e in s.enemy
                    if MON_META.get(e['dbId'], {}).get('role') in ('法师', '射手')
                    or MON_META.get(e['dbId'], {}).get('range', 2) >= 3}
    # 机制特化预计算（引擎技能规则 → 软先验）
    iron_cols = {m['x'] for m in s.my if m['dbId'] == 117}   # 己方铁甲所在列（冲锋配合投掷）
    canon_rows = {e['y'] for e in s.enemy if e['dbId'] == 107}  # 敌方咒法骑士所在行（钻头专处理）

    for db_id, (x, y) in s.legal_actions():
        meta = MON_META.get(db_id, {})
        role = meta.get('role', '战士')
        cost = meta.get('cost', 2)
        race = meta.get('race', '')
        w = 1.0
        dist_front = abs(x - front_x)
        dist_back = abs(x - back_x)

        # 1) 角色站位（权重最大）
        if role == '坦克':
            w *= 1.0 + 1.2 * (4 - dist_front)      # 必须贴前
            w *= 1.0 + 0.3 * (2 - abs(y - 2))      # 尽量居中覆盖全行
        elif role == '战士':
            w *= 1.0 + 0.9 * (4 - dist_front)
        elif role == '特殊' or db_id in RUSH_IDS:  # 冲锋/钻地/投掷怪
            w *= 1.0 + 0.7 * (4 - dist_front)
        else:                                      # 法师/射手
            w *= 1.0 + 0.85 * (4 - dist_back)      # 贴后保输出

        # 2) 相邻协同（技能/徽章多为相邻触发）
        near_any = _near(my, x, y) if my else False
        if race and my:
            same_race = [m for m in my if MON_META.get(m['dbId'], {}).get('race') == race]
            if same_race:
                w *= 2.4 if _near(same_race, x, y) else 1.3
        if db_id in SUPPORT_IDS:                   # 治疗/链接怪贴队友才生效
            w *= 1.8 if near_any else 0.6

        # 3) 费用：4 费核心优先（尤其卡组自带的 4 费核心）
        if cost >= 4:
            w *= 1.7
            if db_id in prof['four_cost']:
                w *= 1.4                          # 卡组核心卡

        # 4) 卡组画像 → "自己的卡组策略"
        if race and race == main_race:
            w *= 1.25                             # 主种族骨干
        if prof['prayer_style']:
            if near_any:
                w *= 1.3                         # 祈祷流：整体聚集
            if db_id in (103, 105):
                w *= 1.35                        # 链接/回血核心体系
        if prof['n_rush'] >= 3 and role in ('战士', '特殊'):
            w *= 1.25                             # 冲脸流：前排压制

        # 5) 聚集：贴已有怪（避免一盘散沙）
        if near_any:
            w *= 1.5

        # 6) 残局库：精确局面专家动作强引导（只加权不覆盖 → 整体仍是概率分布）
        if eg is not None and db_id == eg[0] and x == eg[1] and y == eg[2]:
            w *= 1.0 + 0.5 * min(eg[3], 8.0)     # count=1→1.5x，count≥8→5x（λ=0.7 下最大约 3x）

        # 7) 敌情针对性（对位压制，贴近引擎真实对线逻辑）
        melee = role in ('坦克', '战士') or db_id in RUSH_IDS
        if melee:
            w *= 1.0 + 0.12 * en_row_count.get(y, 0)   # 冲进敌方有怪的行
            if db_id in RUSH_IDS and y in en_back_rows:
                w *= 1.2                                # 突进怪直切敌方后排行
        else:
            w *= 1.0 + 0.25 * (1 if y in en_back_rows else 0)  # 射手贴敌方后排行输出

        # 8) 机制特化（引擎技能规则 → 软先验，引导网络从高质量对局中自学机制）
        if db_id == 106:                        # 冲锋哥：优先与己方铁甲同列（配合投掷），其次敌方怪多的行
            if iron_cols:
                w *= 1.4 if x in iron_cols else 0.85
            w *= 1.0 + 0.15 * en_row_count.get(y, 0)
        elif db_id == 116:                      # 钻头：优先对位敌方咒法骑士（dig 专处理咒法）
            w *= 1.6 if y in canon_rows else 1.0
        elif db_id == 117:                      # 铁甲猴：正后方紧邻格（同y）必须有友军可投 → 投掷范围伤害
            bx = x - 1 if s.side == 'p1' else x + 1
            has_ally = any(m['x'] == bx and m['y'] == y for m in s.my)
            w *= 1.6 if has_ally else 0.7
        elif db_id == 107:                      # 咒法骑士：开局扫一行 → 对位敌方怪多的行
            w *= 1.0 + 0.35 * en_row_count.get(y, 0)

        priors[(db_id, (x, y))] = w
    return priors


def _power(m) -> float:
    """简单战力：血量 + 攻速DPS + 射程 + 费用价值。"""
    meta = MON_META.get(m['dbId'], {})
    hp = meta.get('hp', 1000)
    atk = meta.get('atk', 50)
    ats = meta.get('ats', 1)
    rng = meta.get('range', 2)
    cost = meta.get('cost', 2)
    return hp / 100.0 + atk * ats / 10.0 + (rng - 1) * 8.0 + cost * 40.0


def script_value(s) -> float:
    """理性基线价值：己方视角棋盘评估，返回 [-1, 1]。
    战力差（我方 vs 敌方可视） + 站位结构（坦克贴前/远程贴后） + 相邻协同。"""
    import math
    my_pow = sum(_power(m) for m in s.my)
    en_pow = sum(_power(e) for e in s.enemy)
    base = math.tanh((my_pow - en_pow) / 400.0)
    front_x = 4 if s.side == 'p1' else 6
    back_x = 0 if s.side == 'p1' else 10
    struct = 0.0
    for m in s.my:
        meta = MON_META.get(m['dbId'], {})
        role = meta.get('role', '战士')
        if role == '坦克':
            struct += 0.10 if abs(m['x'] - front_x) <= 1 else -0.12
        elif role in ('法师', '射手'):
            struct += 0.05 if abs(m['x'] - back_x) <= 2 else -0.06
    for i in range(len(s.my)):
        for j in range(i + 1, len(s.my)):
            a, b = s.my[i], s.my[j]
            ra = MON_META.get(a['dbId'], {}).get('race', '')
            rb = MON_META.get(b['dbId'], {}).get('race', '')
            if ra and ra == rb and abs(a['x'] - b['x']) <= 1 and abs(a['y'] - b['y']) <= 1:
                struct += 0.04
    v = base + 0.6 * math.tanh(struct / 2.0)
    return max(-1.0, min(1.0, v))


# ======================================================================
# 局面/动作特征向量（经验库 ANN 相似局面匹配用，相对化 → 平移/镜像天然不变）
# ======================================================================
_ROLE_IDX = {'坦克': 0, '战士': 1, '射手': 2, '法师': 3, '特殊': 4}
_RUSH_IDS = {106, 116, 117, 119}
# 进攻形态核心（全冲）：铁甲 117 / 突突 114 / 咒法 107
_FULL_ATTACK_IDS = {117, 114, 107}


def _front_x(side: str) -> int:
    return 4 if side == 'p1' else 6


def _role_hist(units) -> list:
    """角色分布直方图（6 维，归一化）：坦克/战士/射手/法师/特殊/未知。"""
    h = [0.0] * 6
    for m in units:
        r = MON_META.get(m['dbId'], {}).get('role', '')
        h[_ROLE_IDX.get(r, 5)] += 1.0
    n = max(1, len(units))
    return [v / n for v in h]


def _col_hist(s, units) -> list:
    """己方半区列分布（5 维，归一化）：p1 取 x0-4，p2 取 x6-10 → col0-4。"""
    h = [0.0] * 5
    for m in units:
        c = m['x'] if s.side == 'p1' else m['x'] - 6
        h[max(0, min(4, c))] += 1.0
    n = max(1, len(units))
    return [v / n for v in h]


def state_feat(s) -> 'np.ndarray':
    """局面特征向量（ANN 检索）：布局分布（敌我行/列/角色）+ 我方站位结构 +
    手牌流派特征（4费核心/祷徒 105&103/进攻形态 117·114·107/冲脸）+ 卡组画像 +
    比分态势（比分差）+ 敌方阵容结构（近战/远程比、前线密度）。
    全部相对化 → 平移/镜像/y翻转后特征不变（近似）。"""
    import numpy as np
    my, en = s.my, s.enemy
    row_my = [0.0] * 5
    row_en = [0.0] * 5
    for m in my:
        row_my[m['y']] += 1.0
    for e in en:
        row_en[e['y']] += 1.0
    n_my, n_en = max(1, len(my)), max(1, len(en))
    front = _front_x(s.side)
    dist_avg = sum(abs(m['x'] - front) for m in my) / n_my if my else 2.0
    near = 0.0
    if my:
        near = sum(1 for m in my if any(abs(m['x'] - o['x']) <= 1 and abs(m['y'] - o['y']) <= 1
                                        for o in my if o is not m)) / n_my
    hand_hist = [0.0] * 6
    n_h = max(1, len(s.hand))
    for db in s.hand:
        r = MON_META.get(db, {}).get('role', '')
        hand_hist[_ROLE_IDX.get(r, 5)] += 1.0
    hand_hist = [v / n_h for v in hand_hist]
    deck_four = sum(1 for d in s.deck if MON_META.get(d, {}).get('cost', 2) >= 4)
    deck_rush = sum(1 for d in s.deck if d in _RUSH_IDS)
    pray = 1.0 if (105 in s.hand and 103 in s.hand) else 0.0
    full_attack = 1.0 if any(d in _FULL_ATTACK_IDS for d in s.hand) else 0.0
    # 比分态势（先到3胜 → 归一化 ±1）
    score_diff = float(s.score[0] - s.score[1]) / 3.0 if s.score else 0.0
    # 敌方阵容结构（角色直方图之外的显式形态特征）
    en_melee = sum(1 for e in en if MON_META.get(e['dbId'], {}).get('role') in ('坦克', '战士')) / n_en
    en_range = sum(1 for e in en if MON_META.get(e['dbId'], {}).get('role') in ('射手', '法师')) / n_en
    # 敌方前线密度：贴中线两列的敌方怪比例（近战压力）
    en_front_cols = {6, 7} if s.side == 'p1' else {3, 4}
    en_front = sum(1 for e in en if e['x'] in en_front_cols) / n_en
    return np.array([
        s.round / 5.0, s.budget / 16.0, len(my) / 8.0, len(en) / 8.0,
        *[v / n_en for v in row_en], *[v / n_my for v in row_my],
        *_col_hist(s, en), *_col_hist(s, my),
        *_role_hist(en), *_role_hist(my),
        dist_avg / 4.0, near,
        *hand_hist, len(s.hand) / 8.0, deck_four / 4.0, deck_rush / 4.0, pray, full_attack,
        score_diff, en_melee, en_range, en_front,
    ], dtype=np.float32)


def act_feat(s, db_id: int, x: int, y: int) -> 'np.ndarray':
    """动作相对特征（ANN 动作迁移用，5 维）：相对前线距离/行/贴队友/对位敌行/同种族相邻。"""
    import numpy as np
    dist_front = abs(x - _front_x(s.side)) / 4.0
    near = 1.0 if any(abs(m['x'] - x) <= 1 and abs(m['y'] - y) <= 1 for m in s.my) else 0.0
    en_row = sum(1 for e in s.enemy if e['y'] == y) / 8.0
    race = MON_META.get(db_id, {}).get('race', '')
    race_near = 0.0
    if race:
        race_near = min(1.0, sum(1 for m in s.my
                                 if MON_META.get(m['dbId'], {}).get('race') == race
                                 and abs(m['x'] - x) <= 1 and abs(m['y'] - y) <= 1) / 3.0)
    return np.array([dist_front, y / 4.0, near, en_row, race_near], dtype=np.float32)
