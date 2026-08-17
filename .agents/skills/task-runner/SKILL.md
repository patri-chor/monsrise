---
name: task-runner
description: >-
  Automated adaptive task polling, execution, and delivery runner for the repository.
  Use this skill when the user asks to start or configure task polling, check for open tasks locally,
  or automatically execute tasks and submit reports into their respective domain directories.
---

# Adaptive Task Polling & Submission Runner (自适应阶梯轮询与任务提交流水线)

本技能提供从**本地任务探测、自适应退避轮询、自主执行验证**到**报告精准归档与 Git 提交**的完整流水线机制。

---

## 1. 核心架构与目录对应规范 (Directory & Domain Routing)

所有的 task 文件均在本地 `TASKS/` 目录中组织。根据双域 Git 总线规范，任务与报告必须严格在同一目录下匹配，禁止错位或跨域提交：

| 领域 (Domain) | 任务路径 (Task Path) | 对应报告路径 (Target Report Path) | 领域参数 (CLI Flag) |
|---|---|---|---|
| **全库 / 通用** | `TASKS/Txxx-*.md` 等 | `TASKS/Txxx.report.md` | (默认，无参数) |
| **决策树优化 (`tree`)** | `TASKS/tree/Txxx-*.md` | `TASKS/tree/Txxx.report.md` | `--domain=tree` |
| **新阵型生成 (`generation`)** | `TASKS/generation/Txxx-*.md` | `TASKS/generation/Txxx.report.md` | `--domain=generation` |

> [!IMPORTANT]
> **报告目录对齐原则**：
> 报告文件路径必须为 `dirname(taskFile)/Txxx.report.md`。例如 `TASKS/generation/T006-pilot.md` 对应的报告必须写入 `TASKS/generation/T006.report.md`，不可放在 `TASKS/T006.report.md`。

---

## 2. 本地零开销阶梯退避轮询 (Zero-Token Local Adaptive Backoff)

任务由本地驱动，无需在轮询时频繁拉取远程 Git，极大提升探测速度与稳定性。

### 降频阶梯：
1. **高频冲刺期 (0 ~ 5 分钟)**：每 **1 分钟** 检查一次（提交 report 后自动进入此阶段并执行 5 次）；
2. **中频等待期 (5 ~ 30 分钟)**：每 **5 分钟** 检查一次；
3. **低频待命期 (> 30 分钟)**：每 **30 分钟** 检查一次。

### 开启轮询调度 (Cron Setup)
通过 `schedule` 工具配置 1 分钟心跳 Cron：
```json
{
  "CronExpression": "* * * * *",
  "Prompt": "阶梯自适应任务检测：\n执行命令：`node scripts/check-open-tasks.mjs`（或指定 domain，如 `node scripts/check-open-tasks.mjs --domain=tree`）。\n- 若返回包含 `NO_TASK`（退出码 0），直接停止，不进行任何分析与操作；\n- 若返回包含 `TASK_FOUND`（退出码 100），读取指定的 taskFile 与 reportFile，严格按验收标准执行实现、运行测试，生成报告（首行 STATUS: DONE），执行 `node scripts/check-open-tasks.mjs --report-submitted`，并 git commit 与 git push。",
  "IsDaemon": true
}
```

### 探测结果处理契约：
- **`NO_TASK` (退出码 0)**：未到阶梯检查时间或无未完成任务。Agent **立即结束回合，输出简短状态，不进行任何文件读取或分析**。
- **`TASK_FOUND` (退出码 100)**：检测到最新未完成任务，输出 JSON 携带元数据：
  ```json
  {
    "status": "TASK_FOUND",
    "taskId": "T008",
    "domain": "tree",
    "taskFile": "TASKS/tree/T008-xxx.md",
    "reportFile": "TASKS/tree/T008.report.md",
    "title": "T008 任务标题",
    "stage": "medium (5 min)"
  }
  ```

---

## 3. 任务自主执行与提交规范 (Execution & Submission Workflow)

当收到 `TASK_FOUND` 唤醒时，按以下标准化流程执行：

### Step 1: 本地读取任务与静默规划
- 直接读取本地 `taskFile`；
- **不要向用户展示计划**，由 Agent 自行总结需求与验收标准。

### Step 2: 编写代码与本地验证
- 严格按照任务规范修改指定文件；
- 绝不破坏架构，复用现有接口；
- 运行针对性单元测试与全量校验（如 `npx vite-node tests/...`、`npx tsc --noEmit`），确保所有测试通过（`PASS`）。

### Step 3: 编写交付报告 (Generate Report)
- 将报告写入脚本指定的 `reportFile`（确保目录对应）；
- 报告首行必须包含状态：
  - 全部完成：`STATUS: DONE`
  - 规格存在疑问/阻塞：`STATUS: PARTIAL`（并在正文中列出“规格疑问”后停下）；
- 报告必须包含：
  1. 完成内容概要；
  2. 改动文件清单；
  3. 测试命令与实际输出；
  4. 资源配置/统计指标（如有）；
  5. 遗留问题或后续建议。

### Step 4: 刷新轮询状态机
报告写入后，立即运行：
```bash
node scripts/check-open-tasks.mjs --report-submitted
# 或指定 domain:
node scripts/check-open-tasks.mjs --domain=tree --report-submitted
```
重置回 1 分钟高频冲刺期，准备接收下一阶段任务。

### Step 5: Git 提交与推送 (Git Commit & Push)
```bash
git add <改动文件> <reportFile>
git commit -m "feat(<domain>): complete <taskId> <task-title>"
# 若在代理网络环境下，带上代理参数：
git -c http.proxy=http://127.0.0.1:7890 push
```

---

## 4. 常用辅助脚本参考

- **强制即时检查（跳过退避等待）**：
  ```bash
  node scripts/check-open-tasks.mjs --force
  # 或指定 domain:
  node scripts/check-open-tasks.mjs --domain=tree --force
  ```
- **手动标记 Report 提交时间**：
  ```bash
  node scripts/check-open-tasks.mjs --report-submitted
  ```
