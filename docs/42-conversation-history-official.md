# 42 对话模块使用官方左栏

实施日期：2026-09-30。适用 DSH `dsh-v0.2.0-rc.2`。本文记录"对话模块的左侧会话历史改回官方渲染"这一决策、它依赖的上游接缝，以及升级时必须复核的点。

## 背景

此前 LWB 自绘了对话模块的左栏：248px 产品导航列（`LwbSidebar`）+ 264px 会话历史面板（`ConversationOverlay` 内的 `.lwb-conversation-pane`）。两者都与官方 `ui-sidebar` 的形态不同——官方只有一列，自上而下是品牌行、新建对话、面板图标行、`sidebar.workspaces` 浏览区、底部设置行。

产品要求是：**保留 LWB 的产品导航列，只把对话模块内的会话历史列换成官方渲染**。场景能力包页与设置页不受影响。

## 为什么不是"重新启用 ui-sidebar"

`lwb/dsh-bundle/cordis.patch.yml` 关闭了官方 `ui-sidebar`（"LWB owns the complete sidebar"）。重新启用它会连带产生两个后果：

1. `ui-sidebar` 的 `children` 表会声明 `sidebar.settings`，与 LWB overlay 自己声明的同名声座位冲突（"already declared"，整个工作台壳注册失败）。
2. LWB 的"设置"页依赖 `renderSlot('sidebar.settings', { wide: true })` 承载官方设置面板，换主人会改动设置页。

因此 `ui-sidebar` 继续关闭。官方会话浏览器的激活方式是另一条：**`ui-workspace` 早就注册好了，只是它等的座位没人声明。** `ui-workspace` 通过 `ctx.slots.inject('sidebar.workspaces', …)` 注册 `WorkspaceBrowser`；座位由谁声明它不管。LWB 声明该座位，上游那个休眠注册随即生效——声明位置见下节，它必须落在渲染该座位的条目上。

## 实现

| 位置 | 做法 |
|---|---|
| `client.js` 的 `shell.overlay` 注册 | `children` 增加 `'sidebar.workspaces': { kind: 'single', scope: 'root' }` 与 `'sidebar.panellist': { kind: 'list', scope: 'root' }`，并移除 `'sidebar.workspaces.directoryFlow'` —— 后者的座位改由 `ui-workspace` 的注册声明，重复声明会在加载期报错 |
| `sidebar` 注册 | 不动，保持无 `children`（产品导航不渲染任何座位） |
| `ConversationOverlay` | 264px 柱子里按官方顺序渲染：`renderSlot('sidebar.workspaces', { wide: true, expandSidebar: () => {}, ... })`、面板行、以及官方规格的「新会话」 |
| 官方左列的两行 | 「新会话」不属于任何座位（官方 sidebar 里是硬编码 DOM），按官方规格自绘，动作仍是 `uiWorkspace.startSession`，带 `session.new` 快捷键提示且首帧可用；`sidebar.panellist` 的每一行按官方顺序渲染，glyph 用注册者组件，label 按官方 `resolveSlotLabel` 的契约解析（注册者可传函数以跟随语言），选中态读官方 `layout` 的 `panelInfo` |
| 保留 | 列宽 264px、`[data-lwb-conversation-active]` 的 280px 让位、移动端抽屉、列头「会话」 |

### 座位必须声明在渲染它的那个条目上

`renderSlot` 不是全局函数：渲染器**按条目**绑定它（`ui-renderer/src/client/scoped-slots.tsx` 的 `kit['renderSlot'] = boundRenderSlot(host, entry)`），调用时校验该座位是否出现在**这个条目自己**的 `children` 表里，否则抛 `SlotOwnershipError`。

所以 `'sidebar.workspaces'` 尽管名字属于 `sidebar`，但因为它由 `ConversationOverlay` 渲染、而 `ConversationOverlay` 属于 `shell.overlay` 条目，声明就必须挂在 `shell.overlay` 的 `children` 上。`shell.overlay` 上已有的 `'sidebar.settings'` 是同一个先例：children 的键是全局座位名，与它挂在哪个父条目的表里无关，而与**谁渲染**有关。

