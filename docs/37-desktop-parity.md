# Desktop 与 Web 等价承载

老傅工作台的桌面版使用官方 DSH Electron Desktop 作为承载层。Desktop Host 仍加载同一个 DSH Web App 和 `@scitiger-ai/lwb-dsh-bundle`，因此左侧模块、页面、样式、路由和功能逻辑继续来自工作台现有实现。

## Profile 边界

Desktop 的静态 Profile 只包含：

1. `@deepseek-ai/dsh-base`
2. `@deepseek-ai/dsh-web-app`
3. `@scitiger-ai/lwb-dsh-bundle`

口播视频等场景能力包不写入 DSH Profile。它们继续由 LWB 内部注册表记录，由 `LwbPackRuntime` 在运行时通过 Cordis Loader 动态加载、卸载和恢复。这样官方 Desktop 的插件管理器不会取代产品自己的能力包注册机制。

## 运行目录

在当前源码项目中，`npm run dev`、`npm run dev:desktop` 和 `npm run start:desktop` 使用同一份持久化数据：

| 内容 | 默认位置 |
| --- | --- |
| 模型设置、凭据、会话、附件及 DSH 存储 | `lwb/local/dsh-home` |
| 内部能力包注册表及启用状态 | `lwb/local/packs.json` |
| 能力包工作区、账号、任务和媒体 | `lwb/local/dsh-home/profiles/lwb/pack-state` |

`LWB_DSH_HOME` 优先于 `DSH_HOME`，两者未指定时使用上述历史目录。`LWB_PRODUCT_HOME`、`LWB_PACK_REGISTRY`、`LWB_PACK_STATE_DIR` 可分别覆盖产品目录、注册表和业务工作区根目录；开发版 Desktop 会将这些解析后的路径传递给 Host。

插件激活目录与业务数据目录分开。Web 默认在 `$DSH_HOME/profiles/lwb` 激活插件，开发版 Desktop 在官方生成的 `.desktop-build/development/project` 激活插件，并通过 `LWB_PROFILE_DIR` 将动态能力包链接写入该目录。切换承载端不会把业务工作区改到 `profiles/desktop`，也不会复制或清空现有数据。

开发版直接使用仓库中的能力包代码，以保留 Remotion 等工作区依赖。打包版仍把只读应用资源中的能力包复制到用户目录的 `pack-runtime`；打包版默认产品目录为 `$DSH_HOME/lwb`，此次修复验证的是源码启动方式，不包含已安装发行包的数据导入流程。

同一份业务数据目前只能由一个 Host 运行。切换 Web/Desktop 前应完整退出另一端；Desktop 关闭窗口后仍会保留后台 Host，需要退出应用。两端同时运行的任务协调不在本次修复范围内。

## 启动

```bash
npm run dev:desktop
```

快速复用已构建的 DSH/Electron 产物：

```bash
npm run start:desktop
```

启动器会生成官方 Desktop 的临时开发 Profile、挂载 LWB Bundle，并应用 `lwb/desktop/patch-upstream.mjs` 中的兼容补丁。补丁隐藏官方 Desktop Plugins 菜单，保留窗口关闭后的 Host 和任务生命周期，并把 Desktop Host 的运行环境映射到 LWB 的 Desktop Profile。

构建入口使用官方 `apps/desktop` 自己依赖的 pnpm，由当前 Node 直接执行，不要求上游根目录存在 `node_modules/.bin/pnpm`。开发版使用 `.desktop-build/development/electron-user-data` 作为 Electron 用户目录；Host 沿用官方开发模式，默认调试端口为 9230，可用 `DSH_DESKTOP_HOST_INSPECT_PORT` 覆盖。

Electron 用户目录只保存窗口等壳层状态，不作为产品业务数据目录。旧版本创建的 `.desktop-build/development/home` 会保留，但当前开发启动器不再默认读取它。

正式构建沿用官方 Electron Runtime、签名和更新流程，并在运行时资源中加入 LWB Bundle、Pack SDK 与场景能力包：

```bash
npm run package:desktop:dir
```

产品包不会把具体场景能力包写入静态 Profile；应用资源只提供可发现的包源，启用状态仍由 LWB 注册表持久化。
