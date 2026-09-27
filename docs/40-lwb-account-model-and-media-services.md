# LWB 账号、模型档位与场景服务接入

实施日期：2026-09-27。本文接续 [39 ATS 总体方案](39-ats-capability-service-and-pack-entitlements.md)，描述本次实际实现与上线前提。

## 产品行为

- 基础对话继续使用 DSH 原生模型选择器。登录 LWB 后新增「LWB 模型服务」来源，客户端只展示「快速」「均衡」「极致」档位名称；只有服务端确认可用的档位进入可选模型列表。
- 设置增加「场景任务默认模型」。默认「跟随 DSH 默认模型」，也可指定独立模型，包括官方、自定义和 LWB 来源。独立选择覆盖各场景包的文本任务、视频 Agent、子任务和定时任务，不改写 DSH 对话的默认模型。
- 新任务捕获模型选择，进行中的任务和其子任务不随设置变更切换模型。配音、字幕、封面生图服务仍在各自模块选择，不受文本模型设置控制。
- 配音字幕的「连接配置」和发布的「封面生图配置」都显示「LWB 账号 / 百炼」页签，每次打开先展示 LWB 账号。浏览页签不会覆盖已保存的服务来源，需要点击使用/保存才切换。
- 新安装默认服务来源为 LWB。已保存的百炼来源及密钥继续有效。百炼页签保留手动 API Key，并提示当前默认地址适用于中国内地华北 2（北京）地域；其他地域密钥不能直接套用当前地址。
- 登录后显示邮箱、可用积分、会员等级及服务状态，支持跳转购买积分/会员；未登录时可跳转设置登录。经该入口返回场景页，保留当前组件和未提交草稿。
- 账号状态在前台每 15 秒及重新聚焦时同步，媒体任务结束、付款成功后额外刷新。网络失败显示错误而不伪造退出；刷新令牌被拒绝时清除登录。

## 档位与上线前提

映射由 ATS 私有服务管理，公开客户端仅使用稳定别名。

| 名称 | 客户端 ID | ATS 默认映射 | 服务端覆盖变量 |
| --- | --- | --- | --- |
| 快速 | `lwb-fast` | `qwen-plus` | `LWB_MODEL_FAST` |
| 均衡 | `lwb-balanced` | `deepseek-v4.1-flash` | `LWB_MODEL_BALANCED` |
| 极致 | `lwb-ultimate` | `deepseek-v4.1-flash` | `LWB_MODEL_ULTIMATE` |

2026-09-27 部署前首次核查时，ATS 目录尚无 `deepseek-v4.1-flash`。随后用户新增该模型并部署 ATS；部署后复核确认模型目录与生效价格已包含 `deepseek-v4.1-flash`，登录后的 LWB 目录中「快速」「均衡」「极致」均标记为可用。代码不会静默替换模型；后续若模型未配置或不可用，对应档位仍不可选，并在设置中显示原因。

可用文本档位要求模型启用、有生效状态的计价记录、支持流式和工具调用。ATS 新增迁移校正现有 `qwen-plus` 的工具调用元数据。封面默认模型由 `LWB_COVER_MODEL` 管理（默认 `wan2.7-image`）；客户端不能指定 LWB 封面的真实模型。

部署顺序为先部署 ATS 新接口并执行迁移，再发布客户端。旧 ATS 尚无目录接口时，LWB 账号仍可登录/购买，服务面板明确提示更新 ATS。2026-09-27 用户已执行 ATS 部署，随后通过线上只读请求和已登录桌面复核：LWB 目录返回成功，配音、字幕及封面服务均标记为可用，客户端连接状态已就绪；bootstrap、档位对话及封面代理路由也已存在。该核查未执行生产数据库写入或发起付费模型/媒体调用，不能替代真实生成与计费验收。

## 运行时边界

```text
Web / 官方 Desktop → 同一 LWB client 和场景包
  ├─ 基础对话 → DSH LlmAdapter → LWB 档位 → ATS 原生计费代理
  ├─ 场景文本 → 场景默认模型 → DSH Agent / Subagent
  └─ 媒体 → 包作用域 account.open(service) → ATS 任务服务
```

DSH 源码保持原样。LWB 通过官方公开的 LlmAdapter、PiAiAdapter、Loader 和账户/模型事件扩展，原有动态注册、加载、卸载及包工作区保留。公开代码只维护这一份；服务端模型映射、凭据和计费实现位于 ATS 私有仓库。

