# 12 场景能力包

LWB 场景能力包是运行时组合的 DSH 插件，不是核心 Profile 的业务模块。基础仓库不依赖任何领域包；`lwb/local/packs.json` 只记录本机已注册包，且已被 Git 忽略。因此克隆项目、拉取更新或不提交某个包目录时，基础版依然可以正常启动，也可以开发和注册其他独立包。

## 使用

```sh
npm run pack:install -- /absolute/path/to/pack
npm run pack:list
npm run pack:remove -- pack-id
```

CLI 注册只把外部包源加入本机市场目录，初始为未启用，不会在下一次启动时加载它。工作台中的“场景能力包”是唯一的能力包生命周期入口：点击“加载”会由主机的 Cordis Loader 动态增加 host/client 条目，并把本机登记的 `enabled` 设为 `true`；后续启动会自动恢复这些已启用包。点击“卸载”会移除这些条目、把 `enabled` 设为 `false`，并保留包源和工作区数据。主机将受控、带版本的浏览器 bundle 返回给当前页面；工作台按需注册或销毁对应的浏览器 Loader 条目，再更新左侧菜单，无需刷新整个页面。

启动器始终只装配基础 Profile，不把任何具体能力包写入 Profile 配置。LWB Bundle 在基础服务启动后读取本机登记表，仅恢复 `enabled: true` 的包；运行时依赖链接与浏览器 bundle 均由这条受控加载链路建立。因此基础版仍可在没有任何场景包源码或本机登记的情况下正常运行；单个能力包恢复失败也不会阻止工作台启动。

## 包契约

一个独立包目录至少包含：

| 文件 | 用途 |
|---|---|
| `lwb-pack.json` | 公开 manifest：身份、版本、说明与菜单 |
| `package.json` | npm 包身份、host/client exports 与 `dsh.client` 声明 |
| `index.mjs` | host entry，注册 manifest 与领域服务/RPC |
| `client.js` | browser entry，向 `lwbPackClient` 注册菜单页面 |

manifest 的 `schemaVersion` 当前为 `1`。`id`、菜单 id 与 npm package name 都经过严格校验；菜单 id 在包内唯一。可选的 `market` 字段可声明分类、标签、工作流和图标，供市场卡片和详情抽屉显示。市场读取 `lwb-pack.json` 与 `package.json` 时不会执行包代码；只有用户明确加载后，Cordis Loader 才 import host/client entry。

详情内容由能力包自己的 `market` 元数据提供，核心只负责通用展示。以下字段均可选，兼容原有 schema 1 manifest：

| 字段 | 用途与约束 |
|---|---|
| `introduction` | 面向用户的用途介绍，最多 500 字符；未提供时使用 `description` |
| `workflowHint` | 工作流补充说明，最多 240 字符 |
| `gettingStarted` | 使用前须知，1–8 条，每条最多 240 字符 |
| `features` | 1–16 张能力说明卡；每项含 `menuId`、`title`（80 字符以内）、`description`（240 字符以内）与可选 `icon`（32 字符以内） |

`features.menuId` 必须引用本包已有菜单且不得重复，卡片颜色继承该菜单。支持的线性图标名为 `pack`、`target`、`signal`、`idea`、`write`、`audio`、`video`、`publish`、`calendar`，未知名称回退到通用能力包图标。未提供 `features` 时从现有菜单生成卡片，不要求旧包补充元数据。

详情抽屉按用途介绍、工作流、能力卡片、使用前须知、折叠的数据管理依次展示；标题与加载/开始使用操作固定，中间内容独立滚动。加载、卸载的结果或错误直接在抽屉内呈现。抽屉支持 Escape、点击遮罩关闭、键盘焦点约束及关闭后返回入口。

Host 侧通过 `lwbPackRegistry.register(manifest)` 注册，或使用 `@scitiger-ai/lwb-pack-sdk` 的 `registerLwbPack(ctx, manifest)`。注册必须由 `ctx.effect()` 托管，使包卸载时自动从运行中目录消失。client 侧声明 `inject: ['lwbPackClient']`，注册形如：

```js
ctx.effect(() => ctx.lwbPackClient.register({
  packId: 'example-pack',
  pages: { home: ExamplePage },
}), 'example-pack: register capability pages')
```

客户端注册同样需要由 `ctx.effect()` 托管，以便卸载时释放页面，允许同一页面会话内反复加载与卸载。

核心只向页面传入公开的 pack/menu 信息、`packId` 与基础导航回调。包不能 import `lwb/dsh-bundle/client.js`，也不能假定核心了解它的业务路由或数据模型。加载时宿主自动创建该包专属工作区；数据 RPC 使用宿主分配的上下文，不依赖普通 DSH 对话。Host 声明 `lwbPackServices` 依赖，通过 SDK `getLwbPackScope(ctx, manifest)` 获取包级目录、任务与凭据服务。完整契约见 [29 能力包专属工作区](29-pack-owned-workspaces.md)。

包应在 `peerDependencies` 或 `dependencies` 中声明所需 DSH 运行时包。装载器会为声明的受控 DSH peer 建立同版本本机链接；其他第三方依赖仍由包自己的包管理流程负责。

## 首个包：口播视频内容创作

