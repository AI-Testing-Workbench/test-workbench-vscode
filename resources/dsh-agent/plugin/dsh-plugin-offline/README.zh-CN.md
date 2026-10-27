# dsh-plugin-offline

把一个已安装在 DSH 里的插件（连同它用到的全部依赖）打包成一个 tarball，搬到**没有
npm registry / 外网访问**的机器上离线安装。

- **导出（export）**：从当前 profile 里选一个插件 bundle，把它和整棵依赖闭包打成一个
  `.tgz`——一个合法的 npm tarball，通过 `bundleDependencies` 让 `pnpm` 安装它时不需要
  访问 registry、也不需要本地缓存。
- **导入（import）**：把这个 tarball 通过当前 profile 自己的插件管理器安装回去，于是
  依赖写入、bundle 选择、lockfile、运行时热组合都和普通的 `plugin_manager` 安装一致，
  只是全程离线。
- `list` 列出当前 profile 里可导出的 bundle；`inspect` 不安装、直接读出一个产物的目标
  DSH 版本、平台、打包的依赖和插入的插件行；`verify` 审计产物依赖是否完整。
- **Web 界面**：内置「插件」页新增 **导入导出** 标签页，逐行列出已安装插件并各带一个
  导出按钮（每次导出时选择保存目录），并提供离线导入入口（选 .tgz → 确认 → 上传安装）；
  每个已安装插件的详情页也会在启用开关/卸载按钮旁出现 **导出离线包** 按钮。

它本身是一个 DSH Host 插件：一个 bundle 行、没有浏览器界面、运行时没有任何 npm 依赖。
导出/导入复用的都是 DSH 已有的机制（`ctx.pluginManager`、pnpm 的
`bundleDependencies`、标准 tarball 安装路径）。机制细节与验证记录见
[`docs/DESIGN.md`](docs/DESIGN.md)。

## 安装

在本仓库目录下执行（会修改当前 profile，需要 danger-full-access 或审批）：

```
plugin_manager { action: "install_bundle", target: "/绝对路径/dsh-plugin-offline" }
```

或在终端：

```
dsh plugin --profile <name> add /绝对路径/dsh-plugin-offline
```

安装后 profile 里会出现 **插件离线搬运 / Offline Plugin Transfer** 这个 bundle，Agent
会得到 `plugin_offline` 工具。

## 用法

### 在有外网的机器上导出

```
plugin_offline { action: "list" }
plugin_offline { action: "export", plugin: "dshmarket" }
plugin_offline { action: "export", plugin: "dshmarket", output: "/tmp/transfer" }
```

- `plugin` 是 `list` 里的精确 bundle 名；已安装但被禁用的 bundle 也可以导出。
- `output` 是绝对路径的 `.tgz` 文件或目录，省略时默认写到
  `<DSH_HOME>/offline-artifacts/<name>-<version>-offline.tgz`。
- 结果会给出产物路径、大小、目标 DSH 运行时版本、打包的依赖列表和警告（例如被跳过
  的其他平台可选依赖、无法解析因而没有打包的依赖）。

用 U 盘 / 内网文件共享 / 工单附件把产物拷到隔离机器。**产物文件要保留**：profile 会把
产物路径记为该依赖的来源。

### 在 Web 界面上导出

侧边栏打开 **插件**：

- **导入导出** 标签页：当前 profile 可导出的插件列表，每行一个 **导出离线包** 按钮，外加
  刷新按钮。
  - **导出目录在每次导出时选择**：点 **导出离线包** 会先打开 Host 原生目录选择器，选好目录
    后产物写进去（目录选择器是唯一的落盘选择；取消选择即放弃这次导出）。如果 Host 没有目录
    选择器，则回退到 `<DSH_HOME>/offline-artifacts`，并在结果行里说明。
  - **导入离线插件**：**选择 .tgz 文件** → 显示文件名和大小 → **导入到当前 profile** 会带
    上传进度把文件传到 Host 并安装，成功后可直接 **查看插件详情**。成功提示只显示「导入成功 · 插件@版本」，
    正常生效的 `applied` 不再显示；只有需要用户处理的状态（需重启、被覆盖、启用失败、启用被取消）
    才会以本地化提示出现。这里只接受
    dsh-plugin-offline 的产物；文件会先复制到
    `<DSH_HOME>/offline-artifacts/imports/`（profile 会把这个路径记为该依赖的来源），
    上传上限 1 GB。

