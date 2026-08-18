// ============================================================
// 规范对局轨迹（Canonical Game Trace）
//
// 用途：把「真实应用入口」（playFullGame）与「Tree Runner 沙盒入口」
// （playSpecVsSpec）各自的实际执行结果统一成同一组可比较的规范事件记录，
// 供 T031 独立真实入口 parity 门禁做全字段逐位比较。
//
// 本模块刻意不 import 任何 tree 代码（不引用 arena.ts / playSpecVsSpec /
// PersistentSimPool / fine_grained_worker），保证真实侧适配器的传递闭包干净。
// ============================================================

/** 分支选择事件：真实贪心入口不选择分支（greedy 规划器无树分支），
 *  Tree Runner 会记录经 patchBranchSelection 选中的分支节点。 */
export interface CanonicalBranch {
  round: number;
  /** 选中的分支/节点 id（空数组表示该入口未做分支选择） */
  chosenNodeId: string;
}

/** 回合观察（雾战）事件：对手前 4 手牌 + 场上已揭晓怪 */
export interface CanonicalObservation {
  round: number;
  side: 1 | 2;
  handIds: number[];
  handBadges: number[];
  boardIds: number[];
}

/** 单次部署事件（含计划/实际/接受拒绝/预算） */
export interface CanonicalDeployment {
  round: number;
  /** 该怪兽实际落在棋盘上的侧（1=p1 / 2=p2） */
  side: 1 | 2;
  /** 源阵容实际所在侧（与请求 side 一致，证明 side 到达执行输入） */
  sourceSide: 1 | 2;
  monsterId: number;
  attemptOrder: number;
  plannedX: number;
  plannedY: number;
  actualX?: number;
  actualY?: number;
  accepted: boolean;
  rejectionReason?: string;
  budgetBefore: number;
  costCharged: number;
  budgetAfter: number;
}

/** 一场对局的完整规范轨迹 */
export interface CanonicalGameTrace {
  sourceId: string;
  sourceName: string;
  opponentId: string;
  opponentName: string;
  /** 源阵容请求侧（1=p1 先手 / 2=p2 后手） */
  side: 1 | 2;
  seed: number;
  /** 最终结果（源视角） */
  finalW: number;
  finalD: number;
  finalL: number;
  /** 每回合比分（源视角：1 胜 / 0 平 / -1 负） */
  roundScores: number[];
  branches: CanonicalBranch[];
  observations: CanonicalObservation[];
  deployments: CanonicalDeployment[];
}

/**
 * 明确列为「纯展示、排除在比较之外」的字段（presentation-only excluded fields）：
 * - `elapsedMs`（MatchResult / PlayResult）：墙钟计时，非游戏语义；
 * - `summary`（PlayResult）：人读字符串，由 w/d/l 冗余派生；
 * - 分支 `branchLabels` / 树节点 `label` / `comment`：展示标签与注释，不影响执行分支 id；
 * - vfx 粒子、棋盘渲染状态、replay 记录等 UI 状态。
 * 除上述外，side/阵型身份、分支、观察、计划/实际坐标、尝试序、接受/拒绝+原因、
 * 预算前/扣费/后、回合分、最终 W/D/L 全部参与比较。
 */
export const EXCLUDED_PRESENTATION_ONLY_FIELDS = [
  'elapsedMs',
  'summary',
  'branchLabels',
  'label',
  'comment',
  'vfx',
] as const;

// ---------- 确定性序列化 ----------

