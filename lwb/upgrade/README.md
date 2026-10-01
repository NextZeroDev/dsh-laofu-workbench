# DSH Upgrade Workflow

只支持 `lwb/UPSTREAM.lock.json` 的当前版本。官方 checkout 必须无源码修改；产品扩展通过 Profile、Bundle、SDK 和单一版本适配层实现。开发期不保留旧 API 分支或旧数据迁移。

```bash
npm run upstream:refs     # 查看远端 refs，不改变锁
npm run setup             # 安装并构建精确版本；保留旧 checkout
npm run upstream:check    # 源码、锁、声明、UI 导出和构建检查
npm test
npm run test:integration  # 临时数据根，真实 Host 加载/卸载/重启验收
```

升级时同步锁文件、DSH peer 依赖及适配实现，再执行上述门禁和两种载体的 UI 回归。失败时修正 LWB 接缝；不能自动回退旧 API，也不能静默打补丁。只有新版本验收通过才更新产品基线。

源码不被修改并不保证上游接口不变。版本相关接缝和当前验证范围见 `docs/38-dsh-extension-boundary.md`。旧版本和历史数据留存不是受支持的兼容分支；需要回滚时使用对应版本代码与独立数据副本。
