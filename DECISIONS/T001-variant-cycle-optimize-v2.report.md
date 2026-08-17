STATUS: DONE

# T001 — 变体可控制 + 轮回优化 v2（胜率表/门槛/剪枝）

> 交接文档（落地会话 → 决策会话/用户）。本次是连续多轮迭代的成果，非单一下发任务，故编号定为 T001。

## 一、本次完成内容

### 1. 变体可控制（每个阵型可选开启）
- 变体 7 种：`original` / `mirror_global` / `mirror_imperial` / `shift_up` / `shift_down` / `shift_left` / `shift_right`
- `Formation` 新增 `variants?: VariantType[]` 字段
- `selectVariant()` 从允许列表**等概率**随机选一个；缺省 = 全部 7 种（含 original）
- 删掉硬编码特例，改为 formation_library 配置：

| 阵型 | variants | 原因 |
|---|---|---|
| 全二永平 | original, mirror_imperial, shift_up, shift_left, shift_right | 排除 mirror_global/shift_down（核心须保持上半区 y0-2） |
| 礼物救星 | original, mirror_global | 排除 mirror_imperial/shift_*（银狙礼物指向依赖相对站位） |
| 礼物丛林 | original, mirror_global | 同上 |
| 其余 8 阵 | 默认全部 7 种（含 original） | — |

### 2. 胜率表（11×11）+ 门槛 + 剪枝
- 新增 `winrate_matrix.ts`：全对阵（先手+后手）→ 固定更新 `reports/胜率表格.md` + `winrate_matrix.json`
- 门槛（用户定 3/90/15）：只优化 `新增` 或 `胜率下降 >15%` 的阵型；且 `optCount < 3`、`胜率 < 90%`
- 新增 `prune.ts`：后剪枝（先手+后手全局不败率判据），apply 覆盖后自动跑，日志写 `reports/prune_report.md`
- 局数默认 **10 局/侧**（每配对先手+后手共 20 局）

### 3. cycle_state 初始化
- `reports/cycle_state.json`：前 7 阵 optCount=2（已优化两次，不再优化），后 4 阵不写（作为「新增」）

## 二、改动文件清单

### 对战ai 仓库（bundle 源码）
- `src/ai/strategy/types.ts` — Formation 加 `variants?: VariantType[]`
- `src/ai/strategy/formation_engine.ts` — selectVariant 读 variants（等概率）+ `DEFAULT_VARIANTS` 常量 + loadCustomFormation 支持 variants
- `src/ai/strategy/formation_library.ts` — 全二永平/礼物救星/礼物丛林 加 variants

### monsrise1 仓库（训练栈）
- `src/ai/types.ts` — Formation 加 `variants?: string[]`
- `src/ai/formation_library.ts` — 同步 3 个特例的 variants
- `public/ai-bundle.iife.js` — 重新编译产物（已同步）
- `src/engine/tree/round_robin.ts` — 导出 worker 调度 + 新增 `fullMatrixEvaluate`
- `src/engine/tree/winrate_matrix.ts` — 新增（胜率表 + cycle_state 读写）
- `src/engine/tree/prune.ts` — 新增（可复用后剪枝）
- `src/engine/tree/cycle_optimize.ts` — 胜率表→筛选→并行优化
- `src/engine/tree/apply_optimized.ts` — 覆盖+剪枝+重跑胜率表+更新 state
- `reports/cycle_state.json` — 新增（前 7 阵 optCount=2）

## 三、关键程序澄清

### 轮回优化 v2 闭环
```
cycle_optimize.ts（清空隔离目录 → 胜率表 → 筛选 → 并行优化）
        ↓ 结果隔离 reports/optimized/{id}.json
apply_optimized.ts（覆盖 + 自动剪枝 → 重跑胜率表 → 更新 state）
```

### cycle_state 字段语义
- `optCount` = 已优化次数（每次 apply 对参与优化的阵型 +1，>=3 不再优化）
- `lastWinrate` = 最近一次 apply 后测得的胜率基线（所有阵型都记录，用于下次判断「下降」）
- 初始前 7 阵 lastWinrate=-1（占位，首次 apply 后填充真实值）

### 变体生效路径
- bundle `selectVariant` 读 `selectedFormation.variants`；训练栈 native 侧经 `loadCustomFormation(json.variants)` 生效
- evol 侧（我方候选）在 `arena.ts` 固定 `variant='original'`，不受 variants 影响

## 四、当前状态（2026-08-17 实跑完成）

- ✅ **cycle_optimize 完整跑通**（2565s，exit 0）：胜率表 → 门槛筛选 → 并行优化 4 新增阵型
  - 筛出 4 个新增阵型：铲土多核/礼物救星/壕炸金猴/礼物丛林（前 7 阵按预期跳过，lastWinrate=-1 未误判为下降）
  - 采纳 2 个：铲土多核「dof」@R1（命中对手整局 33%→67%）、礼物救星「忍猴」@R1（65%→90%）
  - 未改进 2 个：壕炸金猴、礼物丛林（保持原阵型）
