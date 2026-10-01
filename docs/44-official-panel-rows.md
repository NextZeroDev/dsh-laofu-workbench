# 44 对话模块内的官方面板行

实施日期：2026-09-30。适用 DSH `dsh-v0.2.0-rc.2`。本文记录"把官方 DSH 的功能放进对话模块那一列，而不是放进 LWB 产品导航"这一原则，以及「插件」入口与插件页的具体接法。

## 原则

LWB 的左区有两列，归属不同：

- **LWB 导航列**（官方 `sidebar` 座位，`LwbSidebar`）是**产品自己的菜单**：对话、场景能力包、设置，以及各能力包注入的菜单组。
- **对话模块的左列**（264px `.lwb-conversation-pane`）是**官方页面的等价物**：官方 sidebar 里属于会话功能的部分都放在这里，按官方顺序排列。

因此官方的功能（今天的「插件」，以后官方或第三方新增的任何面板行）**不进 LWB 导航**，而是进对话模块那一列。这样官方升级它的左列时，我们跟着变，而不是维护一套平行实现。

## 背景

此前对话模块的左列只有两样东西：自绘的列头「会话 + `+`」，以及官方 `sidebar.workspaces` 座位里的 `WorkspaceBrowser`。于是与官方页面相比缺了两行：

| 官方左列 | 此前 | 现在 |
|---|---|---|
| brand 行（`sidebar.brand.mark` / `sidebar.brand.name`） | 无（品牌属于 LWB 导航列） | 仍未搬入，见"未做的部分" |
| 「新会话」按钮 | 列头一个 `+`，只有 tooltip，且包归属索引读完前 `disabled` | 官方规格的通栏按钮，带 `session.new` 快捷键提示，首帧即可用 |
| 面板行（`sidebar.panellist`，「插件」） | 完全没有 | 由 `sidebar.panellist` 座位驱动，按官方顺序渲染 |
| 工作区浏览区（`sidebar.workspaces`） | 官方 `WorkspaceBrowser` | 不变 |
| 底部设置行 / 账户行 | 无（设置属于 LWB 产品页） | 仍未搬入，见"未做的部分" |

`ui-plugin-manager` 之前被 `cordis.patch.yml` 显式禁用（"LWB owns the product navigation"）。现在它保持启用：插件页是一份官方 `main` 面板，**一行代码都不用改**。

## 实现

