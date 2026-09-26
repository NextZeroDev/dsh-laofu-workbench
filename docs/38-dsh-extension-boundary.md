# DSH 与 LWB 的扩展边界

实施日期：2026-09-26。当前只支持 `dsh-v0.1.7-rc.2`，commit `477b4f420553e8a52c2fbccc464d7561b239c443`。

## 产品约束

Web 和 Desktop 装配相同的三个基础模块：对话、场景能力包、设置。共用 LWB 客户端、业务服务、Pack SDK 和场景能力包。内部注册表及动态加载、卸载、重载、启动恢复继续是产品能力；具体场景包不进入静态 Profile。

开发期不提供旧版本 API 分支、旧数据路径回退或自动迁移。旧目录留在磁盘上，新版本默认不读取。升级可以调整内部实现和数据格式，不能通过删减业务模块来通过验收。

## 责任划分

| 层 | 所属代码 | 升级时检查 |
| --- | --- | --- |
| 官方引擎与载体 | 干净的 `vendor/deepseek-harness` | 精确 commit、依赖安装、官方构建 |
| Profile 装配 | `lwb/profile-setup.mjs`、Bundle 的 `cordis.patch.yml` | `initProfile`、包解析、配置行 ID |
| Desktop 入口 | `lwb/desktop/dev.mjs`、`bootstrap.mjs`、`package-config.mjs` | 官方开发入口、资源布局、构建配置工厂 |
| 动态加载边界 | `lwb/dsh-bundle/dsh-adapter/` | Cordis Loader、活动状态、官方客户端 graph 同步 |
| 产品与业务包 | Registry、Pack Services、SDK、`lwb/packs/` | 页面、业务服务、工作区隔离、卸载等待 |

浏览器端通过 `modules.entries.sync()` 使用官方串行模块控制器；LWB 不再手动注入脚本、创建客户端 Loader 条目或清理官方模块缓存。

`cordis.patch.yml` 是 DSH 官方 Bundle 的声明式组合机制，不是修改官方源码的文本补丁。原来的 `patch-upstream.mjs` 已删除。

不能把“零源码补丁”理解成“升级永远零改动”。当前 Loader 的 `group.data`、`fiber.inertia`、内部状态枚举，以及客户端 slots、图标、服务方法、Profile 行 ID 和 Desktop 构建工厂都属于版本相关接缝；它们没有跨版本稳定性保证。适配只针对当前版本，不添加旧版本探测分支。

## 设置与数据

模型、凭据、权限、普通会话仍由 DSH 管理。DSH 新版原生配置走 volatile Config 和 Profile patch。LWB 不再注册已移除的 `settings.register`/`installSection`，不再创建等待上游导入的 `settings.yaml`。

场景包的媒体/发布偏好通过 `scope.settings(name, schema)` 写入独立工作区的 `settings/*.json`；写入串行、原子替换，卸载通过工作区请求屏障等待。密钥仍交给 DSH Credentials。场景包通过 SDK 的 `execution` 入口使用 DSH 执行器。

源码启动默认数据根为 `lwb/local/current`。Web/Desktop 共享产品数据根，激活目录分别是 `dsh-home/profiles/lwb` 和 `dsh-home/profiles/desktop`。同时运行两个 Host 修改同一数据根尚不支持。

## 升级门禁

1. 在新分支锁定精确 tag/commit，并同步产品声明的 DSH peer 版本。
2. `npm run setup`：遇到被修改的上游源码立即拒绝；切换版本时把整个旧 checkout 移入 `.tooling`，再从干净 checkout 安装和构建，避免残留产物。
3. `npm run upstream:check`：检查 HEAD、官方源码洁净、版本声明、必要构建与 UI 导出。
4. `npm test`：Profile、能力包和业务回归。
5. `npm run test:integration`：临时数据根启动真实官方 HTTP Host，验证原生认证、加载、8 个菜单、卸载、重载、账号保留、重启恢复。
6. UI 验收两种载体的对话、工作区、附件、设置和场景包页面。供应商付费调用与发布打包单独验收。

签名版打包必须配置产品自己的 app ID、签名、公证和更新源。禁止把 LWB 指向官方 DSH 生产更新源，避免应用被官方发行包覆盖。打包配置保留官方的签名与 runtime 校验钩子，产物发布不会自动执行。

## 本次验收记录

- 官方依赖安装、引擎构建、Desktop 构建完成；`upstream:check` 通过，官方源码没有修改。
- `npm test`：303 项全部通过；最后设置入口调整后，相关 16 项客户端检查再次通过。
- 真实 Host 集成通过：原生认证、动态加载/卸载、图增删、8 个菜单、账号保留、重启恢复。
- 浏览器实测口播包 8 个业务页面显示；桌面实测跳过密钥配置后进入 LWB、卸载/重载、账号定位页面和直接打开原生系统设置。
- 没有调用付费模型/媒体服务，没有执行对外发布。完整业务生成链仍需真实供应商验收。
- 打包预检被缺少官方本地 `.env.macos` 配置阻断；打包入口已实现，但尚未产出或安装签名应用，不能据此宣称发行包可交付。
