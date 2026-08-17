# 代码探索约定（CodeGraph）

本仓库已初始化 CodeGraph 代码知识图谱（`.codegraph/` 目录存在）。所有代码探索**固定优先使用 `mcp__codegraph__codegraph_explore` 工具**，不要漂移回 grep/read 扫描式探索。

## 多会话协作协议（决策/落地分工）

本工作区可能同时运行两个独立会话：**决策会话**（出方案）与**落地会话**（实现）。双方通过 `DECISIONS/` 目录的**文件黑板**互通（详见 `DECISIONS/README.md`）：

- 你收到 `DECISIONS/Txxx.md` → 这是别人交给你的任务规格，按规格实现，完成后写 `Txxx.report.md`
- 你发出方案时 → 写成 `DECISIONS/Txxx.md`（含方案权衡与验收标准），让另一会话接手
- 每个任务文件首行必须有 `STATUS: OPEN | IN_PROGRESS | DONE | REJECTED`
- 落地时发现规格歧义 → 在 report 里写"规格疑问"，不要擅自假设

## 跨 Harness 协作协议（DeepSeek ↔ Gemini via GitHub）

本仓库通过 git 总线与 Google Antigravity 的 Gemini agent 协作，完整协议见 `TASKS/README.md`。角色判定：

- **你是决策方**（本机 DSH / DeepSeek）：
  1. 验收前先 `git pull`；检查 `TASKS/pending.json` 和 `TASKS/*.report.md`
  2. 验收 → 写 `TASKS/Txxx.closed.md`（结论/遗留转新任务）→ 写下一个 `TASKS/Txxx.md` → `git add TASKS/ && git commit && git push`
  3. 完成后提示用户去 Antigravity 让 Gemini 接手新任务
- **你是执行方**（Antigravity / Gemini，若它读取本仓库指令）：
  1. 先 `git pull`，读 `TASKS/` 中 STATUS: OPEN 的最新任务
  2. 按验收标准实现，写 `TASKS/Txxx.report.md`（首行 STATUS: DONE，列改动文件/测试/遗留）
  3. `git push`；规格歧义时在 report 写"规格疑问"并停下
- 机器状态：`TASKS/pending.json` 由 `scripts/watch-gemini.ps1` 值守脚本生成（不入库），是"Gemini 完成"的提醒来源

## 硬性规则

1. **架构/实现类问题**（"X 是怎么工作的"、"Y 系统如何实现"、"Z 在哪"、"改 X 会影响什么"）→ **第一步必须调用 `mcp__codegraph__codegraph_explore`**，它会一次返回相关文件的完整源码、调用链（callers/callees）、依赖关系和改动影响范围（blast radius）。
2. **改动前影响分析** → 先 `mcp__codegraph__codegraph_explore` 查目标符号，再决定改什么。
3. **codegraph_explore 已返回的源码视为已读取**（与 Read 等价，按行号标注、逐字节一致）→ **禁止**对同一文件重复 read/grep。
4. 仅当 codegraph **明确无结果**（空结果、或该语言/目录未被索引）时，才回退到 `grep` / `glob` / `read`。
5. 精确小目标查找（已知文件名、已知符号、看单文件细节）可直接用 read/grep，但"找代码在哪 / 怎么串起来的"一律先 codegraph。

## 使用建议

- 查询要**具体**：直接给符号名、文件名或一句话任务（如 `"AuthService loginUser session-manager"`），比宽泛的自然语言更准。
- 一次查询聚焦一个主题，避免一次拉取过多文件把上下文撑爆。
- 不要因为 codegraph 偶尔没命中就放弃：换更精确的符号名再试一次，仍无结果再回退传统搜索。
