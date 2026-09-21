# 08 Harness 基座锁定与升级核验

> **状态（2026-09-15）**：LWB 基础版锁定 DeepSeek Harness `dsh-v0.1.6-alpha.1`。这是 developer preview，必须以精确 commit 复现，不跟随浮动分支或 tag 名自动更新。

## 锁定锚点

| 项 | 值 |
|---|---|
| 上游仓库 | `https://github.com/deepseek-ai/deepseek-harness.git` |
| tag | `dsh-v0.1.6-alpha.1` |
| commit | `0a15e36e7f82b6ed45af6fa9759f29b40dcd965d` |
| 核验日期 | `2026-09-15` |
| Node | `^22.19.0 || >=24.0.0` |
| 包管理器 | `pnpm@11.7.0` |

`lwb/UPSTREAM.lock.json` 是机器可读的同一事实源。锁定不代表稳定版；它的作用是让每次上游升级成为可审查、可回滚的变更。

## 已验证能力与边界

- 该 commit 可在全新的 checkout 执行 `CI=true corepack pnpm install --frozen-lockfile` 和 `CI=true corepack pnpm run build`。
- 旧 vendor 的忽略构建产物可能造成错误的导出解析失败。它们是可再生物，不是 LWB 或 DSH 源码补丁，应重新构建，不能为了兼容旧产物修改 vendor 源码。
- LWB 不装配 `agent-team` 或 `tool-agent-team`，也不提供独立模型与路由管理页；DSH 原生设置页只从 LWB“设置”模块进入。
- 普通对话的标题、模型选择、凭据、工具权限和审批都保持 DSH 原生行为。
- LWB 不包装 Session 查询或持久化；普通对话、工作区与归档均使用 DSH 公开接口。

## 可复现基线

```bash
git clone https://github.com/deepseek-ai/deepseek-harness.git vendor/deepseek-harness
git -C vendor/deepseek-harness checkout --detach 0a15e36e7f82b6ed45af6fa9759f29b40dcd965d
cd vendor/deepseek-harness
CI=true corepack pnpm install --frozen-lockfile
CI=true corepack pnpm run build
```

返回项目根目录后运行：

```bash
npm run check
npm run profile:check
npm run file:test
npm run dsh:dump
npm run test
```

## 升级规则

1. 在专用升级分支选择精确上游 commit，先在干净临时 checkout 安装并构建。
2. 只更新 `UPSTREAM.lock.json`、Profile / LWB 适配代码和测试；禁止在 `vendor/deepseek-harness` 留下业务源码改动。
3. 重新执行构建与 LWB 回归，并人工验证普通对话、工作区、归档和文件附件。
4. 若未来确实需要上游改动，应先尝试 LWB 插件接缝，再以单独、可上游化的补丁提出。

## 0.1.6 升级记录

本次从 `dsh-v0.1.2-alpha.1` 升级至 `dsh-v0.1.6-alpha.1`。设置注册改用 `ctx.settings.installSection()` 和字符串 namespace；归档恢复改用公开的 `workspaceRegistry.unarchiveSession()`。能力包首次加载保留市场源码可用标志，避免新用户第一次加载失败。

对话新上传默认使用 DSH 原生流式文件入口（`fileIntake.mode: native`），停用 LWB 上传按钮与发送拦截。LWB 的旧 `lwb-file-attachments` 历史消息展示及旧文件仍保留；不要删除工作区 `.lwb/uploads/`。旧上传适配器代码尚未物理删除，供历史兼容评估和显式部署使用，不代表它与新版混合附件组合已完成全部验证。

DSH 普通文件原样保存到 `DSH_HOME/attachments/`，原生接口不限制文件类型/大小，也不自动清理文件；旧 LWB 的 20 MiB 限制仅属于旧适配器。上传成功不等于模型能解析任意格式，PDF/Office 等仍取决于文件工具和相应解析能力。

验收使用隔离的 DSH Home，未迁移现有用户数据。新版使用 Session v3 格式；切换现有数据前先停止服务并备份完整 DSH Home、能力包登记表和工作区 `.lwb/`。回滚需恢复匹配的旧代码、旧上游构建及升级前数据副本，不能只回退 Git commit 后继续写新版数据。

验证证据与限制见 [28-dsh-016-upgrade.md](28-dsh-016-upgrade.md)。
