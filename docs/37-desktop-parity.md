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

首次出现官方欢迎页时，可选择“添加 API Key → 稍后配置”进入工作台，随后从 LWB 设置配置模型。

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

先按官方 `apps/desktop/.env.macos.example` 或 `.env.windows.example` 配置对应的本地文件，使用产品自己的 app ID、更新服务、签名与公证资料。命令复用官方 release 准备和 electron-builder 配置工厂，追加 LWB bootstrap 与资源，不修改官方 main 或 Host。

安装版由 bootstrap 在系统 appData 下创建 `LaofuWorkbench` 数据根（可显式覆盖），将本次构建的产品资源放到可写 runtime 中，再通过公共 Profile API 装配 LWB，最后加载原封不动的官方 main。业务工作区在 runtime 外，能力包不静态启用。发布上传被禁用。

当前仓库未配置 macOS 签名环境，因此已验证开发入口和打包预检报错路径；尚未生成、安装或验收签名发行包。Windows 打包也需在目标环境验收。详细边界与升级门禁见 [扩展边界](38-dsh-extension-boundary.md)。
