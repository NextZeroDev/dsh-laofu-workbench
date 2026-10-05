# 场景能力包契约

能力包是运行时组合的 DSH 插件。基础 Profile 不依赖具体业务包，公开仓库包含 `spoken-video` 和 `ai-arena`。业务流程见[口播指南](spoken-video.md)与[AI 竞技台](ai-arena.md)，最小代码示例见[开发入门](develop-a-pack.md)。

## 注册与生命周期

仓库 `lwb/packs/` 下的包自动出现在目录中，首次点击“加载”。外部包通过 CLI 登记：

```sh
npm run pack:install -- /absolute/path/to/pack
npm run pack:list
npm run pack:remove -- pack-id
```

登记表默认在被 Git 忽略的 `lwb/local/current/packs.json`。CLI 登记不启用、不复制源码或安装依赖，当前没有在线下载市场或自动更新。

工作台控制加载和卸载。Host 用 Cordis Loader 动态增减条目，浏览器用官方串行模块控制器 `modules.entries.sync()` 同步受控、带版本的 Bundle，再更新菜单，无需整页刷新。加载设 `enabled: true`，重启自动恢复；卸载设为 false，等待释放后保留包源与数据。单包恢复失败不阻止基础启动。浏览器不能自行操作 Loader 内部状态。

| 操作 | 工作区绑定 | 业务文件 | 配置、凭据与审计归属 |
|---|---|---|---|
| 卸载包 | 保留 | 保留 | 保留 |
| 清空业务数据 | 保留原状态 | 移至可恢复副本，重建空目录 | 保留 |
| 解除工作区注册 | 解除活动绑定，保留归属历史 | 保留 | 保留 |
| 再次加载 | 恢复登记，复用目录 | 继续使用 | 继续使用 |
| CLI 删除包源登记 | 不等同解除工作区绑定 | 保留 | 保留 |

清空与解除注册是独立操作，须先卸载并等待任务停止，再分别确认。清空包含业务账号、信号、项目、媒体、任务和安排，返回可恢复目录，不是安全擦除；不导入旧普通工作区数据。重新加载后来源可能再次自动采集，这属于新数据。

## 清单与注册契约

| 文件 | 用途 |
|---|---|
| `lwb-pack.json` | 公开身份、版本、说明与菜单 |
| `package.json` | npm 身份、host/client exports 与 `dsh.client` |
| `index.mjs` | Host entry：manifest、领域服务和 RPC |
| `client.js` | Browser entry：菜单页面 |

`schemaVersion` 为 1；包 id、npm 名称和菜单 id 严格校验，菜单 id 包内唯一。市场只读清单与 package 信息，不执行 entry；加载时才 import。校验后清单规范化并冻结。

`market` 可声明分类、标签、工作流、图标与详情：

| 字段 | 约束 |
|---|---|
| `introduction` | 最多 500 字符；缺省使用 description |
| `workflowHint` | 最多 240 字符 |
| `gettingStarted` | 1–8 条，每条最多 240 字符 |
| `features` | 1–16 项；title ≤80、description ≤240、可选 icon ≤32 字符 |

`features.menuId` 必须引用本包菜单且不重复；缺省从菜单生成卡片。图标支持 pack、target、signal、idea、write、audio、video、publish、calendar，未知名称回退通用图标。详情抽屉固定标题和操作，中部独立滚动，支持 Escape、遮罩关闭、焦点约束及返回入口。

可选服务字段：

| 字段 | 语义 |
|---|---|
| `minHostVersion` | 最低 Host 语义版本 |
| `requiredServices` | 逻辑服务，如 tts、subtitle、cover-image |
| `providers` | 支持 official、ats、custom 来源 |
| `entitlements` | ATS 权益声明，不授予权限 |
| `access` | `{ account: 'lwb', membershipRequired: true }` 启用 Host 会员校验 |

Host 对会员包加载和业务请求校验 ATS 会员状态；菜单禁用只是反馈。声明与本地校验不替代云端计费授权，也不能把任意 JavaScript 插件变成沙箱。接入见[账号与服务契约](40-lwb-account-model-and-media-services.md)。

Host 通过 `registerLwbPack(ctx, manifest)` 或 `lwbPackRegistry.register(manifest)` 注册；Browser 声明 `inject: ['lwbPackClient']`，两者均由 `ctx.effect()` 托管释放：

```js
ctx.effect(() => ctx.lwbPackClient.register({
  packId: 'example-pack',
  pages: { home: ExamplePage },
}), 'example-pack: register capability pages')
```

页面获得公开 pack/menu、packId、导航回调及宿主会话能力。禁止 import 核心 `lwb/dsh-bundle/client.js` 或假定宿主理解业务路由。动态样式创建时须标记 `data-plugin` 为本包 package name，避免被其他模块认领并在卸载时误删。

## 工作区与执行作用域

每实例每包首次加载由 Host 创建专属工作区，以后按身份复用，不加入普通 DSH Workspace Registry。数据 RPC 使用 Host 上下文 `{ packId, workspaceId, workspacePath, generation, status }`，浏览器不能以 agentId / cwd 选任意数据目录。路径见[运行数据布局](31-runtime-data-layout.md)。

Host 声明 `lwbPackServices`，用 `getLwbPackScope(ctx, manifest)` 或 `ctx.lwbPackServices.forPack(manifest.id)` 获取作用域：

