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

# ---------- 卡组树（bundle 阵型树，先学自身布阵策略的核心依据） ----------
# formations（bridge 返回，含 tree）→ 按"卡组 dbId 签名"索引：
#   _TREE_BY_DECK[tuple(sorted(deck_dbids))] = 根树节点
# 树坐标为 AI 侧（p2，x 6-10）视角，p1 侧使用时镜像 x'=10-x。
_TREE_BY_DECK: dict = {}
_TREE_LOADED = False
# 7 套已知阵型卡组（L1_free 自由卡组规则随机用：从已知阵型随机选一套）
FORMATION_DECKS: list = None


def init_formations(formations: list) -> None:
    """从 bridge formations 响应加载卡组树（含 tree 字段）与已知卡组列表。"""
    global _TREE_BY_DECK, _TREE_LOADED, FORMATION_DECKS
    _TREE_BY_DECK = {}
    FORMATION_DECKS = []
    for f in formations:
        team_ids = tuple(sorted(s['monsterId'] for s in f.get('team', []) if s.get('monsterId', 0) > 0))
        if f.get('tree') is not None:
            _TREE_BY_DECK[team_ids] = f['tree']
        deck = {s['monsterId']: s['badgeIds'] for s in f.get('team', []) if s.get('monsterId', 0) > 0}
        if deck:
            FORMATION_DECKS.append(deck)
    _TREE_LOADED = True


def _tree_for_deck(deck: list) -> dict | None:
    """按卡组 dbId 列表匹配树（签名 = 排序后元组）。"""
    if not _TREE_LOADED or not deck:
        return None
    return _TREE_BY_DECK.get(tuple(sorted(deck)))


def tree_plan_for(deck: list, round_: int) -> list:
    """卡组树在指定回合的计划动作（主分支优先：DFS 先命中第一个含放置的子节点）。
    返回 [{monsterId, x, y}]，坐标 = AI 侧（p2）视角；调用方按 side 镜像。
    与 TS features.ts planForRound 语义一致。"""
    root = _tree_for_deck(deck)
    if root is None:
        return []
    stack = [root]
    while stack:
        node = stack.pop(0)
        if node.get('round') == round_ and node.get('placement'):
            return [{'monsterId': p['monsterId'], 'x': p['x'], 'y': p['y']}
                    for p in node['placement']]
        stack.extend(node.get('children', []))
    return []

# 突进/钻地类：冲最前才能发挥价值
RUSH_IDS = {106, 116, 117, 119}
# 治疗/链接类：必须贴队友才生效（学徒生命链接/祈祷回血连线/守卫治疗剑）
SUPPORT_IDS = {103, 105, 112}

# ---------- 徽章/怪兽协同常量（用户深度理解的隐性连接） ----------
EMPIRE = 110      # 帝国之盾：开局给上下左右相邻友方护盾
PRAYER = 105      # 祈祷：连线周围 8 格友方回血
APPRENTICE = 103  # 学徒：生命链接分摊
SUQING = 101      # 肃清：自带流血（凋零核心载体）
SANZHEN = 124     # 三振王：寒冷减速（凋零元素来源）
SHANJI = 109      # 银狙骑士：礼物载体（高攻击，死后给核心 +90 攻）
DRILL = 116       # 钻头：定点破盾/阻断咒法
IRON = 117        # 铁甲猴：投掷后方友方，伤害看盾值
SERI = 118        # 塞雷：突进切祷徒密集
CANON = 107       # 咒法骑士：整行越远伤害越高
RUSH = 106        # 冲锋哥：巫毒冲锋吸火力
SANDAN = 104      # 散弹：燃烧（凋零元素来源，接力献祭者）
TUTU = 114        # 突突：定点破盾

WITHER = 2        # 凋零：每层负面效果 +40% 普攻伤害
ELEMENT = 4       # 元素涌动：施加燃烧/寒冷
POISON = 25       # 中毒
SACRIFICE = 27    # 献祭：周围燃烧
RELAY = 35        # 接力：死亡把第一个徽章给最近友方（需相y邻）
GIFT = 33         # 礼物：死亡给最近友方 30% 攻击
VOODOO = 32       # 巫毒：前 10 秒免疫死亡，吸火力
PREVENT = 11      # 预防：开局 12 盾
REINFORCE = 28    # 加固：+50% 盾
FORMATION_DEF = 12  # 结阵守：相邻加盾
REACTIVE = 30     # 反应装甲：盾反伤
BREAK_SHIELD = 3  # 破盾
# 盾流徽章（提升盾值，配合铁甲投掷/塞雷突进/盾炮）
SHIELD_BADGES = {PREVENT, REINFORCE, FORMATION_DEF, REACTIVE}
# 凋零元素来源（怪兽或徽章带来的负面效果）
ELEMENT_SRC_BADGES = {ELEMENT, POISON, SACRIFICE}
ELEMENT_SRC_MONSTERS = {SUQING, SANZHEN, SANDAN, 126}

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


