# 🔷 Windows 版 Antigravity 中文汉化脚本

[![Platform: Windows](https://img.shields.io/badge/Platform-Windows-blue.svg)]()
[![Startup: Task Scheduler](https://img.shields.io/badge/Startup-Task%20Scheduler-informational.svg)]()

本目录提供了针对 Windows 版 **Antigravity** 的专属汉化守护进程实现。它通过创建用户级别的 `计划任务 (Task Scheduler)`，在您每次登录 Windows 系统后自动在后台静默启动守护进程，并将中文翻译注入至客户端中。

---

## 🛠️ 工作原理

1. **计划任务守护**：利用 Windows 原生的 `计划任务程序` 创建一个开机登录即自启动的任务，无需依赖第三方自启工具。
2. **后台侦听**：使用 Node.js 脚本静默侦听 Antigravity 的调试通道接口。
3. **安全注入**：自动检测客户端窗口的开启与刷新动作，实时注入汉化词表，完美不触碰客户端底层文件。

---

## 🚀 安装与更新

请以管理员身份或普通用户身份打开 **PowerShell**，进入本目录并运行安装脚本：

```powershell
# 1. 进入 Windows 专属目录
cd win

# 2. 执行安装脚本
.\install.ps1
```

> [!IMPORTANT]
> **关于执行策略安全警告**：
> 如果您在运行脚本时遇到 PowerShell 提示“因为在此系统上禁止运行脚本...”的错误，请先执行以下命令以允许运行本地脚本，然后再重新运行安装脚本：
> ```powershell
> Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
> ```

---

## 🔌 停用与卸载

如果您需要完全停用汉化或将其卸载，请在 PowerShell 中执行：

```powershell
cd win
.\uninstall.ps1
```
该脚本会优雅地停止正在运行的后台 Node 汉化进程，并自动从 Windows 计划任务库中彻底删除该项任务，无残留。

---

## 📂 目录结构说明

- 📄 `bin\antigravity-zh-patch.js`：Windows 核心注入汉化代码与翻译词典。
- 📄 `install.ps1`：自动在 Windows 系统中创建并激活开机登录计划任务的脚本。
- 📄 `uninstall.ps1`：停止后台进程并清除对应计划任务的卸载脚本。
- 📂 `logs\`：预留的后台日志输出目录，用于异常排查。
