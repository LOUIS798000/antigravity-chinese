# 🔷 Windows 版 Antigravity 中文汉化脚本

[![Platform: Windows](https://img.shields.io/badge/Platform-Windows-blue.svg)]()
[![Startup: Registry Run](https://img.shields.io/badge/Startup-HKCU%20Run-informational.svg)]()

本目录提供了针对 Windows 版 **Antigravity** 的专属汉化守护进程实现。通过配置用户级别的注册表自启项（`HKCU\Run`）并结合 VBS 脚本，在您每次登录 Windows 系统后自动在后台无黑框静默启动守护进程，实时将中文翻译注入至客户端中。

---

## 🛠️ 工作原理

1. **注册表守护**：利用 Windows 注册表 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` 实现无需管理员权限的开机登录静默守护。
2. **轻量后台侦听**：使用 Node.js 脚本智能侦听 Antigravity 的 Chrome DevTools Protocol 调试通道，具备端口缓存与状态识别，杜绝 CPU 占用。
3. **安全注入**：自动检测客户端窗口的开启与刷新动作，实时注入汉化词表，完美不触碰客户端底层文件。
4. **正文防污染**：内置安全过滤，自动跳过用户提问内容与 AI 回复正文，仅汉化界面 UI 与快捷指令。

---

## 🚀 安装与运行

打开 **PowerShell**，进入本目录并运行安装脚本：

```powershell
# 1. 进入 Windows 专属目录
cd win

# 2. 执行安装脚本
.\install.ps1
```

> [!IMPORTANT]
> **关于执行策略安全提示**：
> 如果您在运行脚本时遇到 PowerShell 提示“因为在此系统上禁止运行脚本...”的错误，可先执行以下命令允许运行本地脚本，然后再重新运行安装脚本：
> ```powershell
> Set-ExecutionPolicy -Scope CurrentUser RemoteSigned -Force
> ```

---

## 🔌 停用与卸载

如果您需要完全停用汉化或将其卸载，请在 PowerShell 中执行：

```powershell
cd win
.\uninstall.ps1
```
该脚本会自动停止正在运行的后台守护进程，清除注册表自启项与临时配置，彻底无残留。

---

## 📂 目录结构说明

- 📄 `bin\antigravity-zh-patch.js`：Windows 核心注入汉化代码、弹出层拦截与翻译词典。
- 📄 `start-silent.vbs`：后台无黑框静默拉起 Node.js 守护进程的启动脚本。
- 📄 `install.ps1`：自动配置开机自启并启动守护进程的安装脚本。
- 📄 `uninstall.ps1`：停止后台进程并清除开机自启项的卸载脚本。
- 📂 `logs\`：预留的后台日志输出目录。
