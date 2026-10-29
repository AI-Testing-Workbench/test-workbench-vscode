# dsh Agent 运行时（打包版）

本目录在打包阶段由 `scripts/dsh-agent/prepare-runtime.mjs` 生成。除本文件、
`runtime.json`、`builtin-plugins.json` 以及 `plugin/` 下的内置插件源码外，
其他内容均不提交到仓库。

```text
resources/dsh-agent/
  node/
    bin/node                 # Node 24.18.0（Windows 为 node.exe）
    bin/pnpm                 # pnpm shim（Windows 为 pnpm.cmd）
  app/
    node_modules/            # 锁定版本的 dsh、pnpm 及其提升后的依赖
  web/
    index.html               # dsh Web 前端产物（诊断/离线页面）
  host/
    README.md                # dsh-desktop-host 说明（可选）
  plugin/
    dsh-client-tscode/       # dsh 客户端插件（源码，安装进 profile）
    dsh-plugin-offline/      # 离线插件导入/导出（内置，安装进 profile）
  builtin-plugins.json       # 内置插件的上游仓库与版本定位
  VERSION                    # dsh 版本 / Node 版本 / 格式 / 构建时间
  THIRD_PARTY_NOTICES
  runtime.json               # 由 prepare-runtime 强制校验的版本 pin
  previous/                  # 可选的回滚快照（不会随包发布）
```

打包时 `gulpfile.vscode.ts` 会把本目录复制到应用根目录，因此安装后的路径为
`<appRoot>/resources/dsh-agent`（macOS 上是
`Contents/Resources/app/resources/dsh-agent`）。

## 为什么单独打包 Node

Electron 内置的 Node 无法承载 dsh。`dsh-app-boot` 通过
`node-addon-require-builtin` 访问 Node 内部的 ESM/CJS 加载器，而该扩展会校验
精确的 Electron/V8 指纹。Electron 43.7.3（Node 24.21.0，
V8 15.0.245.31-electron.0）不在其支持列表中，因此 Host 改为运行在单独暂存的
Node 24.18.0 进程下。这样也能让原生模块（`koffi`、`node-pty`、`sharp`、
`flock`）获得与构建时一致的运行时。

Node 24.18.0 是当前 pin，并与 `.nvmrc` 保持一致；版本不匹配时
`prepare-runtime.mjs` 会直接拒绝。该组合已在 macOS arm64 上验证（暂存、冒烟、
GUI 和原生模块）；参见 `docs/dsh-agent/adr-0002-node-runtime.md`。

## 暂存（Staging）

运行时来自 dsh fork 打出的 tarball，而不是公共 registry。fork 构建会为每个
revision 生成一套 tarball；各平台在安装时再解析自己的原生依赖。

```bash
node scripts/dsh-agent/install-runtime-from-tarballs.mts \
  --out .build/dsh-runtime \
  --from .build/dsh-tarballs/dsh \
  --from .build/dsh-tarballs/vendor \
  --from .build/dsh-tarballs/landlock
node scripts/dsh-agent/prepare-runtime.mjs \
  --dsh .build/dsh-runtime/node_modules/@deepseek-ai/dsh \
  --node "$(which node)" \
  --keep-previous
node scripts/dsh-agent/prepare-runtime.mjs --check
node scripts/dsh-agent/e2e-smoke.mjs
node scripts/dsh-agent/size-report.mjs
```

`runtime.json` 锁定 dsh 版本、Node、pnpm 和 fork revision：

```json
{
  "dsh": "0.2.1-rc.3",
  "node": "24.18.0",
  "pnpm": "11.28.8",
  "dedupe": ["zod"],
  "format": 1,
  "fork": { "repository": "...", "ref": "<commit>" }
}
```

`dedupe` 列出的依赖会在安装时生成 npm `overrides`：当所有 dsh 包都把同一个
依赖精确 pin 到同一版本、而根上又被 caret 范围解析到更高版本时，npm 会在每个
包下各克隆一份。zod 曾因此被复制 55 份（约 350MB、4 万个文件）；改为单一版本后
运行时从约 906MB 降到约 569MB。只有当所有精确 pin 一致时才会生成 override，
否则打印 warning 并保留 npm 默认行为。

`install-runtime-from-tarballs.mts` 会把锁定版本的 pnpm 安装到运行时前缀中，
`prepare-runtime` 则在打包的 Node 旁边提供 `pnpm` shim。Host 启动子进程时会把
该目录前置到 `PATH`，因此 dsh 插件管理器无需全局 pnpm 就能查看和安装 bundle。

`prepare-runtime` 会把 fork revision 写入 `VERSION`，并在 `--check` 时校验。
CI 会从解析出的 fork artifact 传入 `--dsh-version` 和 `--fork-ref`；没有这些
覆盖参数时，使用本地 `runtime.json` 中的 pin。

不要给安装命令加 `--omit=optional`。`koffi` 等原生包通过 optional
dependencies 解析平台二进制；省略后会退回到源码构建，而源码构建需要 CMake。

`--node` 必须指向 Node 24.18.0（即 `.nvmrc` 中的版本）；与 `runtime.json`
不一致时，脚本会在暂存前失败。

`--keep-previous` 会把当前的 `node/`、`app/`、`web/` 和插件内容快照到
`previous/`；`node scripts/dsh-agent/rollback-runtime.mjs` 可将其换回。
常规发版回滚也可以直接重装上一个应用版本，因为运行时随应用一起发布。

## 内置插件

`dsh-client-tscode` 在本仓库中维护。`dsh-plugin-offline` 按
`builtin-plugins.json` 中锁定的 revision 从其独立仓库内置（vendored）而来；
两者都会在启动时复制/链接进 profile，不经过 pnpm。

```bash
# 按锁定的仓库和 revision 重新同步内置源码。
node scripts/dsh-agent/sync-builtin-plugins.mjs

# 或在开发插件时，从本地 checkout 复制。
node scripts/dsh-agent/sync-builtin-plugins.mjs \
  --from ../dsh-plugin-offline

# 不联网，仅校验已内置的文件。
node scripts/dsh-agent/sync-builtin-plugins.mjs --check
```

更新插件时，请在同一个变更里更新 `builtin-plugins.json` 的 `version` 和
`ref`；当内置源码版本与 pin 不一致时，`prepare-runtime.mjs --check` 会失败。

内置的 `dsh-plugin-offline` 还携带了两个 rc.3 兼容修复：

- 等待可选的 `webServer` 服务就绪后再注册路由，而不是在 `apply` 期间直接读取；
  DSH 0.2.1-rc.3 会在这个插件之后才加载该服务，因此此前路由从未注册成功。
- `locale.bind()` 在命名空间/词条缺失时返回 key 本身，而不是 `undefined`。客户端现在
  只在返回值与 key 不同时采用绑定结果，否则回退到内置的中英文案；否则界面会显示
  `tabLabel`、`export` 这类占位符。

请把同样的修改推送到上游、更新 `ref`，然后重新执行同步，再以 pin 作为刷新依据。

## 开发

没有暂存资源时，Agent 会从 `PATH` 解析 `node` 和 `dsh`（Node 24.18.0 以及
全局安装的 `dsh`）。这也是 `./scripts/code.sh` 的默认行为。
