# Tree Decision Experience Library

## 累积经验库说明与审计准则

1. **历史小样本数据定位**：历史 T014/T016/T017/T021 小样本数据仅作为溯源与诊断种子，不作为采纳决策依据。
2. **Append-Only 观察语义**：`evaluation_observations.jsonl` 采用追加写入语义，杜绝覆盖历史评测记录。
3. **多源均衡覆盖**：覆盖全部 10 套 8 怪兽基准，不向全二冲/全二永平单源倾斜。
4. **四费保真门禁**：所有四费怪兽在入库前必须通过 `four_cost_fidelity_gate` 验证。
