# 产品定位与总体架构

老傅工作台（LWB）建立在锁定的 DeepSeek Harness（DSH）之上，提供“对话”“场景能力包”和“设置”。公开仓库包含口播视频与 AI 竞技台；官方完整发行版还可装配私有会员包。业务扩展优先放入独立能力包，基础 Profile 不引用具体业务包。

## 职责分层

| 层 | 职责与事实源 |
|---|---|
| LWB 产品壳 | 三模块导航、包目录与生命周期、工作区归属、场景任务模型选择 |
| DSH 运行时与原生 UI | Session、普通工作区、模型路由与认证、工具、权限、审批、对话和右侧面板 |
| 能力包 | 业务页面、流程、任务与产物；通过宿主作用域使用共享 DSH |
| ATS 私有服务 | LWB 账号、积分、套餐、真实供应商映射及计费 |

LWB 不维护第二套聊天运行时、Session 格式或模型协议。普通对话使用 DSH 当前模型与权限；“场景任务默认模型”可跟随 DSH，也可选择已配置路由，新任务捕获选择，不改变普通对话默认模型。

对话次级栏复用官方 Workspace 浏览器与面板行。LWB 在渲染入口投影会话和工作区列表，以归属索引及路径隐藏包内部会话，只影响可见性，不改原生存储。包可嵌入原生对话卡片，官方右栏由聚焦会话驱动；细节见[能力包契约](12-capability-packs.md)。

设置是唯一产品配置入口，承接 DSH 原生语言、外观、模型、凭据、权限和审批；LWB 账号与媒体业务凭据独立。包状态来自 Host 登记和实际挂载，浏览器不能伪造启用、卸载或权益。

## 扩展边界

Web 与 Desktop 使用同一套 Bundle 和包代码。通过 Profile、Cordis Bundle、SDK 与当前版本适配层组合上游；`vendor/deepseek-harness` 受跟踪源码必须干净，不保留旧 API 分支或自动旧数据导入，不装配实验 `agent-team` / `tool-agent-team`。

`lwb/dsh-bundle/dsh-adapter/` 集中处理版本适配。`cordis.patch.yml` 是官方声明组合，不是源码文本补丁。当前设置通过 volatile Config / Profile patch 接入，不使用已移除的 `settings.register`、`installSection` 或 `settings.yaml` 桥。

Desktop 有一处内存入口适配：`lwb/desktop/entry-policy.mjs` 通过 Node loader hook，仅转换官方主入口的 `needsWelcome` 判断，使匿名、退出登录或认证失效时仍能进入 LWB。首次加载后 hook 注销；开发入口以 `--import` 安装，发行版由 bootstrap 在官方主入口前安装。Host、构建与 Web 不受转换影响，官方认证、凭据和任务取消机制继续执行。精确谓词和调用位置受版本检查约束，不匹配即失败。

Loader 的 `group.data`、`fiber.inertia`、模块状态、slot、Profile id、Factory 与 owner props 合并顺序可能随上游变化；源码干净不代表接缝稳定。owner hook 覆盖依赖未文档化的合并顺序，升级须复核。门禁见[基座锁定与升级](08-base-lock.md)。

## 数据与发行边界

能力包由 Host 创建专属工作区，卸载保留文件、配置和归属。普通附件使用 DSH 原生上传和存储。新版本不自动读取旧数据，回滚需匹配代码、上游构建和数据副本，见[运行数据目录](31-runtime-data-layout.md)。

Web 与 Desktop 不应同时运行两个 Host 写同一数据根。Desktop 发行需独立 app id、更新配置、签名和公证，不使用 DSH 官方生产更新服务。构建输入与验证范围见[双端说明](37-desktop-parity.md)。购买会员、积分或服务不授予源码商业使用权，见[许可证说明](licensing-and-commercial-use.md)。