- ✅ **apply_optimized 完整跑通**（exit 0）：覆盖 2 个改进阵型 → 后剪枝（0 冗余，两分支均判有效保留）→ 重跑胜率表 → 更新 state
- ✅ 胜率表更新（`reports/胜率表格.md`，11×11，2026/8/17 10:49）→ 行汇总与 cycle_state.lastWinrate 逐一对上
- ✅ cycle_state 更新：11 阵型基线全部填充；4 个参与阵型 optCount+1（其余 7 个保持 2）
- ✅ formation_library.ts：esbuild 转译通过、11 阵型完整、3 特例 variants 保留（全二永平 5 种/礼物救星 2 种/礼物丛林 2 种）
- ✅ 备份：`reports/formation_library.backup.ts`（apply 前 73336 字节）
- ✅ 临时检查脚本已清理；`reports/optimized/` 仅剩本轮 4 个 json（旧 10 个已被清空）

## 五、下一步

- **决策（未做）**：bundle 同步 + 重编译。apply 后 monsrise1 库已含新分支，但 `D:\develope\对战ai` 的 `src/ai/strategy/formation_library.ts`（const 硬编码格式，9 阵，与 monsrise1 JSON 数组格式不同，无同步脚本）仍是旧版本。需手动同步 + `build:ai:iife` 重编译 + 同步回 `monsrise1/public/`。⚠️ 建议在解决下面遗留问题 3/4 后再同步，避免把死代码部署上去。
- 下一轮回：`npx vite-node --script src/engine/tree/cycle_optimize.ts 5 11 0 16 10`（此时 4 阵 optCount=1，胜率 <90% 且未下降 → 会跳过；只有胜率下降 >15% 或新增才再优化）

## 六、遗留问题 / 注意事项

1. **预存在类型错误**（非本次引入）：`board_view.ts`（大量 any）、`deploy_evolved.ts`、`evolution2.ts`/`hill_climb.ts`（`number[]` 不匹配 `FeatureMask`）、`inspect_branch.ts` 等。`tsc --noEmit` 整体 exit 1，但本次改动文件无错。
2. **bundle 侧与 monsrise1 侧的 formation_library 需手动同步**：apply_optimized 只写 monsrise1 副本；若手改 bundle variants，需重编译 + 同步 + 同步 monsrise1。两文件格式不同（const 声明 vs JSON 数组），**无现成同步脚本**。
3. **side 分支部署问题（未解决）**：写回 formation_library 后 bundle 原生 `selectBranch` 只匹配「祷徒/全冲/三振/钻头/dof」等关键词，不识别「先手/后手」label。训练栈 evol 侧 `patchBranchSelection` 能正确工作，但真实网页对战走 bundle 原生 selectBranch 会失效。需决策：改 bundle selectBranch 支持 side，或 apply_optimized 特殊处理。
4. **【本轮新发现】label 兼容性缺口（不止 side）**：bundle 原生 `selectBranch`（`formation_engine.ts` 第 373-463 行）关键词表 = 对方/如果/三振/钻头/祷徒/祈祷/全冲/冲锋/盾/铁甲/dof，手牌+场上两阶段匹配。**无 ninja（忍猴）匹配路径**。影响：
   - 礼物救星新分支「忍猴」（keys=ninja，命中经典救星/礼物救星镜像）：bundle 原生**永不可达**（经典救星首4张=[117,110,108,114] 无 105/124 → 走主分支；镜像对手含 105 → 走「祷徒」分支）。实测确认：apply 后胜率表礼物救星 52.5%，镜像改善 50%→100% **未实得**（成为死代码，无害但无效）。
   - 铲土多核新分支「dof」（subs=dof）：bundle 原生靠「手牌/场上含三振王124 或凋零/中毒徽章」触发。肃清（首4张含124）✅ 实得；礼物丛林（首4张=[110,105,106,122] 无124，R1 未部署）❌ 不触发 → 改善 0%→80% 落空。apply 后矩阵铲土多核 vs 礼物丛林 15%（≈原值）。部分实得（vs 肃清 10%→实测），整体 58.0%。
   - **根因**：evol 侧条件语义（main/sub/keys 掩码匹配）与 bundle 原生 label 启发式（关键怪 ID 硬编码）不一致。决策方向：a) 给 bundle selectBranch 加 ninja 等缺失匹配路径；b) 优化产出仅限 bundle 可识别的标签；c) 接受死代码、矩阵只反映原生行为（现状，闭环自洽）。
5. **上一轮 pwsh-48 结果残留**：已由本轮 cycle_optimize 开头 clearDir 清空，无残留。
