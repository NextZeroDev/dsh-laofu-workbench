# 老傅工作台设计文档

> **当前基础版（2026-08-31）**：以锁定的 DSH alpha 为基座，产品只包含“对话”“场景能力包”和“设置”。

当前运行目录与附件实现以 [31-runtime-data-layout.md](./31-runtime-data-layout.md) 为准。下列历史分析与验收记录中的旧目录和 `file:test` 命令仅代表当时状态；当前测试入口为 `npm test` 或 `npm run unit:test`。

## 当前有效文档

| 文档 | 内容 |
|---|---|
| [01-architecture.md](./01-architecture.md) | 三模块产品边界和职责分层 |
| [08-base-lock.md](./08-base-lock.md) | DSH 精确锁定、可复现构建与升级规则 |
| [11-lwb-workbench-shell.md](./11-lwb-workbench-shell.md) | 三模块前端壳与持久化边界 |
| [12-capability-packs.md](./12-capability-packs.md) | 场景能力包契约、生命周期与首个口播视频包 |
| [13-signal-board.md](./13-signal-board.md) | 信号板产品形态设计（信号模块） |
| [14-spoken-video-full-pipeline.md](./14-spoken-video-full-pipeline.md) | 口播视频全链路推进分析（选题→入队补齐路线） |
| [15-signal-board-visual.md](./15-signal-board-visual.md) | 信号板视觉设计（指挥中心方向） |
| [16-signal-module-analysis.md](./16-signal-module-analysis.md) | 信号模块梳理分析 |
| [17-topic-module-analysis.md](./17-topic-module-analysis.md) | 选题模块分析（四输入分层组装 + DSH 生成） |
| [18-signal-module-restructure-plan.md](./18-signal-module-restructure-plan.md) | 信号模块调整方案（双链路分治） |
| [19-script-module-analysis.md](./19-script-module-analysis.md) | 写稿模块分析（P2 规则质检 + P3 AI 起稿合并实施） |
| [20-signal-page-visual-polish-plan.md](./20-signal-page-visual-polish-plan.md) | 信号页视觉美化分析与方案（命令条 + 信号卡片重塑） |
| [21-signal-module-simplification-analysis.md](./21-signal-module-simplification-analysis.md) | 信号模块简化分析（去信号卡工程动作、来源设置与手动导入入口） |
| [22-account-module-analysis.md](./22-account-module-analysis.md) | 账号模块分析（去版本号显示 + 账号卡片重塑） |
| [23-topic-module-account-tabs-analysis.md](./23-topic-module-account-tabs-analysis.md) | 选题模块重设计分析（账号 Tab 化 + 表单简化 + 任务卡/抽屉交互） |
| [24-script-page-ui-redesign-analysis.md](./24-script-page-ui-redesign-analysis.md) | 写稿页 UI 重设计分析与实施记录（单一生命线抽屉 + accent 参数化） |
| [25-publish-module-analysis.md](./25-publish-module-analysis.md) | 发布 / 入队模块设计与实施记录（发布包装 Agent + 封面生图 + packaging 阶段） |
| [26-publish-module-simplification.md](./26-publish-module-simplification.md) | 发布模块简化实施记录（视频货架 + 单一发布资料抽屉，状态机 10→8 删批准/入队/导出） |
| [27-content-schedule-module-analysis.md](./27-content-schedule-module-analysis.md) | 内容安排模块分析与实施记录（定时全自动流水线 + 运行审计） |

- [28-dsh-016-upgrade.md](./28-dsh-016-upgrade.md)：DSH 0.1.6 升级、原生文件上传切换、实测证据与数据备份说明。
- [29-pack-owned-workspaces.md](./29-pack-owned-workspaces.md)：能力包专属工作区、DSH 默认模型复用、业务凭据隔离、内部会话隐藏、卸载与数据维护。
- [30-ui-audit-and-readiness.md](./30-ui-audit-and-readiness.md)：全系统 UI 调整、浏览器巡检、264 项回归测试与正式使用前的待验收事项。

- [31-runtime-data-layout.md](./31-runtime-data-layout.md)：唯一运行数据入口、原生附件、能力包 data 目录与旧实现移除记录。

- [32-product-defaults-audit.md](./32-product-defaults-audit.md)：取消五家对话服务商预置，以及工作台与口播能力包默认配置审计。

- [35-spoken-video-workflow-details.md](./35-spoken-video-workflow-details.md)：配音默认生成字幕与失败隔离、发布预览和下载、内容安排按轮次筛选分页。
