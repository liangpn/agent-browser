# work/（需求与 Backlog）

本目录是 **Minimal AIO + agent-browser** 的“单一事实来源”：

- 需求大纲（冻结版）：`work/requirements.md`
- 当前进度（Checkpoint）：`work/status.md`
- Backlog（任务清单）：`work/backlog.md`
- 验收/证据：`work/validation/README.md`
- 交付物（集成与脚本）：`work/deploy/`
- Agent Skills（面向调用方）：`work/skills/`
- 单元测试：`work/test/`
- 计划/设计文档：`work/docs/`
- 外部参考仓库清单：`work/docs/references.md`

历史遗留材料已归档（不再作为当前方向依据）：
- `work/_archive/2026-01-28-legacy/`

## 变更规则

- 需求变更：先更新 `work/requirements.md`，再同步更新 `work/backlog.md`
- 执行过程中新增任务：只新增到 `work/backlog.md`（不要把实现细节散落到其它临时文档）
