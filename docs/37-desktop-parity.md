# Desktop 与 Web 等价承载

LWB 桌面端使用锁定的官方 DSH Electron Desktop、Host 和 Web App。两种载体共用同一个 LWB Bundle、客户端页面和能力包业务代码；不维护另一套桌面业务 UI。

静态 Profile 只包含 `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app` 和 `@scitiger-ai/lwb-dsh-bundle`。能力包仍通过内部注册表动态加载、卸载和恢复。

## 启动

```bash
npm run setup
npm run dev:desktop
# 已构建后快速启动
npm run start:desktop
```

启动器调用官方 `initProfile`，然后调用官方 Desktop 开发入口。pnpm 从 Desktop 自己的依赖解析，无需根目录 `.bin/pnpm`。不会修改上游源码。

启动直接进入 LWB 工作台。DSH 账号是可选连接，在「设置 → DSH 系统设置」旁点击「登录 DSH」发起官方浏览器授权；成功后按钮变为「退出 DSH」。退出或会话过期后保留当前工作台页面，按钮恢复为「登录 DSH」，不会弹出官方欢迎窗口。模型和 API Key 仍通过「打开设置」配置。

当前锁定的官方版本没有欢迎窗口策略配置，LWB 在 `entry-policy.mjs` 中维护一个受版本检查约束的内存适配：只调整主进程 `needsWelcome` 的界面决策。官方源码和构建文件不改写，官方账号授权、凭据管理及任务取消继续执行。开发入口和安装版 bootstrap 共用此适配；详见[扩展边界](38-dsh-extension-boundary.md)。

开发入口默认本地端口 19487（可用 `LWB_DESKTOP_PORT` 覆盖），避免和单独安装的官方应用冲突。以终端启动命令为开发运行入口，官方开发 Dock 启动器不是 LWB 发行包。

## 数据

| 内容 | 源码启动默认位置 |
| --- | --- |
| 产品数据根 | `lwb/local/current` |
| DSH 原生数据 | `lwb/local/current/dsh-home` |
| 注册表 | `lwb/local/current/packs.json` |
| 能力包工作区 | `lwb/local/current/pack-state` |
| Web 激活 Profile | `dsh-home/profiles/lwb` |
| Desktop 激活 Profile | `dsh-home/profiles/desktop` |
| Electron 窗口状态 | `lwb/local/current/electron-user-data` |

`LWB_PRODUCT_HOME` 可整体指定数据根；细分路径变量见 `.env.example`。旧数据目录保留，但不导入、不回退读取。切换两种载体前退出另一 Host；共享数据的并发写入尚不支持。DSH 的 Profile 偏好分别按各自 Profile 存储。

## 打包

```bash
npm run package:desktop -- --check
npm run package:desktop:dir
npm run package:desktop
```

先按官方 `apps/desktop/.env.macos.example` 或 `.env.windows.example` 配置对应的本地文件，使用产品自己的 app ID、更新服务、签名与公证资料。命令复用官方 release 准备和 electron-builder 配置工厂，追加 LWB bootstrap、入口策略与资源，不改写官方 main 或 Host 文件。

安装版由 bootstrap 在系统 appData 下创建产品数据根（可显式覆盖，见下节），将本次构建的产品资源放到可写 runtime 中，再通过公共 Profile API 装配 LWB，最后在加载官方 main 时应用上述入口策略。业务工作区在 runtime 外，能力包不静态启用。发布上传被禁用。

### 便携版测试构建

当前阶段发布便携版测试包，不需要安装器或管理员权限。缺少正式发行证书时，可构建未签名便携包：

```bash
npm run package:desktop:unsigned
# 商业版仍需设置 LWB_COMMERCIAL_PACK_DIR
npm run package:desktop:unsigned -- --edition commercial
```

也可以显式构建便携版（正式签名环境仍需配置）：

```bash
npm run package:desktop:portable
npm run package:desktop:portable -- --edition commercial
```

Windows 产物是可直接运行的 portable `.exe`，macOS 产物是包含 `.app` 的 `.zip`，不生成 NSIS 安装器或 DMG。程序数据写入用户数据目录，不要求把压缩包目录作为可写目录。未签名模式不读取签名环境文件，不调用 Apple 公证或 Windows 签名硬件。macOS 原生组件使用临时 ad-hoc 签名满足 Apple Silicon 的加载要求，不代表 Developer ID 签名或公证；首次打开仍可能受到 Gatekeeper 或 SmartScreen 提示。

测试包关闭自动更新与强制更新服务，版本为 LWB 根版本加 `-test.<构建编号>`（Actions 使用 `GITHUB_RUN_NUMBER`，本机构建为 `1`），文件名明确带 `-portable-unsigned`。两版使用不同 app ID，输出分开放在 `.tooling/artifacts/<edition>/<target>/`。

官方源码保持原样。未签名模式通过仅在构建子进程启用的内存适配复用官方运行时准备、完整性校验与烟雾测试；适配与锁定的上游结构不匹配时会报错。此模式只用于测试分发，正式签名构建仍使用原有校验。

## 版本（edition）

安装包随带哪些能力包由**构建输入**决定，不由工作树状态决定。`lwb/desktop/editions.json` 声明每个版本的产品身份与能力包列表，`--edition` 选择版本（默认 `community`）。

| 版本 | 产品名 | 数据根 | 协议 | 随带能力包 |
| --- | --- | --- | --- | --- |
| `community` | Laofu Workbench | `LaofuWorkbench` | `lwb://` | 本仓库自有的 `spoken-video` |
| `commercial` | Laofu Workbench Commercial | `LaofuWorkbenchCommercial` | `lwb-commercial://` | 上述加上 `model-review`，源码由 `LWB_COMMERCIAL_PACK_DIR` 指定 |

```bash
npm run package:plan                          # 查看 community 随带哪些包，不需要签名资料
npm run package:plan -- --edition commercial  # 需要先设置 LWB_COMMERCIAL_PACK_DIR
npm run package:desktop -- --edition commercial
```

规则：

- 未声明 `source` 的能力包必须由本仓库拥有：目录在 `lwb/packs/<id>`，且 `lwb-pack.json` 已被 Git 跟踪。`lwb/packs/` 下出现非本仓库的目录时打包直接失败，提示改用 `npm run pack:install` 登记。
- 声明了 `source` 的能力包是构建方给出的绝对目录，用 `${VARIABLE}` 固定到具体 checkout。商业包源码因此不必进入本仓库：两个版本是**同一个内核加不同的能力包集合**，不需要第二份商业版内核。
- 只有清单列出的能力包会被复制进产物。版本解析在打包环境校验之前完成，所以包集合写错时不需要签名资料就会失败。
- 每个能力包在打包时用宿主加载能力包时的同一套规则校验（`inspectLwbPack`），运行时会被拒绝的包无法进入产物。
- 构建 id 只由上游 commit、版本名、清单内能力包内容和依赖锁决定。能力包按 id 计入，因此同一份商业包换一个 checkout 目录不会改变构建 id。
- 依赖、能力包测试目录和仓库元数据（`.git`）一律不进产物。
- 两个版本使用不同的数据根与协议，可以并存安装；产品身份写进 `build.json`，由 bootstrap 在运行时读取。

当前仓库未配置 macOS 签名环境，因此已验证开发入口、打包预检报错路径和两种版本的包集合解析；尚未生成、安装或验收签名发行包。Windows 打包也需在目标环境验收。详细边界与升级门禁见 [扩展边界](38-dsh-extension-boundary.md)。
