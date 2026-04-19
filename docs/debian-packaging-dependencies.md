# Debian 打包依赖问题解决方案

## 问题描述

在 GitHub Actions 构建 Linux Debian 包时，遇到以下错误：

```
Error: The dependencies list has changed.
Old:
ca-certificates
libasound2 (>= 1.0.17)
...

New:
ca-certificates
libasound2 (>= 1.0.17)
libssl3 (>= 3.0.0~~alpha1)
...
```

构建失败，无法生成 `.deb` 安装包。

## 根本原因

### 依赖检查机制

VS Code 的 Debian 打包流程包含一个依赖验证机制：

1. **扫描二进制文件**：构建系统使用 `dpkg-shlibdeps` 扫描所有二进制文件（主程序、CLI、native 模块等）
2. **生成依赖列表**：自动检测这些文件需要哪些系统库
3. **对比参考列表**：将生成的依赖与 `build/linux/debian/dep-lists.ts` 中的参考列表对比
4. **不匹配则失败**：如果两个列表不一致，构建会失败（当 `FAIL_BUILD_FOR_NEW_DEPENDENCIES = true` 时）

相关代码位置：
- 依赖生成器：`build/linux/dependencies-generator.ts`
- 参考列表：`build/linux/debian/dep-lists.ts`
- 构建任务：`build/gulpfile.vscode.linux.ts`

### 为什么会出现不匹配

依赖列表会在以下情况下发生变化：

| 触发场景 | 示例 | 影响 |
|---------|------|------|
| **添加新的二进制文件** | 添加 CLI 工具（Rust 编译） | 引入 `libssl3`, `libstdc++6` 等新依赖 |
| **更新 Electron 版本** | 从 Electron 31 升级到 32 | 可能需要新版本的系统库 |
| **添加/更新 native 模块** | 添加 `node-pty`, `@vscode/spdlog` | 引入新的 C++ 库依赖 |
| **编译环境升级** | Ubuntu 20.04 → 22.04 | glibc 版本要求变化 |

### 这次问题的具体原因

在 `.github/workflows/release.yml` 中添加了 CLI 编译和混入步骤：

```yaml
- name: Compile CLI
  run: npm run gulp compile-cli

- name: Mix in CLI for x64
  run: |
    CLI_APP_NAME=$(node -p "require('./product.json').tunnelApplicationName")
    cp cli/target/release/code ../VSCode-linux-x64/bin/$CLI_APP_NAME
```

CLI 是用 Rust 编译的，引入了新的依赖：
- `libssl3` - OpenSSL 库（用于 HTTPS 连接）
- `libstdc++6` - C++ 标准库
- `libcups2` - 打印支持库
- 更新的 `libc6` 版本要求

但 `build/linux/debian/dep-lists.ts` 中的参考列表没有同步更新，导致构建失败。

## 解决方案

### 步骤 1：临时禁用严格检查

编辑 `build/linux/dependencies-generator.ts`：

```typescript
// 从 true 改为 false
const FAIL_BUILD_FOR_NEW_DEPENDENCIES: boolean = false;
```

这样构建会显示**警告**而不是**失败**，让我们能看到实际生成的依赖列表。

### 步骤 2：触发 CI 构建

提交并推送代码，GitHub Actions 会运行构建。查看构建日志，找到类似这样的警告信息：

```
The dependencies list has changed.
Old:
ca-certificates
libasound2 (>= 1.0.17)
...

New:
ca-certificates
libasound2 (>= 1.0.17)
libssl3 (>= 3.0.0~~alpha1)
libstdc++6 (>= 5)
...
```

### 步骤 3：更新依赖列表

编辑 `build/linux/debian/dep-lists.ts`，将 `referenceGeneratedDepsByArch` 中的依赖列表更新为日志中显示的 "New:" 列表。

需要更新三个架构的列表：
- `amd64` (x86_64)
- `armhf` (ARM 32位)
- `arm64` (ARM 64位)

示例（amd64）：

```typescript
export const referenceGeneratedDepsByArch = {
    'amd64': [
        'ca-certificates',
        'libasound2 (>= 1.0.17)',
        // ... 其他依赖
        'libssl3 (>= 3.0.0~~alpha1)', // test-workbench_change - new dependency for CLI
        'libstdc++6 (>= 5)',           // test-workbench_change - new dependency for CLI
        'libstdc++6 (>= 6)',           // test-workbench_change - new dependency for CLI
        'libstdc++6 (>= 9)',           // test-workbench_change - new dependency for CLI
        'libcups2 (>= 1.6.0)',         // test-workbench_change - new dependency
        // ... 其他依赖
        'zlib1g (>= 1:1.2.3.4)'        // test-workbench_change - added for CLI binary
    ],
    // armhf 和 arm64 同样更新
};
```

**重要**：使用 `// test-workbench_change` 注释标记所有修改，便于与上游 VS Code 合并时识别。

### 步骤 4：重新启用严格检查

编辑 `build/linux/dependencies-generator.ts`：

