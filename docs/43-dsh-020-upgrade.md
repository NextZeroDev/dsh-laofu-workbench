# 43 DSH 0.2.0 升级与验收

> 历史升级记录。核验日期 2026-09-30，升级分支 `upgrade/dsh-0.2.0-rc.2`。当前锁定以 [基座锁定](08-base-lock.md) 与 `lwb/UPSTREAM.lock.json` 为准。

## 版本与构建

- 原基座：`dsh-v0.1.7-rc.2`，`477b4f420553e8a52c2fbccc464d7561b239c443`。
- 新基座：`dsh-v0.2.0-rc.2`，`639ed015397290b3745d163aafe02ffee4aa3f84`（等于上游 `master` HEAD；官方 release 发布于 2026-09-29）。
- 距离：448 个提交、300 个文件。
- 环境：macOS arm64、Node 22.23.2、上游 `pnpm@11.7.0`（经 `corepack pnpm`）；上游 engines `^22.19.0 || >=24.0.0` 未变。
- 切换方式：旧 checkout 移入 `.tooling/dsh-before-<ts>` 后，本次改用增量 `git fetch origin refs/tags/dsh-v0.2.0-rc.2:refs/tags/dsh-v0.2.0-rc.2`（22 秒，避免全量 clone 的长时间下载），再 `git checkout --detach <commit>` 与 `git clean -xdf`。清理后 vendor 由 3.5G 降到 386M，得到与全新 clone 等价的干净树，随后由 `npm run setup` 安装与构建。
- 安装 1392 个包；构建覆盖全部引擎包、`@deepseek-ai/dsh-desktop` 与 Web 前端。
- `lwb/upgrade/verify.mjs` 输出：`LWB upstream contract passed: dsh-v0.2.0-rc.2 (639ed015397290b3745d163aafe02ffee4aa3f84); official source clean.`

## 声明同步

| 位置 | 变更 |
|---|---|
| `lwb/dsh-bundle`、`lwb/pack-sdk`、`lwb/packs/spoken-video`、`lwb/packs/model-review`、商业仓 `@deepseek-ai/dsh-*` peer | `0.1.7-rc.2` → `0.2.0-rc.2` |
| `lwb/dsh-bundle` 的 `@earendil-works/pi-ai` | `0.85.1` → `0.87.1` |
| `@deepseek-ai/schemastery` / `@deepseek-ai/cordis` | 上游仍为 `3.18.4` / `4.0.4`，无需调整 |
| `lwb/dsh-bundle/client.js` 客户端元数据回退版本 | → `0.2.0-rc.2` |

`lwb/UPSTREAM.lock.json` 的 tag、commit、核验日期同步更新；`node` 与 `packageManager` 两项经新 checkout 核对未变。

## 上游变更与 LWB 影响

`packages/bundle/web-app/cordis.patch.yml` 的装配行 id 差异：

- 新增：`product-analytics`、`desktop-product-telemetry`、`ui-settings-session-log`；`packages/bundle/base` 新增 `otel`。
- 移除：`schedule`、`ui-schedule`、`time-context` —— 官方自动化任务改为可选插件包提供。

对 LWB 的结论：

- LWB 不装配官方 `schedule`，内容安排由口播包自己的调度实现承载；`automationAvailable` 探测的是 `agents`、`agentPresets`、`agentDefaultModel` 三个服务，三者在 0.2.0-rc.2 仍存在，因此该变化不影响内容安排与定时全自动链路。
- LWB 仍然只禁用 `ui-sidebar` 与 `ui-plugin-manager`；新增的 `ui-settings-plugins` / `ui-settings-plugin-inventory` 保持启用，原生设置内的插件页因此继续可用。
- pi-ai 0.87.1 移除了部分旧模型 ID。LWB 的 provider 是 Profile 内自定义 OpenAI 兼容条目，不受官方目录影响；升级后首次启动仍应确认已保存的模型选择有效。

## 版本接缝复核

