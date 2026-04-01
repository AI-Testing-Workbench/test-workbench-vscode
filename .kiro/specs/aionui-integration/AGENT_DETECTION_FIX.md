# AionUI 智能体检测问题分析与解决方案

## 🔍 问题描述

**现象**：
- 开发环境（`scripts/code.sh`）：AionUI 可以正常检测到智能体（Claude, OpenCode, Codex 等）
- 生产环境（打包后的安装包）：AionUI 无法检测到任何智能体

**影响**：
用户安装后无法使用 AionUI 的核心功能，因为没有可用的 AI 后端。

---

## 🔬 根本原因分析

### 1. 环境变量差异

**开发环境**：
```bash
# 通过 scripts/code.sh 启动
# 继承了完整的 shell 环境变量
PATH=/usr/local/bin:/usr/bin:/bin:~/.local/bin:~/.npm-global/bin:...
SHELL=/bin/zsh
HOME=/Users/username
```

**生产环境**：
```bash
# 通过 Finder/Dock 启动（macOS）
# 或通过桌面快捷方式启动（Windows/Linux）
# 只有最基本的系统环境变量
PATH=/usr/bin:/bin:/usr/sbin:/sbin
# 缺少用户自定义的 PATH 路径
```

### 2. CLI 检测机制

AionUI 使用 `AcpDetector` 检测已安装的 CLI 工具：

```typescript
// extensions/aionui-main/src/process/agent/acp/AcpDetector.ts

const isCliAvailable = (cliCommand: string): boolean => {
    try {
        // 使用 which/where 命令检测 CLI 是否存在
        execSync(`${whichCommand} ${cliCommand}`, {
            encoding: 'utf-8',
            stdio: 'pipe',
            timeout: 1000,
            env: enhancedEnv,  // ← 关键：依赖环境变量
        });
        return true;
    } catch {
        return false;
    }
};
```

**问题**：
- `which` 命令依赖 `PATH` 环境变量
- 如果 CLI 工具安装在用户目录（如 `~/.local/bin`, `~/.npm-global/bin`）
- 而 `PATH` 中没有这些路径，`which` 就找不到

### 3. Shell 环境加载

AionUI 尝试从用户的 shell 加载环境变量：

```typescript
// extensions/aionui-main/src/process/utils/shellEnv.ts

function loadShellEnvironment(): Record<string, string> {
    // 执行用户的 shell 来获取环境变量
    const shell = process.env.SHELL || '/bin/bash';
    const output = execFileSync(shell, ['-l', '-c', 'env'], {
        encoding: 'utf-8',
        timeout: 5000,
        env: { ...process.env, HOME: os.homedir() },
    });

    // 解析并提取需要的环境变量
    // 包括 PATH, ANTHROPIC_API_KEY 等
}
```

**问题**：
1. **macOS 打包应用的限制**：
   - 打包后的应用运行在沙箱环境中
   - `process.env.SHELL` 可能未设置或不正确
   - `os.homedir()` 可能返回沙箱路径而不是真实的用户目录

2. **权限问题**：
   - 打包后的应用可能没有权限执行用户的 shell
   - 或者无法访问 shell 配置文件（`.zshrc`, `.bashrc`）

3. **超时问题**：
   - Shell 加载可能超时（5秒）
   - 导致环境变量加载失败

---

## 💡 解决方案

### 方案 1：增强环境变量加载（推荐）

**目标**：确保打包后的应用能正确加载用户的 shell 环境。

#### 1.1 修改 `shellEnv.ts`

