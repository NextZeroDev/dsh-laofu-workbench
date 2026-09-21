# 老傅工作台 · Laofu Workbench

老傅工作台（LWB）建立在 DeepSeek Harness（DSH）之上，是本机单用户工作台。当前产品只定义三个模块：

- **对话**：普通 DSH Session，复用 DSH 的模型、工具、会话、事件和审计能力。
- **场景能力包**：预留安装、加载和后续注入入口；基础版暂不包含领域能力包。
- **设置**：唯一的设置入口；DSH 原生页面统一管理服务商、模型、凭据、工具权限与审批。

```bash
npm install
npm run setup
npm run dev -- --port 4173
```

`npm run setup` 按 `lwb/UPSTREAM.lock.json` 获取并构建精确版本的 DSH，生成的 `vendor/` 不进入 Git。需要 Git、Node.js `^22.19.0 || >=24.0.0`（含开发头文件）、Corepack，以及本机 C 编译器（macOS 为 Xcode Command Line Tools）。上游使用 pnpm 11.7.0，Corepack 会按上游声明选择版本。

视频制作额外需要 PATH 中的 `ffmpeg`、`ffprobe` 及 Chrome。首次渲染前可运行 `npx --no-install remotion browser ensure` 下载渲染浏览器；网络受限时可设置 `LWB_REMOTION_BROWSER_EXECUTABLE` 为已安装的 Chrome/Chromium 可执行文件绝对路径。模型及媒体服务的凭据在设置页配置。

对话附件完全使用 DSH 原生上传、存储和消息展示；LWB 不再维护旧上传适配器或附件接管逻辑。产品数据目录规则见[运行数据目录](docs/31-runtime-data-layout.md)。

启动器会将 `lwb/profile/` 同步至本机 DSH Home，并以 `lwb` Profile 启动官方 Web。首次运行会在 `lwb/local/dsh-home/` 创建本地状态；它和 `.env` 不会进入 Git。

DSH Web 对本机页面启用了首次访问鉴权。默认启动会自动打开正确页面；如需手动打开，使用：

```bash
npm run dev -- --no-open --port 4173
```

随后复制终端输出的完整 `dsh web: http://127.0.0.1:4173/?token=...` 地址打开一次。令牌仅用于当前本机进程，不应分享或提交。

当前运行时锁定为 `dsh-v0.1.6-alpha.1` 的精确 commit `0a15e36e7f82b6ed45af6fa9759f29b40dcd965d`。升级必须固定新的 commit，在干净 checkout 中构建并通过 LWB 回归，不能直接跟随上游分支。详见[架构](docs/01-architecture.md)与[基座锁定](docs/08-base-lock.md)。

```bash
npm run check
npm run profile:check
npm run unit:test
npm run dsh:dump
npm run test
```
