# Antigravity 中文汉化补丁

面向 Google Antigravity 的轻量非侵入式中文补丁。

---

### 一键安装

复制以下指令发送给 Antigravity 对话框即可自动完成拉取与配置：

```text
帮我执行 https://github.com/LOUIS798000/antigravity-chinese 这个项目的汉化，并配置开机自启动防止掉后台
```

---

## 特性说明（v3.0）

- **全界面地毯式深度覆盖（适配 Antigravity v2.29+ / Electron 44+）**：
  - 全面覆盖新版主页（Home）、左侧边栏分组与工作区头部、顶部菜单栏、全部设置与全局权限面板、危险区域（Danger Zone）确认卡片、右键上下文菜单、快捷键列表、所有下拉选择框与弹窗、搜索框占位提示（Placeholder）及动态悬浮气泡（Tooltip）。
  - 完整适配 **插件扩展市场（Marketplace）** 八大官方分类货架、精选插件卡片说明及外部账户授权（Accounts）界面。
  - 完整适配新版 **自动化面板（Automations）**、**实时语音对话（Voice Mode / Gemini Live）**、**远程/云端智能体与 WSL 连接**、**Jupyter Notebook 查看器**、**内置浏览器下载/历史面板**，以及 **Android Device Hub / Compose Preview** 等 Sidecar 扩展子窗格（支持 Shadow DOM、同源 iframe 与本地 Webview 注入）。
- **极致低内存与零卡顿架构**：
  - 采用 **O(1) 精确词表哈希 + 首词前缀桶零正则扫描**（彻底移除超大回溯正则，单窗口立省 15~30 MB V8 JIT 原生内存）+ 确定性 UI 复合短语语法引擎。
  - 引入 `WeakMap` 节点级缓存与局部按需监听，AI 高频流式输出期间几乎零开销；自动过滤内置浏览器中打开的外部公网网页（0 注入、0 内存占用）。
  - 后台守护进程内置目标状态缓存（免除高频 WebSocket 重连风暴）与 `48 MB` 堆上限保护，空闲 CPU 占用稳定在 `0.0%`。
- **安全零污染与防崩保护**：
  - 内置 React Fiber DOM 协调异常防护锁、混合长句防半截污染守卫与重复替换互斥锁，彻底杜绝白屏崩溃与中英散装混杂。
  - 斜杠命令（`/`）与输入框提示采用纯 CSS 伪元素零侵入增强（保留英文触发词并附加中文说明，如 `/btw (快速提问)`），不影响指令过滤与输入。
  - 严格保护 AI 回答正文、用户消息、代码块、终端输出、文件树真实文件/目录名、键盘快捷键（`<kbd>`）与模型名称保持原样。
- **非侵入式与全版本 Node 兼容**：基于 Chromium CDP 协议（含 Electron 44+ 浏览器级 WebSocket 双通道兜底与 Node.js 18/20/22+ 原生兼容层）动态注入，不改动客户端二进制文件；支持脚本变更自动热重载与旧闭包完整回收。

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
