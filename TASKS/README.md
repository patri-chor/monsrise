# TASKS — DeepSeek ↔ Gemini 协同总线（git 黑板协议）

本目录是 **DeepSeek V4 Pro（决策方，运行于本地 DSH）与 Gemini（执行方，运行于 Google Antigravity）** 之间的任务交换协议。双方通过 GitHub 仓库 `patri-chor/monsrise` 同步，互不直连。

## 文件协议

每个任务一个编号 `Txxx`（T001, T002, …）：

| 文件 | 谁写 | 内容 |
|---|---|---|
| `Txxx.md` | DeepSeek（决策方） | **任务规格**：目标、验收标准、方案约束、涉及文件、优先级、STATUS |
| `Txxx.report.md` | Gemini（执行方） | **实现报告**：完成内容、改动文件清单、测试结果、遗留问题、偏离说明 |
| `Txxx.closed.md` | DeepSeek（决策方） | **验收结论**：通过/打回、遗留转新任务、经验 |

每份文件**首行必须有** `STATUS: OPEN | IN_PROGRESS | DONE | REJECTED`。

## 工作流（一个循环）

```
1. DeepSeek:  分析 → 写 Txxx.md (STATUS: OPEN) → git commit + push
2. 用户:      在 Antigravity 给 agent 说「处理仓库里最新的 OPEN 任务」（免费版无 API，此步需人工点一下）
3. Gemini:    读 Txxx.md → 实现 → 写 Txxx.report.md (STATUS: DONE) → git push
4. 值守脚本:  scripts/watch-gemini.ps1 轮询到新 report → 弹通知 + 写 TASKS/pending.json
5. DeepSeek:  读 report → 验收 → 写 Txxx.closed.md → 写下一个任务 → push → 回到步骤 2
```

## Antigravity 侧设置（一次性）

1. 在 [antigravity.google](https://antigravity.google) 创建一个 Agent，指向仓库 `patri-chor/monsrise`
2. 给 Agent 的指令（粘贴到 Antigravity 的 agent 说明里）：
   > 你是一个代码执行者。每轮先 `git pull`，读取 `TASKS/` 目录里 STATUS 为 OPEN 的最新任务文件（编号最大者优先）。严格按验收标准实现，完成后写 `TASKS/Txxx.report.md`（首行 STATUS: DONE，列出改动文件、测试结果、遗留问题），然后 `git add TASKS/Txxx.report.md && git commit && git push`。不要修改 TASKS/Txxx.md 本身；规格有歧义时在 report 里写"规格疑问"并停止。
3. 仓库里 `AGENTS.md` 也写有同样的执行方规则（Antigravity 若读取仓库内指令则自动生效）。

## 值守脚本（DeepSeek 侧自动检测）

```powershell
# 方式一：手动后台运行
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\watch-gemini.ps1

# 方式二：Windows 计划任务，开机启动 + 每 5 分钟
#   schtasks /create /tn "watch-gemini" /tr "powershell -NoProfile -ExecutionPolicy Bypass -File D:\develope\monsrise1\scripts\watch-gemini.ps1" /sc minute /mo 5
```

脚本行为：每 30 秒 `git fetch`，发现新的 `Txxx.report.md` 就 `git pull`、弹 Windows 通知、写 `TASKS/pending.json`（供 DeepSeek agent 读取）。

## 规则

- 任务编号递增，不要复用
- 规格必须含**验收标准**（可测/可判），否则执行方有权以"规格疑问"停下
- 执行方不要改规格文件；决策方不要改 report 文件（验收意见写 closed 文件）
- 冲突时 `git pull --rebase` 后重试 push
