# 42 对话模块使用官方左栏

实施日期：2026-09-30。适用 DSH `dsh-v0.1.7-rc.2`。本文记录"对话模块的左侧会话历史改回官方渲染"这一决策、它依赖的上游接缝，以及升级时必须复核的点。

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
| `client.js` 的 `shell.overlay` 注册 | `children` 增加 `'sidebar.workspaces': { kind: 'single', scope: 'root' }`，并移除 `'sidebar.workspaces.directoryFlow'` —— 后者的座位改由 `ui-workspace` 的注册声明，重复声明会在加载期报错 |
| `sidebar` 注册 | 不动，保持无 `children` |
| `ConversationOverlay` | 264px 柱子里渲染 `renderSlot('sidebar.workspaces', { wide: true, expandSidebar: () => {}, ... })` |
| 保留 | 列宽 264px、`[data-lwb-conversation-active]` 的 280px 让位、移动端抽屉、列头「会话 + 新建」 |

### 座位必须声明在渲染它的那个条目上

`renderSlot` 不是全局函数：渲染器**按条目**绑定它（`ui-renderer/src/client/scoped-slots.tsx` 的 `kit['renderSlot'] = boundRenderSlot(host, entry)`），调用时校验该座位是否出现在**这个条目自己**的 `children` 表里，否则抛 `SlotOwnershipError`。

所以 `'sidebar.workspaces'` 尽管名字属于 `sidebar`，但因为它由 `ConversationOverlay` 渲染、而 `ConversationOverlay` 属于 `shell.overlay` 条目，声明就必须挂在 `shell.overlay` 的 `children` 上。`shell.overlay` 上已有的 `'sidebar.settings'` 是同一个先例：children 的键是全局座位名，与它挂在哪个父条目的表里无关，而与**谁渲染**有关。

> **踩过的坑（2026-09-30）**：最初把该声明挂在 `sidebar` 注册上。座位本身照样被声明、`ui-workspace` 照样注册进来，但渲染期 `ConversationOverlay` 抛出 `slot 'sidebar.workspaces' is not declared by this entry's children`。由于 `SlotOwnershipError` 不是 `SlotAssemblyError`，条目错误边界不向上抛，而是把**整个 `shell.overlay` 条目**替换成 `<div data-slot-error="shell.overlay">`：会话历史列消失，场景能力包页与设置页也一并消失（三者同属该条目），表现为"点左侧导航没反应"。控制台里只有 `slot entry crashed in 'shell.overlay':`。回归护栏见 `lwb/dsh-bundle/test/client-conversation-seat.test.mjs`。

`WorkspaceBrowser` 不渲染全局"新建对话"按钮（那属于官方的 sidebar 壳），所以列头的 `+` 保留，调用 `services.uiWorkspace.startSession()`；每个工作区行内的 `+`、搜索、置顶拖拽、行菜单、归档筛选、归档活动确认全部来自官方。

### 宿主侧数据

`WorkspaceBrowser` 的令牌（`--dsh-sidebar-inline-padding`、`--dsh-scrollbar-thumb`）原本定义在官方 sidebar 根元素上，而该元素不再渲染，因此 `.lwb-conversation-pane` 自己声明它们，并按官方 `.regionArea` 的几何给出 `.lwb-conversation-region`。

### 过滤能力包会话

官方浏览器读的是根标准 hook（`useSessions` / `useWorkspaces`），没有过滤入口。而 LWB 必须让能力包的内部会话不出现在普通历史里（见[专属工作区](29-pack-owned-workspaces.md)）。

采用的办法是利用渲染器已文档化的合并顺序——**owner props 最后展开、覆盖一切**：

```
<Comp {...kit} {...injected} {...slotInjected.props} {...contextual} {...ownerProps} />
```

`ConversationOverlay` 因此把自己包装过的 `useSessions` / `useWorkspaces` 作为 owner props 传给这个座位，投影函数按 `lwbPacks/visibility` 的 `sessionIds` / `workspaceIds` / `workspacePaths` 剔除包归属。三点实现约束：

- 投影必须按**底层快照 identity 记忆化**：浏览器用 `useSessions(state => state)` 选中整份快照，每次返回新对象会无限重渲染。
- 官方已经自带 `origin === 'subagent'` 与"只保留当前空会话"的过滤（`ui-workspace/src/client/tree.ts`），LWB 不重复实现。
- 后端内容检索（`sessions.search`）不需要单独过滤：搜索结果只在 Session 概要仍然存在时才成行，投影已把它移出。

归属索引是异步 RPC，首帧为空。此时不渲染座位、显示等待态，避免包会话闪现后消失。

## 上游接缝（升级必查）

这条实现不改上游源码，但依赖四处没有跨版本稳定性保证的事实；`npm run upstream:check` 已经把前三项变成加载期断言：

1. `ui-workspace` 仍然把浏览器注册进 `sidebar.workspaces`（`src/client/index.ts`）。
2. 渲染器的 props 合并仍然是 owner props 最后展开（`ui-renderer/src/client/scoped-slots.tsx`）。
3. `renderSlot` 的授权仍然读**渲染条目自己**的 `children` 表（同上文件，`entry.children?.[key]`）。这条决定座位声明挂在哪个条目上；它一变，声明位置就得重新推导。
4. `--dsh-sidebar-inline-padding` 等令牌仍由官方 sidebar 根元素定义——若上游把它们移出该元素，LWB 的重复声明可以删除。

第 2 项同时是 [`packages/client/AGENTS.md`](../../vendor/deepseek-harness/packages/client/AGENTS.md) 明确禁止的模式（"Business code never creates a hook or selector as a prop value"）。它在这个装配下可用，但不是官方为 `sidebar.workspaces` 座位声明的契约——该座位声明的 owner share 只有 `wide` / `expandSidebar`。升级后如果官方为该座位补上真正的过滤入口，应当改用它。

## 验收

- 普通对话左栏是官方浏览器：置顶、拖拽排序、行菜单（置顶/重命名/分叉/归档）、后端搜索与"仅显示前 N 条"、归档筛选、归档时列出并可停止进行中的工作。
- 能力包内部会话不出现在普通历史，也不出现在搜索结果的 Session 概要里。
- 场景能力包页、设置页、能力包页内嵌的官方对话与产物面板行为不变。
- 264px 列收起/移动端抽屉/官方主区让位正常。