| 位置 | 做法 |
|---|---|
| `cordis.patch.yml` | 删除 `ui-plugin-manager: disabled`，改以注释说明为什么必须保持启用 |
| `shell.overlay` 注册的 `children` | 增加 `'sidebar.panellist': { kind: 'list', scope: 'root' }`。座位必须声明在**渲染它的条目**上（同 `sidebar.workspaces`，见 [42](42-conversation-history-official.md#座位必须声明在渲染它的那个条目上)） |
| 行数据 | `ctx.slots.entriesOfSlot('sidebar.panellist')` + `ctx.slots.subscribe` + `locale.subscribe`，投影成 `{ id, label }` 快照；label 按官方 `resolveSlotLabel` 的契约解析（`typeof label === 'function' ? label() : label`，本地内联，未额外请求 ui-slots 模块）。按内容比较后才替换快照，因为 `entriesOfSlot` 每次返回新数组而 React store 需要稳定 identity |
| 行渲染 | `renderSlot('sidebar.panellist', { size: 16, active }, { only: panel.id })` 提供 glyph；行外壳、label、选中态是壳自己的（与官方 `SidebarRoot` 的 `PanelRow` 分工一致） |
| 选中态 | `usePanelInfo(info => info.activePanelId === id)`（ui-layout 的 `provideRoot` 对每个条目都绑定） |
| 点击 | `services.layout.selectPanel(id)`，**必须作为服务方法调用**：官方 `LayoutController.selectPanel` 读自身的 `hasMainPanel` / `panels` 字段，把方法解构成裸函数再调用会以 `this === undefined` 抛错（`Cannot read properties of undefined (reading 'hasMainPanel')`）。回归护栏见 `client-conversation-seat.test.mjs` 用类实例做假服务的用例。前置 `conversationPanelRegistered` 守卫：面板未注册时**跳过**而不是抛错（`layout.selectPanel` 对未注册 key 会抛） |
| 「新会话」 | 自绘（`lwb-conversation-new`）：官方文案 `新会话`、`session.new` 快捷键提示、`aria-keyshortcuts`，动作 `uiWorkspace.startSession()`。官方那颗按钮是 `SidebarRoot` 里的硬编码 DOM，没有座位，借不到 |
| 回到对话 | `navTo('conversation')` 与 `showConversation()` 调 `selectPanel(null)`（`AppFrame` 的 `main` 以 `panelId ?? 'conversation'` 派发），避免"回到对话却还停在插件页" |

## 为什么「新会话」只能自绘

官方 `SidebarRoot` 的「新会话」不是座位：

```text
<button className={css.newSession} onClick={() => { startSession() }}>…</button>
```

`session.new` 的文案、图标、快捷键提示、位置都在官方 sidebar 壳里。LWB 关掉了那个壳，因此这一颗按钮只能是"同一动作 + 官方规格"的自绘版本。除此之外，面板行、工作区浏览区、以后官方新增的面板行都走座位，自动跟随官方。

## 未做的部分（有意留白）

官方左列还有两行没有搬进来，都需要产品判断：

1. **brand 行**：搬进来会显示官方品牌（`ui-brand-official` 填的鲸鱼 + DSH 名称），与 LWB 导航列的品牌并存。当前保持"品牌只在 LWB 导航列"。
2. **底部设置行 / 账户行**（`sidebar.settings` + `sidebar.footer.action`）：设置目前是 LWB 产品页，搬进来会多出第二个入口。注意 `sidebar.settings` 座位已由 `shell.overlay` 声明并用于设置页内嵌官方设置面板，谁渲染谁声明，搬动前要一并处理。

## 上游接缝（升级必查）

新增三项，均由 `npm run upstream:check` 断言（见 [42 的上游接缝](42-conversation-history-official.md#上游接缝升级必查) 第 6、7、8 项）：

1. `ui-plugin-manager` 仍注册 `sidebar.panellist` 行与 `main` 座位的 `plugins` 面板。
2. `AppFrame` 的 `main` 仍以 `entryKey: panelId ?? 'conversation'` 派发。
3. `layout` 服务仍发布 `panelInfo` 与 `selectPanel`，并以同名服务暴露：行的高亮与点击都读它。

另外这条实现依赖 `ctx.slots.entriesOfSlot` / `subscribe` 的行为，以及"注册者可把 `label` 传成函数"这一契约（`resolveSlotLabel` 目前就是一行 `typeof label === 'function' ? label() : label`，因此本地内联而不是再请求一个模块）；行数据按内容比较 identity 这一点不能退化，否则面板行会无限重渲染。

## 代价

- 插件页让用户能切换**官方 profile bundle 行**（智能化团队、自动授权审查、自动化任务、语音输入等实验特性），写入运行 profile 的用户层（`lwb/local/current/dsh-home/profiles/<id>/cordis.patch.yml`），重启生效。这是官方页面自带的能力，产品上接受。
- 官方插件页自带一个 `shell.overlay` 刷新提示条（id `plugin-manager.refresh-toast`），与 LWB 的 `lwb-workbench-management` 同属 list 座位、id 不同，不冲突。
- LWB 仍然不渲染官方 sidebar 的品牌行与底部设置行，所以"与官方完全同构"还没有做到；真要同构需要重新启用 `ui-sidebar`，代价见 [42 的否掉路线](42-conversation-history-official.md)。

## 验收

- 对话模块左列自上而下：「会话」列头、官方规格「新会话」按钮、（有注册时）面板行、「工作区」浏览区。
- 「插件」行显示官方 pinwheel glyph 与官方 locale 文案（中文「插件」），点击后官方主区显示插件页（官方 N 项开关 + 添加插件），行上高亮。
- 在插件页时左侧仍是 LWB 导航 + 官方会话历史面板（与官方"侧栏不动、只换主区"一致）。
- 点 LWB 导航的「对话」、或新建会话，回到对话本身而不是上次打开的面板。
- 重复加载/卸载能力包、切换语言后，面板行的 label 与选中态仍然正确；没有注册面板行时不出现空行。