```typescript
// extensions/aionui-main/src/process/utils/shellEnv.ts

function loadShellEnvironment(): Record<string, string> {
    if (cachedShellEnv !== null) {
        return cachedShellEnv;
    }

    const startTime = Date.now();
    cachedShellEnv = {};

    // Skip on Windows - shell config loading not needed
    if (process.platform === 'win32') {
        if (PERF_LOG) console.log(`[ShellEnv] shell env skipped (Windows)`);
        return cachedShellEnv;
    }

    try {
        // test-workbench_change start
        // 1. 确保使用正确的 HOME 目录
        const homeDir = process.env.HOME || os.homedir();

        // 2. 尝试多个 shell（按优先级）
        const shellCan

                continue;
            }

            try {
                // 增加超时时间到 10 秒
                shellOutput = execFileSync(shell, ['-l', '-c', 'env'], {
                    encoding: 'utf-8',
                    timeout: 10000,  // 增加到 10 秒
                    stdio: ['pipe', 'pipe', 'pipe'],
                    env: {
                        ...process.env,
                        HOME: homeDir,
                        // 确保基本的 PATH
                        PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin'
                    },
                });
                usedShell = shell;
                break;
            } catch (error) {
                console.warn(`[ShellEnv] Failed to load from ${shell}:`, error);
                continue;
            }
        }

        if (!shellOutput) {
            console.warn('[ShellEnv] Failed to load from any shell, using fallback');
            // 使用回退方案
            cachedShellEnv = getFallbackEnvironment();
            return cachedShellEnv;
        }

        console.log(`[ShellEnv] Successfully loaded environment from ${usedShell}`);
        // test-workbench_change end

        // Parse and capture only the variables we need
        for (const line of shellOutput.split('\n')) {
            const eqIndex = line.indexOf('=');
            if (eqIndex > 0) {
                const key = line.substring(0, eqIndex);
                const value = line.substring(eqIndex + 1);
                if (SHELL_INHERITED_ENV_VARS.includes(key as any)) {
                    cachedShellEnv[key] = value;
                }
            }
        }

        // test-workbench_change start
        // 3. 如果 PATH 仍然为空，使用回退方案
        if (!cachedShellEnv.PATH) {
            console.warn('[ShellEnv] PATH not found in shell env, using fallback');
            const fallback = getFallbackEnvironment();
            cachedShellEnv.PATH = fallback.PATH;
        }
        // test-workbench_change end

        if (PERF_LOG && cachedShellEnv.PATH) {
            console.log('[ShellEnv] Loaded PATH:', cachedShellEnv.PATH.substring(0, 100) + '...');
        }
    } catch (error) {
        console.warn('[ShellEnv] Failed to load shell environment:', error);
        // test-workbench_change start
        cachedShellEnv = getFallbackEnvironment();
        // test-workbench_change end
    }

    if (PERF_LOG) console.log(`[ShellEnv] shell env loaded ${Date.now() - startTime}ms`);
    return cachedShellEnv;
}

// test-workbench_change start
/**
 * 回退环境变量方案
 * 当无法从 shell 加载时使用
 */
function getFallbackEnvironment(): Record<string, string> {
    const homeDir = process.env.HOME || os.homedir();
    const platform = process.platform;

    // 构建常见的 PATH 路径
    const commonPaths = [
        '/usr/local/bin',
        '/usr/bin',
        '/bin',
        '/usr/sbin',
        '/sbin',
    ];

    // 添加用户特定的路径
    const userPaths = [
        path.join(homeDir, '.local', 'bin'),
        path.join(homeDir, '.npm-global', 'bin'),
        path.join(homeDir, '.nvm', 'versions', 'node', 'current', 'bin'),
        path.join(homeDir, '.bun', 'bin'),
        path.join(homeDir, '.cargo', 'bin'),
        path.join(homeDir, 'go', 'bin'),
    ];

    if (platform === 'darwin') {
        // macOS 特定路径
        commonPaths.push('/opt/homebrew/bin');
        commonPaths.push('/usr/local/opt/node/bin');
    }

    // 过滤出存在的路径
    const existingPaths = [...commonPaths, ...userPaths].filter(p => {
        try {
            return existsSync(p);
        } catch {
            return false;
        }
    });

    const fallbackPath = existingPaths.join(':');

    console.log('[ShellEnv] Using fallback PATH:', fallbackPath);

    return {
        PATH: fallbackPath,
        HOME: homeDir,
    };
}
// test-workbench_change end
```

#### 1.2 添加诊断日志

```typescript
// extensions/aionui-main/src/process/agent/acp/AcpDetector.ts

async initialize(): Promise<void> {
    if (this.isDetected) return;

    console.log('[ACP] Starting agent detection...');
    // test-workbench_change start
    console.log('[ACP] Environment info:', {
        platform: process.platform,
        isPackaged: process.env.NODE_ENV === 'production',
        HOME: process.env.HOME,
        SHELL: process.env.SHELL,
        PATH: process.env.PATH?.substring(0, 200) + '...',
    });
    // test-workbench_change end

    const startTime = Date.now();

    // ... 其余代码
}
```

### 方案 2：添加手动配置选项

**目标**：允许用户手动指定 CLI 工具的路径。

#### 2.1 在 AionUI 设置中添加配置界面

```typescript
// extensions/aionui-main/src/renderer/pages/settings/AgentSettings.tsx

export function AgentSettings() {
    const [customPaths, setCustomPaths] = useState<Record<string, string>>({});

    return (
        <div>
            <h2>Agent CLI Paths</h2>
            <p>If agents are not detected automatically, you can specify their paths manually:</p>

            <div>
                <label>Claude CLI Path:</label>
                <input
                    type="text"
                    placeholder="/usr/local/bin/claude"
                    value={customPaths.claude || ''}
                    onChange={(e) => setCustomPaths({...customPaths, claude: e.target.value})}
                />
            </div>

            <div>
                <label>OpenCode CLI Path:</label>
                <input
                    type="text"
                    placeholder="/usr/local/bin/opencode"
                    value={customPaths.opencode || ''}
                    onChange={(e) => setCustomPaths({...customPaths, opencode: e.target.value})}
                />
            </div>

            {/* 其他 CLI 工具 */}

            <button onClick={() => saveCustomPaths(customPaths)}>
                Save and Re-detect
            </button>
        </div>
    );
}
```

