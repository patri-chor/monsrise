STATUS: OPEN

# T004 — 树优化器：首次分支观察与精确触发验收

> 决策方 → 执行方。
> 前置：T003 已完成并提交 `1e1645d`。本任务不是重做 T003，而是补齐其在真实线性树首次归纳时尚未被端到端证明的观察路径。

## 目标

确保树仍是线性主链、尚未有任何条件分支时，优化器也能在每个回合采集候选侧实际看见的对手信息；确保某 mask 的“命中”严格按拟分叉 `forkRound` 与候选 side 判断，而非“任意回合曾匹配”。

## 已确认的遗漏

1. `T003` 的 `sampleFromTrace` 依赖 `BranchDecision`。
   `BranchDecision` 当前由 `patchBranchSelection` 的 `selectBranch` 触发；线性树在首次归纳前没有多 child 分支可选择，因此可能不会产生该事件，导致 `initialTraces` 的 R1-R5 全部无有效样本，`bestOverall` 为 null。

2. `oppMatchesObserved` 遍历该对手的所有回合/所有 side，只要任意一次命中即返回 true；但新分支只会在 `forkRound` 首次选择，故 R3 才出现的 key 不应使 R1 分支被评估为“可触发”。

3. `effectiveOpps = matchedOpps.length > 0 ? matchedOpps : candidateOpps` 在没有实际命中时回退静态全卡组候选，重新引入 T003 要消除的“运行时不可见信息”风险。

4. `computeTreeFingerprint` 对 `node.condition.subs` / `keys` 直接调用 `.sort()`，会原地改写树内数组。即使当前匹配多为集合语义，纯 fingerprint 函数不应产生副作用。

5. T003 给 `replaceKey`/`moveKey` 增加了可选 `treeFp`，但 `focused_climb.ts` 仍按旧签名调用，共享经验库仍会跨树误复用无效操作。

## 范围

允许修改：
- `src/engine/tree/arena.ts`
- `src/engine/tree/branch_induct.ts`
- `src/engine/tree/search_experience.ts`
- `src/engine/tree/focused_climb.ts`
- `tests/branch_induct_evaluation.test.ts` 或新增对应测试

禁止修改：
- `public/ai-bundle.iife.js` 及对战 ai 源码
- `FORMATION_LIBRARY` 数据
- `cycle_optimize.ts`、`apply_optimized.ts`、`tree_ops.ts` 算子语义
- T002 变体数据集、全量矩阵、轮回优化、部署

## 决定方案

### A. 将“观察”与“分支选择”解耦

1. 在 `arena.ts` 定义或扩展一个明确的 observation 回调类型，字段至少为：
   - `round`
   - `side`（候选侧）
   - `handIds`
   - `handBadges`
   - `boardIds`
2. 在 `bundleRoundPlanFor` 中，**每个有效 hand 的回合都在调用 `decideWithFormation` 前**发出一次 observation；不可依赖 `selectBranch` 是否被调用。
3. `playSpecVsSpec` 为 A 侧收集每回合 observation，并将其随结果传回。保留现有 `BranchDecision`，不要破坏已有调用方；允许 MatchTrace 同时保存 observations 与分支实际选择记录。
4. `branch_induct.ts` 的初始样本与崩盘诊断必须从 observations 生成，不能以 `BranchDecision` 缺失作为跳过理由。
5. 对局提前结束才允许该回合无样本；`roundScores` 为 0 是平局，不是缺失。

### B. 以精确回合/侧判断实际命中

1. 新增或重构观察匹配函数，输入 `(mask, forkRound, side, trace)`。
2. 非 side mask：只使用 `trace.observations.get(forkRound)` 的可见特征，并用 `matchMask(mask, rec, trace.side)` 判断。
3. side mask：只在 `trace.side === mask.side` 且该 `forkRound` 有 observation 时命中。
4. `effectiveOpps` 不得回退到静态全卡组 `candidateOpps`。若实际 `forkRound` 无任何命中，记录原因并拒绝建分支/返回 null。
5. 静态特征只可用于日志中的候选解释，不可进入采纳、评估或触发覆盖率计算。
6. 输出 `searchValidation` 时增加：
   - `forkRound`
   - 实际触发覆盖：按 opponent + side 的命中数 / 有观察样本数
   - 未触发原因计数（对局提前结束、无 hand、mask 不匹配）

### C. 修复指纹和共享经验库

1. `computeTreeFingerprint` 不得改变输入。排序必须对副本执行：`[...array].sort()`。
2. `focused_climb.ts` 每轮生成当前 `treeFp`，调用 `replaceKey`/`moveKey` 时必须传入该值。
3. 保持旧经验库文件可读；旧无 fingerprint 的条目不能拦截新 fingerprint key。

## 验收标准

1. 线性树（root 至少只有一条主链、没有条件 child）的真实或 mock 对局：R1-R5 中已打回合均可产生 observation/sample，不依赖任何 `selectBranch` 调用。
2. 单元测试断言：R3 才可见的关键怪不能让 R1 mask 计为命中；同一怪在 R3 的 `forkRound=3` 才可命中。
3. 无实际观测命中时 `optimizeFormation` 不得回退到完整卡组候选；必须不建分支/返回 null，并输出可识别原因。
4. `computeTreeFingerprint` 前后，输入树的 `subs` 与 `keys` 数组顺序和值完全不变。
5. 相同操作在不同 tree fingerprint 下：
   - `branch_induct` 与 `focused_climb` 都不应被旧经验库 key 跳过；
   - 相同 fingerprint 下仍应命中经验库。
6. 扩展后的 `playSpecVsSpec`、`BranchDecision` 现有调用方编译并正常运行；T003 原有四个测试仍通过。
7. `npx tsc --noEmit`：本次改动文件无新增错误；记录既有错误但不要顺手修复。

## 不要求

- 不要求运行完整 `cycle_optimize`。
- 不要求重新生成胜率表。
- 不要求证明某个具体阵型已提升；本任务只保证优化器采样、触发与验收的语义正确。

## 交付

写 `DECISIONS/T004.report.md`：完成内容、文件清单、测试命令与摘要、观察覆盖样例、遗留问题。