| 接缝 | 复核方式 | 结果 |
|---|---|---|
| `ui-workspace` 填充 `sidebar.workspaces` 座位 | `verify.mjs` 读上游源码 | 通过 |
| 渲染器 owner props 覆盖顺序 `{...slotInjected.props} {...contextual} {...ownerProps}` | `verify.mjs` | 通过 |
| `renderSlot` 读取渲染项自身 `entry.children?.[key]` | `verify.mjs` | 通过 |
| LWB 引用的 5 个 `dsh-client-ui-primitives` 导出 | `verify.mjs` | 通过 |
| `needsWelcome` 入口策略（构建产物中 1 处定义 + 4 处调用） | `verify.mjs` 对新建 `apps/desktop/lib/main.js` 实测 | 通过，`entry-policy.mjs` 无需修改 |
| LWB 按 id 覆盖的 4 个装配行（`ui-sidebar`、`ui-plugin-manager`、`webserver`、`ui-theme`） | 上游源码核对 | 均存在 |
| LWB 使用的 3 个 slot（`conversation.session`、`sidebar.settings`、`sidebar.workspaces`） | slot 目录与声明处核对 | 均存在 |
| LWB 探测的服务（`agents`、`agentPresets`、`agentDefaultModel`、`sessionTitle`） | 上游源码核对 | 均存在 |
| LWB 依赖的上游文件（`apps/cli/lib/bin.js`、`apps/desktop/lib/main.js`、`apps/desktop/scripts/electron-builder-config.mjs`、`apps/desktop-host/package.json`） | 构建 + `verify.mjs` | 均存在 |
| `@earendil-works/pi-ai/api/openai-completions.lazy` 仍导出 `openAICompletionsApi` | 对安装后的 0.87.1 实际 import | 通过 |
| `PiAiAdapter` 及 `LlmAdapter`/`LlmError`/`resolveImageAttachmentAccess`/`resolveRetryPolicy` 接口 | `lwb-model.test.mjs`（真实 SSE 流与工具调用） | 通过 |

本次升级没有需要修改的 LWB 适配代码：`lwb/upgrade/verify.mjs` 与 `lwb/desktop/entry-policy.mjs` 在新基座上原样通过，改动集中在版本声明与文档。

## 门禁结果

| 门禁 | 结果 |
|---|---|
| `npm run setup`（安装 + 构建 + `upstream:check`） | 通过 |
| `npm test` | 通过：`check`、`profile:check`（8 行）、`pack:profile-check`、`unit:test` **352 项全部通过** |
| `npm run test:integration` | 通过：原生鉴权、动态加载/卸载、8 个菜单、账号保留、重启恢复 |

未执行：两种载体的浏览器 / 桌面人工 UI 验收、供应商付费模型与媒体调用、签名打包。这些仍按[扩展边界](38-dsh-extension-boundary.md)的门禁要求单独验收。

## 注意事项与回滚

- **环境泄漏**：从 DSH 宿主（官方桌面端）内部启动的 shell 会带上 `ELECTRON_RUN_AS_NODE=1` 与 `DSH_HOME`/`DSH_PROFILE`/`DSH_PROFILE_DIR`。此时 `lwb/dsh-launcher.mjs` 会把 profile 解析为 `desktop` 并指向官方数据根，`profile:check` 会报 `error: profile "desktop" is managed exclusively by the Electron application`。这是环境变量泄漏，不是产品回归；在普通终端运行即可，或在命令前净化：`env -u ELECTRON_RUN_AS_NODE -u LWB_PROFILE_ID -u DSH_HOME -u DSH_PROFILE -u DSH_PROFILE_DIR`。
- **升级前数据**：已完整备份到 `lwb/local/backups/pre-dsh-0.2.0-rc.2-20260930-181258/`（795M，含 `current/` 与 `packs.json`）。
- **回滚**：恢复 `lwb/UPSTREAM.lock.json`、回退本分支的版本声明改动、`npm run setup` 重建 `dsh-v0.1.7-rc.2`，并恢复上述数据备份。只回退 Git commit 不会回退运行数据格式。
- **待处理（与本次升级无关）**：`lwb/packs/model-review` 是商业仓的第二个 checkout，它与 `dsh-laofu-workbench-commercial` 在 `client.js`、`lwb-pack.json`、`test/client-runtime.test.mjs` 三个文件上内容不同（商业仓副本更新）。本次只同步两者的版本声明，未做内容对齐；哪一份是唯一事实源需要另行决定。