`lwb/packs/spoken-video/` 是当前仓库唯一提供的场景能力包，包名为 `@scitiger-ai/lwb-spoken-video`。加载后它贡献一个“口播视频内容创作”菜单组，包含：

- 账号定位：工作区级账号定位库。可新建、编辑、设置默认、归档和恢复多个账号；每个账号有名称、版本和定位/受众/方向/边界。旧版单 profile 会自动迁移为一个「原有账号定位」。选题可明确选择账号或不使用定位；确认选题时将账号快照写入不可变 topic artifact，写稿默认继承该快照。写稿页如需更换账号，会创建新的 topic revision 并使下游产物失效，避免混用账号上下文。
- 信号：默认启用 16 个经主机侧实际采集的公开来源：百度热榜、今日头条、抖音热榜、B站热门内容、知乎热榜、微博热搜、AI 论文日报（Hugging Face）、36氪、InfoQ、IT之家、极客公园、爱范儿、少数派、掘金、GitHub Trending 和 Hacker News；另有「AI 内容日报」内置拉取来源（每 60 分钟 GET 公开报告 `https://scitiger.cn/reports/daily.json`，kind `ai-daily-json`），覆盖抖音 / B站 / 公众号 / 小红书 / 视频号 5 个平台，手动粘贴 JSON 保留为兜底入口。公开采集与 AI 日报是两条独立链路，在信号板上分区呈现、不混排。来源库还支持自定义 RSS / Atom 与 GitHub Releases。采集请求仅在 host 侧执行，来源可启停、设定关键词过滤和采集间隔；每次成功、未变化或失败均记录在审计日志中。所有结果会按链接/标题去重、评分并进入统一信号池，供选题直接消费。信号页默认是「信号板」：今日概览条 + 按情报域分组的来源卡片（AI 日报按平台拆 5 张子卡，带新鲜度徽章），卡片先展示今天拿到的信号 Top3，点击卡片以抽屉展示该来源「今日新增 / 更早」详情，抽屉内可收藏、忽略或「送入选题」一键跳转选题页预选；来源库与采集记录收纳在「来源管理」二级视图。信号模型 schema 9：信号带可选 `platform` 维度（内置平台来源与 AI 日报导入时直接写入）；host 提供只读聚合 RPC `spokenVideo/board` 一次产出整板数据；核心向能力包页面额外传入 `openPackMenu(menuId)` 导航回调。设计详见 [13 信号板设计](13-signal-board.md) 与 [18 信号模块调整方案](18-signal-module-restructure-plan.md)。
- AI 内容日报：`scitiger.cn/reports/daily.json` 自动拉取（每 60 分钟）或手动粘贴导入，信号按平台归一化（抖音 / B站 / 公众号 / 小红书 / 视频号）并带新鲜度语义（fresh ≤72h / recent ≤168h / stale >168h）。不再维护独立的「平台情报」目录。
- 选题：四输入分层组装（标题/角度/信号源/具体信号）交给 DSH 子代理生成候选，人工确认后锁定选题建项目，信号依据写入项目产物。
- 写稿：选择选题后编辑版本化口播稿；支持 AI 起稿/润色（经 DSH 子代理，复用选题执行接缝）、保存后确定性质检（查重/长度/结构/口播书面化，移植自 my-agent）、以及「确认稿件」approve_draft 闸门——稿件未确认或更新后未重新确认时，配音/字幕页不可见且状态机拒绝进入。详见 [19 写稿模块分析](19-script-module-analysis.md)。
- 配音 / 字幕：保存人工或已获批工具生成的配音说明与 SRT。
- 视频 / 预览：保存画面与渲染产物引用，完成质检。
- 发布：直接陈列质检通过的成片（可点开播放），点「发布」在抽屉里查看或生成发布资料（标题/文案/描述/标签 + 横竖封面）。资料齐备即视为可发布；封面可查看并修改生图提示词后单方向重生，也可直接上传。没有人工批准、入队和发布包导出，也不会向任何平台直发。详见 [26 发布模块简化](26-publish-module-simplification.md)。
- 内容安排：持久化的主机侧定时安排、来源范围和运行日志。

项目流仍然遵循：

```text
signals -> topic -> script -> voiceover -> subtitles -> video -> qc -> packaging
```

口播数据位于能力包专属工作区 `data/` 子目录，项目位于 `data/projects/<project-id>/`。每一次阶段提交会写入不可变 artifact；更新任一阶段会清除其下游指针而保留历史文件。请求带期望 revision 与幂等键，避免并发点击造成重复提交。`packaging`（发布资料）是终态阶段，必须先有通过的 QC，且只能由受控的发布 Agent 任务写入。

信号池和内容安排位于 `data/signals.json` 与 `data/schedules.json`；项目仍位于 `data/projects/<project-id>/`。调度器运行在主机进程而非浏览器计时器中，并保留执行记录。信号来源仅允许无凭据的公开 HTTPS 地址，主机在 DNS 解析与重定向后都会拒绝本机和私网地址；这避免自定义订阅源成为 SSRF 入口。后续 TTS、ASR、渲染和发布适配器必须把可计费、网络与发布动作注册为 DSH 工具，并经过 DSH 权限与人工审批边界。

口播创作各模块的原生会话、服务过程与产物展示见 [统一执行详情](32-execution-details.md)。