#### 2.2 修改检测逻辑支持自定义路径

```typescript
// extensions/aionui-main/src/process/agent/acp/AcpDetector.ts

async initialize(): Promise<void> {
    // ... 现有代码

    // test-workbench_change start
    // 检查用户配置的自定义路径
    const customPaths = await ProcessConfig.get('acp.customCliPaths');
    if (customPaths) {
        for (const [backend, cliPath] of Object.entries(customPaths)) {
            if (typeof cliPath === 'string' && cliPath.trim()) {
                // 验证路径是否存在
                try {
                    accessSync(cliPath, fs.constants.X_OK);
                    detected.push({
                        backend: backend as AcpBackendAll,
                        name: `${backend} (custom)`,
                        cliPath: cliPath,
                    });
                    console.log(`[ACP] Added custom CLI: ${backend} at ${cliPath}`);
                } catch (error) {
                    console.warn(`[ACP] Custom CLI path not found: ${cliPath}`);
                }
            }
        }
    }
    // test-workbench_change end

    // ... 其余代码
}
```

### 方案 3：预加载常见 CLI 路径

**目标**：在检测时尝试常见的安装位置。

```typescript
// extensions/aionui-main/src/process/agent/acp/AcpDetector.ts

// test-workbench_change start
/**
 * 常见 CLI 工具的安装位置
 */
const COMMON_CLI_LOCATIONS: Record<string, string[]> = {
    claude: [
        '/usr/local/bin/claude',
        '/opt/homebrew/bin/claude',
        path.join(os.homedir(), '.local/bin/claude'),
        path.join(os.homedir(), '.npm-global/bin/claude'),
    ],
    opencode: [
        '/usr/local/bin/opencode',
        '/opt/homebrew/bin/opencode',
        path.join(os.homedir(), '.local/bin/opencode'),
        path.join(os.homedir(), '.npm-global/bin/opencode'),
    ],
    codex: [
        '/usr/local/bin/codex',
        '/opt/homebrew/bin/codex',
        path.join(os.homedir(), '.local/bin/codex'),
    ],
    // ... 其他 CLI 工具
};

/**
 * 尝试在常见位置查找 CLI 工具
 */
function findCliInCommonLocations(cliCommand: string): string | null {
    const locations = COMMON_CLI_LOCATIONS[cliCommand] || [];

    for (const location of locations) {
        try {
            accessSync(location, fs.constants.X_OK);
            console.log(`[ACP] Found ${cliCommand} at ${location}`);
            return location;
        } catch {
            continue;
        }
    }

    return null;
}
// test-workbench_change end

const isCliAvailable = (cliCommand: string): boolean => {
    // 先尝试 which/where
    try {
        execSync(`${whichCommand} ${cliCommand}`, {
            encoding: 'utf-8',
            stdio: 'pipe',
            timeout: 1000,
            env: enhancedEnv,
        });
        return true;
    } catch {
        // test-workbench_change start
        // 如果 which/where 失败，尝试常见位置
        const foundPath = findCliInCommonLocations(cliCommand);
        if (foundPath) {
            // 更新 detected 列表时使用找到的完整路径
            return true;
        }
        // test-workbench_change end

        if (!isWindows) return false;
    }

    // Windows fallback...
};
```

### 方案 4：添加诊断工具

**目标**：帮助用户诊断为什么检测不到 CLI 工具。

```typescript
// extensions/aionui-main/src/renderer/pages/settings/DiagnosticTool.tsx

export function DiagnosticTool() {
    const [diagnosticResult, setDiagnosticResult] = useState<any>(null);

    const runDiagnostic = async () => {
        const result = await window.electron.ipcRenderer.invoke('acp:runDiagnostic');
        setDiagnosticResult(result);
    };

    return (
        <div>
            <h2>Agent Detection Diagnostic</h2>
            <button onClick={runDiagnostic}>Run Diagnostic</button>

            {diagnosticResult && (
                <div>
                    <h3>Environment Variables:</h3>
                    <pre>{JSON.stringify(diagnosticResult.env, null, 2)}</pre>

                    <h3>Detected Agents:</h3>
                    <pre>{JSON.stringify(diagnosticResult.agents, null, 2)}</pre>

                    <h3>PATH Directories:</h3>
                    <ul>
                        {diagnosticResult.pathDirs.map((dir: string) => (
                            <li key={dir}>
                                {dir} {diagnosticResult.pathExists[dir] ? '✓' : '✗'}
                            </li>
                        ))}
                    </ul>

                    <h3>Common CLI Locations:</h3>
                    <ul>
                        {Object.entries(diagnosticResult.cliLocations).map(([cli, found]: [string, any]) => (
                            <li key={cli}>
                                {cli}: {found ? `✓ ${found}` : '✗ Not found'}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
```