| 接口 | 契约 |
|---|---|
| `context()` | 唯一数据上下文 |
| `request(operation)` | 跟踪完整 RPC |
| `background(promise)` | 跟踪后台任务，包含最后写入及衍生队列工作 |
| `onStop(disposer)` | 停止计时器等资源 |
| `signal` / `fetch` | 包级取消及合并取消的 HTTP |
| `withAgent(operation, signal?)` | 创建、使用、释放包内原生 Agent |
| `sessions.create/resume/get` | 管理包自有会话，登记归属 |
| `sessions.adopt(agent)` | 接管自行创建的原生根会话，cwd 须等于包工作区 |
| `assertAgent(agent)` | 工具调用验证包目录归属 |
| `credentials` | 包命名空间内的业务凭据 |
| `settings(name, schema)` | 独立 JSON 设置，串行原子写入，加入卸载屏障 |

根会话发布工作前须登记归属；自行创建用 `sessions.adopt`。内部根 Agent 挂载 standard 预设及 workspace-write 权限，子代理继承原生边界。这提供归属与调度隔离，不保证不能读取工作区外文件。

场景模型可跟随 DSH 或独立选已有路由；新任务捕获选择，运行中不随设置变化。认证由 DSH 适配器处理。已声明且确定缺失的凭据引用会提示并使调度轮次预检失败；未声明引用的账号、设备、OAuth 路由和探测报错按未知处理，不拦截。`executionStatus` 只判断选择存在，不表示联网或认证成功。TTS、ASR、封面凭据独立于文本模型。

卸载先关闭入口，再取消 HTTP、Agent、ASR WebSocket、ffmpeg 与计时器，最后等前台、后台、写入和衍生任务结算。子进程取消须等 `close`；Remotion 等 CLI 结算，不把 AbortError 视为已退出。30 秒未停止返回忙碌，禁止数据维护，结算后可重试。Loader 删除组等待异步释放。

## 包内会话与官方右栏

包页面位于宿主 overlay，可自行布局原生会话：

```js
h('article', { onPointerDownCapture: () => focusSession(run.sessionId) },
  h('div', { className: 'example-conversation' },
    renderConversation({ sessionId: run.sessionId })),
)
```

`renderConversation` 使用官方 `conversation.content` Factory 与对应 session scope，显示回答、工具、文件 chip 和 composer，不改变 frame 会话。`focusSession` 只接受本页已挂载的自有会话，使官方右栏跟随焦点；最后嵌入释放时，仅在用户未另行导航的情况下恢复原会话。

每会话仅一个 composer。首次嵌入注册优先级 `-10` 的空 `main.conversation` 占位，最后释放移除；保持 `activePanelId === null`，frame session 指向选中卡片。不得手动重绑 editor root；当前会话用 `uiSession.adapter.current`。各卡片独立取消，15 秒就绪超时可重试，过期结果不得覆盖或释放其他卡片。

官方面板由卡片共享。标题提供展开操作，切换卡片后默认收起，官方文件操作打开时除外；开关传明确目标状态。文件 chip 先聚焦、等对应 surface 挂载，再调用官方 `sidebarRight.openResource`，有界重试且不得打开到错误会话。overlay 只测量可见面板，忽略隐藏保留面板，通过 `--lwb-rightbar-inset` 让宽；全屏和窄屏另行适配。

`sessions.create({ provider, model, cwd })` 的 cwd 为包工作区内 `/` 分隔的相对路径，如 `runs/<taskId>/<runId>`；Host 逐段创建并拒绝符号链接和越界，缺省使用包根。`resume` 须用创建时同一 cwd。文件地址为 `dsh-resource://file/session/<sessionId>/<path>`，由官方处理。

会话可以传入 `tools: 'none'` 与完整 `system` 提示词，此时使用无工具预设并启用 DSH 原生自动压缩。`maxTokens` 省略时不新增输出覆盖值，复用已有会话时保留原策略；传入正整数显式设置输出上限，传入 `null` 清除原策略及继承请求头中的上限，恢复模型/适配器默认。竞技台使用 `null` 兼容旧比赛，测评包使用标准会话默认。

## 对话模块的官方左栏

Workspace 浏览器用 `sidebar.workspaces`，面板行用 `sidebar.panellist`；两者必须声明在实际渲染它们的 `shell.overlay` entry 的 children 下，放在 sidebar entry 会使 overlay 崩溃。新对话按钮硬编码在官方 shell 中，LWB 对应按钮按官方行为调用 `uiWorkspace.startSession()`。

这些功能位于对话的 264px 次级栏，产品导航放品牌、三模块与设置。面板行读取 `entriesOfSlot`、订阅变化和 locale；label 可为函数，Glyph 用注册组件。以 `layout.panelInfo` 判定选中，用绑定到服务对象的 `services.layout.selectPanel(id)` 切换，确认同名 main 存在；进入对话或新会话调用 `selectPanel(null)`。

以归属 id 和 cwd 位于包工作区内两条事实过滤包根会话，路径比较须有分隔符边界。投影后的 `useSessions` / `useWorkspaces` 只从 owner props 传给官方座位，保持 snapshot identity；归属 RPC 未完成延迟首次渲染，未知归属不擅自隐藏。子代理与空会话由官方过滤，清空或解绑仍保留历史归属，不改 Session 格式。

owner hook 覆盖依赖未文档化的合并顺序，与上游“业务不把 hook selector 作为 prop”的指导存在偏离，升级须核验。回归见 `lwb/dsh-bundle/test/client-conversation-seat.test.mjs`，门禁见[基座升级](08-base-lock.md)。
