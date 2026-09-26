# Desktop 与 Web 等价承载

老傅工作台的桌面版使用官方 DSH Electron Desktop 作为承载层。Desktop Host 仍加载同一个 DSH Web App 和 `@scitiger-ai/lwb-dsh-bundle`，因此左侧模块、页面、样式、路由和功能逻辑继续来自工作台现有实现。

## Profile 边界

Desktop 的静态 Profile 只包含：

1. `@deepseek-ai/dsh-base`
2. `@deepseek-ai/dsh-web-app`
3. `@scitiger-ai/lwb-dsh-bundle`

口播视频等场景能力包不写入 DSH Profile。它们继续由 LWB 内部注册表记录，由 `LwbPackRuntime` 在运行时通过 Cordis Loader 动态加载、卸载和恢复。这样官方 Desktop 的插件管理器不会取代产品自己的能力包注册机制。

## 运行目录

Web 默认继续使用 `lwb/local`，Desktop 默认使用 `$DSH_HOME/lwb` 保存产品注册表和任务数据。Desktop 应用资源中的 `lwb/packs` 可能是只读的；加载能力包时会把代码复制到 `$DSH_HOME/lwb/pack-runtime/<pack-id>`，再通过现有 Profile `node_modules` 链接给 Loader。能力包专属工作区和任务数据仍由 `LwbPackWorkspaces` 管理，不写回应用安装目录。

## 启动

```bash
npm run dev:desktop
```

快速复用已构建的 DSH/Electron 产物：

```bash
npm run start:desktop
```

启动器会生成官方 Desktop 的临时开发 Profile、挂载 LWB Bundle，并应用 `lwb/desktop/patch-upstream.mjs` 中的兼容补丁。补丁隐藏官方 Desktop Plugins 菜单，保留窗口关闭后的 Host 和任务生命周期，并把 Desktop Host 的运行环境映射到 LWB 的 Desktop Profile。

正式构建沿用官方 Electron Runtime、签名和更新流程，并在运行时资源中加入 LWB Bundle、Pack SDK 与场景能力包：

```bash
npm run package:desktop:dir
```

产品包不会把具体场景能力包写入静态 Profile；应用资源只提供可发现的包源，启用状态仍由 LWB 注册表持久化。