**为什么导入不应该再访问 registry（内网报错的原因与修复）**：Desktop 之外 pnpm 的
`autoInstallPeers` 默认开启，安装插件 tarball 时 pnpm 会把 tarball 声明的每个 peer 都当成
profile 的直接依赖去 registry 拉取——在内网 Artifactory 上就是
`ERR_PNPM_FETCH_404 ... @deepseek-ai/cordis`。现在导出时会把所有 peer 在产物 manifest 里标成
`optional`：peer 仍然保留声明（DSH 启动时照旧校验 `@deepseek-ai/dsh-*` 版本区间，且在源机器
能解析到的 peer 已经打进产物），但 pnpm 不会再安装/下载它们。如果 pnpm 仍因其他原因无法访问
registry（例如 profile 自身的依赖需要重新解析），`import` 会自动回退为**不使用 pnpm** 的安装：
把产物里的整棵依赖树直接落盘到 `node_modules/<name>`、在 profile manifest 里记录依赖并选中
bundle，结果里会提示 lockfile 未更新（若插件没出现请重启 DSH）。兼容性拒绝不会被绕过。
在此修复之前导出的旧产物第一次仍可能触发旧的 peer 拉取；回退会接着完成安装，或在有外网的
机器上重新导出一次。
- **任意已安装插件的详情页**：启用开关、卸载按钮旁的 **导出离线包** 按钮，同样先选择目录。

两个导出入口与 Agent 工具走同一条流程；导出接口会校验所选目录（必须是已存在的绝对路径
目录）后才写入。界面上的导入是「用户在插件页上的主动操作」——和官方插件管理器页面上的
安装按钮同一权限语义——因此直接通过 profile 插件管理器安装；由 Agent 发起的导入仍然只走
需要审批的 `plugin_offline` 工具。Client 半边在 Host 启动时被扫描发现：全新安装会随后正常
热加载出现；如果是给"已经运行中的 Host"上的插件补上 client 半边（升级场景），需要重启
一次 DSH 才会出现标签页和按钮。

```
plugin_offline { action: "inspect", artifact: "/media/usb/dshmarket-1.66.45-offline.tgz" }
plugin_offline { action: "verify",  artifact: "/media/usb/dshmarket-1.66.45-offline.tgz" }
plugin_offline { action: "import",  artifact: "/media/usb/dshmarket-1.66.45-offline.tgz" }
```

`inspect` 会对 DSH 版本不一致、平台/CPU 不一致给出警告。`import` 会：

1. 校验产物（离线清单、包名/版本、bundle patch）；
2. 用 profile 插件管理器的 `installBundle` 安装 tarball——和普通安装完全同一条代码路径，
   包括 DSH peer 兼容性检查、profile manifest/lockfile 更新、bundle 选择；
3. 返回管理器的 `ChangeResult`（`application: "applied"` 表示在 live profile 里已经生效）。

`import` 会改动 profile，因此除非会话已经是 danger-full-access，否则会先请求审批。

如果不想装这个插件，产物本身就是一个标准 npm tarball，也可以直接用
`plugin_manager { action: "install_bundle", target: "<产物>.tgz" }` 安装；本插件负责的是
生成这个产物，以及导入前后的校验与说明。

## 产物格式

```
package/
  package.json            # 插件 manifest + bundleDependencies
  dsh-offline.json        # 离线清单（目标 DSH 版本、平台、依赖列表…）
  node_modules/<dep>/…    # 整棵依赖闭包；版本冲突时在需要它的包下面再嵌套一份
  …                       # 插件包原有的其他文件
```

- 会为 `package/node_modules` 下所有物理存在的包写入 `bundleDependencies`；版本冲突的包
  嵌套在需要它的那个包下面，由该包自己的 manifest 声明。
- 声明了但解析不到的依赖会从产物 manifest 里删除并报告，避免离线安装时 pnpm 去 registry
  拉取而失败。
