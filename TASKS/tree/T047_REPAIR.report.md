STATUS: DONE
DOMAIN: tree

# T047 Repair Report — Low-Cost Error Detection and Formation Library Correction

> Domain: `tree` | Executor branch: `agent/tree`
> Scope: Low-cost detection of score discrepancies, correction of T0 baseline metadata, and score field alignment in formation strength library and registration pipeline.

---

## 1. Summary of Detected Errors

通过轻量级只读审查与跨文件字段一致性比对（`scripts/t047_verify.ts`、`scripts/t047_score_check.ts`、`scripts/t047_field_check.ts`），确认并修复了以下问题：

| 问题分类 | 缺陷详情 | 影响范围 | 状态 |
|---|---|---|---|
| **T0 L3 硬编码满分** | `run_cycle.ts` 在初始化注册 11 套 T0 根基准时，直接硬编码 `l3Score: 1.0`，未引用 `screen_observations` 中实际测量的基准分数（如 `all2rush` 实测 0.500、`classicsavior` 实测 0.714 等）。 | `formation_strength_library.json` 中的全部 T0 根基准 | **已修正**（恢复实测值） |
| **T0 L2/L1 得分语义越界** | T0 根源条目被填入了 `l2Score`（复用了 L3 heldout 分数）。根据 T045R 规范，T0 仅作为不可变基准与对手目录成员，不作为学员参与独立 L2/L1 评测，其 `l2Score` 与 `l1Score` 应显式为 `null`。 | 11 套 T0 根基准的 `l2Score` / `l1Score` 字段 | **已修正**（置为 `null`） |
| **类型接口与字段命名对齐** | `run_cycle.ts` T0 注册逻辑使用了旧版字段名（`l1Status`、`allowedLearningLevels`），未与 `FormationLibraryEntry` 接口（`learningPermissions`、`benchmarkRoles`、`opponentCatalogRoles`、`l1LearnerStatus`）严格对齐。 | `src/engine/tree/product_training/run_cycle.ts` | **已修正** |
| **24 个 L2/L1 满分聚合记录** | `learning_level_evaluations.jsonl` 中存在 72 条满分记录（24 个候选在 3 个阶段均为 1.0），缺乏逐局/逐 cell 细粒度向量备份，均标记为 `AGGREGATE_EXPLORATION_ONLY`。 | 24 个候选的高阶分数声称 | **已标记隔离**（由 T048 进行独立强门禁重测） |

---

## 2. Actions Taken & Code Modifications

1. **修正 T0 注册逻辑 (`src/engine/tree/product_training/run_cycle.ts`)**：
   - `l3Score` 读取 `baselineScoreMap.get(srcId)` 真实测量值；
   - `l2Score` 与 `l1Score` 置 `null`；
   - 字段规范为 `learningPermissions: []`、`benchmarkRoles: ['L2_FROZEN_T0_ANCHOR']`、`opponentCatalogRoles: ['L1_ROOT_LINEAGE_MEMBER']`、`l1LearnerStatus: 'NOT_APPLICABLE'`。

2. **修正阵型强度库数据 (`formation_strength_library.json`)**：
   - 执行 `scripts/t047_fix_t0_scores.ts`，精准修复了 11 个 T0 阵型的 18 处错误分数：
     - `t0:all2rush`: `l3Score` 1.0 → 0.500, `l2Score` → `null`
     - `t0:classicsavior`: `l3Score` 1.0 → 0.714, `l2Score` → `null`
     - `t0:all2prayer`: `l3Score` 1.0 → 0.786, `l2Score` → `null`
     - `t0:suqing`: `l3Score` 1.0 → 0.893, `l2Score` → `null`
     - `t0:laddersel`: `l3Score` 1.0 → 0.857, `l2Score` → `null`
     - `t0:spade_multi`: `l3Score` 1.0 → 0.786, `l2Score` → `null`
     - `t0:gift_jungle`: `l3Score` 1.0 → 0.857, `l2Score` → `null`
     - 其余 4 套 PANEL_SATURATED 基准（`springsword`, `nutsavior`, `gift_savior`, `golden_boom`）`l3Score` 保持实测 1.0，`l2Score` 置 `null`。

---

## 3. Verification Post-Fix

```text
=== Post-fix T0 entries ===
  t0:springsword:   l3=1.0000  l2=null  l1=null
  t0:nutsavior:     l3=1.0000  l2=null  l1=null
  t0:all2rush:      l3=0.5000  l2=null  l1=null
  t0:classicsavior: l3=0.7143  l2=null  l1=null
  t0:all2prayer:    l3=0.7857  l2=null  l1=null
  t0:suqing:        l3=0.8929  l2=null  l1=null
  t0:laddersel:     l3=0.8571  l2=null  l1=null
  t0:spade_multi:   l3=0.7857  l2=null  l1=null
  t0:gift_savior:   l3=1.0000  l2=null  l1=null
  t0:golden_boom:   l3=1.0000  l2=null  l1=null
  t0:gift_jungle:   l3=0.8571  l2=null  l1=null
```

所有修复均通过单元轻量脚本验证完成，未破坏历史不可变 JSONL 证据，且保持对主分支/远程 `agent/tree` 的隔离与受控。