function stableJson(v: unknown): string {
  if (v === undefined) return 'null'; // 缺省可选字段序列化为合法 JSON null（比较语义一致）
  if (typeof v !== 'object' || v === null) return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(',')}}`;
}

/** 序列化整条规范轨迹（确定性，用于完整比对与报告） */
export function serializeCanonicalTrace(t: CanonicalGameTrace): string {
  return stableJson({
    sourceId: t.sourceId,
    sourceName: t.sourceName,
    opponentId: t.opponentId,
    opponentName: t.opponentName,
    side: t.side,
    seed: t.seed,
    finalW: t.finalW,
    finalD: t.finalD,
    finalL: t.finalL,
    roundScores: t.roundScores,
    branches: t.branches,
    observations: t.observations,
    deployments: t.deployments,
  });
}

// ---------- 首字段差异诊断 ----------

export interface CanonicalMismatch {
  /** 首个不一致的字段路径，如 `deployments[0].monsterId`、`branches` */
  field: string;
  realValue: string;
  treeValue: string;
}

const SCALAR_FIELDS: { key: keyof CanonicalGameTrace; label: string }[] = [
  { key: 'sourceId', label: 'sourceId' },
  { key: 'sourceName', label: 'sourceName' },
  { key: 'opponentId', label: 'opponentId' },
  { key: 'opponentName', label: 'opponentName' },
  { key: 'side', label: 'side' },
  { key: 'seed', label: 'seed' },
  { key: 'finalW', label: 'finalW' },
  { key: 'finalD', label: 'finalD' },
  { key: 'finalL', label: 'finalL' },
];

/**
 * 全字段顺序比较：先身份标量，再回合分、分支、观察、部署事件。
 * 返回首个不一致字段的路径与两侧 JSON 值；完全一致则 identical=true。
 * 绝不把相等布尔置为常量——每个字段都来自真实比较。
 */
export function compareCanonicalTraces(
  real: CanonicalGameTrace,
  tree: CanonicalGameTrace,
): { identical: boolean; firstMismatch?: CanonicalMismatch } {
  for (const f of SCALAR_FIELDS) {
    const rv = real[f.key];
    const tv = tree[f.key];
    if (stableJson(rv) !== stableJson(tv)) {
      return { identical: false, firstMismatch: { field: f.label, realValue: stableJson(rv), treeValue: stableJson(tv) } };
    }
  }

  // 回合分
  const rs = compareNumberArray('roundScores', real.roundScores, tree.roundScores);
  if (rs) return { identical: false, firstMismatch: rs };

  // 分支
  const br = compareBranchArray(real.branches, tree.branches);
  if (br) return { identical: false, firstMismatch: br };

  // 观察
  const ob = compareObservationArray(real.observations, tree.observations);
  if (ob) return { identical: false, firstMismatch: ob };

  // 部署事件
  const de = compareDeploymentArray(real.deployments, tree.deployments);
  if (de) return { identical: false, firstMismatch: de };

  return { identical: true };
}

function compareNumberArray(label: string, a: number[], b: number[]): CanonicalMismatch | null {
  if (a.length !== b.length) {
    return { field: label, realValue: stableJson(a), treeValue: stableJson(b) };
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return { field: `${label}[${i}]`, realValue: String(a[i]), treeValue: String(b[i]) };
    }
  }
  return null;
}

function compareBranchArray(a: CanonicalBranch[], b: CanonicalBranch[]): CanonicalMismatch | null {
  if (a.length !== b.length) {
    return { field: 'branches', realValue: stableJson(a), treeValue: stableJson(b) };
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i].round !== b[i].round || a[i].chosenNodeId !== b[i].chosenNodeId) {
      return { field: `branches[${i}]`, realValue: stableJson(a[i]), treeValue: stableJson(b[i]) };
    }
  }
  return null;
}

function compareObservationArray(a: CanonicalObservation[], b: CanonicalObservation[]): CanonicalMismatch | null {
  if (a.length !== b.length) {
    return { field: 'observations', realValue: stableJson(a), treeValue: stableJson(b) };
  }
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.round !== y.round || x.side !== y.side ||
      stableJson(x.handIds) !== stableJson(y.handIds) ||
      stableJson(x.handBadges) !== stableJson(y.handBadges) ||
      stableJson(x.boardIds) !== stableJson(y.boardIds)
    ) {
      return { field: `observations[${i}]`, realValue: stableJson(x), treeValue: stableJson(y) };
    }
  }
  return null;
}

function compareDeploymentArray(a: CanonicalDeployment[], b: CanonicalDeployment[]): CanonicalMismatch | null {
  if (a.length !== b.length) {
    return { field: 'deployments', realValue: stableJson(a), treeValue: stableJson(b) };
  }
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    const keys: { k: keyof CanonicalDeployment; label: string }[] = [
      { k: 'round', label: 'round' },
      { k: 'side', label: 'side' },
      { k: 'sourceSide', label: 'sourceSide' },
      { k: 'monsterId', label: 'monsterId' },
      { k: 'attemptOrder', label: 'attemptOrder' },
      { k: 'plannedX', label: 'plannedX' },
      { k: 'plannedY', label: 'plannedY' },
      { k: 'actualX', label: 'actualX' },
      { k: 'actualY', label: 'actualY' },
      { k: 'accepted', label: 'accepted' },
      { k: 'rejectionReason', label: 'rejectionReason' },
      { k: 'budgetBefore', label: 'budgetBefore' },
      { k: 'costCharged', label: 'costCharged' },
      { k: 'budgetAfter', label: 'budgetAfter' },
    ];
    for (const { k, label } of keys) {
      if (stableJson(x[k]) !== stableJson(y[k])) {
        return { field: `deployments[${i}].${label}`, realValue: stableJson(x[k]), treeValue: stableJson(y[k]) };
      }
    }
  }
  return null;
}