- DSH 安装自带的包（`@deepseek-ai/*`）**不打包**：目标 DSH 运行时会在导入后提供；清单里
  以 `runtimeProvided` 记录。
- `dsh-offline.json`（`schemaVersion: 1`）记录来源 profile、DSH 运行时版本、
  `platform`/`arch`/`node`、bundle patch 与插入行、每个打包依赖的版本/位置/大小，以及警告。
- 安装期生命周期脚本（`preinstall`、`install`、`postinstall`）会从产物 manifest 中移除并报告：
  pnpm 11 会拒绝安装带有“不允许运行的 build 脚本”的依赖，而产物里已经是预编译文件，
  离线环境也跑不了这些脚本。声明了 `binding.gyp`（需要原生构建）的插件会给出警告。

pnpm 会把声明的 bundled 依赖树解包到**安装后插件包内部的 `node_modules`** 里，所以即使
profile 根目录已经存在另一个版本，Node 解析（以及 DSH 的运行时解析）也会命中产物内的
精确副本。原生模块以预编译文件复制，导入时不执行 build script。

### 依赖是不是都打进去了？

导出会递归遍历已安装插件的依赖图——`dependencies`、`optionalDependencies`，以及源 profile
里能解析到的所有 `peerDependencies`——逐个复制包文件，版本冲突时还会生成嵌套副本
（`node_modules/<a>/node_modules/<b>`）。除此之外，产物 manifest 会用 `bundleDependencies`
精确声明物理上放了哪些包（pnpm 只安装这个字段列出的内容）。

**有意不打包**的部分及原因（都会记录在 `dsh-offline.json`）：

| 不打包 | 隔离机器上为什么仍可用 |
|---|---|
| `@deepseek-ai/*` 包 | 由目标机器自己的 DSH 运行时提供（记录在 `runtimeProvided`） |
| 源机器上本就没安装的可选依赖（如其他平台的原生二进制） | 源机器也不需要；记录在 `notBundled` |
| 源机器上解析不到的 peer | 记为 optional peer，由目标运行时或其他 bundle 提供 |
| 安装期生命周期脚本（`preinstall`/`install`/`postinstall`） | 产物里已是预编译文件，离线时不应执行构建 |
| 声明了 `binding.gyp`（安装期需要原生构建）的插件 | 给出警告——这类插件可能需要其他分发方式 |

导出会在打包前对 staged 目录跑一次审计，结果里给出 `complete: true` 以及
`auditErrors`/`auditWarnings`。之后也可以随时离线复审任意产物：

```
plugin_offline { action: "verify", artifact: "/path/to/x-offline.tgz" }
```

`verify` 会把 tarball 解压到临时目录，从插件本身向外检查：每个声明的依赖要么能在产物
内部解析到（含嵌套副本），要么是运行时提供的 `@deepseek-ai/*`；每个 `bundleDependencies`
声明都有真实文件、所有物理嵌套包都有声明；bundle patch 与 `dsh-offline.json` 和
`package.json` 一致。本仓库的真实结果：

- `dshmarket` 产物：`complete: true`，4 个包（插件 + `js-yaml`/`undici`/`argparse`），
  440 个文件 / 解包 7.7 MB，3 个运行时提供的 peer；
- `dsh-univer-office` 产物：`complete: true`，35 个包，2,781 个文件 / 解包 334 MB，
  9 个运行时提供的 peer，16 个其他平台可选二进制列为缺失（符合预期）。

## 需要注意的限制

- **平台相关**：原生模块按导出机器的 `platform`/`arch` 复制（会记录并在导入时警告）。
  请在和隔离机器相同 OS/CPU 系列的机器上导出。
- **DSH 运行时版本**：产物记录了导出时的版本；目标机器上的插件管理器仍会校验插件声明的
  `@deepseek-ai/dsh-*` peer 范围。建议使用相同 DSH 大版本；确需跨版本时按管理器提示添加
  版本豁免并自担风险。
- **产物要保留**：profile 中该依赖的 spec 指向产物文件（`file:/…/x.tgz`），删除或移动产物
  会导致以后 `pnpm install` 失败。
- **workspace link 安装的插件**：`link:` 安装的插件从它真实所在目录解析依赖，只能打包
  从那一路径解析到的依赖；只存在于 profile 根目录的依赖无法捕获。