def _badges_of(s, db_id: int) -> list:
    """手牌/卡组中某怪兽携带的徽章列表（己方）。"""
    return s.deck_badges.get(db_id, [])


def _unit_badges(s, m) -> list:
    """场上某己方怪携带的徽章列表（优先自身 badgeIds，缺失回退卡组映射）。"""
    return m.get('badgeIds') or s.deck_badges.get(m['dbId'], [])


def _n8(my, x: int, y: int) -> int:
    """周围 8 格（Chebyshev 距离 1）友方数量。"""
    return sum(1 for m in my if abs(m['x'] - x) <= 1 and abs(m['y'] - y) <= 1)


def _n4(my, x: int, y: int) -> int:
    """正交上下左右相邻友方数量（帝国盾/结阵守的相邻判定）。"""
    return sum(1 for m in my if abs(m['x'] - x) + abs(m['y'] - y) == 1)


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


def heuristic_prior(s, self_ratio: float = 0.6) -> dict:
    """对每个合法动作 (db_id, (x, y)) 返回先验权重（>0）。
    只对 s.hand 中预算可负担的怪 + 空位产生先验 → 天然"考虑当前手牌"。
    self_ratio：本回合"基于自身卡组设计" vs "基于对方卡组调整"的比重（0~1）。
    人类经验：前 2-3 回合以自身卡组设计为主（self_ratio 高），
    后 2 回合以对方卡组针对性调整为主（self_ratio 低）；不同卡组依赖度不同。
    该数值是训练指标，可由训练过程学习优化（见 mcts.py / train.py）。"""
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

    # 卡组树先验（先学自身布阵策略的核心）：当前回合树计划动作强加权（×3）。
    # 树坐标为 AI 侧（p2）视角，镜像到查询侧；这是 bundle 人工验证过的"正确摆法"，
    # 让 MCTS 冷启动直接倾向树动作（如肃清 R1 = 三振+帝国），而非被通用启发式带偏。
    tree_plan = tree_plan_for(s.deck, s.round)
    if s.side == 'p1':
        tree_plan = [{'monsterId': p['monsterId'], 'x': 10 - p['x'], 'y': p['y']} for p in tree_plan]
    tree_set = {(p['monsterId'], (p['x'], p['y'])) for p in tree_plan}

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
        badges = set(_badges_of(s, db_id))
        w = 1.0
        dist_front = abs(x - front_x)
        dist_back = abs(x - back_x)

        # 0) 卡组树先验（基于自身卡组设计）：树计划动作强加权 ×3，
        #    权重受 self_ratio 调节——self_ratio 高（前回合）树主导，低（后回合）让位给敌情。
        if (db_id, (x, y)) in tree_set:
            w *= 1.0 + 2.0 * self_ratio
        elif tree_plan:
            w *= 0.5 + 0.3 * (1.0 - self_ratio)   # 本回合树有计划时，非树动作降权（程度随 self_ratio）

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

        # 7) 敌情针对性（基于对方卡组调整，权重受 (1-self_ratio) 调节——
        #    self_ratio 低（后回合）敌情主导，高（前回合）弱化，符合人类"前自身后对方"打法）
        melee = role in ('坦克', '战士') or db_id in RUSH_IDS
        if melee:
            w *= 1.0 + 0.12 * en_row_count.get(y, 0) * (1.0 - self_ratio) * 2.5   # 冲进敌方有怪的行
            if db_id in RUSH_IDS and y in en_back_rows:
                w *= 1.0 + 0.2 * (1.0 - self_ratio) * 2.5                          # 突进怪直切敌方后排行
        else:
            w *= 1.0 + 0.25 * (1 if y in en_back_rows else 0) * (1.0 - self_ratio) * 2.5  # 射手贴敌方后排行输出

        # 8) 机制特化（引擎技能规则 → 软先验，引导网络从高质量对局中自学机制；
        #    对位/反制类权重同样受 (1-self_ratio) 调节）
        if db_id == 106:                        # 冲锋哥：优先与己方铁甲同列（配合投掷），其次敌方怪多的行
            if iron_cols:
                w *= 1.4 if x in iron_cols else 0.85
            w *= 1.0 + 0.15 * en_row_count.get(y, 0) * (1.0 - self_ratio) * 2.5
        elif db_id == 116:                      # 钻头：优先对位敌方咒法骑士（dig 专处理咒法）
            w *= 1.0 + 0.6 * (1.0 - self_ratio) if y in canon_rows else 1.0
        elif db_id == 117:                      # 铁甲猴：正后方紧邻格（同y）必须有友军可投 → 投掷范围伤害
            bx = x - 1 if s.side == 'p1' else x + 1
            has_ally = any(m['x'] == bx and m['y'] == y for m in s.my)
            w *= 1.6 if has_ally else 0.7
        elif db_id == 107:                      # 咒法骑士：开局扫一行 → 对位敌方怪多的行
            w *= 1.0 + 0.35 * en_row_count.get(y, 0) * (1.0 - self_ratio) * 2.5

        # 9) 徽章协同（用户深度理解的隐性连接：祈祷连线/帝国盾相邻/凋零配元素/接力相邻/巫毒吸火/盾流）
        n8 = _n8(my, x, y)
        n4 = _n4(my, x, y)
        # 9.1 祈祷(105)：连接周围 8 格回血，放人堆中心收益最大；其余单位贴祈祷被连线
        if db_id == PRAYER:
            w *= 1.0 + 0.35 * n8
        elif my and any(m['dbId'] == PRAYER and abs(m['x'] - x) <= 1 and abs(m['y'] - y) <= 1 for m in my):
            w *= 1.4                                # 贴已有祈祷 → 被连线回血
        # 9.2 帝国之盾(110)：开局给上下左右相邻友方盾 → 重点防御怪（核心/后排）贴帝国边
        if db_id == EMPIRE:
            w *= 1.0 + 0.30 * n4                    # 帝国盾相邻友方越多越赚
        elif my and any(m['dbId'] == EMPIRE for m in my):
            if any(m['dbId'] == EMPIRE and abs(m['x'] - x) + abs(m['y'] - y) == 1 for m in my):
                is_carry = role in ('射手', '法师') or cost >= 4
                w *= 2.5 if is_carry else 2.0       # 核心贴帝国边吃盾（上调：帝国盾需正交相邻，协同最易漏学）
        # 9.3 凋零(2)：伤害随负面效果数量放大 → 搭配元素来源（肃清/三振王/散弹/中毒/献祭）
        if WITHER in badges:
            elem_avail = bool(badges & ELEMENT_SRC_BADGES) or any(d in ELEMENT_SRC_MONSTERS for d in s.deck)
            if elem_avail:
                w *= 1.5
            if db_id == SUQING:
                w *= 1.5                            # 肃清自带流血，天然配凋零
        # 9.4 接力(35)：死亡把首个徽章给最近友方 → 必须相邻专门对象（核心/祈祷/学徒）
        if RELAY in badges:
            adj_target = any(m for m in my if (MON_META.get(m['dbId'], {}).get('cost', 2) >= 4
                                              or m['dbId'] in (PRAYER, APPRENTICE))
                             and abs(m['x'] - x) <= 1 and abs(m['y'] - y) <= 1)
            if adj_target:
                w *= 1.8
        # 9.5 礼物(33)：死亡给最近友方 30% 攻击 → 银狙/炸弹载体贴核心
        if GIFT in badges:
            adj_core = any(m for m in my if MON_META.get(m['dbId'], {}).get('cost', 2) >= 4
                           and abs(m['x'] - x) <= 1 and abs(m['y'] - y) <= 1)
            if adj_core:
                w *= 1.7
        # 9.6 巫毒(32)：前10秒免疫死亡吸火力 → 尽量放前（冲锋/钻头尤甚）
        if VOODOO in badges:
            w *= 1.0 + 0.6 * (4 - dist_front)
        # 9.7 盾流：铁甲(117)/塞雷(118) 需盾徽章；结阵守需相邻；破盾针对帝国
        if db_id in (IRON, SERI) and (badges & SHIELD_BADGES):
            w *= 1.5
        if FORMATION_DEF in badges:
            w *= 1.0 + 0.3 * n4
        if BREAK_SHIELD in badges and db_id in (DRILL, TUTU):
            if any(e['dbId'] == EMPIRE for e in s.enemy):
                w *= 1.4                            # 破盾针对敌方帝国之盾

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
    战力差（我方 vs 敌方可视） + 站位结构（坦克贴前/远程贴后） + 相邻协同 + 徽章协同。"""
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

    # ---- 徽章协同价值（用户深度理解的隐性连接）----
    syn = 0.0
    deck_elem = any(d in ELEMENT_SRC_MONSTERS for d in s.deck)
    for m in s.my:
        b = set(_unit_badges(s, m))
        if m['dbId'] == PRAYER:
            syn += 0.12 * _n8(s.my, m['x'], m['y']) / 8.0          # 祈祷 8 格连线回血
        if m['dbId'] == EMPIRE:
            adj_friends = sum(1 for o in s.my if o is not m
                              and abs(o['x'] - m['x']) + abs(o['y'] - m['y']) == 1)
            syn += 0.12 * adj_friends                            # 帝国盾给所有正交相邻友方护盾
        if VOODOO in b and abs(m['x'] - front_x) <= 1:
            syn += 0.08                                          # 巫毒前排吸火力
        if WITHER in b and deck_elem:
            syn += 0.10                                          # 凋零配元素来源
        if (RELAY in b or GIFT in b) and any(o is not m
                                             and MON_META.get(o['dbId'], {}).get('cost', 2) >= 4
                                             and abs(o['x'] - m['x']) <= 1 and abs(o['y'] - m['y']) <= 1
                                             for o in s.my):
            syn += 0.10                                          # 接力/礼物贴核心
        if m['dbId'] in (IRON, SERI) and (b & SHIELD_BADGES):
            syn += 0.10                                          # 盾流徽章配铁甲/塞雷

    v = base + 0.6 * math.tanh(struct / 2.0) + 0.4 * math.tanh(syn)
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
