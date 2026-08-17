STATUS: OPEN

# T003 — 树决策优化器：评估口径对齐与搜索成本收敛

> 决策方 → Antigravity 落地方。
> 本任务来自树决策代码审查。目标是消除“优化器看到的信息多于运行时”与“小样本重复挑优”问题，并降低 R1-R5 重复模拟成本。

## 目标

让分支归纳和候选搜索使用与实际运行一致的对手可见特征，并在不改变当前树算子语义的前提下复用同一局五回合结果，减少重复模拟。

## 不在范围

- 不修改 `public/ai-bundle.iife.js`，不改 bundle 源码，不做编译同步。
- 不修改 `src/engine/tree/cycle_optimize.ts` 的门槛策略。
- 不修改 `src/engine/tree/tree_ops.ts` 的算子规则；除非为缓存/指纹增加纯辅助函数且不改变算子结果。
- 不运行 `cycle_optimize`、`apply_optimized`、全量胜率矩阵或部署。
- 不修改 `FORMATION_LIBRARY` 数据，不同步对战 ai 仓库的 formation library。
- 不处理 T002 的变体数据集任务。

## 当前问题与证据

1. `branch_induct.ts:95` 和 `:186` 使用：
   `boardIds: new Set(targetIds)`。
   这把对手整个卡组当作已知场上特征；实际 `arena.ts:154-164` 只用前四张手牌、手牌徽章和 `gameState.players.p1.deployed`。因此优化器可能为运行时 R1 无法触发的条件建立分支。

2. `branch_induct.ts:400-413` 对每个 R1-R5 重新调用 `collectSamples`，同一对手/侧/种子对局被重复播放；诊断阶段又重复播放。单局结果已有 `roundScores`，可以一次播放后派生五个回合样本。

3. `branch_induct.ts:258-348` 用同一批样本搜索和验收，且候选只要 `undefeated > bestRate` 即被采纳，存在小样本过拟合。

4. `search_experience.ts` 的 key 没有树结构版本；某操作在当前树因祖先重复或碰撞无效，后续树形变化后仍可能被永久跳过。

## 推荐方案（必须按此落地）

### A. 运行时可见特征采样

修改 `src/engine/tree/branch_induct.ts`：

1. 新增一次性轨迹采样结构，至少包含：
   - `seed`
   - `side`
   - `roundScores`
   - 每个实际作出决策回合的 `BranchDecision`：`round`、`handIds`、`handBadges`、`boardIds`
2. `collectSamples` 不再用完整 `targetIds` 构造识别标签。
3. 对 `focusRound`，使用该局在该回合实际观察到的 `BranchDecision` 特征：
   - `handIds = new Set(decision.handIds)`
   - `handBadges = new Set(decision.handBadges)`
   - `boardIds = new Set(decision.boardIds)`
   - 调用现有 `recognizeArchetype`。
4. 若该回合没有 `BranchDecision` 或对局在该回合前结束，样本不计入；不能回退到全卡组特征。
5. `oppMatches` 不能继续仅用全卡组静态标签作为唯一命中依据。至少提供基于实际采样轨迹的 `observedMatches`，用于分支候选评估/诊断；若实现复杂，先将“静态全卡组匹配”降级为候选预筛选，再用实际轨迹确认最终命中集合。
6. 必须保持 side 语义：side 分支只在对应候选侧评估；标签分支分别覆盖先手和后手。

### B. 一局结果复用

修改 `src/engine/tree/branch_induct.ts`：

1. 对每个 `(candidate, opponent, side, seed)` 只调用一次 `playSpecVsSpec`。
2. 保存该局完整 `roundScores` 与决策轨迹。
3. 从缓存轨迹分别生成 R1-R5 的 `Sample[]`，替代当前每个 round 重打对局。
4. 崩盘诊断复用同一缓存，不再次调用 `playSpecVsSpec`。
5. 缓存 key 必须包含候选树指纹；候选发生替换/移动后不能错误复用旧树的结果。
6. 同一优化调用内，候选评估缓存 key 至少包含：
   - tree fingerprint
   - mask
   - opponent id
   - side
   - seed
   - bundle/评估版本标识

### C. 搜索集/验证集分离

修改 `branch_induct.ts`，不改变默认 CLI 参数含义，但增加可复现的种子策略：

