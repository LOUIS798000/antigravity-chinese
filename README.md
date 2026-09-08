# 🌌 Antigravity 中文汉化补丁 (Antigravity Chinese Patch)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Platform: macOS / Windows](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows-brightgreen.svg)]()
[![Target: Antigravity](https://img.shields.io/badge/Target-Antigravity-purple.svg)](https://antigravity.google/)

面向 Google Antigravity 的轻量、非侵入式中文汉化增强补丁。

---

### 🚀 一键安装（直接复制发给 Antigravity）

将以下指令直接发送给 Antigravity 对话框，智能体即可自动完成拉取、配置与自启守护：

```bash
帮我执行 https://github.com/LOUIS798000/antigravity-chinese 这个项目的汉化，并配置开机自启动防止掉后台
```

---

## ✨ 核心特性

- ⚡ **微秒级单趟匹配**：组合大正则预编译单趟扫描，彻底告别旧版多正则遍历造成的卡顿与高 CPU 占用。
- 🛡️ **绝对防死锁机制**：变动互斥锁 + 强幂等防护，设置页面与海量 DOM 秒开秒响应，绝不锁死主线程。
- 🎯 **精准汉化，不过度侵入**：
  - 核心菜单、面板、按钮与操作提示完整汉化。
  - 斜杠快捷命令保留英文触发词，视觉附加括号中文说明（如 `/btw (快速提问)`），绝不污染命令输入。
  - 严格保护代码块、终端、路径与模型名称，符合专业开发者使用习惯。
- 🟢 **绿色纯净**：基于 Chrome DevTools Protocol (CDP) 注入，不修改客户端二进制与源代码，官方静默更新无冲突。
- 🔄 **开机静默守护**：Windows 注册表 (HKCU\Run) / macOS LaunchAgent 静默常驻，防止后台掉线。

---

## 💻 手动快速开始

### 依赖环境
- 已安装最新版 Antigravity 客户端
- Node.js (>= 18)

### macOS 安装
```bash
cd mac
chmod +x install.sh uninstall.sh bin/antigravity-zh-patch.js
./install.sh
```

### Windows 安装
以 PowerShell 运行：
```powershell
cd win
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned -Force
.\install.ps1
```

### 卸载恢复
- **macOS**: `cd mac && ./uninstall.sh`
- **Windows**: `cd win && .\uninstall.ps1`

---

## 📂 项目结构

```text
antigravity-chinese/
├── mac/                            # macOS 专属
│   ├── bin/antigravity-zh-patch.js # 汉化注入引擎
│   ├── install.sh                  # LaunchAgent 自动安装
│   └── uninstall.sh                # 卸载清理脚本
├── win/                            # Windows 专属
│   ├── bin/antigravity-zh-patch.js # 汉化注入引擎
│   ├── install.ps1                 # 注册表与开机自启动配置
│   ├── start-silent.vbs            # 静默后台守护进程
│   └── uninstall.ps1               # 停用与清理脚本
└── README.md                       # 项目说明
```

---

## 📄 开源许可

本项目遵循 [MIT License](LICENSE) 开源协议。