- **信任**：产物里是可执行代码。只导入自己构建或可验证的产物；导入会在 workspace 沙箱
  之外安装 Host 代码。
- **不会重跑 build 脚本**：安装期生命周期脚本会从产物中移除；确实需要安装期构建的插件
  （例如原生 `binding.gyp`）会给出警告，可能需要换一种分发方式。
- 大插件产物也大（DSH×Univer 集成约 75 MB）。

## 已完成的验证

- 单元测试：`node --test test/*.test.mjs`，50 项通过（tar 读写、依赖闭包与打包布局、
  用合成 profile 跑通的 export→inspect→import 全链路、浏览器接口路由（含"导出到所选目录"
  与"上传产物导入/拒绝"）、一个无浏览器的 Client 渲染冒烟测试（两个插件页扩展位）、产物 peer
  标 optional、无 pnpm 导入回退，以及完整性审计——干净产物、缺依赖、虚假 bundle 声明、
  marker 不匹配、可选依赖缺失）。
- 离线集成测试：在全新 hoisted 工程里用
  `pnpm add --offline --store-dir <空目录> --registry http://127.0.0.1:1/ <产物>` 安装，
  再加载并解析产物内嵌套的依赖（`test/integration/offline-install.test.mjs`）。另有一个复现
  内网 peer 场景的集成测试：声明 `@deepseek-ai/cordis` peer 的插件在 pnpm 默认
  `autoInstallPeers`、空 store、无 registry 的条件下安装成功，且不会出现
  `node_modules/@deepseek-ai`（`test/integration/peer-optional.test.mjs`）。
- 完整性审计：`plugin_offline verify` 对 `dshmarket` 与 `dsh-univer-office` 两个真实产物
  均返回 `complete: true`（数字见上）；手工构造的坏产物会以 `missing-dependency` /
  `declared-bundle-missing` / `marker-mismatch` 报错。
- 在真实 DSH Desktop profile 上端到端跑通：安装 `examples/fixture-plugin`（一个 import
  `semver` 的 Host 工具）→ 导出 → 移除 → 用 `plugin_offline` 导入，bundle 行在 live 组合里
  重新挂载，且 `semver` 只可能来自产物内嵌套的 `node_modules`。另外对 `dshmarket`
  和 `dsh-univer-office` 做了导出与离线安装；后者包含 34 个包、原生 binding 和版本冲突嵌套。
- Web 界面：Client 半边加载后，`Slots.listSubTree` 显示插件在官方插件管理页两个 slot 里的
  实时占用（`plugins.tab` → `dsh-offline-export-tab`，`plugins.detail.actions` →
  `dsh-offline-export`）；页面调用的同一组路由在运行中的 web server 上实测：列表正常；
  `POST .../export` 能写入所选目录（`/tmp/dsh-offline-picked/...tgz`，75 KB），相对路径目录
  被以 `invalid-output` 拒绝；`POST .../import` 上传合成产物后安装生效
  （`application: "applied"`、bundle 行挂载、其工具注册成功），损坏文件以 400
  `invalid-artifact` 拒绝，普通 npm tarball 以 400 `not-offline-artifact` 拒绝。
- 导出后不需要任何 registry 访问：用空 pnpm store 验证过。

## 开发

```
node --test test/*.test.mjs              # 单元测试（不联网）
node --test test/integration/*.test.mjs  # pnpm 离线安装集成测试（需要 pnpm，不联网）
```

代码结构：`index.js`（bundle 入口）、`src/tool.mjs`（工具 schema 与审批）、`src/http.mjs`
（插件页按钮背后的浏览器接口）、`client.js`（浏览器半边：逐次选择导出目录、带导入入口的
导入导出标签页 + 详情页导出按钮）、
`src/export.mjs`、`src/import.mjs`、`src/verify.mjs`（产物完整性审计）、
`src/profile.mjs`（profile 定位、管理器访问）、
`src/closure.mjs`（依赖闭包与 bundled 布局）、`src/tar.mjs`（流式 gzip+tar）、
`examples/fixture-plugin`（端到端自测用的 fixture bundle）。

## License

MIT