```typescript
// 改回 true
const FAIL_BUILD_FOR_NEW_DEPENDENCIES: boolean = true;
```

### 步骤 5：提交更改

```bash
git add build/linux/debian/dep-lists.ts build/linux/dependencies-generator.ts
git commit -m "chore: update Debian dependencies for CLI binary"
git push
```

### 步骤 6：验证构建

再次触发 CI 构建，应该能成功通过，不再有依赖相关的错误。

## 预防措施

### 1. 建立检查清单

当进行以下操作时，记得检查依赖：

- [ ] 添加新的二进制文件（CLI、工具等）
- [ ] 更新 Electron 版本
- [ ] 添加或更新 native Node.js 模块
- [ ] 修改编译环境或 Docker 镜像
- [ ] 更新 `package.json` 中的 native 依赖

### 2. 在 PR 中说明依赖变化

```markdown
## 变更说明
- 添加了 CLI 二进制文件（Rust 编译）
- 新增系统依赖：
  - libssl3 (>= 3.0.0~~alpha1) - 用于 HTTPS 连接
  - libstdc++6 系列 - C++ 运行时
  - libcups2 (>= 1.6.0) - 打印支持

## 依赖更新
- [x] 已更新 build/linux/debian/dep-lists.ts
- [x] 已在 CI 中验证构建通过
```

### 3. 分阶段提交

```bash
# Commit 1: 功能改动
git commit -m "feat: add CLI binary support"

# Commit 2: 依赖更新（单独提交，便于审查和回滚）
git commit -m "chore: update Debian dependencies for CLI"
```

### 4. 本地验证（可选）

如果需要在本地验证依赖：

```bash
# 1. 构建 Linux 二进制
npm run gulp vscode-linux-x64-min

# 2. 编译 CLI
npm run gulp compile-cli

# 3. 混入 CLI
CLI_APP_NAME=$(node -p "require('./product.json').tunnelApplicationName")
mkdir -p ../VSCode-linux-x64/bin
cp cli/target/release/code ../VSCode-linux-x64/bin/$CLI_APP_NAME
chmod +x ../VSCode-linux-x64/bin/$CLI_APP_NAME

# 4. 准备 Debian 包（会显示依赖信息）
npm run gulp vscode-linux-x64-prepare-deb
```

## 相关文件

| 文件路径 | 作用 | 说明 |
|---------|------|------|
| `build/linux/dependencies-generator.ts` | 依赖生成和验证 | 控制是否严格检查依赖 |
| `build/linux/debian/dep-lists.ts` | Debian 依赖参考列表 | 包含 amd64/armhf/arm64 的依赖 |
| `build/linux/rpm/dep-lists.ts` | RPM 依赖参考列表 | Red Hat 系发行版的依赖 |
| `build/gulpfile.vscode.linux.ts` | Linux 打包任务 | 定义 deb/rpm/snap 打包流程 |
| `.github/workflows/release.yml` | CI 构建流程 | GitHub Actions 工作流 |

## 常见问题

### Q1: 为什么不自动更新依赖列表？

**A**: 依赖变化可能影响兼容性和安全性，需要人工审查：
- 新依赖可能在旧系统上不可用
- 可能引入不必要的依赖
- 需要评估对用户的影响

### Q2: armhf 和 arm64 的依赖列表如何获取？

**A**: 如果 CI 只构建 x64，可以：
1. 参考 x64 的变化，手动更新 armhf/arm64
2. 或者在 CI 中启用这些架构的构建，从日志获取实际依赖

### Q3: 依赖列表中的版本号是什么意思？

**A**:
- `libc6 (>= 2.28)` - 需要 glibc 2.28 或更高版本
- `libgtk-3-0 (>= 3.9.10) | libgtk-4-1` - 需要 GTK 3.9.10+ 或 GTK 4.1+（二选一）

### Q4: 如何知道某个依赖是哪个文件引入的？

**A**: 可以使用 `ldd` 命令检查：

```bash
# 检查主程序
ldd ../VSCode-linux-x64/code

# 检查 CLI
ldd ../VSCode-linux-x64/bin/code-tunnel

# 检查 native 模块
ldd ../VSCode-linux-x64/resources/app/node_modules/**/*.node
```

## 总结

这个问题的核心是：**二进制文件的依赖发生变化时，必须同步更新参考列表**。

解决流程：
1. 临时禁用严格检查 → 2. 运行构建获取实际依赖 → 3. 更新参考列表 → 4. 重新启用严格检查 → 5. 验证通过

预防方法：
- 改动二进制文件时主动检查依赖
- 在 PR 中说明依赖变化
- 使用 `test-workbench_change` 标记修改

---

**相关文档**：
- [VS Code 构建文档](https://github.com/microsoft/vscode/wiki/How-to-Contribute#build-and-run)
- [Debian 打包指南](https://www.debian.org/doc/manuals/maint-guide/)
- [dpkg-shlibdeps 手册](https://man7.org/linux/man-pages/man1/dpkg-shlibdeps.1.html)