Host 私有凭据库保存两个独立条目：`lwb-ats-session`（登录会话）和 `lwb-ats-service`（服务 API Key）。ATS 为 LWB 创建或复用名为「LWB 客户端」的 Key，与 Fu-Claw 独立；依然受账号套餐的 API Key 数量上限约束，不额外提高配额。

浏览器只能读取账号、目录、服务状态。场景包得到的服务句柄仅包含 `userId` 和受限 `request`；按 manifest 的 `requiredServices` 和服务路径白名单调用，不接触 JWT、服务 Key 或上游百炼 Key。注销、切换账号、卸载包会取消对应本地调用。已提交云端任务可能已产生费用，本地取消不保证远端撤单/退款。

媒体任务在提交时记录 `lwbUserId`；排队执行时校验所属账号，自动字幕沿用配音任务的账号。跨账号不能继续扣费。付费 POST 不自动重试；服务 Key 被拒绝后清除缓存，由下一次显式调用重新获取。下载签名音频/图片时不附带 ATS Authorization。

开发阶段不迁移旧 `scitiger` 手工云端 Key；现在的云端方式统一是 `lwb` 账号。百炼 BYOK 和独立配置的 legacy 媒体服务保留。

## ATS 接口

| 接口 | 认证 | 用途 |
| --- | --- | --- |
| `GET /api/lwb/catalog` | ATS JWT | 档位/媒体服务可用性、最低积分 |
| `POST /api/lwb/bootstrap` | ATS JWT | 创建或复用 LWB 专用服务 Key，仅 Host 使用 |
| `POST /api/lwb/v1/chat/completions` | API Key | 解析档位并进入现有 ProxyService 计费/流式处理 |
| `POST /api/lwb/cover-images` | API Key | 服务端确定模型，进入现有图片任务代理 |

音频、字幕、文件上传及任务查询复用 ATS 现有 `/api/v1/tts/jobs`、`/api/v1/subtitle/jobs`、`/api/v1/media/audio-uploads`、`/api/v1/tasks/:id`。本次没有实现商业场景包目录/会员包权益端点；`entitlements` 保持 `null`，不把客户端菜单当权限控制。

## 验证与维护

```sh
npm test
npm run test:integration
node lwb/upgrade/account-smoke.mjs
node lwb/upgrade/account-smoke.mjs --desktop
node lwb/upgrade/account-smoke.mjs --catalog-unavailable
node lwb/upgrade/account-smoke.mjs --desktop --catalog-unavailable
```

账号集成验收使用临时产品目录和本地假 ATS，真实启动 DSH Web 或官方 Desktop。它验证登录/退出、模型注册、独立场景模型、凭据不外泄及百炼设置保留。桌面验收需先具备官方构建产物，等同 `start:desktop` 前提。

`--serve` 可保留临时环境用于人工页面验收，终端输出临时 `qa.json` 路径；测试账号 `qa@example.test`，测试密码 `local-only-test`。按 Ctrl+C 停止并清理。假服务只提供验收响应，不代理生产请求。

另有本地 HTTP SSE 测试验证官方适配器的文本流和工具调用协议；它不代表生产供应商实际调用已验证。生产发布后仍需受控验收模型对话、工具调用、音频、字幕、图片和计费结算。

## 已登录但场景服务不可用

登录、积分和会员接口可用，不代表 LWB 新增的服务目录已发布。若设置页显示账号信息，同时提示更新 ATS，检查 `GET /api/lwb/catalog`；2026-09-27 部署前排查曾返回 `404 Cannot GET /api/lwb/catalog`，用户部署后已复核恢复。接口缺失时需要部署 ATS 的 LWB 接口，重复登录不能解决。

配音页和封面页必须分别表达登录状态与服务状态：已登录时显示服务端错误或维护原因，不再统一提示重新登录或配置 API Key。账号错误及服务错误变化会触发连接状态刷新。配音服务选择仅从当前可用来源中选择，已保存的首选来源不可用时不会阻止另一个可用来源，也不会因此改写已保存偏好。

正常状态使用「已就绪」及「LWB 服务已就绪」提示，说明调用服务按实际用量扣除积分；配置页同时展示当前默认服务及确认切换的操作说明。设置页引导前往「场景能力包」查看和管理，不再显示等待服务端接入的占位文案。此文案调整不代表商业场景包权益端点已经实现。

`--catalog-unavailable` 模拟登录、会员、积分正常但目录接口缺失的情况，验证 Web 和官方 Desktop 保留登录状态并返回明确的服务错误。