> **踩过的坑（2026-09-30）**：最初把该声明挂在 `sidebar` 注册上。座位本身照样被声明、`ui-workspace` 照样注册进来，但渲染期 `ConversationOverlay` 抛出 `slot 'sidebar.workspaces' is not declared by this entry's children`。由于 `SlotOwnershipError` 不是 `SlotAssemblyError`，条目错误边界不向上抛，而是把**整个 `shell.overlay` 条目**替换成 `<div data-slot-error="shell.overlay">`：会话历史列消失，场景能力包页与设置页也一并消失（三者同属该条目），表现为"点左侧导航没反应"。控制台里只有 `slot entry crashed in 'shell.overlay':`。回归护栏见 `lwb/dsh-bundle/test/client-conversation-seat.test.mjs`。

`WorkspaceBrowser` 不渲染全局"新会话"按钮（那属于官方 sidebar 壳，而且是它自己的硬编码 DOM，没有座位可借），所以该按钮由 LWB 在面板内按官方规格自绘（`lwb-conversation-new`：通栏、文字、`session.new` 快捷键提示、首帧即可用），动作仍是 `services.uiWorkspace.startSession()`；每个工作区行内的 `+`、搜索、置顶拖拽、行菜单、归档筛选、归档活动确认全部来自官方。官方全局面板行（今天的「插件」）走 `sidebar.panellist`：行外壳、label、选中态属于壳，glyph 属于注册者——与官方 sidebar 的分工一致。完整决策见[对话模块内的官方面板行](44-official-panel-rows.md)。

### 宿主侧数据

`WorkspaceBrowser` 的令牌（`--dsh-sidebar-inline-padding`、`--dsh-scrollbar-thumb`）原本定义在官方 sidebar 根元素上，而该元素不再渲染，因此 `.lwb-conversation-pane` 自己声明它们，并按官方 `.regionArea` 的几何给出 `.lwb-conversation-region`。

### 过滤能力包会话

官方浏览器读的是根标准 hook（`useSessions` / `useWorkspaces`），没有过滤入口。而 LWB 必须让能力包的内部会话不出现在普通历史里（见[专属工作区](29-pack-owned-workspaces.md)）。

采用的办法是利用渲染器已文档化的合并顺序——**owner props 最后展开、覆盖一切**：

```
<Comp {...kit} {...injected} {...slotInjected.props} {...contextual} {...ownerProps} />
```

`ConversationOverlay` 因此把自己包装过的 `useSessions` / `useWorkspaces` 作为 owner props 传给这个座位，投影函数按两条宿主事实剔除包归属：

| 事实 | 来源 | 覆盖什么 |
|---|---|---|
| 归属会话 id | `lwbPacks/visibility` 的 `sessionIds` | 已登记的包内根会话 |
| 会话目录 | 该 Session 概要的 `cwd` 落在 `visibility.workspacePaths` 之下 | 索引读取之后新出现的包内会话 |
| 包工作区 | `workspaceIds` / `workspacePaths` 与工作区实体比对 | 已在 DSH 工作区登记表中的包工作区（见下） |

**为什么必须第二条**：归属索引是拉取式 RPC，只在插件启动、连接重置、能力包加载/卸载、清空与解除注册时重读（`client.js` 的 `refreshPackCatalog`）。而一个能力包可以在页面已经打开之后才创建会话 —— 模型博主评测点一次「开始测评」就会新建 1–4 个 run 会话，每个会话 id 都是那时才写入索引的。此时按 id 认不出来，只有它的目录能证明归属。反过来，目录不随会话创建而变，所以它对「刷新之后才消失」这类闪现是免疫的。

目录比较必须要求**分隔符**：`/root/pack` 不能吞掉同前缀的兄弟目录 `/root/pack-2`；`cwd` 缺失或路径集合为空时一律不隐藏（宁可漏出，也不能误删用户会话）。同一目录规则也覆盖包用原生 Agent 服务自行创建、尚未登记的自建根会话。

三点实现约束：

- 投影必须按**底层快照 identity 记忆化**：浏览器用 `useSessions(state => state)` 选中整份快照，每次返回新对象会无限重渲染；隐藏不了任何会话时必须原样返回入参。
- 官方已经自带 `origin === 'subagent'` 与"只保留当前空会话"的过滤（`ui-workspace/src/client/tree.ts`），LWB 不重复实现。这两条正好覆盖口播包的两类会话（子代理会话、从不提交提示词的空壳根会话）；模型博主评测的 run 是**根会话且非空**，官方两条都不命中，因此它完全依赖上表前两条。
- 后端内容检索（`sessions.search`）不需要单独过滤：搜索结果只在 Session 概要仍然存在时才成行，投影已把它移出。