```typescript
// extensions/aionui-main/src/process/bridge/ipcBridge.ts

ipcMain.handle('acp:runDiagnostic', async () => {
    const enhancedEnv = getEnhancedEnv();
    const pathDirs = (enhancedEnv.PATH || '').split(':');
    const pathExists: Record<string, boolean> = {};

    for (const dir of pathDirs) {
        try {
            pathExists[dir] = existsSync(dir);
        } catch {
            pathExists[dir] = false;
        }
    }

    const cliLocations: Record<string, string | null> = {};
    for (const cli of ['claude', 'opencode', 'codex', 'qwen']) {
        cliLocations[cli] = findCliInCommonLocations(cli);
    }

    return {
        env: {
            HOME: process.env.HOME,
            SHELL: process.env.SHELL,
            PATH: enhancedEnv.PATH,
            NODE_ENV: process.env.NODE_ENV,
        },
        agents: acpDetector.getDetectedAgents(),
        pathDirs,
        pathExists,
        cliLocations,
    };
});
```

---

## 🎯 推荐实施步骤

### 第一阶段：增强环境变量加载（必须）

1. ✅ 修改 `shellEnv.ts` 添加回退方案
2. ✅ 增加超时时间
3. ✅ 尝试多个 shell
4. ✅ 添加诊断日志

### 第二阶段：添加常见路径检测（推荐）

1. ✅ 实现 `findCliInCommonLocations`
2. ✅ 在检测失败时尝试常见位置
3. ✅ 记录找到的完整路径

### 第三阶段：添加手动配置（可选）

1. ⏳ 添加设置界面
2. ⏳ 支持自定义 CLI 路径
3. ⏳ 添加重新检测按钮

### 第四阶段：添加诊断工具（可选）

1. ⏳ 实现诊断 IPC 接口
2. ⏳ 创建诊断界面
3. ⏳ 提供详细的环境信息

---

## 🧪 测试计划

### 测试场景

1. **开发环境测试**：
   ```bash
   ./scripts/code.sh
   # 验证：智能体检测正常
   ```

2. **打包后测试（macOS）**：
   ```bash
   npm run gulp vscode-darwin-arm64
   cd ../VSCode-darwin-arm64
   open "Code - OSS.app"
   # 验证：智能体检测正常
   ```

3. **不同安装位置测试**：
   - CLI 安装在 `/usr/local/bin`
   - CLI 安装在 `~/.local/bin`
   - CLI 安装在 `~/.npm-global/bin`
   - CLI 通过 Homebrew 安装

4. **环境变量测试**：
   - 清空 `PATH` 环境变量
   - 清空 `SHELL` 环境变量
   - 验证回退方案是否生效

### 验证清单

- [ ] 开发环境可以检测到智能体
- [ ] 打包后可以检测到智能体
- [ ] 日志中显示正确的 PATH
- [ ] 日志中显示检测到的智能体数量
- [ ] 手动配置路径功能正常
- [ ] 诊断工具显示正确信息

---

## 📝 相关文件

需要修改的文件：

1. `extensions/aionui-main/src/process/utils/shellEnv.ts` - 环境变量加载
2. `extensions/aionui-main/src/process/agent/acp/AcpDetector.ts` - CLI 检测
3. `extensions/aionui-main/src/renderer/pages/settings/AgentSettings.tsx` - 设置界面（可选）
4. `extensions/aionui-main/src/process/bridge/ipcBridge.ts` - IPC 接口（可选）

---

## 🔗 参考资料

- [Electron 环境变量问题](https://github.com/electron/electron/issues/7688)
- [macOS 应用沙箱限制](https://developer.apple.com/documentation/security/app_sandbox)
- [VS Code 环境变量处理](https://github.com/microsoft/vscode/blob/main/src/vs/platform/environment/node/shellEnv.ts)

---

## 总结

问题的根本原因是**打包后的应用无法正确加载用户的 shell 环境变量**，导致 `PATH` 不完整，`which` 命令找不到 CLI 工具。

解决方案的核心是：
1. **增强环境变量加载**：尝试多个 shell，增加超时，添加回退方案
2. **常见路径检测**：在 `which` 失败时尝试常见的安装位置
3. **手动配置**：允许用户手动指定 CLI 路径
4. **诊断工具**：帮助用户排查问题

优先实施**方案 1 和方案 3**，它们可以解决大部分问题。
