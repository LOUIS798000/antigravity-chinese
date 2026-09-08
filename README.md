# Antigravity 中文汉化补丁

面向 Google Antigravity 的轻量非侵入式中文补丁。

---

### 一键安装

复制以下指令发送给 Antigravity 对话框即可自动完成拉取与配置：

```text
帮我执行 https://github.com/LOUIS798000/antigravity-chinese 这个项目的汉化，并配置开机自启动防止掉后台
```

---

## 特性说明

- **性能轻量**：采用单趟正则匹配，降低扫描开销，减少界面卡顿。
- **运行稳定**：具备 DOM 变动锁与重复替换防护，设置面板可正常展开，避免主线程死循环。
- **适度汉化**：
  - 覆盖常用菜单、设置项、按钮与提示文本。
  - 斜杠命令保留英文触发词，仅附加中文括号说明（如 `/btw (快速提问)`），不影响指令输入。
  - 代码块、终端输出、文件路径与模型名称等保持英文原样，避免过度汉化。
- **非侵入式**：基于 CDP 协议动态注入，不改动客户端二进制文件。
- **后台常驻**：支持配置为开机自启后台服务（Windows / macOS）。

---

## 手动安装

### 环境要求
- 已安装 Antigravity 客户端
- Node.js (>= 18)

### Windows
在 PowerShell 中运行：
```powershell
cd win
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned -Force
.\install.ps1
```

### macOS
在终端中运行：
```bash
cd mac
chmod +x install.sh uninstall.sh bin/antigravity-zh-patch.js
./install.sh
```

### 卸载
- **Windows**: `cd win && .\uninstall.ps1`
- **macOS**: `cd mac && ./uninstall.sh`

---

## 目录结构

```text
antigravity-chinese/
├── mac/                            # macOS 脚本
│   ├── bin/antigravity-zh-patch.js # 汉化注入脚本
│   ├── install.sh                  # 安装自启服务
│   └── uninstall.sh                # 卸载清理脚本
├── win/                            # Windows 脚本
│   ├── bin/antigravity-zh-patch.js # 汉化注入脚本
│   ├── install.ps1                 # 安装自启服务
│   ├── start-silent.vbs            # 静默启动脚本
│   └── uninstall.ps1               # 卸载清理脚本
└── README.md                       # 说明文档
```

---

## 开源协议

[MIT License](LICENSE)