归属索引是异步 RPC，首帧为空。此时不渲染座位、显示等待态，避免包会话闪现后消失。首帧之后的闪现由目录规则兜住；索引仍保留为宿主侧的权威归属记录（`sessions.adopt`、归档、包内会话读取都以它为准）。

## 上游接缝（升级必查）

这条实现不改上游源码，但依赖十处没有跨版本稳定性保证的事实；`npm run upstream:check` 已经把其中九项变成加载期断言：

1. `ui-workspace` 仍然把浏览器注册进 `sidebar.workspaces`（`src/client/index.ts`）。
2. 渲染器的 props 合并仍然是 owner props 最后展开（`ui-renderer/src/client/scoped-slots.tsx`）。
3. `renderSlot` 的授权仍然读**渲染条目自己**的 `children` 表（同上文件，`entry.children?.[key]`）。这条决定座位声明挂在哪个条目上；它一变，声明位置就得重新推导。
4. `--dsh-sidebar-inline-padding` 等令牌仍由官方 sidebar 根元素定义——若上游把它们移出该元素，LWB 的重复声明可以删除。
5. 客户端会话列表概要仍投影 `cwd`（`api/session-controller/src/client/sessions/service.ts` 的 `projectList`）。目录规则读的就是它；上游一旦停止投影，规则退化为静默失效，包会话会重新出现在历史里。`npm run upstream:check` 已把这一项变成断言。
6. `ui-plugin-manager` 仍注册 `sidebar.panellist` 行（label 为「插件」）与 `main` 座位的 `plugins` 面板。这是「插件」行与插件页的接缝；两者任一变，面板行要么消失要么点不开。
7. `AppFrame` 的 `main` 仍以 `entryKey: panelId ?? 'conversation'` 派发（`ui-layout/src/client/AppFrame.tsx`）。`selectPanel(null)` 回到对话这一行为依赖它；上游一旦把默认条目换成别的键，返回对话就会落空。
8. 对话模块的面板行靠 `layout` 服务渲染选中态与执行选择：`ILayout.panelInfo` 与 `selectPanel(panelId: MainPanelId | null)`（`ui-layout/src/client/service.ts`），并仍以 `ctx.reflect.provide('layout', layout)`（`ui-layout/src/client/index.ts`）暴露。
9. 官方右栏以 `activePanelId === null` 且已选中的会话为在屏会话：`show(layout.panelInfo.getSnapshot().activePanelId === null ? selected?.sessionId : undefined)`（`ui-sidebar-right/src/client/index.ts`）。包页面保留这两个状态；替换被覆盖的 Conversation 内容不会改变它们。
10. 官方仍注册 `main.conversation` 内容入口。包页面通过公开 slot 优先级暂时替换它，避免 frame 与卡片同时挂载同一会话的 composer；最后一条嵌入会话卸载时恢复官方入口。当前选择由 `uiSession.adapter.current` 提供。见 [41](41-capability-session-surface.md#一个会话一份输入框只挂载卡片中的-conversation)。

第 6、7、8、9、10 项同样由 `npm run upstream:check` 断言。面板行的 id 由注册者提供、不写死在 LWB 里，所以新增面板行无需改 LWB；但**行内必须存在同名 `main` 面板**，否则 LWB 会按 `layout.selectPanel` 的契约跳过这次选择而不是抛错（`conversationPanelRegistered` 守卫）。

第 2 项同时是 [`packages/client/AGENTS.md`](../../vendor/deepseek-harness/packages/client/AGENTS.md) 明确禁止的模式（"Business code never creates a hook or selector as a prop value"）。它在这个装配下可用，但不是官方为 `sidebar.workspaces` 座位声明的契约——该座位声明的 owner share 只有 `wide` / `expandSidebar`。升级后如果官方为该座位补上真正的过滤入口，应当改用它。

## 验收

- 普通对话左栏是官方浏览器：置顶、拖拽排序、行菜单（置顶/重命名/分叉/归档）、后端搜索与"仅显示前 N 条"、归档筛选、归档时列出并可停止进行中的工作。
- 能力包内部会话不出现在普通历史，也不出现在搜索结果的 Session 概要里。
- 列内自上而下是官方顺序：「新会话」按钮、（有注册时）面板行、「工作区」浏览区；「新会话」在任何时候都可用，点击后落到对话。
- 点面板行（「插件」）在官方主区打开该面板并在行上高亮；点 LWB 导航的「对话」或新建会话后回到对话。
- 场景能力包页、设置页、能力包页内嵌的官方对话与产物面板行为不变。
- 264px 列收起/移动端抽屉/官方主区让位正常。
