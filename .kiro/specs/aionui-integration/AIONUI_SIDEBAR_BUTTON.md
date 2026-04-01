# AionUI 侧边栏按钮实现

## 概述

在 VS Code 侧边栏底部的 Account 和 Manage 按钮之间添加了一个 AionUI 按钮，点击该按钮可以打开 AionUI 窗口。

## 实现的文件修改

### 1. `src/vs/workbench/common/activity.ts`
- 添加了 `AIONUI_ACTIVITY_ID` 常量定义

### 2. `src/vs/workbench/browser/parts/globalCompositeBar.ts`
- 添加了 `AIONUI_ACTION_INDEX` 常量（索引为 1，位于 Accounts 和 Manage 之间）
- 注册了 `AIONUI_ICON`（使用 sparkle 图标）
- 添加了 `aionuiAction` 实例
- 在 `actionViewItemProvider` 中添加了 AionUI 按钮的处理逻辑
- 创建了 `AionUIActivityActionViewItem` 类来处理 AionUI 按钮的渲染和交互
- 创建了 `SimpleAionUIActivityActionViewItem` 类用于标题栏中的简化版本
- 更新了 `toggleAccountsActivity` 方法以适应新的按钮数量

### 3. `src/vs/workbench/browser/parts/titlebar/titlebarPart.ts`
- 导入了 `AIONUI_ACTIVITY_ID` 和 `SimpleAionUIActivityActionViewItem`
- 在 `actionViewItemProvider` 中添加了 AionUI 按钮的处理
- 在 `overflowBehavior.exempted` 中添加了 `AIONUI_ACTIVITY_ID`，防止按钮被隐藏到溢出菜单

## 按钮顺序

侧边栏底部的按钮顺序（从上到下）：
1. Accounts（可选，可以通过设置隐藏）
2. AionUI（新增）
3. Manage

## 功能说明

- 点击 AionUI 按钮会执行 `workbench.action.openAionUIWindow` 命令
- 该命令已在 `src/vs/workbench/contrib/aionui/browser/aionui.contribution.ts` 中注册
- 支持鼠标点击、键盘（Enter/Space）和触摸操作
- 按钮使用 sparkle 图标（Codicon.sparkle）
- 按钮标题为 "Open AionUI"

## 测试建议

1. 启动 VS Code
2. 查看侧边栏底部是否显示 AionUI 按钮（sparkle 图标）
3. 点击按钮验证是否能打开 AionUI 窗口
4. 测试键盘导航（Tab 键选中后按 Enter 或 Space）
5. 验证在不同的侧边栏位置（左侧/右侧）按钮是否正常工作