1. 搜索候选使用 `searchSeedBase`；最终采纳验证使用不同的 `validationSeedBase`。
2. 同一个候选不得用搜索种子结果直接作为最终采纳依据。
3. 默认验证必须满足：
   - 验证样本非空；
   - `after.undefeated > before.undefeated + 0.05`，或提供等价的显式最低改善阈值；
   - 验证集没有比基线多输超过允许容差。
4. 输出中记录搜索集与验证集的 seed base、局数、命中对手集合和触发决策数。
5. 现有 `before`/`after` JSON 字段保持兼容；可以新增 `searchValidation` 字段。

### D. 经验库结构版本隔离

修改 `src/engine/tree/search_experience.ts` 和调用处：

1. 不得再让结构相关无效 key 跨任意树形永久复用。
2. 推荐给 key 加入 `treeFingerprint` 或 `structureVersion`。
3. 若无法实现稳定指纹，则只跨轮次持久化与树结构无关的绝对无效项；跨回合重复/坐标碰撞等依赖树结构的错误只保留在当前进程。
4. 旧格式 `reports/search_experience.json` 必须能安全读取：旧条目应视为过期或迁移为当前版本，不能导致异常退出。
5. 保持已有 `replaceKey`/`moveKey` 调用方可用，或提供兼容迁移函数。

## 方案权衡

### 方案 A（推荐，本任务）
实际决策轨迹 + 单局五回合缓存 + 独立验证种子 + 经验库版本隔离。

- 优点：直接解决评估与运行时语义不一致，且收益可验证。
- 缺点：改动 `branch_induct.ts` 较多，需要新增轨迹类型和缓存。

### 方案 B
只把 `boardIds` 从全卡组改为空集或前四手牌，不记录真实决策轨迹。

- 优点：改动小。
- 缺点：仍无法表示 R2-R5 已部署信息；会丢失实际运行时可见特征，不推荐。

### 方案 C
只增加最终全局矩阵验收，不改采样与缓存。

- 优点：风险最低。
- 缺点：掩盖“优化分支运行时不触发”和大量重复模拟，不能作为本任务完成方案。

## 验收标准

### 必测回归

1. `npx tsc --noEmit`：本次修改文件不得新增错误；已知其他文件错误记录在 report，不要顺手修复。
2. `branch_induct.ts` 可被导入，原有 `optimizeFormation` 返回字段仍兼容 `optimize_one.ts`。
3. 现有树算子结构验证仍通过；至少测试：跨回合重复、四费 R4/R5、坐标碰撞、特殊怪位置跳过。
4. `search_experience.json` 旧格式存在或损坏时，加载不崩溃；旧条目不会无条件污染新树搜索。

### 行为验收

5. 新增测试或诊断脚本证明：一个只存在于对手完整卡组、但尚未在前四手牌/实际部署中的关键怪，不会在对应回合被记录为已观测特征。
6. 同一 `(candidate, opponent, side, seed)` 的 R1-R5 采样只产生一次 `playSpecVsSpec` 调用。可用 mock/counter 断言，不要求运行完整对战。
7. 搜索集与验证集 seed 不同；日志/JSON 可见两组 seed 配置。
8. 候选只在验证集达到最低改善门槛时标记 `improved=true`。
9. 经验库 key 含结构版本或等价 fingerprint；树结构变化后同一个操作不会被旧无效记录静默跳过。

### 产物

- 源码改动集中在：
  - `src/engine/tree/branch_induct.ts`
  - `src/engine/tree/search_experience.ts`
  - 必要时新增单元/诊断测试文件
- 写入 `DECISIONS/T003.report.md`，格式包含：
  - 完成内容
  - 改动文件
  - 测试命令与结果
  - 性能前后对比（至少报告缓存命中/调用次数）
  - 遗留问题
  - 规格疑问

## 落地注意

- 不要为了通过验收伪造缓存计数；计数器必须包住真实 `playSpecVsSpec` 调用。
- 不要把 `roundScores` 的 `0` 当作缺失；当前语义中 `0` 是平局/不输，只有 `undefined` 才表示该回合未打。
- 不要用全卡组特征作为实际可见特征的回退路径。
- 不要扩大到 T002 变体数据集，也不要运行全轮回优化。
