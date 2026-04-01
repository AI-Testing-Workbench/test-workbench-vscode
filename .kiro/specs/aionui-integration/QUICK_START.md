# 🚀 快速开始：打包 VS Code + AionUI

## 一键打包

```bash
./scripts/quick-build.sh
```

就这么简单！🎉

## 打包后测试

```bash
# 进入打包目录
cd ../VSCode-darwin-arm64  # macOS
# 或 cd ../VSCode-linux-x64  # Linux
# 或 cd ..\VSCode-win32-x64  # Windows

# 启动 AionUI
./Code\ -\ OSS.app/Contents/MacOS/Electron --aionui  # macOS
# 或 ./code --aionui  # Linux
# 或 Code.exe --aionui  # Windows
```

## 验证打包

```bash
./scripts/verify-package.sh
```

## 需要帮助？

查看详细文档：
- [BUILD_README.md](./BUILD_README.md) - 完整打包指南
- [PACKAGING_COMPLETE.md](./PACKAGING_COMPLETE.md) - 打包完成指南
- [PACKAGING_GUIDE.md](./PACKAGING_GUIDE.md) - 详细技术文档

## 常见问题

**Q: 打包需要多久？**
A: 约 6-12 分钟

**Q: 打包后文件在哪里？**
A: `../VSCode-{platform}-{arch}/`

**Q: 如何测试？**
A: 运行 `./scripts/verify-package.sh`

**Q: 打包失败怎么办？**
A: 查看 [PACKAGING_COMPLETE.md](./PACKAGING_COMPLETE.md) 的故障排查部分

---

**就是这么简单！** 🎯
