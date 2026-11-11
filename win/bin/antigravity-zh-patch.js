#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const PATCH_VERSION = 68;
const INITIAL_SCRIPT_MTIME = (() => {
  try {
    return fs.statSync(__filename).mtimeMs;
  } catch {
    return 0;
  }
})();

const overlaySource = String.raw`
(() => {
  // 排除内置浏览器中打开的外部公网网页，避免对第三方网站注入 DOM 监听与词典占用内存
  try {
    const proto = location.protocol;
    const host = location.hostname;
    if (
      (proto === 'http:' || proto === 'https:') &&
      host !== '127.0.0.1' &&
      host !== 'localhost' &&
      host !== '[::1]'
    ) {
      return;
    }
  } catch {}

  const CURRENT_PATCH_VERSION = 68;
  if (window.__antigravityZhPatchInstalled === CURRENT_PATCH_VERSION) return;
  if (typeof window.__antigravityCleanup === 'function') {
    try { window.__antigravityCleanup(); } catch {}
  }
  if (window.__antigravityZhPatchObserver) {
    try { window.__antigravityZhPatchObserver.disconnect(); } catch {}
  }
  if (Array.isArray(window.__antigravityZhPatchObservers)) {
    for (const obs of window.__antigravityZhPatchObservers) {
      try { obs.disconnect(); } catch {}
    }
  }
  window.__antigravityZhPatchObservers = [];
  if (window.__antigravityPopupInterval) clearInterval(window.__antigravityPopupInterval);
  if (window.__antigravityTitleInterval) clearInterval(window.__antigravityTitleInterval);
  window.__antigravityPopupInterval = null;
  window.__antigravityTitleInterval = null;
  window.__antigravityZhPatchInstalled = CURRENT_PATCH_VERSION;

  // 核心防护：拦截外部 DOM 变动导致的 React 协调异常 (Failed to execute 'removeChild' on 'Node')，杜绝白屏卡死
  if (typeof Node === 'function' && Node.prototype && !window.__antigravityReactCrashGuardInstalled) {
    window.__antigravityReactCrashGuardInstalled = true;
    const origRemoveChild = Node.prototype.removeChild;
    Node.prototype.removeChild = function (child) {
      if (child && child.parentNode !== this) {
        return child;
      }
      return origRemoveChild.apply(this, arguments);
    };
    const origInsertBefore = Node.prototype.insertBefore;
    Node.prototype.insertBefore = function (newNode, refNode) {
      if (refNode && refNode.parentNode !== this) {
        return newNode;
      }
      return origInsertBefore.apply(this, arguments);
    };
  }

  // ===== 第一级：整词/整节点精确匹配字典 (O(1) 查找，仅当整个文本节点或属性值完全匹配时才替换，彻底杜绝句子中误替换 "now" 等短词) =====
  const exactPhrases = new Map([
    // 时间与状态短词（仅整节点匹配，绝不污染正文或句子中的 now）
    ["now", "刚刚"],
    ["Now", "刚刚"],
    ["just now", "刚刚"],
    ["Just now", "刚刚"],
    ["Working...", "正在处理..."],
    ["Working", "正在处理"],
    ["Running", "运行中"],
    ["Thinking...", "思考中..."],
    ["Thinking", "思考中"],
    ["Thought Process", "思考过程"],
    ["Creating…", "正在创建…"],
    ["Creating...", "正在创建..."],
    ["Loading...", "加载中..."],
    ["Searching", "正在搜索"],
    ["Searched", "已搜索"],
    ["Analyzing", "正在分析"],
    ["Analyzed", "已分析"],
    ["Ran", "已运行"],
    ["Explored", "已探索"],
    ["Edited", "已编辑"],
    ["Created", "已创建"],
    ["Deleted", "已删除"],
    ["Archived", "已归档"],
    ["Pinned", "已固定"],
    ["Copied", "已复制"],
    ["Disabled", "已禁用"],
    ["Enabled", "已启用"],

    // 顶部菜单栏与基础导航单字
    ["File", "文件"],
    ["Edit", "编辑"],
    ["Selection", "选择"],
    ["View", "视图"],
    ["Go", "前往"],
    ["Run", "运行"],
    ["Terminal", "终端"],
    ["Window", "窗口"],
    ["Help", "帮助"],
    ["Workspace", "工作区"],
    ["Automations", "自动化"],
    ["Automation", "自动化"],
    ["Customizations", "自定义"],
    ["Customize", "自定义"],
    ["Conversations", "对话"],
    ["Conversation", "对话"],
    ["Projects", "项目"],
    ["Project", "项目"],
    ["Settings", "设置"],
    ["Shortcuts", "快捷键"],
    ["Feedback", "反馈"],
    ["Sidebar", "侧边栏"],
    ["Overview", "概览"],
    ["Review", "审查"],
    ["Artifacts", "产物"],
    ["Subagents", "子智能体"],
    ["Terminals", "终端列表"],
    ["Uploads", "已上传附件"],
    ["Sources", "参考来源"],

    // 通用按钮与操作单字
    ["Open", "打开"],
    ["Use", "使用"],
    ["Read", "读取"],
    ["Add", "添加"],
    ["Copy", "复制"],
    ["Quit", "退出"],
    ["Cancel", "取消"],
    ["Skip", "跳过"],
    ["Submit", "提交"],
    ["Rename", "重命名"],
    ["Back", "返回"],
    ["Close", "关闭"],
    ["Delete", "删除"],
    ["Save", "保存"],
    ["Reset", "重置"],
    ["Refresh", "刷新"],
    ["Search", "搜索"],
    ["Export", "导出"],
    ["Import", "导入"],
    ["Upgrade", "升级"],
    ["Allow", "允许"],
    ["Deny", "拒绝"],
    ["Confirm", "确认"],
    ["Retry", "重试"],
    ["Restore", "恢复"],
    ["Archive", "归档"],
    ["Pin", "固定"],
    ["Unpin", "取消固定"],
    ["Minimize", "最小化"],
    ["Maximize", "最大化"],
    ["No", "否"],
    ["Yes", "是"],

    // 设置分类与标签单字
    ["General", "常规"],
    ["Account", "账户"],
    ["Permissions", "权限"],
    ["Appearance", "外观"],
    ["Models", "模型"],
    ["Model", "模型"],
    ["Browser", "浏览器"],
    ["Notifications", "通知"],
    ["App", "应用"],
    ["Application", "应用"],
    ["Developer", "开发者选项"],
    ["Labs", "实验特性"],
    ["Rules", "规则"],
    ["Skills", "技能"],
    ["Skill", "技能"],
    ["Workflows", "工作流"],
    ["Plugins", "插件"],
    ["Plugin", "插件"],
    ["Commands", "命令"],
    ["Command", "命令"],
    ["Actions", "动作"],
    ["Action", "动作"],
    ["Mentions", "提及引用"],
    ["Mention", "提及引用"],
    ["Built-in", "内置"],
    ["System", "系统"],
    ["Marketplace", "扩展市场"],
    ["Version", "版本"],
    ["Description", "问题描述"],
    ["Recommended", "推荐"],
    ["Navigation", "导航"],
    ["Email", "邮箱"],
    ["Sound", "声音"],
    ["Advanced", "高级"],
    ["Updater", "更新管理"],
    ["Quota", "配额"],
    ["Usage", "用量"],
    ["Notice", "提示"],
    ["New", "新建"],
    ["Plan", "计划"],
    ["Tab", "标签页"],
    ["Picker", "选择器"],
    ["picker", "选择器"],
    ["Media", "媒体"],
    ["Folders", "文件夹"],
    ["Execution", "执行"],
    ["Queue", "排队"],
    ["Trigger", "触发器"],
    ["Environment", "环境"],
    ["Nickname", "设备昵称"],
    ["Subtitles", "副标题"],
    ["Worktree", "工作树"],
    ["Theme", "主题"],
    ["Themes", "主题"],
    ["Preset", "预设"],
    ["Presets", "预设"],
    ["Background", "背景色"],
    ["Foreground", "前景色"],
    ["Accent", "强调色"],

    // 选项值与级别单字
    ["Minimal", "极低"],
    ["Low", "低"],
    ["Medium", "中等"],
    ["High", "高"],
    ["Max", "最高"],
    ["Fast", "快速"],
    ["Balanced", "均衡"],
    ["Reasoning", "深度推理"],
    ["Effort", "推理强度"],
    ["Local", "本地"],
    ["Remote", "远程"],
    ["Cloud", "云端"],
    ["None", "无"],
    ["Status", "状态"],
    ["Custom", "自定义"],
    ["Default", "默认"],
    ["Narrow", "紧凑"],
    ["Wide", "宽屏"],
    ["Fill", "填充"],
    ["Compact", "紧凑"],
    ["Comfortable", "舒适"],
    ["Auto", "自动"],
    ["Auto (Preview)", "自动（预览）"],
    ["Turbo", "极速 (Turbo)"],
    ["Preview", "预览"],
    ["Experimental", "实验性"],
    ["Beta", "测试版"],
    ["Deprecated", "已弃用"],

    // v2.29 主页、侧边栏日期分组与基础导航单字
    ["Home", "主页"],
    ["Inbox", "收件箱"],
    ["Activity", "活动"],
    ["Updates", "更新"],
    ["Changelog", "更新日志"],
    ["Documentation", "文档"],
    ["Docs", "文档"],
    ["Community", "社区"],
    ["Support", "支持"],
    ["About", "关于"],
    ["Today", "今天"],
    ["Yesterday", "昨天"],
    ["Older", "更早"],
    ["Recent", "最近"],
    ["All", "全部"],
    ["Active", "活跃"],
    ["Inactive", "未激活"],
    ["Unread", "未读"],
    ["Starred", "已加星标"],
    ["Favorites", "收藏"],

    // v2.28-v2.29 插件市场、账户与生命周期单字
    ["Installed", "已安装"],
    ["Featured", "精选"],
    ["Official", "官方"],
    ["Partner", "合作伙伴"],
    ["Partners", "合作伙伴"],
    ["Popular", "热门"],
    ["Trending", "趋势"],
    ["Categories", "分类"],
    ["Category", "分类"],
    ["Accounts", "账户"],
    ["Install", "安装"],
    ["Installing...", "正在安装..."],
    ["Installing", "正在安装"],
    ["Uninstall", "卸载"],
    ["Uninstalling...", "正在卸载..."],
    ["Enable", "启用"],
    ["Disable", "禁用"],
    ["Update", "更新"],
    ["Updating...", "正在更新..."],
    ["Updated", "已更新"],
    ["Configure", "配置"],
    ["Manage", "管理"],
    ["Connect", "连接"],
    ["Connected", "已连接"],
    ["Connecting...", "正在连接..."],
    ["Connecting", "正在连接"],
    ["Disconnect", "断开连接"],
    ["Disconnected", "已断开"],
    ["Reconnect", "重新连接"],
    ["Authorize", "授权"],
    ["Authorized", "已授权"],
    ["Business", "商业与数据"],
    ["Personal", "个人"],
    ["Work", "工作"],
    ["Hooks", "钩子"],
    ["Hook", "钩子"],
    ["Agents", "智能体"],
    ["Agent", "智能体"],
    ["Sidecar", "扩展面板"],
    ["Sidecars", "扩展面板"],

    // v2.29 自动化与计划调度单字
    ["Schedule", "计划调度"],
    ["Scheduled", "已计划"],
    ["Schedules", "计划列表"],
    ["Cadence", "执行周期"],
    ["Frequency", "执行频率"],
    ["Timezone", "时区"],
    ["Prompt", "提示词"],
    ["Prompts", "提示词"],
    ["History", "历史记录"],
    ["Logs", "日志"],
    ["Output", "输出"],
    ["Outputs", "输出"],
    ["Result", "结果"],
    ["Results", "结果"],
    ["Hourly", "每小时"],
    ["Daily", "每天"],
    ["Weekly", "每周"],
    ["Monthly", "每月"],
    ["Weekdays", "工作日"],
    ["Weekends", "周末"],
    ["Once", "单次"],
    ["Manual", "手动"],
    ["Paused", "已暂停"],
    ["Pause", "暂停"],
    ["Resume", "恢复"],
    ["Stop", "停止"],
    ["Stopped", "已停止"],
    ["Start", "启动"],
    ["Restart", "重启"],
    ["Completed", "已完成"],
    ["Succeeded", "已成功"],
    ["Success", "成功"],
    ["Failed", "失败"],
    ["Error", "错误"],
    ["Errors", "错误"],
    ["Warning", "警告"],
    ["Warnings", "警告"],
    ["Pending", "等待中"],
    ["Queued", "排队中"],
    ["Cancelled", "已取消"],
    ["Canceled", "已取消"],
    ["Skipped", "已跳过"],
    ["Timeout", "超时"],
    ["Monday", "星期一"],
    ["Tuesday", "星期二"],
    ["Wednesday", "星期三"],
    ["Thursday", "星期四"],
    ["Friday", "星期五"],
    ["Saturday", "星期六"],
    ["Sunday", "星期日"],
    ["Mon", "周一"],
    ["Tue", "周二"],
    ["Wed", "周三"],
    ["Thu", "周四"],
    ["Fri", "周五"],
    ["Sat", "周六"],
    ["Sun", "周日"],

    // v2.29 实时语音模式 (Voice Mode / Gemini Live) 单字
    ["Voice", "语音"],
    ["Live", "实时语音"],
    ["Listening...", "正在聆听..."],
    ["Listening", "正在聆听"],
    ["Speaking...", "正在说话..."],
    ["Speaking", "正在说话"],
    ["Processing...", "正在处理..."],
    ["Initializing...", "正在初始化..."],
    ["Mute", "静音"],
    ["Muted", "已静音"],
    ["Unmute", "取消静音"],
    ["Microphone", "麦克风"],
    ["Speaker", "扬声器"],
    ["Audio", "音频"],
    ["Transcript", "文字记录"],
    ["Captions", "实时字幕"],
    ["Interrupt", "打断"],

    // v2.29 远程环境、编辑器、审查、Notebook、浏览器与设备中心单字
    ["Repository", "代码仓库"],
    ["Repositories", "代码仓库"],
    ["Branch", "分支"],
    ["Branches", "分支"],
    ["Secrets", "密钥"],
    ["Secret", "密钥"],
    ["Variables", "变量"],
    ["Container", "容器"],
    ["Sandbox", "沙盒"],
    ["Online", "在线"],
    ["Offline", "离线"],
    ["Provisioning...", "正在分配环境..."],
    ["Provisioning", "正在分配环境"],
    ["Starting...", "正在启动..."],
    ["Stopping...", "正在停止..."],
    ["Sleeping", "休眠中"],
    ["Ready", "就绪"],
    ["Diff", "差异对比"],
    ["Changes", "更改"],
    ["Changed", "已更改"],
    ["Added", "新增"],
    ["Modified", "已修改"],
    ["Removed", "已移除"],
    ["Renamed", "已重命名"],
    ["Untracked", "未跟踪"],
    ["Staged", "已暂存"],
    ["Unstaged", "未暂存"],
    ["Accept", "接受"],
    ["Reject", "拒绝"],
    ["Discard", "放弃"],
    ["Revert", "还原"],
    ["Approve", "批准"],
    ["Approved", "已批准"],
    ["Proceed", "继续执行"],
    ["Continue", "继续"],
    ["Done", "完成"],
    ["Finish", "完成"],
    ["Next", "下一步"],
    ["Previous", "上一步"],
    ["Apply", "应用"],
    ["Clear", "清除"],
    ["Filter", "筛选"],
    ["Filters", "筛选"],
    ["Sort", "排序"],
    ["Share", "分享"],
    ["Shared", "已分享"],
    ["Send", "发送"],
    ["Attach", "添加附件"],
    ["Upload", "上传"],
    ["Download", "下载"],
    ["Downloads", "下载内容"],
    ["Bookmarks", "书签"],
    ["Reload", "重新加载"],
    ["Inspect", "检查"],
    ["Console", "控制台"],
    ["Network", "网络"],
    ["Notebook", "笔记本"],
    ["Kernel", "内核"],
    ["Cell", "单元格"],
    ["Cells", "单元格"],
    ["Split", "拆分"],
    ["Unified", "统一视图"],
    ["Inline", "内联"],
    ["Side-by-side", "并排对比"],
    ["Details", "详情"],
    ["Summary", "摘要"],
    ["Name", "名称"],
    ["Type", "类型"],
    ["Size", "大小"],
    ["Path", "路径"],
    ["Scope", "作用域"],
    ["Global", "全局"],
    ["Inherited", "继承"],
    ["Override", "覆盖"],
    ["Optional", "可选"],
    ["Required", "必填"],
    ["Devices", "设备"],
    ["Device", "设备"],
    ["Emulators", "模拟器"],
    ["Emulator", "模拟器"],
    ["Physical", "真机"],
    ["Virtual", "虚拟设备"],
    ["Mirror", "屏幕镜像"],
    ["Mirroring", "正在镜像"],
    ["Screenshot", "屏幕截图"],
    ["Rotate", "旋转"],
    ["Portrait", "竖屏"],
    ["Landscape", "横屏"],
    ["Render", "渲染"],
    ["Rendering...", "正在渲染..."],
    ["Rendered", "已渲染"],
    ["Undo", "撤销"],
    ["Redo", "重做"],
    ["Cut", "剪切"],
    ["Paste", "粘贴"],
    ["Find", "查找"],
    ["Replace", "替换"],
    ["Exit", "退出"],
    ["Preferences", "偏好设置"],
    ["Services", "服务"],
    ["Hide", "隐藏"],
    ["Show", "显示"],
    ["Tools", "工具"],

    // v2.29.0 分段开关、按钮动作、快捷键与状态单字补齐
    ["Light", "浅色"],
    ["Dark", "深色"],
    ["Change...", "更改..."],
    ["Change…", "更改…"],
    ["Change", "更改"],
    ["Browse...", "浏览..."],
    ["Browse…", "浏览…"],
    ["Browse", "浏览"],
    ["Choose...", "选择..."],
    ["Choose…", "选择…"],
    ["Choose", "选择"],
    ["Select...", "选择..."],
    ["Edit...", "编辑..."],
    ["Quote", "引用"],
    ["Block", "阻止"],
    ["Blocked", "已阻止"],
    ["Ask", "询问"],
    ["Always", "始终"],
    ["Never", "从不"],
    ["On", "开启"],
    ["Off", "关闭"],
    ["Memory", "记忆"],
    ["Memories", "记忆"],
    ["Knowledge", "知识库"],
    ["Demoted", "已降级"],
    ["Excluded", "已排除"],
    ["Truncated", "已截断"],
    ["Available", "可用"],
    ["Total", "总计"],
    ["Used", "已使用"],
    ["Remaining", "剩余"],
    ["Unlimited", "无限制"],
    ["Free", "免费版"],
    ["Pro", "专业版"],
    ["Ultra", "旗舰版"],
    ["Enterprise", "企业版"],
    ["Team", "团队版"],
    ["Stable", "稳定版"],
    ["Nightly", "每夜版"],
    ["Canary", "金丝雀版"],
    ["Copied!", "已复制！"],
    ["Speakers", "扬声器"],
    ["Headphones", "耳机"],
    ["Input", "输入"],
    ["Volume", "音量"],
    ["Speed", "语速"],
    ["Pitch", "音调"],
    ["Waveform", "波形"],
    ["Editor", "编辑器"],
    ["Pane", "窗格"],
    ["Panes", "窗格"],
    ["Panel", "面板"],
    ["Panels", "面板"],
    ["Toolbar", "工具栏"],
    ["Statusbar", "状态栏"],
    ["Header", "顶部栏"],
    ["Footer", "底部栏"],
    ["Modal", "弹窗"],
    ["Zen", "禅模式"],
    ["Fullscreen", "全屏"],
    [", or", "，或"],
    [", and", "，以及"],

    // v65 地板式全量单复数与面板控件单字补齐
    ["Files", "文件"],
    ["Folder", "文件夹"],
    ["Extension", "扩展"],
    ["Extensions", "扩展"],
    ["Raw", "原始文本"],
    ["Outline", "大纲"],
    ["Blame", "Git 追溯"],
    ["Document", "文档"],
    ["Documents", "文档"],
    ["Artifact", "产物"],
    ["Subagent", "子智能体"],
    ["Source", "参考来源"],
    ["Task", "任务"],
    ["Tasks", "任务"],
    ["Tabs", "标签页"],
    ["Windows", "窗口"],
    ["Permission", "权限"],
    ["Grant", "授权"],
    ["Grants", "授权"],
    ["Shortcut", "快捷键"],
    ["Notification", "通知"],
    ["Sounds", "声音"],
    ["Font", "字体"],
    ["Fonts", "字体"],
    ["Icon", "图标"],
    ["Icons", "图标"],
    ["Badge", "徽章"],
    ["Badges", "徽章"],
    ["Comment", "评论"],
    ["Comments", "评论"],
    ["Attachment", "附件"],
    ["Attachments", "附件"],
    ["Page", "页面"],
    ["Pages", "页面"],
    ["Image", "图片"],
    ["Images", "图片"],
    ["Video", "视频"],
    ["Videos", "视频"],
    ["Link", "链接"],
    ["Links", "链接"],
    ["Domain", "域名"],
    ["Domains", "域名"],
    ["Host", "主机"],
    ["Hosts", "主机"],
    ["Server", "服务器"],
    ["Servers", "服务器"],
    ["Provider", "服务商"],
    ["Providers", "服务商"],
    ["Profile", "配置资料"],
    ["Profiles", "配置资料"],
    ["Session", "会话"],
    ["Sessions", "会话"],
    ["Job", "作业"],
    ["Jobs", "作业"],
    ["Runs", "运行记录"],
    ["Step", "步骤"],
    ["Steps", "步骤"],
    ["Turn", "轮次"],
    ["Turns", "轮次"],
    ["Credit", "积分"],
    ["Credits", "积分"],
    ["Limit", "限额"],
    ["Limits", "限额"],
    ["Rule", "规则"],
    ["Policy", "策略"],
    ["Policies", "策略"],
    ["List", "列表"],
    ["Lists", "列表"],
    ["Allowlist", "允许列表"],
    ["Denylist", "拒绝列表"],
    ["Accessibility", "无障碍"],
    ["Precedence", "优先级"],
    ["Print", "打印"],
    ["Print...", "打印..."],
    ["Stage", "暂存"],
    ["Unstage", "取消暂存"],
    ["Supervised", "受控模式"],
    ["Cautious", "谨慎模式"],
    ["Strict", "严格模式"],
    ["Autonomous", "自主模式"],
    ["Read-only", "只读"],
    ["Readonly", "只读"],
    ["Minimap", "缩略图"],
    ["Breadcrumbs", "面包屑导航"],
    ["Duplicate", "创建副本"],
    ["Fork", "创建分支"],
    ["Regenerate", "重新生成"],
    ["Chat", "聊天"],
    ["Chats", "聊天"],
    ["Verbose", "详细"],
    ["Concise", "简洁"],
    ["Brief", "简略"],
    ["Detailed", "详细"],
    ["Contrast", "对比度"],
    ["Strong", "增强"],
    ["Normal", "标准"],
    ["Standard", "标准"],
    ["Subtle", "柔和"],
    ["Small", "小"],
    ["Large", "大"],
    ["Zoom", "缩放"],
    ["Layout", "布局"],
    ["Width", "宽度"],
    ["Density", "排列密度"],
    ["Motion", "动态效果"],
    ["Animations", "动画效果"],
    ["Telemetry", "遥测"],
    ["Diagnostics", "诊断"],
    ["Security", "安全"],
    ["Privacy", "隐私"],
    ["Billing", "账单"],
    ["Subscription", "订阅"],
    ["Credentials", "凭据"],
    ["Authentication", "身份认证"],
    ["Proxy", "代理"],
    ["Cache", "缓存"],
    ["Storage", "存储"],
    ["Trash", "回收站"],
    ["Clipboard", "剪贴板"],
    ["Workspaces", "工作区"],
    ["Goals", "目标"],
    ["Machine", "全本机"],
    ["Other", "其他"],
    ["Worked", "已工作"],
  ]);

  // ===== 第二级：多词安全短语与完整句字典 (均为 2 词以上明确 UI 短语，无单字歧义) =====
  const phrases = new Map([
    // 旧版半截翻译自愈修复（无需重启即可修复已污染节点）
    ["添加到聊天/Quote", "添加到聊天 / 引用"],
    ["添加到聊天 / Quote", "添加到聊天 / 引用"],
    ["Scan the code to open this device in 远程控制, or copy link.", "扫描二维码以在远程控制中打开此设备，或复制链接。"],
    ["Scan the code to open this device in 远程控制, or", "扫描二维码以打开此设备的远程控制，或"],
    ["Configure the browser subagent. It requires Chrome 浏览器 to be installed. The browser subagent can be invoked by typing /browser in the conversation input box.", "配置浏览器子智能体。此功能需要安装 Chrome 浏览器后方可使用。在对话输入框中输入 /browser 即可调用浏览器子智能体。"],
    ["已固定 动作", "已固定会话操作"],
    ["Pinned Actions", "已固定会话操作"],
    ["搜索 对话", "搜索对话"],
    ["Search Conversations", "搜索对话"],
    ["视图 Usage", "查看用量"],
    ["文件 Viewer header", "文件查看器头部"],
    ["文件 Viewer", "文件查看器"],
    ["文件 path breadcrumbs", "文件路径面包屑"],
    ["Toggle 概览 Panel", "切换概览面板"],
    ["项目 options", "项目选项"],
    ["对话 Log", "对话日志"],
    ["滚动到Bottom", "滚动到底部"],
    ["新建tab", "新建标签页"],
    ["切换sidebar", "切换侧边栏"],
    ["最大化 Pane", "最大化窗格"],
    ["添加 inline comment", "添加行内评论"],
    ["Android Compose预览", "Android Compose 预览"],
    ["Toggle 侧边栏", "切换侧边栏"],
    ["Toggle 辅助面板", "切换辅助面板"],
    ["New 终端 Tab", "新建终端标签页"],
    ["Toggle 项目 Selector", "切换项目选择器"],
    ["Agent 设置", "智能体设置"],
    ["Local 权限", "本地权限"],
    ["Actuation 权限", "操作权限"],
    ["Build With Google 插件", "Build With Google 插件"],
    ["Notification 设置", "通知设置"],
    ["概述tab", "概览标签页"],
    ["审查tab", "审查标签页"],
    ["Split 终端", "拆分终端"],
    ["Toggle 终端", "切换终端"],
    ["Close 标签页", "关闭标签页"],
    ["New Editor 窗口", "新建编辑器窗口"],
    ["Select Next 对话", "选择下一个对话"],
    ["Select Previous 对话", "选择上一个对话"],
    ["文件 Picker", "文件选择器"],
    ["浏览器 设置", "浏览器设置"],
    ["浏览器 操作权限", "浏览器操作权限"],
    ["应用 设置", "应用设置"],
    ["打开 System Preferences", "打开系统设置"],
    ["Pinned 对话", "已固定对话"],
    ["Outside of 项目", "项目外"],
    ["应用lication", "应用"],
    ["自定义ize", "自定义"],
    ["Project-Specific 设置", "项目专属设置"],
    ["Go to 项目", "前往项目"],
    ["File 权限", "文件权限"],
    ["Network 权限", "网络权限"],
    ["Terminal & Tooling 权限", "终端与工具权限"],
    ["Sort 对话", "排序对话"],
    ["对话 Width", "对话宽度"],
    ["Verbose Agent 对话", "详细智能体对话"],
    ["Verbose Agent 聊天", "详细智能体聊天"],
    ["模型 & Usage", "模型与用量"],
    ["模型 & 用量", "模型与用量"],
    ["Claude and GPT 模型", "Claude 与 GPT 模型"],
    ["Claude & GPT 模型", "Claude 与 GPT 模型"],
    ["Weekly Limit 剩余", "每周剩余额度"],
    ["Five Hour Limit 剩余", "5 小时剩余额度"],
    ["5-Hour Limit 剩余", "5 小时剩余额度"],

    // 新版 Antigravity (v44+) 补充短语
    ["View Usage", "查看用量"],
    ["No models available", "暂无可用模型"],
    ["New Remote Project", "新建远程项目"],
    ["Open File Search", "打开文件搜索"],
    ["Search automations...", "搜索自动化任务..."],
    ["Refresh all credentials", "刷新所有凭据"],
    ["Create with Prompt", "通过提示词创建"],
    ["No automations matching your search", "没有匹配搜索条件的自动化任务"],
    ["No automations configured.", "暂未配置任何自动化任务。"],
    ["No scheduled tasks matching your search", "没有匹配搜索条件的定时任务"],
    ["No scheduled tasks configured.", "暂未配置任何定时任务。"],
    ["Sidecar feature is not available.", "Sidecar 扩展服务当前不可用。"],
    ["Runs on", "运行位置"],
    ["Execution Identity", "执行身份"],
    ["You don't have any projects created. Please create a project first.", "您尚未创建任何项目，请先创建一个项目。"],
    ["Use Global Settings", "使用全局设置"],
    ["This project overrides your global permission settings.", "此项目已覆盖您的全局权限设置。"],
    ["This workspace overrides your global permission settings.", "此工作区已覆盖您的全局权限设置。"],
    ["Every command requires approval.", "每条命令都需要审批。"],
    ["Ask before sensitive operations.", "在执行敏感操作前询问。"],
    ["Automatically decide if commands run.", "由智能体自动决定是否运行命令。"],
    ["Run all commands without restrictions.", "无限制运行所有命令。"],
    ["Manage your notification preferences.", "管理您的通知偏好设置。"],
    ["Project options", "项目选项"],
    ["Toggle Overview Panel", "切换概览面板"],
    ["Toggle Aux Sidebar", "切换辅助侧边栏"],
    ["Toggle auxiliary sidebar", "切换辅助侧边栏"],
    ["Toggle sidebar", "切换侧边栏"],
    ["Maximize Pane", "最大化窗格"],
    ["Restore Pane", "还原窗格"],
    ["Unmaximize Pane", "还原窗格"],
    ["New tab", "新建标签页"],
    ["New Tab", "新建标签页"],
    ["File Viewer header", "文件查看器头部"],
    ["File Viewer", "文件查看器"],
    ["File path breadcrumbs", "文件路径面包屑"],
    ["Fold code block", "折叠代码块"],
    ["Unfold code block", "展开代码块"],
    ["Add inline comment", "添加行内评论"],
    ["Scroll to Bottom", "滚动到底部"],
    ["Scroll to bottom", "滚动到底部"],
    ["No more older messages", "没有更早的消息了"],
    ["Conversation Log", "对话日志"],
    ["Cancel (Ctrl+D)", "取消 (Ctrl+D)"],
    ["Table options", "表格选项"],
    ["Copy as Markdown", "复制为 Markdown"],
    ["Maximize Width", "最大化宽度"],
    ["Minimize Width", "还原默认宽度"],
    ["Preview unavailable", "预览不可用"],
    ["View Page", "查看页面"],
    ["Reading Browser Page in Browser", "正在读取浏览器页面"],
    ["Read Browser Page in Browser", "已读取浏览器页面"],
    ["Page was short enough to be read as a single document.", "页面较短，已作为完整文档直接读取。"],
    ["Failed to parse settings. Fix and restart.", "解析设置失败，请修复后重启。"],
    ["Copy error messages", "复制错误信息"],
    ["Context Menus", "右键菜单"],
    ["Custom Context Menus", "自定义右键菜单"],
    ["Replace the default browser right-click menu with quick actions.", "使用快捷操作菜单替换默认的浏览器右键菜单。"],
    ["Markdown Artifact Width", "Markdown 产物宽度"],
    ["Configure the default width of markdown artifacts.", "配置 Markdown 产物的默认显示宽度。"],
    ["Enable Sounds for Agent", "启用智能体提示音"],
    ["Play a sound when your action is needed or the agent finishes.", "当需要您操作或智能体完成任务时播放提示音。"],
    ["Enable Notifications for Agent", "启用智能体系统通知"],
    ["Show system notifications when your action is needed or the agent finishes.", "当需要您操作或智能体完成任务时显示系统通知。"],
    ["Default Customizations", "默认自定义项"],
    ["Customize Global Skills", "自定义全局技能"],
    ["Custom Agents", "自定义智能体"],
    ["MCP Servers", "MCP 服务器"],
    ["Include Jetski Default Customizations", "包含内置默认自定义项"],
    ["Include default customizations, such as default skills.", "包含内置默认技能等默认自定义项。"],
    ["Manage your conversations from the companion website.", "从配套网页端管理您的对话。"],
    ["A nickname for identifying this application in the companion website. Changing this will restart the connection.", "用于在配套网页端识别此应用的设备昵称。修改此项将重新建立连接。"],
    ["Inline Actions", "内联快捷操作"],
    ["Autonomous Mode", "自主模式"],
    ["Adds an Autonomous Mode switch to the modes dropdown below the input box. Turns sent with it on run non-interactively: the agent does not ask questions or request new permissions.", "在输入框下方的模式下拉菜单中添加“自主模式”开关。开启后发送的对话将以非交互方式运行：智能体不会提问或请求新权限。"],
    ["Choose between the Default and Project 4K experience.", "在默认模式和 Project 4K 体验之间切换。"],
    ["Project 4K interface without developer tooling.", "不包含开发者工具的 Project 4K 精简界面。"],
    ["The full developer experience.", "完整的开发者体验。"],
    ["Interrupt the agent and send immediately.", "中断当前智能体并立即发送。"],
    ["Queue until after the current turn.", "排队等待当前轮次结束后发送。"],
    ["Enable Demo Mode (Beta)", "启用演示模式（测试版）"],
    ["Strict Mode", "严格模式"],
    ["Command Setup Script", "命令初始化脚本"],
    ["Enable Terminal Sandbox", "启用终端沙盒"],
    ["Sandbox Allow Network", "允许沙盒访问网络"],
    ["Loading workspace customizations...", "正在加载工作区自定义项..."],
    ["Connecting to language server...", "正在连接语言服务器..."],
    ["Configure workspace-specific permissions, resources, and customizations.", "配置工作区专属的权限、资源与自定义项。"],
    ["The agent never asks for confirmation before executing terminal commands (except those in the Deny list). This provides the agent with the maximum ability to operate over long periods without intervention, but also has the highest risk of the agent executing an unsafe terminal command.", "智能体在执行终端命令前从不请求确认（拒绝列表中的命令除外）。这能让智能体在无需人工干预的情况下长时间自主运行，但也带来执行不安全终端命令的最高风险。"],
    ["Terminal commands automatically proceed inside the sandbox. A command that needs to leave the sandbox proceeds only if an agent judges it reversible, and otherwise requests review.", "终端命令在沙盒内会自动执行。需要脱离沙盒的命令仅在智能体判断其可逆时才继续执行，否则将请求人工审核。"],
    ["The agent always asks for confirmation before executing terminal commands (except those in the Allow list).", "智能体在执行终端命令前始终请求确认（允许列表中的命令除外）。"],
    ["Terminal command automatically proceeds if the command runs inside the sandbox. Otherwise, it requests review.", "若终端命令在沙盒内运行则自动执行，否则请求人工审核。"],
    ["The agent never asks for review. This maximizes the autonomy of the agent, but also has the highest risk of the agent operating over unsafe or injected artifact content.", "智能体从不请求审核。这能最大化智能体的自主性，但也带来处理不安全或注入式产物内容的最高风险。"],
    ["Agent never asks for review. This maximizes the autonomy of the Agent, but also has the highest risk of the Agent operating over unsafe or injected Artifact content.", "智能体从不请求审核。这能最大化智能体的自主性，但也带来处理不安全或注入式产物内容的最高风险。"],
    ["The agent always asks for review.", "智能体始终请求审核。"],
    ["Agent always asks for review.", "智能体始终请求审核。"],
    ["Specifies the agent's behavior when asking for review on artifacts, which are documents it creates to enable a richer conversation experience.", "指定智能体在请求审核产物时的行为；产物是它创建的文档，用来支持更丰富的对话体验。"],
    ["Let the agent use browser tools to open URLs, read web pages, and interact with browser content. This gives the agent access to important (and often critical) knowledge and methods of validation, but any browser integration does increase exposure to external malicious parties for security exploits.", "允许智能体使用浏览器工具打开 URL、读取网页并与浏览器内容交互。这能让智能体获取重要知识和验证手段，但任何浏览器集成都可能增加遭受外部恶意利用的风险。"],
    ["Allow the agent to automatically view and edit files outside the current workspace. Use with caution: this gives the agent access to additional potentially-relevant information, but also allows the agent to access credential files, secrets, and other files outside of the workspace that could be targeted in prompt injection attacks or other exploits by malicious actors.", "允许智能体自动查看和编辑当前工作区外部的文件。请谨慎开启：这能让智能体获取更多潜在相关信息，但也允许其访问工作区外的凭据、密钥和其他敏感文件，可能面临提示词注入或恶意利用风险。"],

    // 原有多词短语与句子
    ["Files Changed", "已修改文件"],
    ["AuxiliaryPane", "辅助窗格"],
    ["Auxiliary Pane", "辅助窗格"],
    ["Pinned Conversations", "已固定对话"],
    ["Recent Conversations", "最近对话"],
    ["Delete Conversation", "删除对话"],
    ["Rename Conversation", "重命名对话"],
    ["Pin Conversation", "固定对话"],
    ["Unpin Conversation", "取消固定对话"],
    ["Toggle Side Bar", "切换侧边栏"],
    ["Toggle Auxiliary Bar", "切换辅助面板"],
    ["Open Settings", "打开设置"],
    ["User Settings", "用户设置"],
    ["Workspace Settings", "工作区设置"],
    ["Search for commands...", "搜索快捷命令..."],
    ["Search for commands", "搜索快捷命令"],
    ["Next Aux Pane Tab", "下一个辅助窗格标签页"],
    ["Previous Aux Pane Tab", "上一个辅助窗格标签页"],
    ["New Terminal Tab", "新建终端标签页"],
    ["Collapse All", "全部折叠"],
    ["Expand All", "全部展开"],
    ["Toggle Project Selector", "切换项目选择器"],
    ["Download Diagnostics", "下载诊断信息"],
    ["Provide feedback", "提供反馈"],
    ["Open Keyboard Shortcuts", "打开键盘快捷键"],
    ["Configure tab completion", "配置 Tab 自动补全"],
    ["Tab completion", "Tab 自动补全"],
    ["tab completion", "Tab 自动补全"],
    ["Search settings...", "搜索设置..."],
    ["Search settings", "搜索设置"],
    ["Your Plan:", "您的订阅计划："],
    ["Google AI Pro", "Google AI 专业版"],
    ["Google AI Ultra", "Google AI 旗舰版"],
    ["You can upgrade to a Google AI Ultra plan to receive higher rate limits.", "您可以升级到 Google AI Ultra 计划以获得更高的速率配额限制。"],
    ["Modified in", "修改于"],
    ["Modify permissions for file, terminal, and MCP tools.", "修改文件、终端和 MCP 工具的权限。"],
    ["Google Chrome", "Chrome 浏览器"],
    ["Configure editor-specific behaviors and shortcuts.", "配置编辑器特定的行为和快捷键。"],
    ["Marketplace Item URL", "扩展市场项目 URL"],
    ["Marketplace Gallery URL", "扩展市场展示库 URL"],
    ["Changes the base URL on each extension page. You must restart Antigravity to use the new marketplace after changing this value.", "更改每个扩展页面的基础 URL。更改此值后必须重启 Antigravity 才能生效。"],
    ["Changes the base URL for marketplace search results. You must restart Antigravity to use the new marketplace after changing this value.", "更改扩展市场搜索结果的基础 URL。更改此值后必须重启 Antigravity 才能生效。"],
    ["Configure tab completion, suggestions, and navigation behavior.", "配置 Tab 自动补全、代码建议和导航行为。"],
    ["Jetski Chat", "Jetski 聊天"],
    ["Configure a chat bot so you can use Jetski directly from Google Chat.", "配置聊天机器人，以便直接在 Google Chat 中使用 Jetski。"],
    ["For help, visit", "如需帮助，请访问"],
    ["or join the", "或加入"],
    ["chat space", "聊天空间"],
    ["Bot Name", "机器人名称"],
    ["Avatar URL", "头像 URL"],
    ["Setup Jetski Chat", "配置 Jetski Chat"],
    ["% of the customization budget is available.", "% 的自定义配额预算可用。"],
    ["Show 1 breakdown", "显示 1 项细分详情"],
    ["Show breakdown", "显示细分详情"],
    ["Guidelines for interacting with GitHub and request permissions from the user when commands fail due to restrictions in the agent environment.", "与 GitHub 交互的指导原则，并在命令因智能体环境限制失败时向用户请求权限。"],
    ["No MCP servers installed", "未安装任何 MCP 服务器"],
    ["Browse and enable plugins from the Build With Google catalog.", "浏览并启用来自 Build With Google 目录的插件。"],
    ["Remote Control", "远程控制"],
    ["Enable Remote Control", "启用远程控制"],
    ["Bug Report", "缺陷报告"],
    ["Feature Request", "功能建议"],
    ["Auth and Billing", "认证与计费"],
    ["Remote Control Issue", "远程控制问题"],
    ["Please describe the issue in detail. The more actionable your feedback, the quicker our team can address your request. Some helpful information includes:", "请详细描述该问题。反馈越具体，我们的团队就能越快处理您的请求。建议包含的信息："],
    ["Steps to reproduce the issue", "复现步骤"],
    ["Expected behavior", "预期行为"],
    ["Actual behavior", "实际行为"],
    ["Any error messages", "任何错误信息"],
    ["Any relevant information", "任何相关信息"],
    ["Steps to Reproduce", "复现步骤"],
    ["Attach a screenshot (optional)", "附加屏幕截图（可选）"],
    ["Attach Antigravity server logs", "附加 Antigravity 服务端日志"],
    ["We recommend attaching logs. Attaching logs will help the Antigravity team act on and prioritize your feedback.", "建议附加日志。附加日志有助于 Antigravity 团队排查问题并优先处理您的反馈。"],
    ["Focus Input", "聚焦输入框"],
    ["Previous Pane Tab", "上一个窗格标签页"],
    ["Next Pane Tab", "下一个窗格标签页"],
    ["Toggle Model Selector", "切换模型选择器"],
    ["Toggle Voice Recording", "切换语音录制"],
    ["Find in Pane", "在窗格中查找"],
    ["Layout Controls", "布局控件"],
    ["Try out early-stage features before they ship. These may change or be removed at any time.", "在早期功能正式发布前先行体验。这些功能可能随时更改或移除。"],
    ["Experimental features", "实验性功能"],
    ["Generate a link that lets any Googler load a read-only copy of a conversation. Sharing exports the conversation history to your public x20 folder, so it needs that folder to be readable by others.", "生成链接以允许他人加载会话的只读副本。共享会将对话历史导出到您的公共文件夹，因此需要该文件夹可供读取。"],
    ["Show a floating notification card when background conversations need your input. Answer questions, approve commands, and grant permissions without leaving your current conversation. Share feedback at go/inline-actions-feedback.", "当后台会话需要您的输入时显示浮动通知卡片。无需离开当前对话即可回答问题、批准命令并授予权限。"],
    ["Manage settings specific to Google CitC workspaces development.", "管理特定于 Google CitC 工作区开发的设置。"],
    ["Best of N", "多重采样最佳候选"],
    ["Manage how Best of N sets up the workspaces its arms run in.", "管理 Best of N 如何设置各分支运行的工作区。"],
    ["Regroup Google3 Chats", "重新聚合 Google3 聊天"],
    ["Google3 chats will be regrouped into their workspaces in the sidebar.", "Google3 聊天将在侧边栏中重新聚合归类到各自的工作区。"],
    ["This migration may mess up your settings, chats, and sidebar.", "此迁移可能会打乱您的设置、聊天记录和侧边栏。"],
    ["Follow the guide at", "请按照以下指引进行："],
    ["to back up your data and run the migration.", "备份您的数据并运行迁移。"],
    ["Zoom In", "放大"],
    ["Zoom Out", "缩小"],
    ["Reset Zoom", "重置缩放"],
    ["Close Window", "关闭窗口"],
    ["Ask a quick question without interrupting the main conversation.", "快速提问，不打断主对话流程。"],
    ["Run until the specified goal is completely finished.", "持续运行直到指定目标彻底完成。"],
    ["Run an instruction on a recurring schedule or as a one-time timer.", "按周期性计划运行指令，或设置为一次性定时器。"],
    ["Invoke a browser agent for web tasks.", "调用浏览器智能体执行网页自动化任务。"],
    ["Interview me to align on a plan.", "对我进行交互式访谈，以对齐方案与需求。"],
    ["Invoke a team of agents to autonomously tackle large projects.", "调用多智能体团队自主协作处理大型复杂项目。"],
    ["Reflect on recent successes or corrections to capture reusable skills or rules.", "回顾近期的成功经验或修正内容，沉淀为可复用的技能或规则。"],
    ["Invoke the Boost multi-agent orchestrator for complex tasks.", "为复杂任务调用 Boost 多智能体编排器。"],
    ["Activate this skill when the user asks questions about how to use, configure, or customize Antigravity, AGY, the agy CLI, the Antigravity IDE, or Antigravity 2.0.", "当用户询问如何使用、配置或自定义 Antigravity、AGY、agy 命令行、Antigravity IDE 或 Antigravity 2.0 时调用此技能。"],
    ["Ask anything, @ to mention, / for actions", "想问什么都可以，@ 引用上下文，/ 执行快捷动作"],
    ["Type / for commands...", "输入 / 查看快捷动作..."],
    ["Type / for commands", "输入 / 查看快捷动作"],
    ["Search commands...", "搜索快捷动作..."],
    ["Search commands", "搜索快捷动作"],
    ["No commands found", "未找到命令"],
    ["No matching commands", "没有匹配的命令"],
    ["Slash Commands", "快捷动作命令"],
    ["Slash Command", "快捷动作命令"],
    ["Slash commands", "快捷动作命令"],
    ["Slash command", "快捷动作命令"],
    ["System Commands", "系统命令"],
    ["Custom Commands", "自定义命令"],
    ["Files & Folders", "文件与文件夹"],
    ["Press Enter to select, Esc to dismiss", "按 Enter 选中，按 Esc 关闭"],
    ["Select a command", "选择一个命令"],
    ["Run a long-running task until the goal is fully achieved.", "设定目标并持续执行直到完全达成。"],
    ["Run a task to completion with deep reasoning", "使用深度推理持续执行任务直至达成目标"],
    ["Schedule recurring or delayed tasks", "创建定时任务或计划调度"],
    ["Schedule a task or recurring cron", "设置定时任务或周期性调度"],
    ["Automate actions in Chrome", "在 Chrome 浏览器中执行自动化操作"],
    ["Launch browser subagent to interact with web", "启动浏览器子智能体与网页交互"],
    ["Interactive interview to resolve design decisions", "交互式访谈以细化设计决策"],
    ["Interactive interview to refine requirements", "交互式访谈以细化需求与方案"],
    ["Collaborate with a team of specialized agents", "与专业多智能体团队协同工作"],
    ["Team of autonomous agents working together", "多智能体团队协同工作"],
    ["Learn from conversation and save as a skill", "从当前对话学习并固化为技能"],
    ["Persist behavior or complex setup as a skill", "将复杂操作或配置固化为技能"],
    ["Boost reasoning and verification capacity", "增强深度推理与严谨验证能力"],
    ["Deep thinking, strategic planning, and rigorous verification", "深度思考、战略规划与严谨验证"],
    ["Clear conversation context", "清除会话上下文"],
    ["Show help and commands", "显示帮助与命令列表"],
    ["List skills and subagents", "列出技能与子智能体"],
    ["Compact conversation", "压缩会话上下文"],
    ["Review code and plans", "审查代码与方案"],
    ["Comprehensive guide and reference for the Antigravity Customization System.", "Antigravity 自定义系统的完整指南与参考手册。"],
    ["Use to explain how customizations work, their loading priority, discovery mechanisms, and to guide the creation of skills, rules, plugins, hooks, and MCP servers.", "用于解释自定义系统的工作原理、加载优先级、发现机制，并指导技能、规则、插件、钩子和 MCP 服务器的创建。"],
    ["Provides a comprehensive guide, quick reference, and sitemap for Google Antigravity (AGY), including the Antigravity CLI (agy), Antigravity 2.0, Antigravity IDE, Python SDK, slash commands, keybindings, and customizations (skills, rules, MCP, sidecars).", "提供 Google Antigravity (AGY) 的完整指南、快速参考与知识图谱，包含 CLI (agy)、Antigravity 2.0、IDE、Python SDK、斜杠命令、快捷键和自定义项。"],
    ["How to render rich interactive HTML widgets inline in the chat or as standalone artifacts. Use this skill when you want to show the user diagrams, data visualizations, interactive controls, educational walkthroughs, or any rich visual content beyond plain text and markdown.", "在聊天或独立产物中渲染丰富的交互式 HTML 小部件。用于向用户展示图表、数据可视化、交互式控件、教学指引或超越纯文本的内容。"],
    ["Automatically migrate legacy workflows to modern skills across global and workspace configurations. Scans for existing workflows, creates target SKILL.md files, and safely archives old workflow files.", "在全局和工作区配置中将旧版工作流自动迁移为现代技能。扫描现有工作流，创建目标 SKILL.md 文件并安全归档旧文件。"],
    ["The agent auto-executes commands matched by an allow list entry.", "智能体会自动执行匹配允许列表的命令。"],
    ["The agent asks for permission before executing commands matched by a deny list entry.", "智能体在执行匹配拒绝列表的命令前会请求许可。"],
    ["Give the agent awareness of lint errors created by its edits so it can fix them without explicit prompting.", "让智能体感知其编辑产生的 Lint 错误，以便无需明确提示即可自动修复。"],
    ["Enforce settings that prevent the agent from autonomously running targeted exploits and require human review for all agent actions. Visit antigravity.google/docs/strict-mode for details.", "强制启用安全设置，防止智能体自主运行高危利用，并要求对所有智能体操作进行人工审核。详情请访问 antigravity.google/docs/strict-mode。"],
    ["A shell setup script run before every command the agent executes.", "在智能体执行每条命令前运行的 Shell 初始化脚本。"],
    ["A shell setup script run before every command the agent executes in this project. Overrides the global script.", "在智能体执行此项目的每条命令前运行的 Shell 初始化脚本。将覆盖全局脚本。"],
    ["Run terminal commands with sandbox restrictions.", "在沙盒限制下运行终端命令。"],
    ["Allow sandboxed commands to make network requests.", "允许沙盒中的命令发起网络请求。"],
    ["When running commands, the agent will try to use this address, and fall back to the ", "运行命令时，智能体将尝试使用此地址，并在失败时回退到 "],
    ["Play a sound when the agent finishes generating a response.", "当智能体生成回复完毕时播放提示音。"],
    ["Show browser notifications when your action is needed or execution finishes.", "当需要您操作或执行结束时显示桌面通知。"],
    ["Automatically expand the Changes Overview toolbar when the agent finishes generating a response.", "当智能体生成回复完毕时，自动展开“更改概览”工具栏。"],
    ["Let the agent access past conversations to inform its responses.", "允许智能体访问历史对话以辅助其生成回复。"],
    ["Open files in the background if the agent creates or edits them", "当智能体创建或编辑文件时在后台打开它们"],
    ["Open the agent panel on window reload", "窗口重新加载时默认打开智能体面板"],
    ["Controls whether the agent can run custom JavaScript to automate complex browser actions.", "控制智能体是否可以运行自定义 JavaScript 来自动化复杂浏览器操作。"],
    ["Custom path for the browser user profile directory. Leave empty for default (~/.gemini/antigravity-browser-profile).", "浏览器用户资料目录的自定义路径。留空则使用默认路径（~/.gemini/antigravity-browser-profile）。"],
    ["Folders the automation agents can access.", "自动化智能体可以访问的文件夹。"],
    ["Command and file access granted to the automation agents.", "授予自动化智能体的命令与文件访问权限。"],
    ["When enabled, the agent will include default customizations, including default skills.", "启用后，智能体将包含默认自定义项，包括内置默认技能。"],
    ["Manage your plan, credentials, and general preferences.", "管理你的套餐、凭据和通用偏好设置。"],
    ["Work with local agents from another device.", "从其他设备访问并使用本地智能体。"],
    ["Allow/deny agent browser actuation access to specific URLs.", "允许或拒绝智能体对指定 URL 执行浏览器操作。"],
    ["Developer-only tools. These settings are stored locally in this browser and do not affect other users.", "仅限开发者工具。这些设置保存在本地，不影响其他用户。"],
    ["Paths the agent can read inside this workspace.", "智能体在此工作区内可读取的路径。"],
    ["Paths the agent can modify inside this workspace.", "智能体在此工作区内可修改的路径。"],
    ["Terminal commands the agent can execute in this workspace.", "智能体在此工作区内可执行的终端命令。"],
    ["Commands the agent can run outside the sandbox in this workspace.", "智能体在此工作区内可在沙盒外运行的命令。"],
    ["External tools the agent can call via Model Context Protocol.", "智能体可通过 Model Context Protocol 调用的外部工具。"],
    ["URLs the agent can read or open in this workspace.", "智能体在此工作区内可读取或打开的 URL。"],
    ["URLs the agent can actuate on in this workspace.", "智能体在此工作区内可进行交互操作的 URL。"],
    ["Every terminal command requires approval.", "每个终端命令都需要审批。"],
    ["A Gemini-powered security agent decides if commands should be auto-approved.", "由 Gemini 驱动的安全智能体决定命令是否应自动批准。"],
    ["Allow the agent to run without restrictions.", "允许智能体无限制运行。"],
    ["Controls the actions the agent can take.", "控制智能体可以执行的操作。"],
    ["Whether the agent asks you to review its documents.", "智能体是否在创建文档产物时请求您审核。"],
    ["Allow/deny agent read access to specific files or directories.", "允许或拒绝智能体读取指定文件或目录。"],
    ["Allow/deny agent write access to specific files or directories.", "允许或拒绝智能体写入指定文件或目录。"],
    ["Allow/deny agent read access to specific URLs or domains.", "允许或拒绝智能体读取指定 URL 或域名。"],
    ["Allow/deny specific terminal commands.", "允许或拒绝指定终端命令。"],
    ["Allow/deny agent command execution outside the sandbox.", "允许或拒绝智能体在沙盒外执行命令。"],
    ["Configure allowed terminal commands.", "配置允许的终端命令。"],
    ["Configure allowed commands outside the sandbox.", "配置允许在沙盒外运行的命令。"],
    ["Configure agent execution, queued message delivery, and permissions.", "配置智能体执行、排队消息发送以及权限。"],
    ["When enabled, sandboxed commands are allowed to make network requests.", "启用后，沙盒命令允许发起网络请求。"],
    ["Allows the agent to access files outside of your current workspace.", "允许智能体访问当前工作区外部的文件。"],
    ["When enabled, the agent will be able to access past conversations to inform its responses.", "启用后，智能体将能够访问历史对话以辅助回答。"],
    ["When enabled, the agent will be able to access its knowledge base to inform its responses and automatically generate knowledge items in the background.", "启用后，智能体将能够访问其知识库以辅助回答，并在后台自动生成知识条目。"],
    ["Paths the agent can read.", "智能体可读取的路径。"],
    ["Paths the agent can modify.", "智能体可修改的路径。"],
    ["Terminal commands the agent can execute.", "智能体可执行的终端命令。"],
    ["Commands the agent can run outside the sandbox.", "智能体可在沙盒外运行的命令。"],
    ["URLs the agent can read or open in the browser.", "智能体可读取或在浏览器中打开的 URL。"],
    ["URLs the agent can actuate on using the browser.", "智能体可通过浏览器执行操作的 URL。"],
    ["Configure allowed and denied URLs for browser actuation.", "配置允许和拒绝浏览器执行操作的 URL。"],
    ["Hook will only trigger if the tool name matches run_command.", "仅在工具名称匹配 run_command 时触发钩子。"],
    ["Hook will only trigger if the tool name matches run_command or view_file.", "仅在工具名称匹配 run_command 或 view_file 时触发钩子。"],
    ["Hook will only trigger if the tool name starts with browser_.", "仅在工具名称以 browser_ 开头时触发钩子。"],
    ["Configure hooks that run on agent lifecycle events.", "配置在智能体生命周期事件上运行的钩子。"],
    ["Load older messages", "加载更早的消息"],
    ["More options", "更多选项"],
    ["More actions", "更多操作"],
    ["Pin conversation", "固定对话"],
    ["Stop execution", "停止执行"],
    ["Archive conversation", "归档对话"],
    ["Unpin conversation", "取消固定对话"],
    ["Rename conversation", "重命名对话"],
    ["Delete conversation", "删除对话"],
    ["Copy code", "复制代码"],
    ["Code copied", "代码已复制"],
    ["Copy message", "复制消息"],
    ["Message copied", "消息已复制"],
    ["Add to Chat", "添加到聊天"],
    ["Add Context", "添加上下文"],
    ["Add Files", "添加文件"],
    ["Add Folder", "添加文件夹"],
    ["Add Workspace", "添加工作区"],
    ["Add Terminal", "添加终端"],
    ["Add MCP Server", "添加 MCP 服务器"],
    ["Add MCP Servers", "添加 MCP 服务器"],
    ["Add MCP server", "添加 MCP 服务器"],
    ["Action Required", "需要操作"],
    ["Action required", "需要操作"],
    ["Active Context Start", "当前活跃上下文起点"],
    ["Active Browser page", "活跃的浏览器页面"],
    ["Active Browser pages", "活跃的浏览器页面"],
    ["A new version is available.", "有新版本可用。"],
    ["A project with this name already exists.", "同名项目已存在。"],
    ["AI Credits Used to Generate Response", "生成回复消耗的 AI 积分"],
    ["Access a file outside workspace", "访问工作区外部文件"],
    ["Add them to allow future interactions", "将它们添加以允许将来的交互"],
    ["Add to allowlist", "添加到允许列表"],
    ["Added to allowlist", "已添加到允许列表"],
    ["Added to the model's instructions.", "已添加到模型的系统指令中。"],
    ["Agent Auto-Fix Lints", "智能体自动修复 Lint"],
    ["Agent Edits", "智能体编辑修改"],
    ["Agent Hooks Configuration", "智能体钩子配置"],
    ["Agent Host Address", "智能体主机地址"],
    ["Agent Market Search Results", "智能体市场搜索结果"],
    ["Agent Status", "智能体状态"],
    ["Agent Activity", "智能体活动"],
    ["Agent Capabilities", "智能体能力"],
    ["All Conversations", "所有对话"],
    ["All Projects", "所有项目"],
    ["All Files", "所有文件"],
    ["Allow always", "始终允许"],
    ["Always Allow for this Workspace", "对此工作区始终允许"],
    ["Always Allow for this Project", "对此项目始终允许"],
    ["Always Allow Globally", "全局始终允许"],
    ["Allow Once", "允许一次"],
    ["Allow Once for this command", "仅允许此命令一次"],
    ["Deny Once", "拒绝本次"],
    ["Always Deny", "始终拒绝"],
    ["Auto-approve commands", "自动批准命令"],
    ["Auto-approve file edits", "自动批准文件编辑"],
    ["Auto-approve web requests", "自动批准网络请求"],
    ["Automatic check for updates", "自动检查更新"],
    ["Back to conversations", "返回对话列表"],
    ["Back to projects", "返回项目列表"],
    ["Browse files", "浏览文件"],
    ["Cancel running task", "取消正在运行的任务"],
    ["Cancel execution", "取消执行"],
    ["Check for Updates", "检查更新"],
    ["Checking for updates...", "正在检查更新..."],
    ["Clear all", "全部清除"],
    ["Clear history", "清除历史记录"],
    ["Clear context", "清除上下文"],
    ["Clear messages", "清除消息"],
    ["Close editor", "关闭编辑器"],
    ["Close panel", "关闭面板"],
    ["Close sidebar", "关闭侧边栏"],
    ["Collapse all", "全部折叠"],
    ["Expand all", "全部展开"],
    ["Command Palette", "命令面板"],
    ["Configure MCP", "配置 MCP"],
    ["Configure settings", "配置设置"],
    ["Confirm deletion", "确认删除"],
    ["Context length", "上下文长度"],
    ["Context window", "上下文窗口"],
    ["Current conversation", "当前对话"],
    ["Current project", "当前项目"],
    ["Current workspace", "当前工作区"],
    ["Dark theme", "深色主题"],
    ["Light theme", "浅色主题"],
    ["System theme", "跟随系统主题"],
    ["Default model", "默认模型"],
    ["Developer tools", "开发者工具"],
    ["Disable MCP server", "禁用 MCP 服务器"],
    ["Enable MCP server", "启用 MCP 服务器"],
    ["Download update", "下载更新"],
    ["Duplicate conversation", "复制对话"],
    ["Edit project", "编辑项目"],
    ["Enter conversation title", "输入对话标题"],
    ["Enter project name", "输入项目名称"],
    ["Environment variables", "环境变量"],
    ["Error details", "错误详情"],
    ["Export conversation", "导出对话"],
    ["Failed to load conversation", "加载对话失败"],
    ["Failed to load project", "加载项目失败"],
    ["Feedback sent", "反馈已发送"],
    ["File tree", "文件树"],
    ["Filter conversations", "筛选对话"],
    ["Filter projects", "筛选项目"],
    ["Find in conversation", "在对话中查找"],
    ["General settings", "常规设置"],
    ["Global settings", "全局设置"],
    ["Go to next change", "前往下一个修改"],
    ["Go to previous change", "前往上一个修改"],
    ["Help and feedback", "帮助与反馈"],
    ["Import project", "导入项目"],
    ["Include hidden files", "包含隐藏文件"],
    ["Install extension", "安装扩展"],
    ["Installed extensions", "已安装扩展"],
    ["Keyboard shortcuts", "快捷键"],
    ["Loading conversations...", "正在加载对话..."],
    ["Loading projects...", "正在加载项目..."],
    ["Manage accounts", "管理账户"],
    ["Manage extensions", "管理扩展"],
    ["Manage permissions", "管理权限"],
    ["Model settings", "模型设置"],
    ["Move to project", "移动至项目"],
    ["New conversation in this project", "在此项目中新建对话"],
    ["No conversations yet", "暂无对话"],
    ["No files found", "未找到文件"],
    ["No projects yet", "暂无项目"],
    ["Open containing folder", "打开所在文件夹"],
    ["Open documentation", "打开官方文档"],
    ["Open in browser", "在浏览器中打开"],
    ["Open in editor", "在编辑器中打开"],
    ["Open in new window", "在新窗口中打开"],
    ["Open terminal here", "在此处打开终端"],
    ["Output channel", "输出通道"],
    ["Project details", "项目详情"],
    ["Recent conversations", "最近对话"],
    ["Recent projects", "最近项目"],
    ["Reload window", "重新加载窗口"],
    ["Restart agent", "重启智能体"],
    ["Restore all", "全部恢复"],
    ["Resume execution", "恢复执行"],
    ["Retry command", "重试命令"],
    ["Revert changes", "还原修改"],
    ["Save changes", "保存修改"],
    ["Save and close", "保存并关闭"],
    ["Search files", "搜索文件"],
    ["Select all", "全选"],
    ["Select folder", "选择文件夹"],
    ["Send message", "发送消息"],
    ["Show diff", "显示差异对比"],
    ["Show details", "显示详情"],
    ["Show in folder", "在文件夹中显示"],
    ["Sign in with Google", "使用 Google 登录"],
    ["Sign out of Google", "退出 Google 登录"],
    ["Split editor", "拆分编辑器"],
    ["Start debugging", "开始调试"],
    ["Stop debugging", "停止调试"],
    ["Switch project", "切换项目"],
    ["Switch workspace", "切换工作区"],
    ["Task completed", "任务已完成"],
    ["Task failed", "任务已失败"],
    ["Task in progress", "任务进行中"],
    ["Terminal output", "终端输出"],
    ["Toggle auxiliary pane", "切换辅助窗格"],
    ["Toggle panel", "切换面板"],
    ["Toggle terminal", "切换终端"],
    ["Undo changes", "撤销更改"],
    ["Update available", "发现新版本"],
    ["View documentation", "查看文档"],
    ["View logs", "查看日志"],
    ["Workspace settings", "工作区设置"],
    ["Zoom in", "放大"],
    ["Zoom out", "缩小"],
    ["Reset zoom", "重置缩放"],
    ["New Conversation", "新建对话"],
    ["Conversation History", "对话历史"],
    ["Pinned Conversation", "已固定对话"],
    ["Other Conversations", "其他对话"],
    ["Standalone Conversation", "独立对话"],
    ["Parent Conversation", "父对话"],
    ["New conversation", "新建对话"],
    ["New standalone conversation, outside of projects.", "新建独立对话，不属于任何项目。"],
    ["Open Conversation", "打开对话"],
    ["Open Conversation History", "打开对话历史"],
    ["Open Conversation Picker", "打开对话选择器"],
    ["Conversation picker", "对话选择器"],
    ["Search conversations...", "搜索对话..."],
    ["Search conversations (by name or Cascade ID)", "搜索对话（按名称或 Cascade ID）"],
    ["Search all convos...", "搜索全部对话..."],
    ["Search by name or Cascade ID...", "按名称或 Cascade ID 搜索..."],
    ["Mark as Read", "标记为已读"],
    ["Mark as Unread", "标记为未读"],
    ["Mark As Read", "标记为已读"],
    ["Mark As Unread", "标记为未读"],
    ["Edit Conversation Title", "编辑对话标题"],
    ["Archive Conversation", "归档对话"],
    ["Archive / Restore", "归档 / 恢复"],
    ["Restore Conversation", "恢复对话"],
    ["Archive this conversation", "归档此对话"],
    ["Copy conversation markdown", "复制对话 Markdown"],
    ["Conversation copied as Markdown to clipboard", "对话已作为 Markdown 复制到剪贴板"],
    ["Copy the trajectory ID", "复制轨迹 ID"],
    ["Copy trajectory ID", "复制轨迹 ID"],
    ["View Debug", "查看调试信息"],
    ["Delete Permanently", "永久删除"],
    ["See less", "收起"],
    ["Scheduled Tasks", "定时任务"],
    ["Project picker", "项目选择器"],
    ["Project Settings", "项目设置"],
    ["Project General", "项目常规"],
    ["Project Folders", "项目文件夹"],
    ["Project Agent", "项目智能体"],
    ["Project Detected", "检测到项目"],
    ["Create Project", "创建项目"],
    ["Create New Project", "创建新项目"],
    ["Create a Project", "创建项目"],
    ["Creating a Project", "正在创建项目"],
    ["Delete Project", "删除项目"],
    ["Open Project Picker", "打开项目选择器"],
    ["Open project settings", "打开项目设置"],
    ["Search projects...", "搜索项目..."],
    ["Project name. E.g. Tasks", "项目名称，例如 Tasks"],
    ["Project validation failed", "项目验证失败"],
    ["Projects serve as your workspace where your agents work. Each project has its own file scope and permissions.", "项目是智能体工作的工作区。每个项目都有自己的文件范围和权限。"],
    ["Getting started with a Project", "开始使用项目"],
    ["Select Project", "选择项目"],
    ["No agents running", "没有正在运行的代理"],
    ["Open App", "打开应用"],
    ["Confirm Quit", "确认退出"],
    ["Explore the new Antigravity", "探索新版 Antigravity"],
    ["Download the Antigravity IDE", "下载 Antigravity IDE"],
    ["Welcome to the new Antigravity!", "欢迎使用新版 Antigravity！"],
    ["Loading Antigravity", "正在加载 Antigravity"],
    ["Allow running this command?", "允许运行此命令？"],
    ["Yes, allow this time", "是，仅允许本次"],
    ["No (tell the agent what to do instead)", "否（告诉智能体改做什么）"],
    ["Add context", "添加上下文"],
    ["Agent response", "智能体回复"],
    ["User message", "用户消息"],
    ["Good response", "好评"],
    ["Bad response", "差评"],
    ["Display Options", "显示选项"],
    ["Go Back", "后退"],
    ["Go Forward", "前进"],
    ["Message input", "消息输入"],
    ["Record voice memo", "录制语音备忘"],
    ["Toggle Auxiliary Pane", "切换辅助面板"],
    ["Toggle Sidebar", "切换侧边栏"],
    ["Typeahead menu", "自动补全菜单"],
    ["Not Signed In", "未登录"],
    ["Sign in to use Antigravity!", "登录以使用 Antigravity！"],
    ["Sign In", "登录"],
    ["Sign Out", "退出登录"],
    ["Configure the agent's visual theme and display preferences.", "配置智能体的视觉主题和显示偏好。"],
    ["Configure the browser subagent. It requires Google Chrome to be installed. The browser subagent can be invoked by typing /browser in the conversation input box.", "配置浏览器子智能体。它需要安装 Google Chrome。你可以在对话输入框中输入 /browser 来调用浏览器子智能体。"],
    ["MCP Error", "MCP 错误"],
    ["Manage Antigravity app settings.", "管理 Antigravity 应用设置。"],
    ["Keep the app accessible from the menu bar and running in the background when all windows are closed.", "当所有窗口关闭时，保持应用在菜单栏可用并在后台运行。"],
    ["Automatic Check for Updates", "自动检查更新"],
    ["Automatically prompt you to restart the app when a new update is available. When disabled, you can check for updates manually from the app menu.", "有新更新时自动提示重启应用。禁用后，您可以从应用菜单手动检查更新。"],
    ["Not in Project", "未在项目中"],
    ["Agent Settings", "智能体设置"],
    ["Agent Behavior", "智能体行为"],
    ["Local Permissions", "本地权限"],
    ["Security Preset", "安全预设"],
    ["Manually customize individual settings.", "手动自定义各项设置。"],
    ["Outside of folders file access policy", "文件夹外访问策略"],
    ["Terminal Command Auto Execution", "终端命令自动执行"],
    ["Require Review", "需要审核"],
    ["Request Review", "请求审核"],
    ["Always Proceed", "始终继续"],
    ["Proceed in Sandbox", "在沙盒中继续"],
    ["Allow once", "允许一次"],
    ["Always Allow", "始终允许"],
    ["Allow in Conversation", "在本次对话中允许"],
    ["Allow options", "允许选项"],
    ["Value:", "当前值："],
    ["Enable Sandbox Mode (Preview)", "启用沙盒模式（预览）"],
    ["Artifact Review Policy", "产物审核策略"],
    ["Always Ask", "始终询问"],
    ["File Access Rules", "文件访问规则"],
    ["Network Access Rules", "网络访问规则"],
    ["Terminal Commands", "终端命令"],
    ["Commands Outside Sandbox", "沙盒外命令"],
    ["MCP Tools", "MCP 工具"],
    ["Allow List Terminal Commands", "终端命令允许列表"],
    ["Deny List Terminal Commands", "终端命令拒绝列表"],
    ["Review Policy", "审核策略"],
    ["Auto-Execution Policy", "自动执行策略"],
    ["Agent Non-Workspace File Access", "智能体非工作区文件访问"],
    ["Enable Shell Integration", "启用 Shell 集成"],
    ["Advanced File Access", "高级文件访问"],
    ["Advanced Command Access", "高级命令访问"],
    ["Advanced Web Access", "高级网页访问"],
    ["File Access", "文件访问"],
    ["Workspace File Access", "工作区文件访问"],
    ["Workspace Command Access", "工作区命令访问"],
    ["File Permissions", "文件权限"],
    ["Network Permissions", "网络权限"],
    ["Terminal & Tooling Permissions", "终端与工具权限"],
    ["Project-Specific Settings", "项目专属设置"],
    ["No projects found", "未找到项目"],
    ["New Project", "新建项目"],
    ["Quick Start", "快速开始"],
    ["No Project", "无项目"],
    ["Outside of Project", "项目外"],
    ["New Conversation in Project", "在项目中新建对话"],
    ["New Conversation in Workspace", "在工作区中新建对话"],
    ["New Workspace", "新建工作区"],
    ["New Worktree", "新建工作树"],
    ["Previous Worktrees", "以前的工作树"],
    ["Group By", "分组方式"],
    ["Sort Conversations", "排序对话"],
    ["Sort Conversation", "排序对话"],
    ["Last Updated", "最近更新"],
    ["Alphabetical (A-Z)", "按字母顺序 (A-Z)"],
    ["Date Added", "添加日期"],
    ["No Subtitle", "无副标题"],
    ["Open Workspace", "打开工作区"],
    ["Open Workspace Selector", "打开工作区选择器"],
    ["Open Folder", "打开文件夹"],
    ["Close Folder", "关闭文件夹"],
    ["Missing Folder", "缺失文件夹"],
    ["Missing Folders", "缺失文件夹"],
    ["Folder no longer exists or is unavailable.", "文件夹不再存在或不可用。"],
    ["Configure global allowed and denied resource permissions.", "配置全局允许和拒绝的资源权限。"],
    ["Modify scoped permissions, folders, and agent settings like Sandbox and Terminal Command Execution.", "修改作用域权限、文件夹，以及沙盒和终端命令执行等智能体设置。"],
    ["Go to Projects", "前往项目"],
    ["File Reads", "文件读取"],
    ["File Writes", "文件写入"],
    ["Read Files", "读取文件"],
    ["Write Files", "写入文件"],
    ["Read URLs", "读取 URL"],
    ["Execute URLs", "执行 URL"],
    ["global settings", "全局设置"],
    ["Learn more", "了解更多"],
    ["Provide Feedback", "提供反馈"],
    ["Send Feedback", "发送反馈"],
    ["Feedback Type", "反馈类型"],
    ["General Feedback", "一般反馈"],
    ["Agent settings and permissions for conversations outside of projects.", "为项目外对话配置智能体设置和权限。"],
    ["Agent settings and permissions can be further customized below.", "可以在下方进一步自定义智能体设置和权限。"],
    ["Agents have full access to your machine and external resources.", "智能体可完整访问你的电脑和外部资源。"],
    ["Agents run in a secure sandbox that restricts access to external resources outside of your trusted folders.", "智能体会在安全沙盒中运行，限制其访问受信任文件夹之外的外部资源。"],
    ["Choose a predefined security preset for the agent. This controls terminal auto-execution policy, and file access policy.", "为智能体选择预设安全策略。它会控制终端自动执行策略和文件访问策略。"],
    ["Configures how the agent tries to access files outside of its working folders.", "配置智能体如何访问工作文件夹之外的文件。"],
    ["Controls whether terminal commands require your approval before running.", "控制终端命令运行前是否需要你的批准。"],
    ["Restricts agent tools to a secure, isolated local sandbox.", "将智能体工具限制在安全隔离的本地沙盒中。"],
    ["Specifies Agent's behavior when asking for review on artifacts, which are documents it creates to enable richer conversation experience.", "指定智能体在请求审核产物时的行为；产物是它创建的文档，用来支持更丰富的对话体验。"],
    ["Specifies Agent's behavior when asking for review on artifacts, which are documents it creates to enable a richer conversation experience.", "指定智能体在请求审核产物时的行为；产物是它创建的文档，用来支持更丰富的对话体验。"],
    ["Inherit General", "继承常规设置"],
    ["Inherit general", "继承常规设置"],
    ["Inherits your General settings when working in this project.", "在此项目中工作时继承常规设置。"],
    ["Inherits your general settings when working in this project.", "在此项目中工作时继承常规设置。"],
    ["Requires manual review for all terminal commands and file accesses outside of the working folders.", "对所有终端命令以及工作文件夹外的文件访问都需要手动审核。"],
    ["Full machine", "完整本机访问"],
    ["Full Machine", "完整本机访问"],
    ["Full Machine Access", "完整本机访问"],
    ["All terminal commands require review. The agent can read or write to any file in the machine.", "所有终端命令需要审核。智能体可以读写本机上的任意文件。"],
    ["Turbo mode", "Turbo 模式"],
    ["Turbo Mode", "Turbo 模式"],
    ["Disables all safety barriers for maximal iteration velocity.", "禁用所有安全防护以获得最大迭代速度。"],
    ["Manage project folders, agent settings, and permissions.", "管理项目文件夹、智能体设置与权限。"],
    ["Also includes global settings when working in this project.", "在此项目中工作时也包含全局设置。"],
    ["Also includes global settings when working outside of projects.", "在项目外工作时也包含全局设置。"],
    ["Queued Messages", "排队消息"],
    ["Configure when follow-up messages are sent.", "配置后续消息的发送时机。"],
    ["Send Immediately", "立即发送"],
    ["Inherits from global settings. Local permissions have higher priority.", "继承全局设置。本地权限优先级更高。"],
    ["Configure allowed and denied paths for file reads and writes.", "配置允许和拒绝读写的文件路径。"],
    ["Configure allowed and denied URLs for reading.", "配置允许和拒绝读取的 URL。"],
    ["Configure external tools via Model Context Protocol.", "配置通过 Model Context Protocol 使用的外部工具。"],
    ["Enter file or directory path...", "输入文件或目录路径..."],
    ["Enter command (e.g., git, blaze)...", "输入命令（例如 git、blaze）..."],
    ["Enter tool name or server...", "输入工具名称或服务器..."],
    ["Enter URL pattern...", "输入 URL 匹配模式..."],
    ["Confirm the command is safe to run outside of the sandbox with full network and disk access.", "确认该命令可在沙盒外安全运行，并拥有完整网络和磁盘访问权限。"],
    ["Edit permission target", "编辑权限目标"],
    ["Click to copy full command", "点击复制完整命令"],
    ["Confirmation required to execute this step", "执行此步骤需要确认"],
    ["Confirm Browser Interaction", "确认浏览器交互"],
    ["Deny setting up browser", "拒绝设置浏览器"],
    ["Launching the browser...", "正在启动浏览器..."],
    ["The agent will wait for you to install the browser extension.", "智能体会等待你安装浏览器扩展。"],
    ["Antigravity would like to use the browser.", "Antigravity 想要使用浏览器。"],
    ["Enable Browser Tools", "启用浏览器工具"],
    ["When enabled, Agent can use browser tools to open URLs, read web pages, and interact with browser content. This allows the Agent access to important (and often critical) knowledge and methods of validation, but any browser integration does increase exposure to external malicious parties for security exploits.", "启用后，智能体可以使用浏览器工具打开 URL、读取网页并与浏览器内容交互。这能让智能体获取重要知识和验证方式，但任何浏览器集成都可能增加遭受外部恶意利用的风险。"],
    ["Browser Javascript Execution Policy", "浏览器 JavaScript 执行策略"],
    ["Actuation Permissions", "操作权限"],
    ["Browser Actuation Rules", "浏览器操作规则"],
    ["Block all browser JavaScript execution.", "阻止所有浏览器 JavaScript 执行。"],
    ["Prompt for approval before running browser scripts.", "运行浏览器脚本前请求批准。"],
    ["Allow full browser script execution without prompting.", "允许完整执行浏览器脚本且不再提示。"],
    ["Chrome Binary Path", "Chrome 可执行文件路径"],
    ["Path to the Chrome/Chromium executable. Leave empty for auto-detection.", "Chrome/Chromium 可执行文件路径。留空则自动检测。"],
    ["Browser User Profile Path", "浏览器用户资料路径"],
    ["Browser CDP Port", "浏览器 CDP 端口"],
    ["Port number for Chrome DevTools Protocol remote debugging. Leave empty for default (9222).", "Chrome DevTools Protocol 远程调试端口号。留空则使用默认值（9222）。"],
    ["Configure AI models and view your quota.", "配置 AI 模型并查看额度。"],
    ["Configure default behaviors, skills, and MCP servers.", "配置默认行为、技能和 MCP 服务器。"],
    ["Token Usage", "Token 使用量"],
    ["The breakdown below shows token usage from customizations like skills, rules, and MCP. If the budget is exceeded, large customizations will be truncated automatically.", "下面的明细展示技能、规则和 MCP 等自定义内容的 Token 使用量。如果超出预算，较大的自定义内容会被自动截断。"],
    ["No customizations found for this workspace.", "此工作区没有找到自定义内容。"],
    ["Installed MCP Servers", "已安装的 MCP 服务器"],
    ["Add MCP", "添加 MCP"],
    ["No MCP Servers", "没有 MCP 服务器"],
    ["You currently don't have any MCP Servers installed. Add an MCP server above", "你当前还没有安装任何 MCP 服务器。请在上方添加 MCP 服务器。"],
    ["Build With Google Plugins", "使用 Google 插件构建"],
    ["App Settings", "应用设置"],
    ["Manage application settings.", "管理应用设置。"],
    ["Prevent Sleep", "防止睡眠"],
    ["Prevent the computer from sleeping while the app is running.", "应用运行时防止电脑进入睡眠。"],
    ["Keep In Menu Bar", "保留在菜单栏"],
    ["The app will be accessible from the menu bar and will keep running in the background when all windows are closed.", "应用可从菜单栏访问，并会在所有窗口关闭后继续在后台运行。"],
    ["Notification Settings", "通知设置"],
    ["To modify notification settings, open your operating system's system preferences.", "要修改通知设置，请打开操作系统的系统设置。"],
    ["Open System Preferences", "打开系统设置"],
    ["Enable Telemetry", "启用遥测"],
    ["When toggled on, Antigravity collects usage data to help Google enhance performance and features.", "开启后，Antigravity 会收集使用数据，帮助 Google 改进性能和功能。"],
    ["Marketing Emails", "营销邮件"],
    ["Receive product updates, tips, and promotions from Google Antigravity via email.", "通过电子邮件接收 Google Antigravity 的产品更新、技巧和促销信息。"],
    ["Your Plan: Google AI Pro", "你的套餐：Google AI Pro"],
    ["You can upgrade to a Google AI Ultra plan to receive the highest rate limits.", "你可以升级到 Google AI Ultra 套餐以获得最高速率限制。"],
    ["By using this app, you agree to its", "使用本应用即表示你同意其"],
    ["Terms of Service", "服务条款"],
    ["Search files...", "搜索文件..."],
    ["Search across files...", "跨文件搜索..."],
    ["Search for files in the project...", "在项目中搜索文件..."],
    ["Search tasks...", "搜索任务..."],
    ["Search MCP servers by name", "按名称搜索 MCP 服务器"],
    ["Search for MCP servers to add to your configuration", "搜索要添加到配置中的 MCP 服务器"],
    ["Open Preferences", "打开偏好设置"],
    ["Open Command Palette", "打开命令面板"],
    ["Open System Browser", "在系统浏览器中打开"],
    ["Open URL", "打开 URL"],
    ["Opened URL in Browser", "已在浏览器中打开 URL"],
    ["Opening URL in Browser", "正在浏览器中打开 URL"],
    ["Opened browser", "已打开浏览器"],
    ["Copy Command", "复制命令"],
    ["Copy Content", "复制内容"],
    ["Copy File Name", "复制文件名"],
    ["Copy File Path", "复制文件路径"],
    ["Copy Path", "复制路径"],
    ["Copy path", "复制路径"],
    ["Copy prompt", "复制提示词"],
    ["Copy to clipboard", "复制到剪贴板"],
    ["Copy debug info", "复制调试信息"],
    ["Copy full URL to clipboard", "复制完整 URL 到剪贴板"],
    ["Copy sign-in link", "复制登录链接"],
    ["Import AI Studio Project", "导入 AI Studio 项目"],
    ["Import failed:", "导入失败："],
    ["Import success:", "导入成功："],
    ["Import feature is not available in this context.", "当前上下文中无法使用导入功能。"],
    ["Model Credits", "模型积分"],
    ["Enable AI Credit Overages", "启用 AI 积分超额使用"],
    ["When toggled on, Antigravity will use your AI credits to fulfill model requests once you're out of model quota. Antigravity will always use your model quota first before using AI credits.", "开启后，当模型额度用完时，Antigravity 会使用 AI 积分完成模型请求。Antigravity 会始终先使用模型额度，再使用 AI 积分。"],
    ["Model Quota", "模型额度"],
    ["Models & Usage", "模型与用量"],
    ["Model & Usage", "模型与用量"],
    ["Models and Usage", "模型与用量"],
    ["Model and Usage", "模型与用量"],
    ["Usage & Limits", "用量与限制"],
    ["Usage and Limits", "用量与限制"],
    ["Usage & Quotas", "用量与配额"],
    ["Usage and Quotas", "用量与配额"],
    ["Manage your model quota and credits.", "管理您的模型配额与积分。"],
    ["Manage your model quota, credit balance, and rate limits.", "管理您的模型配额、积分余额与速率限制。"],
    ["Weekly Limit Remaining", "每周剩余额度"],
    ["Weekly Limit", "每周额度"],
    ["Five Hour Limit Remaining", "5 小时剩余额度"],
    ["Five Hour Limit", "5 小时额度"],
    ["5-Hour Limit Remaining", "5 小时剩余额度"],
    ["5-Hour Limit", "5 小时额度"],
    ["5 Hour Limit Remaining", "5 小时剩余额度"],
    ["5 Hour Limit", "5 小时额度"],
    ["Daily Limit Remaining", "每日剩余额度"],
    ["Daily Limit", "每日额度"],
    ["Monthly Limit Remaining", "每月剩余额度"],
    ["Monthly Limit", "每月额度"],
    ["Hourly Limit Remaining", "每小时剩余额度"],
    ["Hourly Limit", "每小时额度"],
    ["Limit Remaining", "剩余额度"],
    ["Quota Remaining", "剩余配额"],
    ["Rate Limits", "速率限制"],
    ["Rate Limit", "速率限制"],
    ["Credit Balance", "积分余额"],
    ["Credits Remaining", "剩余积分"],
    ["Claude and GPT models", "Claude 与 GPT 模型"],
    ["Claude and GPT Models", "Claude 与 GPT 模型"],
    ["Claude & GPT models", "Claude 与 GPT 模型"],
    ["Claude & GPT Models", "Claude 与 GPT 模型"],
    ["Gemini models", "Gemini 模型"],
    ["Gemini Models", "Gemini 模型"],
    ["Claude models", "Claude 模型"],
    ["Claude Models", "Claude 模型"],
    ["GPT models", "GPT 模型"],
    ["GPT Models", "GPT 模型"],
    ["Install IDE", "安装 IDE"],
    ["Show all", "显示全部"],
    ["Show less", "收起全部"],
    ["Show more", "显示更多"],
    ["See more", "查看更多"],
    ["Select Model", "选择模型"],
    ["Select Model to Send Message", "选择用于发送消息的模型"],
    ["No Model Selected", "未选择模型"],
    ["Add Model", "添加模型"],
    ["Add Custom Model", "添加自定义模型"],
    ["Edit Model", "编辑模型"],
    ["Edit Custom Model", "编辑自定义模型"],
    ["Best of N Models", "Best of N 模型"],
    ["Best of N Settings", "Best of N 设置"],
    ["Model quota reached", "模型额度已达上限"],
    ["Model quota exhausted", "模型额度已耗尽"],
    ["Model must be available on the Gemini API and use the gemini-api scheme.", "模型必须可在 Gemini API 中使用，并使用 gemini-api scheme。"],
    ["My Custom Gemini Model", "我的自定义 Gemini 模型"],
    ["Chat Settings", "聊天设置"],
    ["Advanced Settings", "高级设置"],
    ["Editor Settings", "编辑器设置"],
    ["Auto-Open Edited Files", "自动打开已编辑文件"],
    ["Open files in the background if Agent creates or edits them", "当智能体创建或编辑文件时，在后台打开这些文件"],
    ["Open Agent on Reload", "重新加载时打开智能体"],
    ["Open Agent panel on window reload", "窗口重新加载时打开智能体面板"],
    ["Background Task", "后台任务"],
    ["Background Tasks", "后台任务"],
    ["Background Task Output", "后台任务输出"],
    ["Browser Task", "浏览器任务"],
    ["Analyzing Task Log", "正在分析任务日志"],
    ["Analyzed Task Log", "已分析任务日志"],
    ["Add Scheduled Task", "添加定时任务"],
    ["New Scheduled Task", "新建定时任务"],
    ["Back to Scheduled Tasks", "返回定时任务"],
    ["Cancel Task", "取消任务"],
    ["Cancel All Tasks", "取消全部任务"],
    ["Delete Task", "删除任务"],
    ["Disable Task", "禁用任务"],
    ["Enable Task", "启用任务"],
    ["Restart Task", "重启任务"],
    ["View your available model quota and AI credits. Model quota refreshes periodically based on your plan. Enable AI Credit Overages to continue using models when your quota is exhausted.", "查看可用的模型额度和 AI 积分。模型额度会根据你的计划定期刷新。启用 AI 积分超额使用后，可在额度耗尽时继续使用模型。"],
    ["Verbose Agent Chat", "详细智能体聊天"],
    ["Display and preserve intermediate thinking steps.", "显示并保留中间思考步骤。"],
    ["Conversation Width", "对话宽度"],
    ["Configure the maximum width of the conversation panel.", "配置对话面板的最大宽度。"],
    ["Light Theme", "浅色主题"],
    ["Dark Theme", "深色主题"],
    ["System Theme", "跟随系统"],
    ["Default Light", "默认浅色"],
    ["Default Dark", "默认深色"],
    ["Theme Preset", "主题预设"],
    ["Accent Color", "强调色"],
    ["Background Color", "背景颜色"],
    ["Foreground Color", "前景颜色"],
    ["Full Width", "全宽"],
    ["Full width", "全宽"],
    ["High Contrast Dark", "高对比度深色"],
    ["High Contrast Light", "高对比度浅色"],
    ["High Contrast", "高对比度"],
    ["Color Theme", "颜色主题"],
    ["Icon Theme", "图标主题"],
    ["Match OS", "跟随系统"],
    ["Match System", "跟随系统"],
    ["Follow System", "跟随系统"],
    ["Light mode", "浅色模式"],
    ["Dark mode", "深色模式"],
    ["System mode", "系统模式"],
    ["Font Family", "字体"],
    ["Font Size", "字号"],
    ["Line Height", "行高"],
    ["Code Font", "代码字体"],
    ["Editor Font", "编辑器字体"],
    ["Zoom Level", "缩放级别"],
    ["Overview tab", "概览标签页"],
    ["Review tab", "审查标签页"],
    ["Terminal tab", "终端标签页"],
    ["Split Terminal", "拆分终端"],
    ["Split terminal", "拆分终端"],
    ["Toggle Terminal", "切换终端"],
    ["Kill Terminal", "终止终端"],
    ["Focus Terminal", "聚焦终端"],
    ["Clear Terminal", "清空终端"],
    ["Split Editor", "拆分编辑器"],
    ["Split editor", "拆分编辑器"],
    ["Split Editor Right", "向右拆分编辑器"],
    ["Split Editor Down", "向下拆分编辑器"],
    ["Split Editor Left", "向左拆分编辑器"],
    ["Split Editor Up", "向上拆分编辑器"],
    ["Close Tab", "关闭标签页"],
    ["Close tab", "关闭标签页"],
    ["Close Other Tabs", "关闭其他标签页"],
    ["Close Tabs to the Right", "关闭右侧标签页"],
    ["Close All Tabs", "关闭所有标签页"],
    ["Close Saved Tabs", "关闭已保存的标签页"],
    ["Close Editor", "关闭编辑器"],
    ["Close All Editors", "关闭所有编辑器"],
    ["New Editor Window", "新建编辑器窗口"],
    ["New editor window", "新建编辑器窗口"],
    ["Select Next Conversation", "选择下一个对话"],
    ["Select next conversation", "选择下一个对话"],
    ["Select Previous Conversation", "选择上一个对话"],
    ["Select previous conversation", "选择上一个对话"],
    ["Next Conversation", "下一个对话"],
    ["Previous Conversation", "上一个对话"],
    ["Open File Picker", "打开文件选择器"],
    ["File Picker", "文件选择器"],
    ["File picker", "文件选择器"],
    ["Symbol Picker", "符号选择器"],
    ["Color Picker", "颜色选择器"],
    ["Emoji Picker", "表情选择器"],
    ["Upload Media", "上传媒体"],
    ["Attach Media", "附加媒体"],

    // ===== Antigravity v2.28 - v2.29.0 全新界面全量覆盖 =====
    // 1. 全新主页 (Home)、欢迎引导与左侧边栏分组
    ["Welcome back", "欢迎回来"],
    ["Welcome to Antigravity", "欢迎使用 Antigravity"],
    ["Good morning", "早上好"],
    ["Good afternoon", "下午好"],
    ["Good evening", "晚上好"],
    ["What would you like to build?", "今天想构建些什么？"],
    ["What would you like to build today?", "今天想构建些什么？"],
    ["What can I help you with?", "有什么我可以帮您的？"],
    ["What can I help you with today?", "今天有什么可以帮您的？"],
    ["How can I help you today?", "今天有什么可以帮您的？"],
    ["What are we building today?", "今天我们要构建什么？"],
    ["Start a conversation", "开始新对话"],
    ["Start a new conversation", "开始新对话"],
    ["Ask anything...", "尽管提问..."],
    ["Ask Antigravity anything...", "向 Antigravity 提问..."],
    ["Ask anything, @ to mention, / for commands", "想问什么都可以，@ 引用上下文，/ 执行快捷命令"],
    ["Message Antigravity...", "给 Antigravity 发送消息..."],
    ["Reply to agent...", "回复智能体..."],
    ["Send a message...", "发送消息..."],
    ["Follow up...", "继续追问..."],
    ["Ask a follow-up...", "继续追问..."],
    ["Ask a follow-up question...", "继续追问..."],
    ["Previous 7 Days", "过去 7 天"],
    ["Previous 30 Days", "过去 30 天"],
    ["Last 7 Days", "最近 7 天"],
    ["Last 30 Days", "最近 30 天"],
    ["Last 90 Days", "最近 90 天"],
    ["This Week", "本周"],
    ["Last Week", "上周"],
    ["This Month", "本月"],
    ["Last Month", "上月"],
    ["Earlier This Month", "本月早些时候"],
    ["Archived Conversations", "已归档对话"],
    ["View Archived", "查看已归档"],
    ["Show Archived", "显示已归档"],
    ["Hide Archived", "隐藏已归档"],
    ["No archived conversations", "暂无已归档的对话"],
    ["Unarchive Conversation", "取消归档对话"],
    ["Unarchive conversation", "取消归档对话"],
    ["Open Home", "打开主页"],
    ["Go to Home", "返回主页"],
    ["Back to Home", "返回主页"],
    ["Quick Actions", "快捷操作"],
    ["Suggested Actions", "推荐操作"],
    ["Get Started", "快速上手"],
    ["Getting Started", "快速入门"],
    ["Recent Activity", "最近活动"],
    ["Active Agents", "活跃智能体"],
    ["Running Agents", "运行中的智能体"],
    ["Clone Repository", "克隆代码仓库"],
    ["Clone a Repository", "克隆代码仓库"],
    ["Open Existing Folder", "打开现有文件夹"],
    ["Open Local Folder", "打开本地文件夹"],
    ["Sign out", "退出登录"],
    ["Sign in", "登录"],
    ["Log in", "登录"],
    ["Log out", "退出登录"],

    // 2. 顶部原生/自定义菜单栏全项补齐 (File / Edit / Selection / View / Go / Window / Help)
    ["New Window", "新建窗口"],
    ["New Chat", "新建聊天"],
    ["Open Recent", "打开最近使用"],
    ["Clear Recently Opened", "清除最近打开记录"],
    ["Save All", "全部保存"],
    ["Save As...", "另存为..."],
    ["Save As", "另存为"],
    ["Auto Save", "自动保存"],
    ["Quit Antigravity", "退出 Antigravity"],
    ["About Antigravity", "关于 Antigravity"],
    ["Hide Antigravity", "隐藏 Antigravity"],
    ["Hide Others", "隐藏其他"],
    ["Show All", "全部显示"],
    ["Find in Files", "在文件中查找"],
    ["Replace in Files", "在文件中替换"],
    ["Toggle Line Comment", "切换行注释"],
    ["Toggle Block Comment", "切换块注释"],
    ["Select All", "全选"],
    ["Expand Selection", "扩大选区"],
    ["Shrink Selection", "缩小选区"],
    ["Copy Line Up", "向上复制一行"],
    ["Copy Line Down", "向下复制一行"],
    ["Move Line Up", "向上移动一行"],
    ["Move Line Down", "向下移动一行"],
    ["Toggle Full Screen", "切换全屏"],
    ["Full Screen", "全屏"],
    ["Actual Size", "实际大小"],
    ["Toggle Developer Tools", "切换开发者工具"],
    ["Reload Window", "重新加载窗口"],
    ["Force Reload", "强制重新加载"],
    ["Minimize Window", "最小化窗口"],
    ["Bring All to Front", "前置全部窗口"],
    ["Release Notes", "发行说明"],
    ["What's New", "新功能介绍"],
    ["Report Issue", "报告问题"],
    ["Report a Problem", "报告问题"],
    ["Privacy Policy", "隐私政策"],
    ["View License", "查看许可证"],
    ["Restart to Update", "重启以完成更新"],
    ["Check for Updates...", "检查更新..."],

    // 3. 实时语音对话模式 (Voice Mode / Gemini Live)
    ["Voice Mode", "语音模式"],
    ["Start Voice Mode", "开启语音模式"],
    ["Enter Voice Mode", "进入语音模式"],
    ["End Voice Mode", "结束语音模式"],
    ["Exit Voice Mode", "退出语音模式"],
    ["Stop Voice Mode", "停止语音模式"],
    ["Close Voice Mode", "关闭语音模式"],
    ["Voice Conversation", "语音对话"],
    ["Start Voice Conversation", "开始语音对话"],
    ["End Call", "结束通话"],
    ["Gemini Live", "Gemini 实时语音"],
    ["Live Voice", "实时语音"],
    ["Mute Microphone", "麦克风静音"],
    ["Unmute Microphone", "取消麦克风静音"],
    ["Mute microphone", "麦克风静音"],
    ["Unmute microphone", "取消麦克风静音"],
    ["Microphone muted", "麦克风已静音"],
    ["Microphone is muted", "麦克风处于静音状态"],
    ["Connecting to voice...", "正在连接语音服务..."],
    ["Connecting to Gemini Live...", "正在连接 Gemini 实时语音..."],
    ["Voice Settings", "语音设置"],
    ["Audio Settings", "音频设置"],
    ["Input Device", "输入设备"],
    ["Output Device", "输出设备"],
    ["Microphone Device", "麦克风设备"],
    ["Speaker Device", "扬声器设备"],
    ["System Default", "系统默认"],
    ["Default Microphone", "默认麦克风"],
    ["Default Speaker", "默认扬声器"],
    ["Voice Selection", "音色选择"],
    ["Select Voice", "选择音色"],
    ["Test Microphone", "测试麦克风"],
    ["Test Audio", "测试音频"],
    ["Push to Talk", "按住说话"],
    ["Push-to-Talk", "按住说话"],
    ["Hold to talk", "按住说话"],
    ["Release to send", "松开发送"],
    ["Hands-free", "免提模式"],
    ["Hands-Free", "免提模式"],
    ["Voice Activity Detection", "语音活动检测"],
    ["Tap to interrupt", "点击可随时打断"],
    ["Speak to interrupt", "直接说话即可打断"],
    ["Click to speak", "点击开始说话"],
    ["Show Transcript", "显示文字记录"],
    ["Hide Transcript", "隐藏文字记录"],
    ["Show Captions", "显示实时字幕"],
    ["Hide Captions", "隐藏实时字幕"],
    ["Microphone Access Required", "需要麦克风权限"],
    ["Microphone permission denied", "麦克风权限已被拒绝"],
    ["Allow Antigravity to access your microphone", "允许 Antigravity 访问您的麦克风"],
    ["Please grant microphone access in System Settings.", "请在系统设置中授予麦克风访问权限。"],

    // 4. 远程智能体 (Remote Agents)、云端环境与 WSL 连接
    ["Remote Agents", "远程智能体"],
    ["Remote Agent", "远程智能体"],
    ["Cloud Agents", "云端智能体"],
    ["Cloud Agent", "云端智能体"],
    ["Local Agent", "本地智能体"],
    ["Local Agents", "本地智能体"],
    ["Run Locally", "在本地运行"],
    ["Run in Cloud", "在云端运行"],
    ["Run Remotely", "远程运行"],
    ["Local Environment", "本地环境"],
    ["Remote Environment", "远程环境"],
    ["Cloud Environment", "云端环境"],
    ["Remote Projects", "远程项目"],
    ["Remote Project", "远程项目"],
    ["Create Remote Project", "创建远程项目"],
    ["Connect to Remote", "连接到远程环境"],
    ["Connect to Host", "连接到远程主机"],
    ["Disconnect from Remote", "断开远程连接"],
    ["Connect to WSL", "连接到 WSL"],
    ["Connect to WSL...", "连接到 WSL..."],
    ["Connect to WSL Distro", "连接到 WSL 发行版"],
    ["New WSL Window", "新建 WSL 窗口"],
    ["New WSL Window using Distro...", "使用指定发行版新建 WSL 窗口..."],
    ["Open Folder in WSL", "在 WSL 中打开文件夹"],
    ["Open Folder in WSL...", "在 WSL 中打开文件夹..."],
    ["Reopen Folder in WSL", "在 WSL 中重新打开文件夹"],
    ["Reopen Folder Locally", "在本地重新打开文件夹"],
    ["Close Remote Connection", "关闭远程连接"],
    ["Connect via SSH", "通过 SSH 连接"],
    ["Connect to SSH Host...", "连接到 SSH 主机..."],
    ["Select Repository", "选择代码仓库"],
    ["Select Branch", "选择分支"],
    ["Git Repository", "Git 代码仓库"],
    ["Repository URL", "仓库地址 URL"],
    ["Setup Script", "初始化脚本"],
    ["Startup Script", "启动脚本"],
    ["Environment Variables", "环境变量"],
    ["Add Environment Variable", "添加环境变量"],
    ["Add Secret", "添加密钥"],
    ["Provisioning environment...", "正在分配云端环境..."],
    ["Starting remote environment...", "正在启动远程环境..."],
    ["Waking up environment...", "正在唤醒远程环境..."],
    ["Environment Ready", "环境已就绪"],
    ["Environment Stopped", "环境已停止"],
    ["Stop Environment", "停止环境"],
    ["Restart Environment", "重启环境"],
    ["Rebuild Environment", "重建环境"],
    ["Remote Control Settings", "远程控制设置"],
    ["Companion Website", "配套网页端"],
    ["Open Companion Website", "打开配套网页端"],
    ["Connected Devices", "已连接设备"],
    ["Pair Device", "配对设备"],

    // 5. 全新自动化面板 (Automations Dashboard) 与定时调度
    ["New Automation", "新建自动化"],
    ["Create Automation", "创建自动化"],
    ["Edit Automation", "编辑自动化"],
    ["Delete Automation", "删除自动化"],
    ["Duplicate Automation", "复制自动化"],
    ["Pause Automation", "暂停自动化"],
    ["Resume Automation", "恢复自动化"],
    ["Enable Automation", "启用自动化"],
    ["Disable Automation", "禁用自动化"],
    ["Run Now", "立即运行"],
    ["Run now", "立即运行"],
    ["Test Run", "测试运行"],
    ["Trigger Now", "立即触发"],
    ["Automation Name", "自动化名称"],
    ["Enter automation name...", "输入自动化名称..."],
    ["Task Prompt", "任务提示词"],
    ["Automation Prompt", "自动化提示词"],
    ["Instructions for the agent...", "输入给智能体的执行指令..."],
    ["Describe what the agent should do...", "描述您希望智能体自动执行的任务..."],
    ["Next Run", "下次运行"],
    ["Next run", "下次运行"],
    ["Last Run", "上次运行"],
    ["Last run", "上次运行"],
    ["Never run", "从未运行"],
    ["Run History", "运行历史"],
    ["Execution History", "执行历史"],
    ["Recent Runs", "最近运行记录"],
    ["No runs yet", "暂无运行记录"],
    ["No run history", "暂无运行历史"],
    ["View Run", "查看运行详情"],
    ["Open Run Conversation", "打开运行对话"],
    ["View Conversation", "查看对话"],
    ["Every Hour", "每小时"],
    ["Every Day", "每天"],
    ["Every Week", "每周"],
    ["Every Month", "每月"],
    ["Weekdays (Mon-Fri)", "工作日（周一至周五）"],
    ["Weekdays (Mon–Fri)", "工作日（周一至周五）"],
    ["Every Weekday", "每个工作日"],
    ["Custom Schedule", "自定义计划"],
    ["Custom Cron", "自定义 Cron 表达式"],
    ["Cron Expression", "Cron 表达式"],
    ["Custom cron schedule", "自定义 Cron 计划"],
    ["Time of Day", "执行时间"],
    ["Day of Week", "星期几"],
    ["Day of Month", "每月日期"],
    ["Select Timezone", "选择时区"],
    ["Local Time", "本地时间"],
    ["Allowed Folders", "允许访问的文件夹"],
    ["Working Directory", "工作目录"],
    ["Select Working Directory", "选择工作目录"],
    ["Access Grants", "权限授权"],
    ["Granted Permissions", "已授予权限"],
    ["Model Tier", "模型级别"],
    ["Restart Policy", "重启策略"],
    ["On Failure", "失败时重启"],
    ["Max Retries", "最大重试次数"],
    ["Automate repetitive tasks on a schedule.", "按计划自动执行重复性任务。"],
    ["Create scheduled agents that run in the background.", "创建在后台按计划自动运行的智能体任务。"],

    // 6. 插件市场 (Plugin Marketplace)、官方货架、精选插件描述与账户连接 (Accounts)
    ["Plugin Marketplace", "插件市场"],
    ["Agent Marketplace", "智能体扩展市场"],
    ["Plugins Manager", "插件管理器"],
    ["Manage Plugins", "管理插件"],
    ["Browse Plugins", "浏览插件"],
    ["Browse Marketplace", "浏览扩展市场"],
    ["Explore Plugins", "探索插件"],
    ["All Plugins", "全部插件"],
    ["Installed Plugins", "已安装插件"],
    ["Enabled Plugins", "已启用插件"],
    ["Disabled Plugins", "已禁用插件"],
    ["Built-in Plugins", "内置插件"],
    ["Search plugins...", "搜索插件..."],
    ["Search plugins and skills...", "搜索插件与技能..."],
    ["Search marketplace...", "搜索扩展市场..."],
    ["Filter plugins...", "筛选插件..."],
    ["No plugins found", "未找到匹配的插件"],
    ["No plugins installed", "暂未安装任何插件"],
    ["No matching plugins", "没有匹配的插件"],
    ["Build with Google", "使用 Google 平台构建"],
    ["Build With Google", "使用 Google 平台构建"],
    ["Connect to Google Workspace, including Docs, Sheets, Slides, Drive, and Calendar.", "连接到 Google Workspace，涵盖 Docs、Sheets、Slides、Drive 与 Calendar。"],
    ["Build on Google's developer platforms, including Android, Chrome, Gemini, and Google Cloud.", "基于 Google 开发者平台进行构建，涵盖 Android、Chrome、Gemini 与 Google Cloud。"],
    ["Design, Creative & Media", "设计、创意与媒体"],
    ["Design, creative, and media tools.", "设计、创意与多媒体工具。"],
    ["Productivity & Project Management", "生产力与项目管理"],
    ["Plan work, track issues, sign documents, and manage your notes and files.", "规划工作、追踪问题、签署文档，并管理您的笔记与文件。"],
    ["Cloud Hosting & Deployment", "云托管与部署"],
    ["Deploy and host your apps, sites, and their backends.", "部署并托管您的应用、网站及其后端服务。"],
    ["Developer Tools", "开发者工具"],
    ["APIs, services, and tools to build, test, secure, and run your apps.", "用于构建、测试、加固和运行应用的 API、服务与工具。"],
    ["Payments, CRM, accounting, data, identity, customer support, marketing, and workflow automation.", "涵盖支付、CRM、财务、数据、身份认证、客户支持、营销与工作流自动化。"],
    ["More Plugins", "更多插件"],
    ["Explore other marketplace customizations", "探索扩展市场中的更多自定义能力"],
    ["Explore other marketplace customizations.", "探索扩展市场中的更多自定义能力。"],
    ["Read, draft, and edit docs.", "读取、起草和编辑 Google 文档。"],
    ["Read, write, and format spreadsheets.", "读取、写入和格式化电子表格。"],
    ["Read, edit, and export presentations.", "读取、编辑和导出幻灯片演示文稿。"],
    ["Manage events, check availability, and schedule meetings.", "管理日程事件、查看空闲时间并安排会议。"],
    ["Search, read, organize, and share files in Google Drive.", "在 Google Drive 中搜索、读取、整理和共享文件。"],
    ["Build applications with the Gemini Interactions API and Live API, including text, image, video, and speech generation, managed agents, and real-time multimodal interactions.", "使用 Gemini Interactions API 与 Live API 构建应用，支持文本、图像、视频与语音生成、托管智能体及实时多模态交互。"],
    ["Reliable automation, in-depth debugging, and performance analysis in Chrome using Chrome DevTools and Puppeteer.", "使用 Chrome DevTools 与 Puppeteer 在 Chrome 中进行可靠自动化、深度调试与性能分析。"],
    ["Reliable automation, in-depth debugging, and performance analysis in Chrome using Chrome DevTools and Puppeteer", "使用 Chrome DevTools 与 Puppeteer 在 Chrome 中进行可靠自动化、深度调试与性能分析"],
    ["Prototype, build & run modern apps that users love with Firebase's backend, AI, and operational infrastructure.", "借助 Firebase 的后端、AI 与运维基础设施，快速构建并运行现代应用。"],
    ["Connect to your managed Looker MCP server to explore data, run saved Looks, build dashboards, and validate LookML.", "连接托管的 Looker MCP 服务器，探索数据、运行已保存视图、构建仪表盘并验证 LookML。"],
    ["Create, edit, review, resize, and brand-check Canva designs with the Canva MCP server.", "通过 Canva MCP 服务器创建、编辑、审查、调整尺寸并检查品牌规范。"],
    ["Turn Figma designs into production code, map components with Code Connect, and create or edit Figma files in Antigravity.", "将 Figma 设计稿转化为生产代码，通过 Code Connect 映射组件，并在 Antigravity 中创建或编辑 Figma 文件。"],
    ["Give your AI agent 600,000+ real app screens, and the skills to use them.", "为您的 AI 智能体提供 600,000+ 真实应用界面参考及配套设计技能。"],
    ["The product development system for teams and agents.", "面向团队与智能体的现代产品研发协作系统。"],
    ["Teamwork Graph CLI is Atlassian's agent-first interface to your entire work context: Jira issues, Confluence pages, Bitbucket PRs, along with your connected tools.", "Atlassian 面向智能体的全局工作上下文接口：打通 Jira 问题、Confluence 页面与 Bitbucket PR。"],
    ["Connect Antigravity to Dropbox to search, inspect, summarize, share, collect uploads, organize folders, and clean up files with confirmation for write actions.", "将 Antigravity 连接到 Dropbox，支持搜索、查看、总结、分享、整理文件夹，并在写入操作前请求确认。"],
    ["Build and deploy on Netlify: functions, edge functions, blobs, database, identity, forms, image CDN, caching, and AI Gateway, plus the Netlify MCP server.", "在 Netlify 上构建与部署：涵盖云函数、边缘函数、存储、数据库、身份认证、CDN 缓存与 Netlify MCP 服务。"],
    ["Deploy, configure, monitor, and troubleshoot apps, databases, and infrastructure on Railway from Antigravity with Railway's agent skill and hosted MCP server.", "通过 Railway 智能体技能与托管 MCP 服务，在 Antigravity 中部署、配置、监控和排查应用与基础设施。"],
    ["Build and deploy web apps and AI agents on Vercel with skills for Next.js, AI SDK, and cloud services, plus the official Vercel MCP server.", "使用 Next.js、AI SDK 技能与官方 Vercel MCP 服务，在 Vercel 上构建和部署 Web 应用与 AI 智能体。"],
    ["Add Auth0 authentication to any app: login, MFA, SSO, Organizations, RBAC, custom domains, and branding.", "为任意应用接入 Auth0 身份认证：支持登录、多因素认证、SSO、组织架构、RBAC 权限与自定义域名。"],
    ["Build and deploy Base44 full-stack apps: CLI project management, JavaScript/TypeScript SDK development, and production troubleshooting skills.", "构建并部署 Base44 全栈应用：涵盖 CLI 项目管理、JS/TS SDK 开发与生产环境排障技能。"],
    ["Manage your Bigin CRM from Antigravity: review pipelines, find contacts and deals, log calls, plan follow-ups, and email customers.", "在 Antigravity 中管理 Bigin CRM：查看销售管道、查找联系人与交易、记录通话并规划客户跟进。"],
    ["Databricks skills for the CLI, Apps, Lakebase, Model Serving, Lakeflow Jobs, Spark Declarative Pipelines, Declarative Automation Bundles (DABs), and connecting via MCP.", "提供 Databricks CLI、应用、模型服务、Lakeflow 作业、Spark 声明式流水线与 MCP 连接技能。"],
    ["Install Plugin", "安装插件"],
    ["Uninstall Plugin", "卸载插件"],
    ["Enable Plugin", "启用插件"],
    ["Disable Plugin", "禁用插件"],
    ["Add from Marketplace", "从扩展市场添加"],
    ["Installed from Marketplace", "已从扩展市场安装"],
    ["Requires Restart", "需要重启"],
    ["Restart Required", "需要重启"],
    ["Reload Required", "需要重新加载"],
    ["Built-in plugins cannot be uninstalled.", "内置插件无法卸载。"],
    ["Built-in plugins cannot be uninstalled", "内置插件无法卸载"],
    ["Suggested Prompts", "推荐提示词"],
    ["Try a prompt", "试试以下提示词"],
    ["Try it out", "立即体验"],
    ["Included Customizations", "包含的自定义项"],
    ["Included Skills", "包含的技能"],
    ["Included Tools", "包含的工具"],
    ["Included Agents", "包含的智能体"],
    ["Included Rules", "包含的规则"],
    ["Included Hooks", "包含的钩子"],
    ["Included MCP Servers", "包含的 MCP 服务器"],
    ["Connected Accounts", "已连接账户"],
    ["Plugin Accounts", "插件账户"],
    ["Account Sign-in", "账户登录"],
    ["Connect Account", "连接账户"],
    ["Add Account", "添加账户"],
    ["Switch Account", "切换账户"],
    ["Reconnect Account", "重新连接账户"],
    ["Disconnect Account", "断开账户连接"],
    ["Remove Account", "移除账户"],
    ["Signed in", "已登录"],
    ["Signed out", "未登录"],
    ["Sign in required", "需要登录"],
    ["Authentication required", "需要身份认证"],
    ["Authentication failed", "身份认证失败"],
    ["Token expired", "令牌已过期"],
    ["Set as Default", "设为默认"],
    ["Set as default", "设为默认"],
    ["Default Account", "默认账户"],
    ["Account Label", "账户标签"],
    ["Edit Label", "编辑标签"],
    ["No installed plugins declare account sign-ins.", "当前已安装的插件均无需连接外部账户。"],
    ["No accounts connected.", "暂未连接任何账户。"],
    ["No accounts connected", "暂未连接任何账户"],
    ["Powers CLI:", "支持的命令行工具："],
    ["Auth Provider", "认证服务商"],

    // 7. Jupyter Notebook 查看器与交互式单元格
    ["Jupyter Notebook", "Jupyter 笔记本"],
    ["Notebook Viewer", "笔记本查看器"],
    ["Run Cell", "运行单元格"],
    ["Run All", "全部运行"],
    ["Run All Cells", "运行所有单元格"],
    ["Run Above", "运行上方单元格"],
    ["Run Below", "运行下方单元格"],
    ["Run Cell and Below", "运行当前及下方单元格"],
    ["Stop Execution", "停止执行"],
    ["Interrupt Kernel", "中断内核"],
    ["Restart Kernel", "重启内核"],
    ["Restart Kernel and Run All", "重启内核并全部运行"],
    ["Clear Output", "清除输出"],
    ["Clear Outputs", "清除所有输出"],
    ["Clear All Outputs", "清除所有输出"],
    ["Add Code Cell", "添加代码单元格"],
    ["Add Markdown Cell", "添加 Markdown 单元格"],
    ["Code Cell", "代码单元格"],
    ["Markdown Cell", "Markdown 单元格"],
    ["Move Cell Up", "上移单元格"],
    ["Move Cell Down", "下移单元格"],
    ["Delete Cell", "删除单元格"],
    ["Select Kernel", "选择内核"],
    ["Change Kernel", "切换内核"],
    ["Python Environment", "Python 环境"],
    ["Kernel Idle", "内核空闲"],
    ["Kernel Busy", "内核忙碌"],
    ["Kernel Disconnected", "内核已断开"],
    ["Collapse Output", "折叠输出"],
    ["Expand Output", "展开输出"],

    // 8. 内置浏览器面板增强 (Downloads / History / Take Control)
    ["Browser Downloads", "浏览器下载"],
    ["Browsing History", "浏览历史"],
    ["Browser History", "浏览历史"],
    ["Clear Browsing Data", "清除浏览数据"],
    ["Clear Downloads", "清除下载记录"],
    ["Open Downloads Folder", "打开下载文件夹"],
    ["Show in Folder", "在文件夹中显示"],
    ["No downloads yet", "暂无下载内容"],
    ["No browsing history", "暂无浏览历史"],
    ["Take Control", "接管浏览器控制"],
    ["Take Over", "接管控制"],
    ["Return Control", "交还控制权"],
    ["Return Control to Agent", "将控制权交还智能体"],
    ["Agent is controlling the browser", "智能体正在控制浏览器"],
    ["You are controlling the browser", "您正在手动控制浏览器"],
    ["Enter URL or search...", "输入网址或搜索内容..."],
    ["Reload Page", "重新加载页面"],
    ["Hard Reload", "强制刷新页面"],
    ["Open DevTools", "打开开发者工具"],

    // 9. Sidecar 扩展面板 (Android Device Hub / Android Compose Preview)
    ["Android Device Hub", "Android 设备中心"],
    ["Device Hub", "设备中心"],
    ["Android Compose Preview", "Android Compose 预览"],
    ["Compose Preview", "Compose 预览"],
    ["Virtual Devices", "虚拟设备 (AVD)"],
    ["Physical Devices", "物理真机"],
    ["Available Devices", "可用设备"],
    ["Create Device", "创建虚拟设备"],
    ["Create AVD", "创建 AVD"],
    ["Start Device", "启动设备"],
    ["Stop Device", "停止设备"],
    ["Cold Boot", "冷启动"],
    ["Wipe Data", "擦除数据"],
    ["Delete Device", "删除设备"],
    ["Start Mirroring", "开始屏幕镜像"],
    ["Stop Mirroring", "停止屏幕镜像"],
    ["Take Screenshot", "截取屏幕"],
    ["Inspect Layout", "检查界面布局"],
    ["Rotate Left", "向左旋转"],
    ["Rotate Right", "向右旋转"],
    ["Device Back", "返回键"],
    ["Device Home", "主页键"],
    ["App Switch", "多任务键"],
    ["Power Button", "电源键"],
    ["Volume Up", "音量加"],
    ["Volume Down", "音量减"],
    ["No devices connected", "未连接任何设备"],
    ["No virtual devices found", "未找到虚拟设备"],
    ["No @Preview functions found", "未找到 @Preview 预览函数"],
    ["Render Preview", "渲染预览"],
    ["Re-render Preview", "重新渲染预览"],
    ["Refresh Preview", "刷新预览"],
    ["Rendering Compose preview...", "正在渲染 Compose 预览..."],

    // 10. 模型选择 (Model Selection)、代码差异审查与子智能体协同
    ["Model Selection", "模型选择"],
    ["Reasoning Effort", "推理强度"],
    ["Thinking Effort", "思考强度"],
    ["Effort Level", "推理级别"],
    ["Auto-select model", "自动选择模型"],
    ["Automatically choose the best model for each task.", "根据任务复杂度自动选择最合适的模型。"],
    ["Accept All", "全部接受"],
    ["Reject All", "全部拒绝"],
    ["Discard All", "全部放弃"],
    ["Discard Changes", "放弃更改"],
    ["Accept Changes", "接受更改"],
    ["Accept File", "接受此文件更改"],
    ["Reject File", "拒绝此文件更改"],
    ["Approve Plan", "批准计划"],
    ["Proceed with Plan", "按此计划执行"],
    ["Request Changes", "请求修改"],
    ["Open Diff", "打开差异对比"],
    ["View Diff", "查看差异对比"],
    ["Side by Side", "并排视图"],
    ["Inline Diff", "内联差异视图"],
    ["No changes to review", "暂无需要审查的更改"],
    ["All changes reviewed", "所有更改已审查完毕"],
    ["Subagent Activity", "子智能体活动"],
    ["Running Subagents", "运行中的子智能体"],
    ["Completed Subagents", "已完成的子智能体"],
    ["View Subagent", "查看子智能体会话"],
    ["Stop Subagent", "停止子智能体"],
    ["Ask Question", "等待您的回答"],
    ["Select all that apply", "可多选"],
    ["Other (specify)", "其他（请说明）"],
    ["Type your answer...", "输入您的回答..."],

    // 11. v2.29.0 深度拾遗全覆盖（内置浏览器、语音模式、远程控制、快捷键全集、拆散链接片段与配额细分）
    // 11.1 内置浏览器与浏览器子智能体 (Built-in Browser & Browser Subagent)
    ["Built-in Browser", "内置浏览器"],
    ["Built-In Browser", "内置浏览器"],
    ["External Browser", "外部浏览器"],
    ["System Browser", "系统默认浏览器"],
    ["Default Browser", "默认浏览器"],
    ["Configure link opening and built-in browser preferences.", "配置链接打开方式和内置浏览器偏好设置。"],
    ["Open Links In", "链接打开方式"],
    ["Open links in", "链接打开方式"],
    ["Choose where links open by default when clicked.", "选择点击链接时的默认打开位置。"],
    ["Download Location", "下载保存位置"],
    ["Folder where files downloaded in the built-in browser are saved.", "内置浏览器下载文件的保存文件夹。"],
    ["Clear visited URLs and autocomplete suggestions from the built-in browser.", "清除内置浏览器中已访问的网址记录和自动补全建议。"],
    ["Clear cookies, cache, and site data from the built-in browser.", "清除内置浏览器中的 Cookie、缓存和网站数据。"],
    ["Clear Site Data", "清除网站数据"],
    ["Cookies and Site Data", "Cookie 与网站数据"],
    ["Browser Subagent", "浏览器子智能体"],
    ["Configure the browser subagent. It requires", "配置浏览器子智能体。此功能需要安装"],
    ["to be installed. The browser subagent can be invoked by typing /browser in the conversation input box.", "后方可使用。在对话输入框中输入 /browser 即可调用浏览器子智能体。"],
    ["to be installed. The browser subagent can be invoked by typing", "后方可使用。可在对话输入框中输入"],
    ["The browser subagent can be invoked by typing /browser in the conversation input box.", "在对话输入框中输入 /browser 即可调用浏览器子智能体。"],
    ["The browser subagent can be invoked by typing", "可在对话输入框中输入"],
    ["in the conversation input box.", "来调用该功能。"],
    ["in the conversation input box", "（在对话输入框中）"],
    ["to be installed.", "后方可使用。"],

    // 11.2 语音模式与音频输入输出设置 (Voice mode & Audio Devices)
    ["Voice mode", "语音模式"],
    ["Configure voice mode preferences.", "配置语音模式偏好设置。"],
    ["Configure microphone and speaker settings for voice mode.", "配置语音模式的麦克风和扬声器设置。"],
    ["Configure microphone and audio settings for voice mode.", "配置语音模式的麦克风和音频设置。"],
    ["Configure audio input and output devices for voice mode.", "配置语音模式的音频输入与输出设备。"],
    ["Configure audio input and output for voice conversations.", "配置语音对话的音频输入与输出。"],
    ["Choose which microphone to use for voice mode.", "选择语音模式使用的麦克风设备。"],
    ["Choose which microphone to use for voice input.", "选择用于语音输入的麦克风设备。"],
    ["Select the microphone used for voice input.", "选择用于语音输入的麦克风。"],
    ["Input device used for voice conversations.", "用于语音对话的音频输入设备。"],
    ["Choose which speaker to use for voice mode.", "选择语音模式使用的扬声器设备。"],
    ["Choose which speaker or headphones to use for voice output.", "选择用于语音输出的扬声器或耳机。"],
    ["Select the speaker used for voice output.", "选择用于语音输出的扬声器。"],
    ["Output device used for voice conversations.", "用于语音对话的音频输出设备。"],
    ["System default", "系统默认"],
    ["No microphone found", "未检测到麦克风"],
    ["No microphones found", "未检测到麦克风"],
    ["No speaker found", "未检测到扬声器"],
    ["No speakers found", "未检测到扬声器"],
    ["No audio devices found", "未检测到音频设备"],
    ["Noise Suppression", "噪音抑制"],
    ["Echo Cancellation", "回声消除"],
    ["Auto Gain Control", "自动增益控制"],
    ["Voice Speed", "语音语速"],
    ["Playback Speed", "播放倍速"],
    ["Spoken Responses", "语音朗读回复"],
    ["Auto-play voice responses", "自动播放语音回复"],

    // 11.3 远程控制与设备配对二维码 (Remote Control & Device Name)
    ["Device Name", "设备名称"],
    ["Device Nickname", "设备昵称"],
    ["Scan the code to open this device in Remote Control, or copy link.", "扫描二维码以在远程控制中打开此设备，或复制链接。"],
    ["Scan the code to open this device in", "扫描二维码以打开此设备的"],
    ["Scan QR code to connect", "扫描二维码进行连接"],
    ["Scan the QR code to connect from your phone or another device.", "使用手机或其他设备扫描二维码进行连接。"],
    ["copy link", "复制链接"],
    ["Copy Link", "复制链接"],
    ["Copy link", "复制链接"],
    ["Link copied", "链接已复制"],
    ["Link copied!", "链接已复制！"],
    ["Link copied to clipboard", "链接已复制到剪贴板"],
    ["Copied to clipboard", "已复制到剪贴板"],
    ["Copied to clipboard!", "已复制到剪贴板！"],
    ["Allow remote access to this device from the companion web app.", "允许从配套网页应用远程访问此设备。"],
    ["Control your local Antigravity sessions from another device.", "从其他设备远程控制您的本地 Antigravity 会话。"],
    ["Remote Control is enabled", "远程控制已启用"],
    ["Remote Control is disabled", "远程控制已禁用"],
    ["Waiting for connection...", "正在等待连接..."],
    ["Reconnecting...", "正在重新连接..."],

    // 11.4 对话设置、项目外独立会话与自定义项 Token 占用细分 (Conversations & Customizations Breakdown)
    ["Settings for conversations outside of projects.", "项目外独立对话的设置。"],
    ["Settings for conversations in this project.", "此项目内对话的设置。"],
    ["Settings for conversations across all projects.", "所有项目对话的通用设置。"],
    ["Permissions for conversations outside of projects.", "项目外独立对话的权限设置。"],
    ["Permissions for conversations in this project.", "此项目内对话的权限设置。"],
    ["Customizations for conversations outside of projects.", "项目外独立对话的自定义项。"],
    ["Customizations for conversations in this project.", "此项目内对话的自定义项。"],
    ["The breakdown below shows token usage from customizations like rules, skills, and MCP. If a budget is exceeded, large rules are demoted to path pointers and large customizations are excluded automatically.", "下方明细展示了规则、技能和 MCP 等自定义项的 Token 占用情况。若超出配额预算，较大的规则会自动降级为路径指针，过大的自定义项将被自动排除。"],
    ["The breakdown below shows token usage from customizations like rules, skills, and MCP. If the budget is exceeded, large rules are demoted to path pointers and large customizations are excluded automatically.", "下方明细展示了规则、技能和 MCP 等自定义项的 Token 占用情况。若超出配额预算，较大的规则会自动降级为路径指针，过大的自定义项将被自动排除。"],
    ["The breakdown below shows token usage from customizations like rules, skills, and MCP.", "下方明细展示了规则、技能和 MCP 等自定义项的 Token 占用情况。"],
    ["If a budget is exceeded, large rules are demoted to path pointers and large customizations are excluded automatically.", "若超出配额预算，较大的规则会自动降级为路径指针，过大的自定义项将被自动排除。"],
    ["If the budget is exceeded, large rules are demoted to path pointers and large customizations are excluded automatically.", "若超出配额预算，较大的规则会自动降级为路径指针，过大的自定义项将被自动排除。"],
    ["Other Customizations", "其他自定义项"],
    ["Hide breakdown", "隐藏细分详情"],
    ["Hide 1 breakdown", "隐藏 1 项细分详情"],
    ["Show breakdowns", "显示细分详情"],
    ["Hide breakdowns", "隐藏细分详情"],
    ["Path Pointers", "路径指针"],
    ["Path Pointer", "路径指针"],
    ["Demoted to path pointer", "已降级为路径指针"],
    ["Excluded (exceeds budget)", "已排除（超出预算）"],
    ["Budget exceeded", "已超出配额预算"],
    ["Customization Budget", "自定义项配额预算"],
    ["Past Conversations", "历史对话记忆"],
    ["Conversation Memory", "对话记忆"],
    ["Knowledge Base", "知识库"],
    ["Manage Knowledge", "管理知识库"],
    ["Auto-Expand Changes Overview", "自动展开更改概览"],

    // 11.5 键盘快捷键全集与斜杠复合动作名 (Keyboard Shortcuts)
    ["Add to Chat/Quote", "添加到聊天 / 引用"],
    ["Add to Chat / Quote", "添加到聊天 / 引用"],
    ["Add Selection to Chat", "将选区添加到聊天"],
    ["Quote Selection", "引用选中文本"],
    ["Archive This Conversation", "归档此对话"],
    ["Unarchive This Conversation", "取消归档此对话"],
    ["Delete This Conversation", "删除此对话"],
    ["Pin This Conversation", "固定此对话"],
    ["Unpin This Conversation", "取消固定此对话"],
    ["Rename This Conversation", "重命名此对话"],
    ["Duplicate This Conversation", "复制此对话"],
    ["Focus Chat Input", "聚焦聊天输入框"],
    ["Focus Agent Input", "聚焦智能体输入框"],
    ["Focus Conversation", "聚焦对话区域"],
    ["Focus Sidebar", "聚焦侧边栏"],
    ["Focus Editor", "聚焦编辑器"],
    ["Focus Browser", "聚焦浏览器"],
    ["Stop Generation", "停止生成"],
    ["Stop Agent", "停止智能体"],
    ["Interrupt Agent", "打断智能体"],
    ["Cancel Generation", "取消生成"],
    ["Approve Action", "批准操作"],
    ["Reject Action", "拒绝操作"],
    ["Approve Command", "批准命令"],
    ["Reject Command", "拒绝命令"],
    ["Accept All Changes", "接受所有更改"],
    ["Reject All Changes", "拒绝所有更改"],
    ["Next Change", "下一处更改"],
    ["Previous Change", "上一处更改"],
    ["Next Tab", "下一个标签页"],
    ["Previous Tab", "上一个标签页"],
    ["Reopen Closed Tab", "重新打开已关闭标签页"],
    ["Toggle Left Sidebar", "切换左侧边栏"],
    ["Toggle Right Sidebar", "切换右侧边栏"],
    ["Toggle Bottom Panel", "切换底部面板"],
    ["Toggle Review Pane", "切换审查窗格"],
    ["Toggle Browser Pane", "切换浏览器窗格"],
    ["Toggle Editor Pane", "切换编辑器窗格"],
    ["Toggle Voice Mode", "切换语音模式"],
    ["Mute/Unmute", "静音 / 取消静音"],
    ["Mute / Unmute", "静音 / 取消静音"],
    ["Expand/Collapse", "展开 / 折叠"],
    ["Expand / Collapse", "展开 / 折叠"],
    ["Show/Hide", "显示 / 隐藏"],
    ["Show / Hide", "显示 / 隐藏"],
    ["Accept/Reject", "接受 / 拒绝"],
    ["Accept / Reject", "接受 / 拒绝"],
    ["Play/Pause", "播放 / 暂停"],
    ["Play / Pause", "播放 / 暂停"],
    ["Open/Close", "打开 / 关闭"],
    ["Open / Close", "打开 / 关闭"],
    ["Quick Open", "快速打开"],
    ["Go to File", "转到文件"],
    ["Go to Line", "转到行"],
    ["Go to Symbol", "转到符号"],
    ["Go to Definition", "转到定义"],
    ["Peek Definition", "速览定义"],
    ["Find References", "查找所有引用"],
    ["Format Document", "格式化文档"],
    ["Reset Shortcuts", "重置快捷键"],
    ["Reset All Shortcuts", "重置所有快捷键"],
    ["Reset to Default", "恢复默认"],
    ["Press keys...", "请按下快捷键..."],
    ["Press desired key combination", "请按下目标快捷键组合"],
    ["Record Shortcut", "录制快捷键"],
    ["Search shortcuts...", "搜索快捷键..."],
    ["Search keybindings...", "搜索快捷键绑定..."],
    ["No shortcuts found", "未找到匹配的快捷键"],

    // 11.6 行内链接拆散长句片段、应用设置、CLI 与自定义管理项 (Split-Link Fragments & App/Customizations)
    ["Enforce settings that prevent the agent from autonomously running targeted exploits and require human review for all agent actions. Visit", "强制启用安全设置，防止智能体自主运行高危利用，并要求对所有智能体操作进行人工审核。详情请访问"],
    ["Enforce settings that prevent the agent from autonomously running targeted exploits and require human review for all agent actions.", "强制启用安全设置，防止智能体自主运行高危利用，并要求对所有智能体操作进行人工审核。"],
    ["for details.", "了解详情。"],
    ["Show a floating notification card when background conversations need your input. Answer questions, approve commands, and grant permissions without leaving your current conversation. Share feedback at", "当后台会话需要您的输入时显示浮动通知卡片。无需离开当前对话即可回答问题、批准命令并授予权限。反馈请访问"],
    ["Show a floating notification card when background conversations need your input. Answer questions, approve commands, and grant permissions without leaving your current conversation.", "当后台会话需要您的输入时显示浮动通知卡片。无需离开当前对话即可回答问题、批准命令并授予权限。"],
    ["Share feedback at", "反馈请访问"],
    ["You currently don't have any MCP Servers installed.", "您当前尚未安装任何 MCP 服务器。"],
    ["Add an MCP server above", "请在上方添加 MCP 服务器"],
    ["Add an MCP server above.", "请在上方添加 MCP 服务器。"],
    ["an MCP server above", "上方的 MCP 服务器"],
    ["an MCP server above.", "上方的 MCP 服务器。"],
    ["You can upgrade to a", "您可以升级到"],
    ["plan to receive the highest rate limits.", "套餐以获得最高速率配额限制。"],
    ["plan to receive higher rate limits.", "套餐以获得更高的速率配额限制。"],
    ["Command Line Tool", "命令行工具 (CLI)"],
    ["Install Command Line Tool", "安装命令行工具"],
    ["Install 'agy' in PATH", "将 'agy' 安装到系统 PATH"],
    ["Install agy in PATH", "将 agy 安装到系统 PATH"],
    ["Launch Antigravity from the terminal using the agy command.", "在终端中使用 agy 命令快速启动 Antigravity。"],
    ["Launch at Login", "开机自动启动"],
    ["Open at Login", "登录时自动打开"],
    ["Start Antigravity automatically when you log in.", "登录系统时自动启动 Antigravity。"],
    ["Hardware Acceleration", "硬件加速"],
    ["Use GPU acceleration when available.", "可用时启用 GPU 硬件加速。"],
    ["Default Editor", "默认外部编辑器"],
    ["External Editor", "外部编辑器"],
    ["Open in External Editor", "在外部编辑器中打开"],
    ["Choose which editor opens files externally.", "选择在外部打开文件时使用的编辑器。"],
    ["Restart Language Server", "重启语言服务器"],
    ["Open Logs Folder", "打开日志文件夹"],
    ["Show Logs", "显示日志"],
    ["Clear Cache", "清除缓存"],
    ["Reset Onboarding", "重置新手引导"],
    ["Release Channel", "更新通道"],
    ["Update Channel", "更新通道"],
    ["Up to date", "已是最新版本"],
    ["Antigravity is up to date.", "Antigravity 已是最新版本。"],
    ["Add Rule", "添加规则"],
    ["New Rule", "新建规则"],
    ["Edit Rule", "编辑规则"],
    ["Delete Rule", "删除规则"],
    ["Global Rules", "全局规则"],
    ["Workspace Rules", "工作区规则"],
    ["Project Rules", "项目规则"],
    ["Add Skill", "添加技能"],
    ["New Skill", "新建技能"],
    ["Edit Skill", "编辑技能"],
    ["Delete Skill", "删除技能"],
    ["Global Skills", "全局技能"],
    ["Workspace Skills", "工作区技能"],
    ["Project Skills", "项目技能"],
    ["Add Hook", "添加钩子"],
    ["New Hook", "新建钩子"],
    ["Edit Hook", "编辑钩子"],
    ["Delete Hook", "删除钩子"],
    ["Add Agent", "添加智能体"],
    ["New Agent", "新建智能体"],
    ["Edit Agent", "编辑智能体"],
    ["Delete Agent", "删除智能体"],
    ["No rules configured", "暂未配置任何规则"],
    ["No skills configured", "暂未配置任何技能"],
    ["No hooks configured", "暂未配置任何钩子"],
    ["No custom agents configured", "暂未配置任何自定义智能体"],

    // ===== 12. v65 地板式全界面深度清扫（覆盖侧边面板、右键多级菜单、查看器、权限弹窗、快捷键与危险区域） =====
    // 12.1 侧边面板 (Side Panel)、标签选择器、快捷启动栏与拆分菜单
    ["Search or enter a URL", "搜索文件或输入网址"],
    ["Search or enter URL", "搜索文件或输入网址"],
    ["Search or enter a URL...", "搜索文件或输入网址..."],
    ["Search files or enter a URL", "搜索文件或输入网址"],
    ["Search files or enter URL", "搜索文件或输入网址"],
    ["Enter a URL or search", "输入网址或搜索文件"],
    ["Type a URL or search...", "输入网址或搜索内容..."],
    ["Open File", "打开文件"],
    ["Open File...", "打开文件..."],
    ["Open Files", "打开文件"],
    ["Open Folder...", "打开文件夹..."],
    ["New File", "新建文件"],
    ["New Folder", "新建文件夹"],
    ["New Browser Tab", "新建浏览器标签页"],
    ["Open Browser", "打开浏览器"],
    ["Open Terminal", "打开终端"],
    ["Split Right", "向右拆分"],
    ["Split Left", "向左拆分"],
    ["Split Up", "向上拆分"],
    ["Split Down", "向下拆分"],
    ["Split Horizontally", "水平拆分"],
    ["Split Vertically", "垂直拆分"],
    ["Open to the Side", "在侧边打开"],
    ["Open in Side Panel", "在侧边面板中打开"],
    ["Open in Aux Pane", "在辅助窗格中打开"],
    ["Open in New Tab", "在新标签页中打开"],
    ["Active Documents", "当前活跃文档"],
    ["Associated Documents", "关联文档"],
    ["Generated Artifacts", "生成的产物"],
    ["Recent Files", "最近文件"],
    ["Open Files", "打开的文件"],
    ["Open Editors", "打开的编辑器"],
    ["Open Tabs", "打开的标签页"],
    ["Modified Files", "已修改文件"],
    ["Untracked Files", "未跟踪文件"],
    ["Edited Files", "已编辑文件"],
    ["No open tabs", "暂无打开的标签页"],
    ["No open files", "暂无打开的文件"],
    ["No recent files", "暂无最近打开的文件"],
    ["No extensions", "暂无可用扩展"],
    ["No extensions installed", "暂未安装任何扩展"],
    ["No extensions available", "暂无可用扩展"],
    ["No UI extensions", "暂无界面扩展"],
    ["Manage Extensions", "管理扩展"],
    ["UI Extensions", "界面扩展"],
    ["Extension Panels", "扩展面板"],
    ["Pin Tab", "固定标签页"],
    ["Unpin Tab", "取消固定标签页"],
    ["Close Others", "关闭其他"],
    ["Close to the Right", "关闭右侧标签页"],
    ["Close Saved", "关闭已保存"],
    ["Filter files...", "筛选文件..."],
    ["Empty folder", "空文件夹"],
    ["No folder open", "尚未打开文件夹"],
    ["No workspace open", "尚未打开工作区"],

    // 12.2 对话与项目右键多级菜单、复制子菜单与项目危险区域 (Context Menus & Danger Zone)
    ["删除 项目", "删除项目"],
    ["创建 项目", "创建项目"],
    ["移除 项目", "移除项目"],
    ["打开 文件", "打开文件"],
    ["下载 文件", "下载文件"],
    ["Mark Unread", "标记为未读"],
    ["Mark Read", "标记为已读"],
    ["Mark unread", "标记为未读"],
    ["Mark read", "标记为已读"],
    ["Conversation Name", "对话名称"],
    ["Conversation Title", "对话标题"],
    ["Conversation ID", "对话 ID"],
    ["Conversation Link", "对话链接"],
    ["Conversation URL", "对话链接"],
    ["Conversation Markdown", "对话 Markdown"],
    ["Project Name", "项目名称"],
    ["Project ID", "项目 ID"],
    ["Project Path", "项目路径"],
    ["Project Description", "项目描述"],
    ["Project Instructions", "项目指令"],
    ["Project Icon", "项目图标"],
    ["Workspace Name", "工作区名称"],
    ["Workspace ID", "工作区 ID"],
    ["Workspace Path", "工作区路径"],
    ["Folder Name", "文件夹名称"],
    ["Folder Path", "文件夹路径"],
    ["Copy Project Name", "复制项目名称"],
    ["Copy Project ID", "复制项目 ID"],
    ["Copy Project Path", "复制项目路径"],
    ["Copy Conversation Name", "复制对话名称"],
    ["Copy Conversation Title", "复制对话标题"],
    ["Copy Conversation ID", "复制对话 ID"],
    ["Copy Conversation Link", "复制对话链接"],
    ["Copy Conversation URL", "复制对话链接"],
    ["Copy Workspace Name", "复制工作区名称"],
    ["Copy Workspace Path", "复制工作区路径"],
    ["Copy Relative Path", "复制相对路径"],
    ["Copy Folder Path", "复制文件夹路径"],
    ["Relative Path", "相对路径"],
    ["Full Path", "完整路径"],
    ["Show in File Explorer", "在文件资源管理器中显示"],
    ["Reveal in File Explorer", "在文件资源管理器中显示"],
    ["Show in Explorer", "在资源管理器中显示"],
    ["Reveal in Explorer", "在资源管理器中显示"],
    ["Show in Finder", "在访达中显示"],
    ["Reveal in Finder", "在访达中显示"],
    ["Show in File Manager", "在文件管理器中显示"],
    ["Reveal in File Manager", "在文件管理器中显示"],
    ["Open in File Explorer", "在文件资源管理器中打开"],
    ["Open in Finder", "在访达中打开"],
    ["Open in Default App", "使用默认应用打开"],
    ["Open in System Default", "使用系统默认应用打开"],
    ["Open in Integrated Terminal", "在集成终端中打开"],
    ["Open in External Terminal", "在外部终端中打开"],
    ["Move to Trash", "移至回收站"],
    ["Move to Recycle Bin", "移至回收站"],
    ["Remove from Project", "从项目中移除"],
    ["Add Folder to Project", "添加文件夹到项目"],
    ["Add Folder to Workspace", "添加文件夹到工作区"],
    ["Remove Folder", "移除文件夹"],
    ["Working Folders", "工作文件夹"],
    ["Workspace Folders", "工作区文件夹"],
    ["Primary Folder", "主文件夹"],
    ["No folders added", "尚未添加任何文件夹"],
    ["Danger Zone", "危险区域"],
    ["Danger zone", "危险区域"],
    ["Archive Project", "归档项目"],
    ["Unarchive Project", "取消归档项目"],
    ["Remove Project", "移除项目"],
    ["Leave Project", "退出项目"],
    ["Reset Project", "重置项目"],
    ["Reset Project Settings", "重置项目设置"],
    ["Delete All Conversations", "删除所有对话"],
    ["Archive All Conversations", "归档所有对话"],
    ["This action cannot be undone.", "此操作无法撤销。"],
    ["This action cannot be undone", "此操作无法撤销"],
    ["Your local files will not be deleted.", "您的本地文件不会被删除。"],
    ["Files on disk will not be deleted.", "磁盘上的本地文件不会被删除。"],
    ["Your files on disk will not be affected.", "磁盘上的本地文件不会受到影响。"],
    ["Type project name to confirm", "输入项目名称以确认"],

    // 12.3 文件查看器、Markdown 预览、PDF 查看器与代码差异视图 (File / Markdown / PDF / Diff Viewers)
    ["Download File", "下载文件"],
    ["Download Image", "下载图片"],
    ["Download PDF", "下载 PDF"],
    ["Download Artifact", "下载产物"],
    ["Download All", "全部下载"],
    ["Export as PDF", "导出为 PDF"],
    ["Export as Markdown", "导出为 Markdown"],
    ["Export as HTML", "导出为 HTML"],
    ["Export as JSON", "导出为 JSON"],
    ["Export as PNG", "导出为 PNG"],
    ["Export as SVG", "导出为 SVG"],
    ["Export as Text", "导出为纯文本"],
    ["Copy Markdown", "复制 Markdown"],
    ["Copy Raw", "复制原始文本"],
    ["Copy Selection", "复制选中内容"],
    ["View Raw", "查看原始文本"],
    ["View Preview", "查看预览"],
    ["Live Preview", "实时预览"],
    ["Markdown Preview", "Markdown 预览"],
    ["Raw Text", "原始文本"],
    ["Table of Contents", "目录大纲"],
    ["Toggle Table of Contents", "切换目录大纲"],
    ["Show Table of Contents", "显示目录大纲"],
    ["Hide Table of Contents", "隐藏目录大纲"],
    ["Document Outline", "文档大纲"],
    ["No headings found", "暂无标题大纲"],
    ["Find in File", "在文件中查找"],
    ["Word Wrap", "自动换行"],
    ["Toggle Word Wrap", "切换自动换行"],
    ["Line Numbers", "显示行号"],
    ["Toggle Minimap", "切换代码缩略图"],
    ["PDF Viewer", "PDF 查看器"],
    ["Fit to Width", "适应宽度"],
    ["Fit to Page", "适应页面"],
    ["Fit Width", "适应宽度"],
    ["Fit Page", "适应页面"],
    ["Rotate Clockwise", "顺时针旋转"],
    ["Rotate Counterclockwise", "逆时针旋转"],
    ["Previous Page", "上一页"],
    ["Next Page", "下一页"],
    ["First Page", "第一页"],
    ["Last Page", "最后一页"],
    ["Binary file", "二进制文件"],
    ["Binary file not shown", "二进制文件无法直接显示"],
    ["Binary file cannot be displayed.", "二进制文件无法直接预览。"],
    ["File is too large to display", "文件过大，无法直接显示"],
    ["File is too large to preview.", "文件过大，无法预览。"],
    ["Open Anyway", "仍然打开"],
    ["Changes Overview", "更改概览"],
    ["Staged Changes", "已暂存更改"],
    ["Unstaged Changes", "未暂存更改"],
    ["Stage File", "暂存此文件"],
    ["Unstage File", "取消暂存此文件"],
    ["Stage All", "全部暂存"],
    ["Unstage All", "全部取消暂存"],
    ["Stage Changes", "暂存更改"],
    ["Unstage Changes", "取消暂存更改"],
    ["Unified View", "统一视图"],
    ["Split View", "并排视图"],
    ["Unified Diff", "统一差异视图"],
    ["Split Diff", "并排差异视图"],
    ["Ignore Whitespace", "忽略空白差异"],
    ["Hide Whitespace", "隐藏空白字符"],
    ["Show Whitespace", "显示空白字符"],
    ["Expand Unchanged Lines", "展开未更改行"],

    // 12.4 全局权限、权限预设与工具权限抽屉全集 (Global Permissions & 9 Tool Permissions)
    ["Global Permissions", "全局权限"],
    ["Project Permissions", "项目权限"],
    ["Workspace Permissions", "工作区权限"],
    ["Conversation Permissions", "对话权限"],
    ["Shared Permissions", "共享权限"],
    ["Permission Preset", "权限预设"],
    ["Permission Presets", "权限预设"],
    ["Tool Permissions", "工具权限"],
    ["Manage Tool Permissions", "管理工具权限"],
    ["Configure Tool Permissions", "配置工具权限"],
    ["Permission Rules", "权限规则"],
    ["Permission Grants", "权限授权"],
    ["Tool Execution Policy", "工具执行策略"],
    ["Internet Access Policy", "网络访问策略"],
    ["File Access Policy", "文件访问策略"],
    ["Non-Workspace File Access", "工作区外文件访问"],
    ["Non-Workspace Files", "工作区外文件"],
    ["External File Access", "外部文件访问"],
    ["External Files", "工作区外文件"],
    ["Workspace Files", "工作区文件"],
    ["Edit Files", "编辑文件"],
    ["Modify Files", "修改文件"],
    ["Create Files", "创建文件"],
    ["Delete Files", "删除文件"],
    ["File Read", "文件读取"],
    ["File Write", "文件写入"],
    ["File Edit", "文件编辑"],
    ["File Delete", "文件删除"],
    ["Run Commands", "运行命令"],
    ["Execute Commands", "执行命令"],
    ["Run Terminal Commands", "运行终端命令"],
    ["Shell Commands", "Shell 命令"],
    ["Background Commands", "后台命令"],
    ["Unsandboxed Commands", "沙盒外命令"],
    ["Outside Sandbox", "沙盒外运行"],
    ["Sandbox Mode", "沙盒模式"],
    ["Terminal Sandbox", "终端沙盒"],
    ["Web Search", "网页搜索"],
    ["Search Web", "搜索网页"],
    ["Web Fetch", "网页抓取"],
    ["Fetch URLs", "抓取 URL"],
    ["Open URLs", "打开 URL"],
    ["Web Access", "网络访问"],
    ["Internet Access", "互联网访问"],
    ["Network Access", "网络访问"],
    ["Browser Actions", "浏览器操作"],
    ["Browser Actuation", "浏览器交互"],
    ["Browser JavaScript", "浏览器脚本执行"],
    ["Use Browser", "使用浏览器"],
    ["External Tools", "外部工具"],
    ["Plugin Tools", "插件工具"],
    ["MCP Tool Calls", "MCP 工具调用"],
    ["Invoke Subagents", "调用子智能体"],
    ["Spawn Subagents", "创建子智能体"],
    ["Image Generation", "图像生成"],
    ["Generate Images", "生成图像"],
    ["Allow List", "允许列表"],
    ["Ask List", "询问列表"],
    ["Deny List", "拒绝列表"],
    ["Command Allowlist", "命令允许列表"],
    ["Command Denylist", "命令拒绝列表"],
    ["Browser Allowlist", "浏览器允许列表"],
    ["Browser Denylist", "浏览器拒绝列表"],
    ["URL Allowlist", "URL 允许列表"],
    ["URL Denylist", "URL 拒绝列表"],
    ["Path Allowlist", "路径允许列表"],
    ["Path Denylist", "路径拒绝列表"],
    ["Deny > Ask > Allow", "拒绝 > 询问 > 允许"],
    ["Precedence: Deny > Ask > Allow", "优先级：拒绝 > 询问 > 允许"],
    ["Add Permission Rule", "添加权限规则"],
    ["Add Pattern", "添加匹配规则"],
    ["Add Path", "添加路径"],
    ["Add Command", "添加命令"],
    ["Add URL", "添加 URL"],
    ["Add Domain", "添加域名"],
    ["Add Tool", "添加工具"],
    ["No permission rules", "暂无权限规则"],
    ["No permissions configured", "暂未配置任何权限"],
    ["No rules added yet", "暂未添加任何规则"],
    ["Revert to Global", "恢复为全局设置"],
    ["Revert to Global Settings", "恢复为全局设置"],
    ["Revert to global settings", "恢复为全局设置"],
    ["Override Global Settings", "覆盖全局设置"],
    ["Inherits Global Permissions", "继承全局权限"],
    ["Using Global Permissions", "正在使用全局权限"],
    ["Reset to Preset", "恢复为预设默认值"],
    ["Auto (Recommended)", "自动（推荐）"],

    // 12.5 快捷键全集深度补完 (Keyboard Shortcuts — 对话移动、侧边面板切换与全局动作)
    ["Move Conversation Up", "上移对话"],
    ["Move Conversation Down", "下移对话"],
    ["Previous Side Panel Tab", "上一个侧边栏标签页"],
    ["Next Side Panel Tab", "下一个侧边栏标签页"],
    ["Side Panel", "侧边面板"],
    ["Toggle Side Panel", "切换侧边面板"],
    ["Open Side Panel", "打开侧边面板"],
    ["Close Side Panel", "关闭侧边面板"],
    ["Hide Side Panel", "隐藏侧边面板"],
    ["Focus Side Panel", "聚焦侧边面板"],
    ["Maximize Side Panel", "最大化侧边面板"],
    ["Toggle Maximize Side Panel", "切换侧边面板最大化"],
    ["New Side Panel Tab", "新建侧边栏标签页"],
    ["Close Side Panel Tab", "关闭侧边栏标签页"],
    ["Reopen Closed Side Panel Tab", "重新打开已关闭的侧边栏标签页"],
    ["Open Overview Tab", "打开概览标签页"],
    ["Open Review Tab", "打开审查标签页"],
    ["Open Files Tab", "打开文件标签页"],
    ["Open Terminal Tab", "打开终端标签页"],
    ["Open Browser Tab", "打开浏览器标签页"],
    ["Open Extensions Tab", "打开扩展标签页"],
    ["Open Subagents Tab", "打开子智能体标签页"],
    ["Move Tab Left", "左移标签页"],
    ["Move Tab Right", "右移标签页"],
    ["Move Pane Left", "左移窗格"],
    ["Move Pane Right", "右移窗格"],
    ["Select First Conversation", "选择第一个对话"],
    ["Select Last Conversation", "选择最后一个对话"],
    ["Open Recent Conversation", "打开最近对话"],
    ["Switch Conversation", "切换对话"],
    ["Search in Conversation", "在对话中搜索"],
    ["Clear Conversation", "清空对话"],
    ["Fork Conversation", "从此处分支对话"],
    ["Branch Conversation", "分支此对话"],
    ["Share Conversation", "分享对话"],
    ["Open Project Settings", "打开项目设置"],
    ["New Standalone Conversation", "新建独立对话"],
    ["Open Automations", "打开自动化面板"],
    ["Open Customizations", "打开自定义设置"],
    ["Open Plugin Marketplace", "打开插件市场"],
    ["Open Extensions", "打开扩展面板"],
    ["Cycle Model", "循环切换模型"],
    ["Next Model", "下一个模型"],
    ["Previous Model", "上一个模型"],
    ["Cycle Reasoning Effort", "切换推理强度"],
    ["Cycle Permission Preset", "切换权限预设"],
    ["Toggle Autonomous Mode", "切换自主模式"],
    ["Toggle Plan Mode", "切换计划模式"],
    ["Attach File to Chat", "添加文件到聊天"],
    ["Submit Message", "发送消息"],
    ["Queue Message", "排队发送消息"],
    ["Edit Last Message", "编辑上一条消息"],
    ["Copy Last Response", "复制最后一条回复"],
    ["Copy Last Code Block", "复制最后一个代码块"],

    // 12.6 侧栏底部反馈、输入框附件、停靠审批卡片、通知音效、无障碍与自定义扩展项
    ["Give Feedback", "提供反馈"],
    ["Give feedback", "提供反馈"],
    ["Share Feedback", "分享反馈"],
    ["Submit Feedback", "提交反馈"],
    ["Help & Feedback", "帮助与反馈"],
    ["Report a Bug", "报告缺陷"],
    ["Report Bug", "报告缺陷"],
    ["Docs & Guides", "文档与指南"],
    ["Join Community", "加入社区"],
    ["Attach File", "添加文件"],
    ["Attach Files", "添加文件"],
    ["Attach Image", "添加图片"],
    ["Attach Folder", "添加文件夹"],
    ["Upload File", "上传文件"],
    ["Upload Files", "上传文件"],
    ["Upload Image", "上传图片"],
    ["Paste from Clipboard", "从剪贴板粘贴"],
    ["Drop files here", "拖拽文件到此处"],
    ["Drop files to attach", "松开以添加附件"],
    ["Drag and drop files here", "拖拽文件到此处上传"],
    ["Unsupported file type", "不支持的文件类型"],
    ["Waiting for approval", "等待批准"],
    ["Waiting for your approval", "等待您的批准"],
    ["Waiting for input", "等待输入"],
    ["Waiting for your input", "等待您的输入"],
    ["Waiting for answer", "等待回答"],
    ["Waiting for your response", "等待您的回复"],
    ["Command requires approval", "命令需要批准"],
    ["File access requires approval", "文件访问需要批准"],
    ["Browser action requires approval", "浏览器操作需要批准"],
    ["MCP tool requires approval", "MCP 工具调用需要批准"],
    ["Always allow in this project", "在此项目中始终允许"],
    ["Always allow globally", "全局始终允许"],
    ["Context Summary", "上下文摘要"],
    ["Compacted Context", "已压缩上下文"],
    ["Context compacted", "上下文已压缩"],
    ["Conversation compacted", "对话已压缩"],
    ["Desktop Notifications", "桌面通知"],
    ["Push Notifications", "推送通知"],
    ["Mobile Push Notifications", "移动端推送通知"],
    ["Notification Sound", "通知提示音"],
    ["Notification Sounds", "通知提示音"],
    ["Notification Volume", "通知音量"],
    ["Sound Volume", "提示音音量"],
    ["Test Sound", "测试提示音"],
    ["Play Test Sound", "试听提示音"],
    ["Completion Sound", "完成提示音"],
    ["When action is needed", "需要您操作时"],
    ["When agent finishes", "智能体完成任务时"],
    ["When in background", "应用处于后台时"],
    ["Screen Reader Mode", "屏幕阅读器模式"],
    ["Reduce Motion", "减弱动态效果"],
    ["Interface Font", "界面字体"],
    ["UI Font", "界面字体"],
    ["System UI", "系统默认字体"],
    ["Show Timestamps", "显示时间戳"],
    ["Relative Timestamps", "相对时间戳"],
    ["Always on", "常驻启用"],
    ["Always On", "常驻启用"],
    ["Model Decision", "由模型决定"],
    ["On Demand", "按需调用"],
    ["Manual Only", "仅手动调用"],
    ["Fix with Agent", "使用智能体修复"],
    ["+ Global", "+ 全局"],
    ["+ Workspace", "+ 工作区"],
    ["+ Project", "+ 项目"],
    ["Additional Options", "更多选项"],
    ["Search in Marketplace", "在扩展市场中搜索"],
    ["Starter Prompts", "示例提示词"],
    ["MCP Apps", "MCP 应用"],
    ["Configure Server", "配置服务器"],
    ["Restart Server", "重启服务器"],
    ["Reconnect Server", "重新连接服务器"],
    ["Failed to start", "启动失败"],
    ["Manage Subscription", "管理订阅"],
    ["Billing & Plan", "账单与套餐"],

    // 12.7 外观 (Appearance)、对话步骤、对比度、聊天宽度与无障碍描述全量补齐 + 半截文本自愈
    ["Optimize the interface and 终端输出 for screen readers.", "针对屏幕阅读器优化界面与终端输出。"],
    ["Optimize the interface and terminal output for screen readers.", "针对屏幕阅读器优化界面与终端输出。"],
    ["Optimize the interface for screen readers.", "针对屏幕阅读器优化界面显示。"],
    ["Conversation Steps", "对话步骤"],
    ["Choose how much detail is shown during a conversation.", "选择对话过程中显示的详细程度。"],
    ["Control how intermediate agent steps and tool calls are displayed.", "控制智能体中间执行步骤和工具调用的展示方式。"],
    ["Chat Width", "聊天宽度"],
    ["Maximum Chat Width", "最大聊天宽度"],
    ["Increase color contrast for better readability.", "提高色彩对比度以增强可读性。"],
    ["Adjust the color contrast of the interface.", "调整界面的色彩对比度。"],
    ["Choose the font family used across the interface.", "选择整个界面使用的字体系列。"],
    ["Choose the font family used in code blocks and editors.", "选择代码块和编辑器中使用的字体系列。"],
    ["Minimize animations and transitions across the interface.", "减少界面中的动画与过渡效果。"],
    ["Customize the look and feel of Antigravity.", "自定义 Antigravity 的视觉外观与交互体验。"],
    ["Configure the visual theme, font, and layout preferences.", "配置视觉主题、字体与界面布局偏好。"],
    ["UI Density", "界面紧凑度"],
    ["UI Scale", "界面缩放比例"],
    ["Interface Scale", "界面缩放比例"],
    ["Code Font Size", "代码字号"],
    ["Editor Font Size", "编辑器字号"],
    ["Terminal Font Size", "终端字号"],
    ["Terminal Font", "终端字体"],
    ["Cursor Style", "光标样式"],
    ["Cursor Blinking", "光标闪烁"],
    ["Smooth Scrolling", "平滑滚动"],
    ["Bracket Pair Colorization", "括号配对着色"],
    ["Render Whitespace", "显示空白字符"],
    ["Sticky Scroll", "粘性滚动"],

    // v68 Antigravity 新版界面布局（Knowledge Work / Software Engineering）、权限重组、工作流、分叉与引导页补全
    ["Interface Layout", "界面布局"],
    ["Knowledge Work", "知识工作"],
    ["Simplified interface for research, writing, and everyday tasks.", "面向研究、写作和日常任务的精简界面。"],
    ["Software Engineering", "软件工程"],
    ["Full interface for coding, developer tools, and managing agents.", "包含编程、开发者工具与智能体管理的完整界面。"],
    ["Project 4K", "Project 4K 精简模式"],
    ["managed by your organization", "由您的组织托管控制"],
    ["Plan Review Policy", "计划审核策略"],
    ["This Computer", "本机"],
    ["Permission Settings", "权限设置"],
    ["Permission Details", "权限详情"],
    ["Inherit Global", "继承全局设置"],
    ["Controls permissions for remote conversations.", "控制远程对话中的智能体权限。"],
    ["Configure what the agent can do in local and remote conversations.", "配置智能体在本地与远程对话中可执行的操作。"],
    ["Learn more about", "进一步了解"],
    ["Modify permissions for file and terminal tools.", "修改文件和终端工具的权限。"],
    ["Configure GitHub access policies.", "配置 GitHub 访问策略。"],
    ["Enable Sandbox Mode", "启用沙盒模式"],
    ["Terminal sandbox is not supported in this environment", "当前环境不支持终端沙盒"],
    ["Checking availability\u2026", "正在检查可用性…"],
    ["Checking availability...", "正在检查可用性..."],
    ["Disabled by organization policy", "已被组织策略禁用"],
    ["Your This Computer setting", "您的本机全局设置"],
    ["Your Remote setting", "您的远程全局设置"],
    ["Inherits your Global Permissions when working on this computer.", "在本机上工作时继承您的全局权限设置。"],
    ["Inherits your Global Permissions when working in this project.", "在此项目中工作时继承您的全局权限设置。"],
    ["Inherits your Global Permissions when working in these conversations.", "在这些对话中工作时继承您的全局权限设置。"],
    ["Inherits your Global Permissions when working remotely.", "在远程环境中工作时继承您的全局权限设置。"],
    ["Useful for typical development with an emphasis on security. It prioritizes safety over speed by requiring manual approval for all terminal commands and files outside the project directory.", "适用于注重安全性的常规开发。此模式安全优先于速度，执行所有终端命令以及访问项目目录以外的文件都需要人工批准。"],
    ["Useful for tasks that require file access across your full machine. The agent has full read and write access to all local files, but all proposed terminal commands require manual review and approval before running.", "适用于需要访问整台计算机文件的任务。智能体对所有本地文件拥有完整的读写权限，但所有拟执行的终端命令在运行前均需人工审核与批准。"],
    ["A high-risk mode that disables all safety barriers. The agent operates with full system access, auto-executes all terminal commands, and reads or writes to all local files without review prompts.", "高风险模式，将禁用所有安全防护屏障。智能体将拥有完整的系统访问权限，自动执行所有终端命令，并在无审核提示的情况下读写所有本地文件。"],
    ["Your agent\u2019s ability to execute commands is also controlled by enterprise security policies.", "智能体执行命令的能力同时受企业安全策略控制。"],
    ["Your agent's ability to execute commands is also controlled by enterprise security policies.", "智能体执行命令的能力同时受企业安全策略控制。"],
    ["Also includes", "同时包含"],
    ["when working in this project.", "，适用于此项目。"],
    ["when working in these conversations.", "，适用于这些对话。"],
    ["This project was created for", "此项目专用于"],
    ["to have the agent generate a plan.", "即可让智能体生成实施计划。"],
    ["Use full VCS clones for Best of N", "为 Best of N 使用完整 VCS 克隆"],
    ["Use full Git clones for Best of N", "为 Best of N 使用完整 Git 克隆"],
    ["Give each Best of N fork a full clone of your workspace, including its local commit history. Choosing a winner then gives your workspace that fork's state, so the commits it made are kept. Forks take longer to create than the default CitC clone.", "为每个 Best of N 分支提供工作区的完整克隆（含本地提交历史）。选定胜出分支后，您的工作区将应用该分支状态并保留其创建的提交。与默认 CitC 克隆相比，创建分支耗时更长。"],
    ["Give each Best of N fork its own clone of your Git repository instead of a copy-on-write overlay. Each fork is then a real repository, so commits it makes are kept when you choose it as the winner. Forks take longer to create, and the wait grows with the size of your repository.", "为每个 Best of N 分支创建独立的 Git 仓库克隆，而非写时复制叠加层。每个分支都是真实仓库，因此选定胜出者后会保留其创建的提交。创建分支耗时更长，且等待时间随仓库体积增大而增加。"],
    ["Sync JJ Worktrees to Head", "将 JJ 工作树同步到 Head"],
    ["Sync newly created JJ worktrees to head when starting a conversation.", "在开始对话时将新建的 JJ 工作树同步到最新提交 (Head)。"],
    ["Try out early-stage features before they ship. These may be changed or removed at any time. These features are experimental, and we make no guarantees about performance or functionality.", "在早期功能正式发布前先行体验。这些功能可能随时更改或移除。这些功能尚处于实验阶段，我们对其性能或功能不做任何保证。"],
    ["Enter to Send", "按 Enter 发送"],
    ["Send messages with the keyboard's Enter key instead of starting a new line.", "使用键盘 Enter 键直接发送消息，而非换行。"],
    ["New Conversation Button", "新建对话按钮"],
    ["Which workspace the New Conversation button and keyboard shortcut start you in.", "设置点击“新建对话”按钮或使用快捷键时默认进入的工作区。"],
    ["Last Workspace", "上次使用的工作区"],
    ["Create a new workspace from your first message.", "根据您的首条消息自动创建新工作区。"],
    ["Start without a workspace, for general questions.", "不关联工作区直接开始，适合通用问答。"],
    ["Reuse your last workspace.", "复用您上次使用的工作区。"],
    ["Chat Layout", "聊天布局"],
    ["Chat Input", "聊天输入"],
    ["Terminal Placement", "终端显示位置"],
    ["Choose where terminal sessions appear.", "选择终端会话窗口的显示位置。"],
    ["Bottom Panel", "底部面板"],
    ["Side Panel Preview", "侧边栏预览"],
    ["Context and Quota Indicator", "上下文与配额指示器"],
    ["Show how full the context window is next to the send button. Click it for a breakdown and to see your model quota.", "在发送按钮旁显示上下文窗口的占用情况。点击可查看明细与模型配额。"],
    ["GitHub Permissions", "GitHub 权限"],
    ["Browser Actuation Permissions", "浏览器操作权限"],
    ["Select your license", "选择您的许可证"],
    ["Organization Allowed Domains (Read-Only)", "组织允许的域名（只读）"],
    ["Hide Advanced Settings", "隐藏高级设置"],
    ["Show Advanced", "显示高级选项"],
    ["Hide Advanced", "隐藏高级选项"],
    ["Remote Agents Data", "远程智能体数据"],
    ["Delete All Remote Agents Data", "删除所有远程智能体数据"],
    ["Delete All Data", "删除所有数据"],
    ["Delete All Remote Agents Data?", "确定要删除所有远程智能体数据吗？"],
    ["Permanently delete your remote conversations, projects, scheduled tasks, connected plugins and settings. Data in the desktop app and your Google account are not affected.", "永久删除您的远程对话、项目、定时任务、已连接插件及设置。桌面端应用和您 Google 账户中的数据不受影响。"],
    ["This permanently deletes all of your Remote Agents conversations, projects, scheduled tasks, connected plugins and settings, and stops any running remote agents. It can't be undone. Data in the desktop app and your Google account are not affected, and you can keep using Remote Agents afterwards.", "此操作将永久删除您所有的远程智能体对话、项目、定时任务、已连接插件和设置，并停止所有正在运行的远程智能体，且无法撤销。桌面端应用和您 Google 账户中的数据不受影响，您之后仍可继续使用远程智能体。"],
    ["Couldn't delete your data. Try again.", "无法删除您的数据，请重试。"],
    ["Checked task", "已检查任务"],
    ["Checking task", "正在检查任务"],
    ["Checked command status", "已检查命令状态"],
    ["Checking command status", "正在检查命令状态"],
    ["User cancelled agent execution.", "用户已取消智能体执行。"],
    ["Fork conversation in this folder", "在此文件夹中分叉对话"],
    ["Keeps working in this folder. Nothing is copied.", "继续在此文件夹中工作，不会复制任何文件。"],
    ["Rewinds the conversation only. Files in this folder stay as they are now.", "仅回退对话记录，此文件夹中的文件保持当前状态不变。"],
    ["Fork in Current Workspace", "在当前工作区中分叉"],
    ["Fork in Shared Workspace", "在共享工作区中分叉"],
    ["Fork in New Workspace", "在新建工作区中分叉"],
    ["Shares this repository, with a working copy of its own. Uncommitted changes stay behind.", "共享此代码仓库并拥有独立工作副本，未提交的更改会保留在原处。"],
    ["A full copy of this workspace, uncommitted changes included.", "创建此工作区的完整副本，包含未提交的更改。"],
    ["A copy of the workspace snapshot recorded at this step.", "创建在此步骤记录的工作区快照副本。"],
    ["Keeps working in this workspace. Nothing is copied.", "继续在此工作区中工作，不会复制任何文件。"],
    ["Rewinds the conversation only. Files in this workspace stay as they are now.", "仅回退对话记录，此工作区中的文件保持当前状态不变。"],
    ["Side Questions", "旁路提问"],
    ["Side Question", "旁路提问"],
    ["No links", "暂无链接"],
    ["No artifacts generated", "暂未生成产物"],
    ["No conversations found", "未找到对话"],
    ["See all", "查看全部"],
    ["Refreshing...", "正在刷新..."],
    ["Deleting...", "正在删除..."],
    ["Downloading...", "正在下载..."],
    ["Build new features", "构建新功能"],
    ["Hand off a feature and come back to working code.", "将功能开发交由智能体处理，直接验收可运行的代码。"],
    ["Debug and fix", "调试与修复"],
    ["Automatically reproduce bugs, trace causes, test fixes.", "自动复现问题、定位根因并验证修复结果。"],
    ["Research anything", "研究任意主题"],
    ["Ask about your code or any topic, get clear answers.", "询问您的代码库或任何主题，获取清晰解答。"],
    ["Write and edit docs", "撰写与编辑文档"],
    ["Draft documents, emails, and notes that sound like you.", "起草符合您个人风格的文档、邮件与笔记。"],
    ["Let's tailor the experience for you. What best describes your work?", "让我们为您量身定制使用体验。以下哪项最符合您的日常工作？"],
    ["Trouble signing in? Enter authorization code", "登录遇到问题？输入授权码"],
    ["Sign in in your browser, then paste the authorization code shown on the callback page.", "请在浏览器中完成登录，然后粘贴回调页面上显示的授权码。"],
    ["Authorization code", "授权码"],
    ["Paste authorization code", "粘贴授权码"],
    ["Submit code", "提交授权码"],
    ["Authorization code was rejected. Paste a fresh code and try again.", "授权码无效或已拒绝，请粘贴新的授权码后重试。"],
    ["Copied sign-in link to clipboard", "已将登录链接复制到剪贴板"],
    ["Switched to authorization code sign-in", "已切换为授权码登录方式"],
    ["Authorization code sign-in is unavailable in this version.", "当前版本不支持授权码登录。"],
    ["Select Theme", "选择主题"],
    ["Use theme to be imported with settings", "使用随设置导入的主题"],
    ["Get Anything Done with", "开启高效工作，携手"],
  ]);

  function formatCompactDuration(text) {
    if (!text) return '';
    return text
      .replace(/(\d+)\s*ms\b/gi, '$1 毫秒')
      .replace(/(\d+)\s*d\b/gi, '$1 天')
      .replace(/(\d+)\s*h\b/gi, '$1 小时')
      .replace(/(\d+)\s*m\b/gi, '$1 分钟')
      .replace(/(\d+)\s*s\b/gi, '$1 秒')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function formatDuration(text) {
    if (!text) return '';
    return text
      .replace(/(\d+)\s*years?/gi, '$1 年')
      .replace(/(\d+)\s*months?/gi, '$1 个月')
      .replace(/(\d+)\s*weeks?/gi, '$1 周')
      .replace(/(\d+)\s*days?/gi, '$1 天')
      .replace(/(\d+)\s*hours?/gi, '$1 小时')
      .replace(/(\d+)\s*minutes?/gi, '$1 分钟')
      .replace(/(\d+)\s*seconds?/gi, '$1 秒')
      .replace(/,\s*/g, ' ')
      .trim();
  }

  function formatRelativeOrInner(raw) {
    if (!raw) return '';
    const t = raw.trim();
    const exact = exactPhrases.get(t) ?? phrasesLower.get(t.toLowerCase());
    if (exact !== undefined) return exact;
    return t
      .replace(/^just now$/i, '刚刚')
      .replace(/^yesterday$/i, '昨天')
      .replace(/^tomorrow$/i, '明天')
      .replace(/^today$/i, '今天')
      .replace(/^never$/i, '从不')
      .replace(/^(\d+)\s*years?\s+ago$/i, '$1 年前')
      .replace(/^(\d+)\s*months?\s+ago$/i, '$1 个月前')
      .replace(/^(\d+)\s*weeks?\s+ago$/i, '$1 周前')
      .replace(/^(\d+)\s*days?\s+ago$/i, '$1 天前')
      .replace(/^(\d+)\s*hours?\s+ago$/i, '$1 小时前')
      .replace(/^(\d+)\s*minutes?\s+ago$/i, '$1 分钟前')
      .replace(/^(\d+)\s*seconds?\s+ago$/i, '$1 秒前')
      .replace(/^(\d+)\s*mo\s+ago$/i, '$1 个月前')
      .replace(/^(\d+)\s*y\s+ago$/i, '$1 年前')
      .replace(/^(\d+)\s*w\s+ago$/i, '$1 周前')
      .replace(/^(\d+)\s*d\s+ago$/i, '$1 天前')
      .replace(/^(\d+)\s*h\s+ago$/i, '$1 小时前')
      .replace(/^(\d+)\s*m\s+ago$/i, '$1 分钟前')
      .replace(/^(\d+)\s*s\s+ago$/i, '$1 秒前')
      .replace(/\(Recommended\)/gi, '(推荐)');
  }

  // ===== 第三级：动态上下文正则替换规则 =====
  const patterns = [
    [/^Version (\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)?)$/gi, '版本 $1'],
    [/^Thought for (\d+)s$/gi, '思考耗时 $1 秒'],
    [/^Thought for (\d+)m$/gi, '思考耗时 $1 分钟'],
    [/^Thought for (\d+)ms$/gi, '思考耗时 $1 毫秒'],
    [/^Worked for (\d+)s$/gi, '已工作 $1 秒'],
    [/^Worked for (\d+)m$/gi, '已工作 $1 分钟'],
    [/^Worked for (\d+)h$/gi, '已工作 $1 小时'],
    [/^Updated (.+)$/gi, (_m, s) => '更新于 ' + formatRelativeOrInner(s)],
    [/^Created (.+)$/gi, (_m, s) => '创建于 ' + formatRelativeOrInner(s)],
    [/^(\d+) files? changed$/gi, '$1 个文件已更改'],
    [/^(\d+) tasks? running$/gi, '$1 个任务运行中'],
    [/^(\d+)tasksrunning$/gi, '$1 个任务运行中'],
    [/^Ran (\d+) commands?$/gi, '已运行 $1 条命令'],
    [/^Explored (\d+) files?$/gi, '已探索 $1 个文件'],
    [/^(\d+) files?, (\d+) searches?$/gi, '$1 个文件，$2 次搜索'],
    [/^(\d+) commands?$/gi, '$1 条命令'],
    [/^(\d+) files?$/gi, '$1 个文件'],
    [/^(\d+) searches?$/gi, '$1 次搜索'],
    [/^Ran (\d+) commands?\nWorking\.\.\.$/gi, '已运行 $1 条命令\n正在处理...'],
    [/^(?:Load older messages|加载更早的消息), showing (\d+) (?:of|的) (\d+)$/gi, '加载更早的消息，显示第 $1 条，共 $2 条'],
    [/^(?:No more older messages|没有更早的消息了|无more older messages), showing (\d+) (?:of|的)\s*(\d+)$/gi, '没有更早的消息了，已显示 $1 / $2 条'],
    [/^Fold lines (\d+-\d+)$/gi, '折叠第 $1 行'],
    [/^Unfold lines (\d+-\d+)$/gi, '展开第 $1 行'],
    [/^Close ([^\s].*\.[A-Za-z0-9]+)$/g, '关闭 $1'],
    [/^关闭([^\s].*\.[A-Za-z0-9]+)$/g, '关闭 $1'],
    [/^Agent permissions preset selector, current: (.+)$/gi, (_m, s) => '智能体权限预设选择器，当前：' + formatRelativeOrInner(s)],
    [/^Select model, current: (.+)$/gi, (_m, s) => '选择模型，当前：' + s.trim().replace(/Gemini ([^(]+) \((Minimal|Low|Medium|High|Max)\)/g, (_m2, model, effort) => 'Gemini ' + model.trim() + ' (' + (exactPhrases.get(effort) ?? effort) + ')')],
    [/· Exited with code (\d+)/g, '· 退出码 $1'],
    [/·Exited与code (\d+)/g, '· 退出码 $1'],
    [/See all \((\d+)\)/g, '查看全部 ($1)'],
    [/(\d+) agents running/g, '$1 个代理正在运行'],
    [/1 agent running/g, '1 个代理正在运行'],
    [/^(\d+)\s*years?\s+ago$/gi, '$1 年前'],
    [/^(\d+)\s*months?\s+ago$/gi, '$1 个月前'],
    [/^(\d+)\s*weeks?\s+ago$/gi, '$1 周前'],
    [/^(\d+)\s*days?\s+ago$/gi, '$1 天前'],
    [/^(\d+)\s*hours?\s+ago$/gi, '$1 小时前'],
    [/^(\d+)\s*minutes?\s+ago$/gi, '$1 分钟前'],
    [/^(\d+)\s*seconds?\s+ago$/gi, '$1 秒前'],
    [/^(\d+)\s*mo\s+ago$/gi, '$1 个月前'],
    [/^(\d+)\s*y\s+ago$/gi, '$1 年前'],
    [/^(\d+)\s*w\s+ago$/gi, '$1 周前'],
    [/^(\d+)\s*d\s+ago$/gi, '$1 天前'],
    [/^(\d+)\s*h\s+ago$/gi, '$1 小时前'],
    [/^(\d+)\s*m\s+ago$/gi, '$1 分钟前'],
    [/^(\d+)\s*s\s+ago$/gi, '$1 秒前'],
    [/\(Recommended\)/gi, '(推荐)'],
    [/^(\d+)mo$/g, '$1 个月前'],
    [/^(\d+)y$/g, '$1 年前'],
    [/^(\d+)w$/g, '$1 周前'],
    [/^(\d+)d$/g, '$1 天前'],
    [/^(\d+)h$/g, '$1 小时前'],
    [/^(\d+)m$/g, '$1 分钟前'],
    [/^(\d+)s$/g, '$1 秒前'],
    [/(\d+(?:\.\d+)?)% of the customization budget is available\./g, '自定义预算还剩 $1%。'],
    [/Your Plan: (.+)/g, (_m, s) => '你的套餐：' + formatRelativeOrInner(s)],
    [/You currently don't have any MCP Servers installed\. 添加 an MCP server above/g, '你当前还没有安装任何 MCP 服务器。请在上方添加 MCP 服务器。'],
    [/Also includes (?:全局设置|global settings) when working in this project\./g, '在此项目中工作时也包含全局设置。'],
    [/Also includes (?:全局设置|global settings)/g, '也包含全局设置'],
    [/(?:了解更多|Learn more) about (.+)/g, (_match, topic) => {
      const clean = topic.trim();
      return '了解关于 ' + clean + (/[\u4e00-\u9fa5]$/.test(clean) ? '的更多信息' : ' 的更多信息');
    }],
    [/Starting (?:the|a|A) (?:project|Project|项目)/g, '启动项目'],
    [/You have used some of your (.+?) limit, it will fully refresh in (.+?)\.?$/gi, (_match, limit, time) => {
      const limitMap = {
        'weekly': '每周', 'Weekly': '每周',
        '5-hour': '5 小时', '5-Hour': '5 小时', 'five-hour': '5 小时', 'Five-hour': '5 小时', 'Five Hour': '5 小时', 'five hour': '5 小时',
        'daily': '每日', 'Daily': '每日',
        'monthly': '每月', 'Monthly': '每月',
        'hourly': '每小时', 'Hourly': '每小时',
      };
      const limitZh = limitMap[limit.trim()] ?? limit.trim();
      return '您已使用部分' + limitZh + '额度，将在 ' + formatDuration(time) + '后完全重置。';
    }],
    [/You have used all of your (.+?) limit, it will fully refresh in (.+?)\.?$/gi, (_match, limit, time) => {
      const limitMap = {
        'weekly': '每周', 'Weekly': '每周',
        '5-hour': '5 小时', '5-Hour': '5 小时', 'five-hour': '5 小时', 'Five-hour': '5 小时', 'Five Hour': '5 小时', 'five hour': '5 小时',
        'daily': '每日', 'Daily': '每日',
        'monthly': '每月', 'Monthly': '每月',
        'hourly': '每小时', 'Hourly': '每小时',
      };
      const limitZh = limitMap[limit.trim()] ?? limit.trim();
      return '您的' + limitZh + '额度已耗尽，将在 ' + formatDuration(time) + '后完全重置。';
    }],
    [/You have not used any of your (.+?) limit\.?/gi, (_match, limit) => {
      const limitMap = {
        'weekly': '每周', 'Weekly': '每周',
        '5-hour': '5 小时', '5-Hour': '5 小时', 'five-hour': '5 小时', 'Five-hour': '5 小时', 'Five Hour': '5 小时', 'five hour': '5 小时',
        'daily': '每日', 'Daily': '每日',
        'monthly': '每月', 'Monthly': '每月',
        'hourly': '每小时', 'Hourly': '每小时',
      };
      const limitZh = limitMap[limit.trim()] ?? limit.trim();
      return '您尚未消耗' + limitZh + '额度。';
    }],
    [/it will fully refresh in (.+?)\.?$/gi, (_match, time) => '将在 ' + formatDuration(time) + '后完全重置。'],
    [/it will refresh in (.+?)\.?$/gi, (_match, time) => '将在 ' + formatDuration(time) + '后刷新。'],
    [/^\(tell the agent what to do instead\)$/g, '（告诉智能体改做什么）'],
    [/Requesting permission to (read access to this path|write access to this path|reading this URL|executing actions on this URL|running this command|running this command outside the sandbox|using this MCP tool) (.+)/g, (_match, action, target) => {
      const actions = {
        'read access to this path': '读取此路径',
        'write access to this path': '写入此路径',
        'reading this URL': '读取此 URL',
        'executing actions on this URL': '在此 URL 上执行操作',
        'running this command': '运行此命令',
        'running this command outside the sandbox': '在沙盒外运行此命令',
        'using this MCP tool': '使用此 MCP 工具',
      };
      return '正在请求权限：' + (actions[action] ?? action) + ' ' + target;
    }],
    [/Agent needs permission to act on (.+)/g, '智能体需要权限才能操作 $1'],
    [/Agent needs permission to execute JavaScript on (.+)/g, '智能体需要权限才能在 $1 上执行 JavaScript'],
    [/Agent needs permission to execute JavaScript/g, '智能体需要权限才能执行 JavaScript'],
    [/Yes, save rule for '([^']+)' when not in a project/g, "是，并在未处于项目时保存 '$1' 的规则"],
    [/Yes, save rule for '([^']+)' in this project/g, "是，并在此项目中保存 '$1' 的规则"],
    [/Yes, save rule for '([^']+)' in this workspace/g, "是，并在此工作区保存 '$1' 的规则"],
    [/Yes, save rule for '([^']+)' globally/g, "是，并全局保存 '$1' 的规则"],
    [/Yes, save rule when not in a project/g, '是，并在未处于项目时保存规则'],
    [/Yes, save rule in this project/g, '是，并在此项目中保存规则'],
    [/Yes, save rule in this workspace/g, '是，并在此工作区保存规则'],
    [/Yes, save rule globally/g, '是，并全局保存规则'],
    [/Yes, and always allow '([^']+)' when not in a project/g, "是，并在未处于项目时始终允许 '$1'"],
    [/Yes, and always allow '([^']+)' in this project/g, "是，并在此项目中始终允许 '$1'"],
    [/Yes, and always allow '([^']+)' in this workspace/g, "是，并在此工作区始终允许 '$1'"],
    [/Yes, and always allow '([^']+)'/g, "是，并始终允许 '$1'"],
    [/Yes, and always allow when not in a project/g, '是，并在未处于项目时始终允许'],
    [/Yes, and always allow in this project/g, '是，并在此项目中始终允许'],
    [/Yes, and always allow in this workspace/g, '是，并在此工作区始终允许'],
    [/Yes, and always allow/g, '是，并始终允许'],
    [/Refreshes in (\d+) hours?, (\d+) minutes?/g, '$1 小时 $2 分钟后刷新'],
    [/Gemini ([^(]+) \((Minimal|Low|Medium|High|Max)\)/g, (_match, model, effort) => 'Gemini ' + model.trim() + ' (' + (exactPhrases.get(effort) ?? effort) + ')'],
    [/Antigravity has been redesigned to put agents first with new capabilities\. If you'd still like a code editor, you can download it as a separate app named Antigravity IDE\./g, 'Antigravity 已重新设计为智能体优先，并加入了新能力。如果你仍然需要代码编辑器，可以下载名为 Antigravity IDE 的独立应用。'],

    // v2.28-v2.29 动态卡片截断、账户状态、工具计数与自动化周期匹配
    [/^Build applications with the Gemini Interactions API and Live API[\s\S]*$/i, '使用 Gemini Interactions API 与 Live API 构建应用，支持多模态生成、托管智能体与实时交互…'],
    [/^Teamwork Graph CLI is Atlassian's agent-first interface[\s\S]*$/i, 'Atlassian 面向智能体的全局工作上下文接口：打通 Jira、Confluence 与 Bitbucket…'],
    [/^Connect Antigravity to Dropbox to search, inspect[\s\S]*$/i, '将 Antigravity 连接到 Dropbox，支持搜索、查看、总结、分享与整理文件…'],
    [/^Build and deploy on Netlify: functions, edge functions[\s\S]*$/i, '在 Netlify 上构建与部署：涵盖云函数、边缘函数、数据库、CDN 与 MCP 服务…'],
    [/^Deploy, configure, monitor, and troubleshoot apps, databases, and infrastructure on Railway[\s\S]*$/i, '在 Antigravity 中通过 Railway 技能与托管 MCP 服务部署、配置和监控应用与基础设施…'],
    [/^Build and deploy web apps and AI agents on Vercel[\s\S]*$/i, '使用 Next.js、AI SDK 技能与官方 Vercel MCP 服务构建和部署 Web 应用与智能体…'],
    [/^Databricks skills for the CLI, Apps, Lakebase[\s\S]*$/i, '提供 Databricks CLI、应用、模型服务、Lakeflow 作业、Spark 流水线与 MCP 连接技能…'],
    [/^Signed in as (.+)$/gi, '已登录为 $1'],
    [/^Connected as (.+)$/gi, '已连接为 $1'],
    [/^Logged in as (.+)$/gi, '已登录为 $1'],
    [/^By ([A-Za-z0-9 _.-]+)$/g, '提供方：$1'],
    [/^(\d+) plugins? installed$/gi, '已安装 $1 个插件'],
    [/^(\d+) plugins? enabled$/gi, '已启用 $1 个插件'],
    [/^(\d+) skills? available$/gi, '$1 个可用技能'],
    [/^(\d+) skills?$/gi, '$1 个技能'],
    [/^(\d+) tools?$/gi, '$1 个工具'],
    [/^(\d+) MCP servers?$/gi, '$1 个 MCP 服务器'],
    [/^(\d+) accounts? connected$/gi, '已连接 $1 个账户'],
    [/^Open (.+) panel$/gi, '打开 $1 面板'],
    [/^Toggle (.+) panel$/gi, '切换 $1 面板'],
    [/^Read (\d+) files?$/gi, '已读取 $1 个文件'],
    [/^Edited (\d+) files?$/gi, '已编辑 $1 个文件'],
    [/^Created (\d+) files?$/gi, '已创建 $1 个文件'],
    [/^Deleted (\d+) files?$/gi, '已删除 $1 个文件'],
    [/^Searched (\d+) files?$/gi, '已搜索 $1 个文件'],
    [/^Ran (\d+) tests?$/gi, '已运行 $1 项测试'],
    [/^(\d+) subagents? running$/gi, '$1 个子智能体运行中'],
    [/^(\d+) subagents? completed$/gi, '$1 个子智能体已完成'],
    [/^(\d+) additions?, (\d+) deletions?$/gi, '新增 $1 行，删除 $2 行'],
    [/^\+(\d+)\s*\/?\s*-(\d+) lines?$/gi, '+$1 / -$2 行'],
    [/^Next run: (.+)$/gi, (_m, s) => '下次运行：' + formatRelativeOrInner(s)],
    [/^Last run: (.+)$/gi, (_m, s) => '上次运行：' + formatRelativeOrInner(s)],
    [/^Every (\d+) minutes?$/gi, '每 $1 分钟'],
    [/^Every (\d+) hours?$/gi, '每 $1 小时'],
    [/^Every (\d+) days?$/gi, '每 $1 天'],
    [/^Thought for (\d+)m (\d+)s$/gi, '思考耗时 $1 分 $2 秒'],
    [/^Worked for (\d+(?:\.\d+)?(?:d|h|m|s|ms)(?:\s+\d+(?:\.\d+)?(?:d|h|m|s|ms))*)\s*·\s*(\d+)\s+updates?$/gi, (_m, dur, n) => '已工作 ' + formatCompactDuration(dur) + ' · ' + n + ' 条更新'],
    [/^Worked for (\d+)m (\d+)s$/gi, '已工作 $1 分 $2 秒'],
    [/^Worked for (\d+(?:\.\d+)?(?:d|h|m|s|ms)(?:\s+\d+(?:\.\d+)?(?:d|h|m|s|ms))+)$/gi, (_m, dur) => '已工作 ' + formatCompactDuration(dur)],
    [/^(\d+)\s*updates?$/gi, '$1 条更新'],
    [/^(\d+)m (\d+)s$/g, '$1 分 $2 秒'],

    // v2.29.0 动态细分详情展开、系统音频设备名、重置倒计时与通用动态计数器
    [/^Show (\d+) breakdowns?$/gi, '显示 $1 项细分详情'],
    [/^Hide (\d+) breakdowns?$/gi, '隐藏 $1 项细分详情'],
    [/^System default \((.+)\)$/gi, '系统默认 ($1)'],
    [/^Default - (.+)$/gi, '默认 - $1'],
    [/^Communications - (.+)$/gi, '通信默认 - $1'],
    [/^Show (\d+) items?$/gi, '显示 $1 项'],
    [/^Hide (\d+) items?$/gi, '隐藏 $1 项'],
    [/^Show (\d+) more$/gi, '显示另外 $1 项'],
    [/^(\d+) more\.\.\.$/gi, '还有 $1 项...'],
    [/^\+(\d+) more$/gi, '另外 $1 项'],
    [/^View all (\d+)$/gi, '查看全部 $1 项'],
    [/^Show all (\d+)$/gi, '显示全部 $1 项'],
    [/^(\d+) selected$/gi, '已选择 $1 项'],
    [/^(\d+) results?$/gi, '$1 个结果'],
    [/^(\d+) matches$/gi, '$1 处匹配'],
    [/^1 match$/gi, '1 处匹配'],
    [/^(\d+) rules?$/gi, '$1 条规则'],
    [/^(\d+) agents?$/gi, '$1 个智能体'],
    [/^(\d+) hooks?$/gi, '$1 个钩子'],
    [/^(\d+) workflows?$/gi, '$1 个工作流'],
    [/^(\d+) automations?$/gi, '$1 个自动化任务'],
    [/^(\d+) conversations?$/gi, '$1 个对话'],
    [/^(\d+) projects?$/gi, '$1 个项目'],
    [/^(\d+) devices?$/gi, '$1 台设备'],
    [/^Resets in (.+?)\.?$/gi, (_match, time) => formatDuration(time) + '后重置'],
    [/^Refreshes in (.+?)\.?$/gi, (_match, time) => formatDuration(time) + '后刷新'],

    // v65 危险区域删除确认、JSX 粗体拆分计数、文件导出格式与快捷键动态匹配
    [/^Permanently delete (.+?) including (\d+) active conversations?(\.?)$/gi, (_m, name, n, dot) => '永久删除“' + name.trim() + '”及其包含的 ' + n + ' 个活跃对话' + (dot ? '。' : '')],
    [/^Permanently delete (.+?) including (\d+) conversations?(\.?)$/gi, (_m, name, n, dot) => '永久删除“' + name.trim() + '”及其包含的 ' + n + ' 个对话' + (dot ? '。' : '')],
    [/^Permanently delete (.+?) including\s*$/gi, (_m, name) => '永久删除“' + name.trim() + '”及其包含的 '],
    [/^Permanently delete\s+$/gi, '永久删除 '],
    [/^Delete (.+?) including\s*$/gi, (_m, name) => '删除“' + name.trim() + '”及其包含的 '],
    [/^Are you sure you want to permanently delete (.+?)\?$/gi, '确定要永久删除“$1”吗？'],
    [/^Are you sure you want to delete (.+?)\?$/gi, '确定要删除“$1”吗？'],
    [/^Are you sure you want to remove (.+?)\?$/gi, '确定要移除“$1”吗？'],
    [/^(\d+) active conversations?(\.?)$/gi, (_m, n, dot) => n + ' 个活跃对话' + (dot ? '。' : '')],
    [/^(\d+) archived conversations?(\.?)$/gi, (_m, n, dot) => n + ' 个已归档对话' + (dot ? '。' : '')],
    [/^(\d+) conversations?\.$/gi, '$1 个对话。'],
    [/^(\d+) active agents?(\.?)$/gi, (_m, n, dot) => n + ' 个活跃智能体' + (dot ? '。' : '')],
    [/^(\d+) active tasks?(\.?)$/gi, (_m, n, dot) => n + ' 个活跃任务' + (dot ? '。' : '')],
    [/^(\d+) folders?(\.?)$/gi, (_m, n, dot) => n + ' 个文件夹' + (dot ? '。' : '')],
    [/^(\d+) workspaces?(\.?)$/gi, (_m, n, dot) => n + ' 个工作区' + (dot ? '。' : '')],
    [/^(\d+) tabs?(\.?)$/gi, (_m, n, dot) => n + ' 个标签页' + (dot ? '。' : '')],
    [/^(\d+) permissions?(\.?)$/gi, (_m, n, dot) => n + ' 项权限' + (dot ? '。' : '')],
    [/^(\d+) extensions?(\.?)$/gi, (_m, n, dot) => n + ' 个扩展' + (dot ? '。' : '')],
    [/^(\d+) plugins?(\.?)$/gi, (_m, n, dot) => n + ' 个插件' + (dot ? '。' : '')],
    [/^(\d+) servers?(\.?)$/gi, (_m, n, dot) => n + ' 个服务器' + (dot ? '。' : '')],
    [/^(\d+) subagents?(\.?)$/gi, (_m, n, dot) => n + ' 个子智能体' + (dot ? '。' : '')],
    [/^(\d+) changes?(\.?)$/gi, (_m, n, dot) => n + ' 处更改' + (dot ? '。' : '')],
    [/^(\d+) lines?(\.?)$/gi, (_m, n, dot) => n + ' 行' + (dot ? '。' : '')],
    [/^Page (\d+) of (\d+)$/gi, '第 $1 / $2 页'],
    [/^Export as ([A-Z0-9]+)$/gi, '导出为 $1'],
    [/^Download as ([A-Z0-9]+)$/gi, '下载为 $1'],
    [/^Save as ([A-Z0-9]+)$/gi, '另存为 $1'],
    [/^Copy as ([A-Za-z0-9+]+)$/gi, '复制为 $1'],
    [/^Switch to (?:Side Panel )?Tab (\d+)$/gi, '切换到第 $1 个标签页'],
    [/^Go to Tab (\d+)$/gi, '前往第 $1 个标签页'],
    [/^Select Tab (\d+)$/gi, '选择第 $1 个标签页'],
    [/^([\d.]+)%\s*of the customization budget is available\.?$/gi, '$1% 的自定义配额预算可用。'],

    // v68 动态规则：工作时长继承说明、实验性功能、引导页标题与 Best of N 短链拼接
    [/^Give each Best of N fork a full clone of your workspace, including its local commit history\. Choosing a winner then gives your workspace that fork's state, so the commits it made are kept\. Forks take longer to create than the default CitC clone\.(?:\s*See (\S+)\.)?$/i, (_m, link) => '为每个 Best of N 分支提供工作区的完整克隆（含本地提交历史）。选定胜出分支后，您的工作区将应用该分支状态并保留其创建的提交。与默认 CitC 克隆相比，创建分支耗时更长。' + (link ? ' 详见 ' + link + '。' : '')],
    [/^Give each Best of N fork its own clone of your Git repository instead of a copy-on-write overlay\. Each fork is then a real repository, so commits it makes are kept when you choose it as the winner\. Forks take longer to create, and the wait grows with the size of your repository\.(?:\s*See (\S+)\.)?$/i, (_m, link) => '为每个 Best of N 分支创建独立的 Git 仓库克隆，而非写时复制叠加层。每个分支都是真实仓库，因此选定胜出者后会保留其创建的提交。创建分支耗时更长，且等待时间随仓库体积增大而增加。' + (link ? ' 详见 ' + link + '。' : '')],
    [/^Inherits your Global Permissions when working (.+?)\.?$/gi, (_m, scope) => {
      const s = scope.trim().toLowerCase();
      if (s === 'on this computer') return '在本机上工作时继承您的全局权限设置。';
      if (s === 'in this project') return '在此项目中工作时继承您的全局权限设置。';
      if (s === 'in these conversations') return '在这些对话中工作时继承您的全局权限设置。';
      if (s === 'remotely') return '在远程环境中工作时继承您的全局权限设置。';
      return '在 ' + scope.trim() + ' 中工作时继承您的全局权限设置。';
    }],
    [/^(.+) \(Experimental\)$/g, (_m, label) => {
      const inner = translate(label);
      return (inner !== label ? inner : label) + '（实验性）';
    }],
    [/^Get Anything Done with (.+)$/g, '使用 $1 高效完成一切任务'],
    [/^Select (.+) Theme$/g, '选择 $1 主题'],
  ];

  // ===== 高性能低内存汉化引擎（O(1) 哈希 + 首词前缀桶扫描，彻底移除超大回溯正则节省 15~30MB V8 JIT 内存） =====
  const isMultiTokenPhrase = (s) => /[\s\/.,:;!?()\-_\u4e00-\u9fa5]/.test(s);

  function toAsciiLowerCode(code) {
    return code >= 65 && code <= 90 ? code + 32 : code;
  }

  function isAlnumCode(code) {
    return (
      (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122)
    );
  }

  function isWhitespaceCode(code) {
    return code === 32 || code === 9 || code === 10 || code === 13 || code === 160;
  }

  const phrasesLower = new Map();
  const phrasePrefixMap = new Map();
  const firstTokenExtract = /^[a-z0-9\u4e00-\u9fa5]+/;

  for (const [k, v] of phrases) {
    const trimmedKey = k.trim();
    const normKey = trimmedKey.replace(/\s+/g, ' ').toLowerCase();
    if (!normKey) continue;
    if (!isMultiTokenPhrase(normKey)) {
      if (!exactPhrases.has(trimmedKey)) exactPhrases.set(trimmedKey, v);
      continue;
    }
    if (!phrasesLower.has(normKey)) {
      phrasesLower.set(normKey, v);
      if (normKey.length <= 180) {
        const fm = normKey.match(firstTokenExtract);
        if (fm) {
          const firstWord = fm[0];
          let bucket = phrasePrefixMap.get(firstWord);
          if (!bucket) {
            bucket = [];
            phrasePrefixMap.set(firstWord, bucket);
          }
          bucket.push({
            normKey,
            target: v,
            endsAlnum: isAlnumCode(normKey.charCodeAt(normKey.length - 1))
          });
        }
      }
    }
  }
  // 立即释放原始重复 Map 内存，仅保留归一化单份哈希与轻量首词桶索引
  phrases.clear();

  for (const bucket of phrasePrefixMap.values()) {
    if (bucket.length > 1) {
      bucket.sort((a, b) => b.normKey.length - a.normKey.length);
    }
  }

  function matchPhraseAt(value, startIdx, normKey, endsAlnum) {
    const vLen = value.length;
    const kLen = normKey.length;
    let i = startIdx;
    let j = 0;
    while (j < kLen) {
      if (i >= vLen) return -1;
      const kc = normKey.charCodeAt(j);
      if (kc === 32) {
        if (!isWhitespaceCode(value.charCodeAt(i))) return -1;
        while (i < vLen && isWhitespaceCode(value.charCodeAt(i))) i++;
        j++;
      } else {
        if (toAsciiLowerCode(value.charCodeAt(i)) !== kc) return -1;
        i++;
        j++;
      }
    }
    if (endsAlnum && i < vLen && isAlnumCode(value.charCodeAt(i))) return -1;
    return i;
  }

  const tokenScanRegex = /[A-Za-z0-9\u4e00-\u9fa5]+/g;

  function replaceEmbeddedPhrases(value) {
    if (!value || value.length > 260) return value;
    tokenScanRegex.lastIndex = 0;
    let out = '';
    let lastPos = 0;
    let match;
    while ((match = tokenScanRegex.exec(value)) !== null) {
      const startIdx = match.index;
      if (startIdx < lastPos) continue;
      if (startIdx > 0 && isAlnumCode(value.charCodeAt(startIdx - 1)) && isAlnumCode(value.charCodeAt(startIdx))) {
        continue;
      }
      const bucket = phrasePrefixMap.get(match[0].toLowerCase());
      if (!bucket) continue;
      for (let b = 0; b < bucket.length; b++) {
        const entry = bucket[b];
        const endIdx = matchPhraseAt(value, startIdx, entry.normKey, entry.endsAlnum);
        if (endIdx !== -1) {
          out += value.slice(lastPos, startIdx) + entry.target;
          lastPos = endIdx;
          tokenScanRegex.lastIndex = endIdx;
          break;
        }
      }
    }
    return lastPos === 0 ? value : out + value.slice(lastPos);
  }

  const translateCache = new Map();
  const TRANSLATE_CACHE_MAX = 1200;
  const TRANSLATE_CACHE_MAX_LEN = 140;

  function putTranslateCache(key, val) {
    if (key.length > TRANSLATE_CACHE_MAX_LEN) return;
    if (translateCache.size >= TRANSLATE_CACHE_MAX) {
      let evict = 300;
      for (const oldKey of translateCache.keys()) {
        translateCache.delete(oldKey);
        if (--evict <= 0) break;
      }
    }
    translateCache.set(key, val);
  }

  let isPatching = false;

  // ===== 第四级：确定性 UI 复合短语语法引擎（仅匹配完整 2~3 词首字母大写 UI 标签/菜单/动作，100% 拒绝半截中英混杂） =====
  const uiBrandBlocklist = new Set([
    'Google', 'Gemini', 'Claude', 'OpenAI', 'Anthropic', 'Android', 'Chrome', 'Chromium',
    'GitHub', 'GitLab', 'Bitbucket', 'Firebase', 'Vercel', 'Netlify', 'Railway', 'Figma',
    'Canva', 'Linear', 'Jira', 'Confluence', 'Dropbox', 'Looker', 'Databricks', 'Auth0',
    'Jetski', 'Cascade', 'Monaco', 'Jupyter', 'Python', 'Node', 'Docker', 'Apple', 'Microsoft',
    'Windows', 'Linux', 'Mac', 'Ubuntu', 'PowerShell', 'Bash', 'Zsh'
  ]);

  const uiVerbMap = new Map([
    ['Open', '打开'], ['Close', '关闭'], ['View', '查看'], ['Show', '显示'], ['Hide', '隐藏'],
    ['Add', '添加'], ['Create', '创建'], ['New', '新建'], ['Edit', '编辑'], ['Modify', '修改'],
    ['Manage', '管理'], ['Configure', '配置'], ['Delete', '删除'], ['Remove', '移除'],
    ['Clear', '清除'], ['Reset', '重置'], ['Refresh', '刷新'], ['Reload', '重新加载'],
    ['Copy', '复制'], ['Export', '导出'], ['Import', '导入'], ['Download', '下载'], ['Upload', '上传'],
    ['Search', '搜索'], ['Filter', '筛选'], ['Sort', '排序'], ['Select', '选择'], ['Switch', '切换'],
    ['Toggle', '切换'], ['Focus', '聚焦'], ['Enable', '启用'], ['Disable', '禁用'],
    ['Start', '启动'], ['Stop', '停止'], ['Pause', '暂停'], ['Resume', '恢复'], ['Restart', '重启'],
    ['Give', '提供'], ['Send', '发送'], ['Submit', '提交'], ['Share', '分享'], ['Save', '保存'],
    ['Restore', '恢复'], ['Archive', '归档'], ['Unarchive', '取消归档'], ['Pin', '固定'],
    ['Unpin', '取消固定'], ['Duplicate', '复制'], ['Rename', '重命名'], ['Test', '测试'],
    ['Check', '检查'], ['Browse', '浏览'], ['Explore', '探索'], ['Install', '安装'],
    ['Uninstall', '卸载'], ['Connect', '连接'], ['Disconnect', '断开'], ['Reconnect', '重新连接'],
    ['Attach', '添加'], ['Stage', '暂存'], ['Unstage', '取消暂存'], ['Discard', '放弃'],
    ['Accept', '接受'], ['Reject', '拒绝'], ['Approve', '批准'], ['Deny', '拒绝'],
    ['Expand', '展开'], ['Collapse', '折叠'], ['Maximize', '最大化'], ['Minimize', '最小化'],
    ['Mark', '标记为']
  ]);

  const uiModifierMap = new Map([
    ['Global', '全局'], ['Local', '本地'], ['Remote', '远程'], ['Cloud', '云端'],
    ['Project', '项目'], ['Workspace', '工作区'], ['System', '系统'], ['Default', '默认'],
    ['Custom', '自定义'], ['External', '外部'], ['Internal', '内部'], ['Active', '活跃'],
    ['Recent', '最近'], ['Pinned', '已固定'], ['Archived', '已归档'], ['Shared', '共享'],
    ['Personal', '个人'], ['Installed', '已安装'], ['Enabled', '已启用'], ['Disabled', '已禁用'],
    ['Available', '可用'], ['Running', '运行中的'], ['Completed', '已完成的'], ['Failed', '失败的'],
    ['Scheduled', '定时'], ['Paused', '已暂停'], ['All', '所有'], ['Other', '其他'],
    ['More', '更多'], ['Advanced', '高级'], ['General', '常规'], ['Security', '安全'],
    ['Network', '网络'], ['Terminal', '终端'], ['Browser', '浏览器'], ['Voice', '语音'],
    ['Audio', '音频'], ['Microphone', '麦克风'], ['Speaker', '扬声器'], ['Agent', '智能体'],
    ['Subagent', '子智能体'], ['Model', '模型'], ['Tool', '工具'], ['File', '文件'],
    ['Folder', '文件夹'], ['Plugin', '插件'], ['Extension', '扩展'], ['Permission', '权限'],
    ['Notification', '通知'], ['Appearance', '外观'], ['Editor', '编辑器'], ['Code', '代码'],
    ['Conversation', '对话'], ['Chat', '聊天'], ['Automation', '自动化'], ['Shortcut', '快捷键'],
    ['Account', '账户'], ['Device', '设备'], ['Environment', '环境'], ['Sandbox', '沙盒'],
    ['Background', '后台'], ['Desktop', '桌面'], ['Mobile', '移动端'], ['Side', '侧边'],
    ['Bottom', '底部'], ['Left', '左侧'], ['Right', '右侧'], ['Primary', '主'], ['Danger', '危险']
  ]);

  const uiNounMap = new Map([
    ['File', '文件'], ['Files', '文件'], ['Folder', '文件夹'], ['Folders', '文件夹'],
    ['Project', '项目'], ['Projects', '项目'], ['Workspace', '工作区'], ['Workspaces', '工作区'],
    ['Conversation', '对话'], ['Conversations', '对话'], ['Chat', '聊天'], ['Chats', '聊天'],
    ['Agent', '智能体'], ['Agents', '智能体'], ['Subagent', '子智能体'], ['Subagents', '子智能体'],
    ['Model', '模型'], ['Models', '模型'], ['Permission', '权限'], ['Permissions', '权限'],
    ['Preset', '预设'], ['Presets', '预设'], ['Rule', '规则'], ['Rules', '规则'],
    ['Policy', '策略'], ['Policies', '策略'], ['Skill', '技能'], ['Skills', '技能'],
    ['Plugin', '插件'], ['Plugins', '插件'], ['Extension', '扩展'], ['Extensions', '扩展'],
    ['Hook', '钩子'], ['Hooks', '钩子'], ['Server', '服务器'], ['Servers', '服务器'],
    ['Tool', '工具'], ['Tools', '工具'], ['Task', '任务'], ['Tasks', '任务'],
    ['Automation', '自动化'], ['Automations', '自动化'], ['Schedule', '计划'], ['Schedules', '计划'],
    ['Setting', '设置'], ['Settings', '设置'], ['Preference', '偏好设置'], ['Preferences', '偏好设置'],
    ['Shortcut', '快捷键'], ['Shortcuts', '快捷键'], ['Notification', '通知'], ['Notifications', '通知'],
    ['Sound', '提示音'], ['Sounds', '提示音'], ['Volume', '音量'], ['Account', '账户'],
    ['Accounts', '账户'], ['Device', '设备'], ['Devices', '设备'], ['Environment', '环境'],
    ['Environments', '环境'], ['History', '历史记录'], ['Logs', '日志'], ['Cache', '缓存'],
    ['Data', '数据'], ['Output', '输出'], ['Outputs', '输出'], ['Preview', '预览'],
    ['Artifact', '产物'], ['Artifacts', '产物'], ['Document', '文档'], ['Documents', '文档'],
    ['Tab', '标签页'], ['Tabs', '标签页'], ['Pane', '窗格'], ['Panes', '窗格'],
    ['Panel', '面板'], ['Panels', '面板'], ['Window', '窗口'], ['Windows', '窗口'],
    ['Sidebar', '侧边栏'], ['Terminal', '终端'], ['Terminals', '终端'], ['Browser', '浏览器'],
    ['Feedback', '反馈'], ['Usage', '用量'], ['Quota', '配额'], ['Limit', '限额'],
    ['Limits', '限额'], ['Credits', '积分'], ['Options', '选项'], ['Actions', '操作'],
    ['Commands', '命令'], ['Status', '状态'], ['Mode', '模式'], ['View', '视图'],
    ['Viewer', '查看器'], ['Overview', '概览'], ['Summary', '摘要'], ['Details', '详情'],
    ['Access', '访问权限'], ['Allowlist', '允许列表'], ['Denylist', '拒绝列表'],
    ['Sandbox', '沙盒'], ['Theme', '主题'], ['Themes', '主题'], ['Font', '字体'],
    ['Fonts', '字体'], ['Layout', '布局'], ['Width', '宽度'], ['Steps', '步骤'],
    ['Step', '步骤'], ['Zone', '区域'], ['Name', '名称'], ['Title', '标题'],
    ['Path', '路径'], ['Link', '链接'], ['Content', '内容'], ['Context', '上下文'],
    ['Memory', '记忆'], ['Knowledge', '知识库'], ['Changes', '更改'], ['Diff', '差异对比'],
    ['Outline', '大纲'], ['Image', '图片'], ['Images', '图片'], ['Unread', '未读'],
    ['Read', '已读'], ['ID', ' ID'], ['URL', ' URL'], ['CLI', ' CLI'], ['PDF', ' PDF'], ['MCP', ' MCP']
  ]);

  function translateCompoundUiLabel(normTrimmed) {
    if (!normTrimmed || normTrimmed.length > 42) return undefined;
    const parts = normTrimmed.split(' ');
    if (parts.length < 2 || parts.length > 4) return undefined;
    for (const p of parts) {
      if (uiBrandBlocklist.has(p)) return undefined;
    }

    // 方向性动作: Move <Target> Up/Down/Left/Right
    if (parts.length >= 3 && parts[0] === 'Move') {
      const dir = parts[parts.length - 1];
      const dirMap = { Up: '上移', Down: '下移', Left: '左移', Right: '右移' };
      if (dirMap[dir]) {
        const mid = parts.slice(1, -1);
        const midZh =
          mid.length === 1
            ? uiNounMap.get(mid[0])
            : mid.length === 2 && uiModifierMap.has(mid[0]) && uiNounMap.has(mid[1])
              ? uiModifierMap.get(mid[0]) + uiNounMap.get(mid[1])
              : undefined;
        if (midZh) return dirMap[dir] + midZh.trim();
      }
    }

    // 前后切换动作: Next/Previous <Target>
    if ((parts[0] === 'Next' || parts[0] === 'Previous') && parts.length >= 2) {
      const prefix = parts[0] === 'Next' ? '下一个' : '上一个';
      const rest = parts.slice(1);
      if (rest.length === 1 && uiNounMap.has(rest[0])) {
        return prefix + uiNounMap.get(rest[0]);
      }
      if (rest.length === 2 && uiModifierMap.has(rest[0]) && uiNounMap.has(rest[1])) {
        return prefix + uiModifierMap.get(rest[0]) + uiNounMap.get(rest[1]);
      }
      if (
        rest.length === 3 &&
        uiModifierMap.has(rest[0]) &&
        uiNounMap.has(rest[1]) &&
        uiNounMap.has(rest[2])
      ) {
        return prefix + uiModifierMap.get(rest[0]) + uiNounMap.get(rest[1]) + uiNounMap.get(rest[2]);
      }
    }

    // 2 词 Title-Case UI 标签/动作: <Verb|Modifier> <Noun>
    if (parts.length === 2 && /^[A-Z][a-z]+$/.test(parts[0]) && /^(?:[A-Z][a-z]+|ID|URL|CLI|PDF|MCP)$/.test(parts[1])) {
      if (parts[0] === parts[1]) return undefined;
      const w1 = uiVerbMap.get(parts[0]) ?? uiModifierMap.get(parts[0]);
      const w2 = uiNounMap.get(parts[1]);
      if (w1 && w2) return w1 + w2;
    }

    // 3 词 Title-Case UI 动作: <Verb> <Modifier> <Noun>
    if (
      parts.length === 3 &&
      /^[A-Z][a-z]+$/.test(parts[0]) &&
      /^[A-Z][a-z]+$/.test(parts[1]) &&
      /^(?:[A-Z][a-z]+|ID|URL|CLI|PDF|MCP)$/.test(parts[2])
    ) {
      const v = uiVerbMap.get(parts[0]);
      const m = uiModifierMap.get(parts[1]);
      const n = uiNounMap.get(parts[2]);
      if (v && m && n) return v + m + n;
    }

    return undefined;
  }

  const allowedLowerTechTokens = new Set([
    'tokens', 'token', 'agy', 'git', 'npm', 'npx', 'pnpm', 'yarn', 'ssh', 'wsl',
    'http', 'https', 'localhost', 'gemini', 'chrome', 'json', 'yaml', 'html', 'pdf', 'cli', 'mcp'
  ]);

  function hasBrokenMixedSentence(original, candidate) {
    if (candidate === original) return false;
    if (/[\u4e00-\u9fa5]/.test(original)) return false;
    if (!/[\u4e00-\u9fa5]/.test(candidate)) return false;
    const lowerWords = candidate.match(/\b[a-z]{2,}\b/g);
    if (!lowerWords) return false;
    let untranslatedCount = 0;
    for (const w of lowerWords) {
      if (!allowedLowerTechTokens.has(w)) {
        untranslatedCount++;
        if (untranslatedCount >= 3) return true;
      }
    }
    return false;
  }

  function translate(value) {
    if (!value || !/[A-Za-z]/.test(value)) return value;
    const cached = translateCache.get(value);
    if (cached !== undefined) return cached;

    const matchTrim = value.match(/^([\s\u00a0]*)([\s\S]*?)([\s\u00a0]*)$/);
    const leading = matchTrim ? matchTrim[1] : '';
    const trimmed = matchTrim ? matchTrim[2] : value.trim();
    const trailing = matchTrim ? matchTrim[3] : '';
    if (!trimmed) return value;

    const normTrimmed = trimmed.replace(/[\s\u00a0]+/g, ' ');

    // 1. 优先尝试整词/整句 O(1) 哈希匹配（单字严格区分大小写，多词/复合短语自动忽略大小写与折行空白）
    const exactMatch =
      exactPhrases.get(trimmed) ??
      exactPhrases.get(normTrimmed) ??
      (isMultiTokenPhrase(normTrimmed) ? phrasesLower.get(normTrimmed.toLowerCase()) : undefined);

    if (exactMatch !== undefined) {
      const result = leading + exactMatch + trailing;
      putTranslateCache(value, result);
      return result;
    }

    // 2. 上下文动态正则匹配优先，再执行首词桶多词扫描（并拦截长句中只替换个别词导致的半截中英混杂）
    let patterned = value;
    for (const [pattern, target] of patterns) {
      patterned = patterned.replace(pattern, target);
    }

    let next = patterned;
    if (patterned === value) {
      const phraseCandidate = replaceEmbeddedPhrases(value);
      if (phraseCandidate !== value && !hasBrokenMixedSentence(value, phraseCandidate)) {
        next = phraseCandidate;
        for (const [pattern, target] of patterns) {
          next = next.replace(pattern, target);
        }
      }
    }

    // 3. 确定性 2~3 词 UI 语法兜底（覆盖新版本动态组合按钮/标题/菜单，零混杂风险）
    if (next === value) {
      const compound = translateCompoundUiLabel(normTrimmed);
      if (compound !== undefined) {
        next = leading + compound + trailing;
      }
    }

    putTranslateCache(value, next);
    return next;
  }

  // 属性翻译安全排除（仅排除脚本、样式、终端、代码编辑器及显式声明不翻译的节点，允许 input/textarea 翻译 placeholder 等属性）
  const ATTR_SKIP_SELECTOR = [
    'script', 'style', '.xterm', '.monaco-editor', '.cm-editor',
    '[translate="no"]', '.notranslate'
  ].join(', ');

  // 严格安全边界过滤：保护 AI 回答正文、用户消息、Markdown 渲染块、代码查看器、文件路径、快捷键与 Lexical 斜杠输入区不被篡改
  // 注意：放开普通下拉框 (select / role="combobox" / role="listbox") 与工具折叠面板标题，仅精准跳过 Lexical 富文本与自动补全菜单
  const SKIP_SELECTOR = [
    'script', 'style', 'textarea', 'input', 'code', 'pre', 'kbd',
    'a[href^="file:"]', '[data-testid*="file-path"]', '[data-testid*="filepath"]', '[data-testid*="command-text"]',
    '.xterm', '.monaco-editor', '.cm-editor',
    '.code-line', '.line-content', '[data-testid="code-gutter"]',
    '[contenteditable="true"]', '[contenteditable=""]',
    '[role="textbox"]',
    '[data-lexical-editor]', '[data-lexical-text]', '[data-mention-menu]',
    '#typeahead-menu', '[id*="typeahead"]', '[data-testid*="typeahead"]',
    '[aria-label="Typeahead menu"]', '[aria-label="自动补全菜单"]',
    '[data-testid="menu-option-label"]', '[data-testid="menu-option-description"]',
    '[data-testid="agent-input-box"] p.pointer-events-none',
    '[data-testid="agent-input-box"] div.pointer-events-none',
    '[data-testid="agent-input-box"] span.pointer-events-none',
    '[data-testid="planner-response-text"]',
    '[data-testid="user-input-step"]',
    '[data-testid="user-message-bubble"]',
    '[data-testid="voice-user-message"]',
    '[data-testid="voice-agent-message"]',
    '[data-testid="comment-card-text"]',
    '[data-testid="pdf-text-layer"]',
    '[data-testid="breadcrumb-segment"]',
    'nav[aria-label*="breadcrumbs"] *',
    'nav[aria-label*="面包屑"] *',
    '.md-divider-spacing', '.markdown-frontmatter', '.prose', '.markdown', '.cursor-edit',
    '[translate="no"]', '.notranslate'
  ].join(', ');

  const observedRoots = new WeakSet();
  const skipElementCache = new WeakMap();
  const attrSkipCache = new WeakMap();

  function shouldSkipElement(element) {
    if (!element) return true;
    const cached = skipElementCache.get(element);
    if (cached !== undefined) return cached;
    const skipped = !!element.closest?.(SKIP_SELECTOR);
    skipElementCache.set(element, skipped);
    return skipped;
  }

  function shouldSkip(node) {
    if (!node) return true;
    if (node.nodeType === Node.DOCUMENT_NODE || node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) return false;
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return shouldSkipElement(element);
  }

  const FILE_TREE_SECTION_HEADERS = new Set([
    'Workspace', 'Workspaces', 'Project', 'Projects', 'Artifacts', 'Uploads',
    'Sources', 'Overview', 'Changes', 'Staged', 'Unstaged', 'Recent', 'Files'
  ]);

  function hasLeadingIconInRow(node) {
    if (!node) return false;
    const isIconCarrier = (el) =>
      el &&
      el.nodeType === Node.ELEMENT_NODE &&
      (el.tagName === 'SVG' || el.tagName === 'IMG' || !!el.querySelector?.('svg, img'));
    let cur = node.previousSibling;
    while (cur) {
      if (isIconCarrier(cur)) return true;
      cur = cur.previousSibling;
    }
    const parent = node.parentElement;
    if (parent && (parent.tagName === 'SPAN' || parent.tagName === 'DIV')) {
      let pPrev = parent.previousElementSibling;
      while (pPrev) {
        if (isIconCarrier(pPrev)) return true;
        pPrev = pPrev.previousElementSibling;
      }
    }
    return false;
  }

  function translateElement(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return;
    let skipAttr = attrSkipCache.get(element);
    if (skipAttr === undefined) {
      skipAttr = !!element.closest?.(ATTR_SKIP_SELECTOR);
      attrSkipCache.set(element, skipAttr);
    }
    if (skipAttr) return;
    const inFileTree = !!element.closest?.('[data-testid="tab-file-tree-sidebar"]');
    for (const attr of ['aria-label', 'title', 'placeholder', 'alt']) {
      const value = element.getAttribute?.(attr);
      if (!value || !/[A-Za-z]/.test(value)) continue;
      if (inFileTree && attr !== 'placeholder') {
        const normAttr = value.replace(/[\s\u00a0]+/g, ' ').trim();
        if (!isMultiTokenPhrase(normAttr) || !phrasesLower.has(normAttr.toLowerCase())) continue;
      }
      const translated = translate(value);
      if (translated !== value) {
        element.setAttribute(attr, translated);
      }
    }
  }

  function inspectNestedRoot(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return;
    if (element.shadowRoot) {
      ensureSlashStyle(element.shadowRoot);
      observeRoot(element.shadowRoot);
      translateNode(element.shadowRoot);
    }
    if (element.tagName === 'IFRAME') {
      try {
        const doc = element.contentDocument;
        if (doc && doc.documentElement) {
          doc.documentElement.lang = 'zh-CN';
          ensureSlashStyle(doc.head || doc.documentElement);
          observeRoot(doc.documentElement);
          translateNode(doc.body || doc.documentElement);
        }
      } catch {}
      if (!element.__antigravityIframeBound) {
        element.__antigravityIframeBound = true;
        element.addEventListener('load', () => {
          safeTranslate(() => inspectNestedRoot(element));
        });
      }
    }
  }

  function translateInlineConnector(node, raw) {
    const prev = node.previousSibling;
    const next = node.nextSibling;
    const isInlineRichChild = (el) =>
      el &&
      el.nodeType === Node.ELEMENT_NODE &&
      (el.tagName === 'A' ||
        el.tagName === 'BUTTON' ||
        el.tagName === 'STRONG' ||
        el.tagName === 'B' ||
        el.tagName === 'SPAN');
    if (!isInlineRichChild(prev) && !isInlineRichChild(next)) return raw;
    if (/^,\s*or\s*$/i.test(raw)) return '，或 ';
    if (/^\s+or\s+$/i.test(raw)) return ' 或 ';
    if (/^,\s*and\s*$/i.test(raw)) return '，以及 ';
    if (/^\s+and\s+$/i.test(raw)) return ' 与 ';
    if (/^\s+including\s*$/i.test(raw)) return ' 及其包含的 ';
    if (raw === '.' && isInlineRichChild(prev) && /[\u4e00-\u9fa5]$/.test((prev.textContent || '').trim())) {
      return '。';
    }
    return raw;
  }

  const UI_CJK_SPACE_HEAL_SELECTOR =
    'button, [role="button"], [role="menuitem"], [role="tab"], [role="option"], label, h1, h2, h3, h4';

  function healAdjacentCjkSpace(node) {
    const parent = node.parentElement;
    if (!parent || !parent.closest?.(UI_CJK_SPACE_HEAL_SELECTOR)) return;
    const val = node.nodeValue || '';
    if (/^[ \t]*[\u4e00-\u9fa5]/.test(val)) {
      if (/^[ \t]+[\u4e00-\u9fa5]/.test(val)) {
        const prevText = (node.previousSibling?.textContent || '').trim();
        if (/[\u4e00-\u9fa5]$/.test(prevText)) {
          node.nodeValue = val.replace(/^[ \t]+/, '');
        }
      }
      const prev = node.previousSibling;
      if (prev && prev.nodeType === Node.TEXT_NODE) {
        if (/[\u4e00-\u9fa5][ \t]+$/.test(prev.nodeValue || '')) {
          prev.nodeValue = prev.nodeValue.replace(/[ \t]+$/, '');
        } else if (/^[ \t]+$/.test(prev.nodeValue || '')) {
          const prevPrevText = (prev.previousSibling?.textContent || '').trim();
          if (/[\u4e00-\u9fa5]$/.test(prevPrevText)) {
            prev.nodeValue = '';
          }
        }
      } else if (parent.tagName === 'SPAN' && parent.previousSibling?.nodeType === Node.TEXT_NODE) {
        const gap = parent.previousSibling;
        if (/^[ \t]+$/.test(gap.nodeValue || '')) {
          const beforeGap = (gap.previousSibling?.textContent || '').trim();
          if (/[\u4e00-\u9fa5]$/.test(beforeGap)) {
            gap.nodeValue = '';
          }
        }
      }
    }
    if (/[\u4e00-\u9fa5][ \t]+$/.test(node.nodeValue || '')) {
      const nextText = (node.nextSibling?.textContent || '').trim();
      if (/^[\u4e00-\u9fa5]/.test(nextText)) {
        node.nodeValue = node.nodeValue.replace(/[ \t]+$/, '');
      }
    }
  }

  function translateTextNode(node) {
    const raw = node.nodeValue || '';
    if (!raw.trim()) return;
    const parentEl = node.parentElement;
    if (parentEl && parentEl.closest?.('[data-testid="plan-command-fyi-alert"]')) {
      const mTrim = raw.match(/^([\s\u00a0]*)([\s\S]*?)([\s\u00a0]*)$/);
      const lead = mTrim ? mTrim[1] : '';
      const core = mTrim ? mTrim[2] : raw.trim();
      const trail = mTrim ? mTrim[3] : '';
      if (core === 'Type' || core === '类型') {
        node.nodeValue = lead + '输入' + trail;
        return;
      }
      if (core === 'and select') {
        node.nodeValue = lead + '并选择' + trail;
        return;
      }
      if (core === 'to have the agent generate a plan.') {
        node.nodeValue = lead + '即可让智能体生成实施计划。' + trail;
        return;
      }
    }
    if (parentEl) {
      const t = raw.trim();
      if (t === 'when working' || t === 'in this project' || t === 'in these conversations' || t === '.') {
        const prevText = (node.previousSibling?.nodeValue || node.previousSibling?.textContent || '').trim();
        if (t === '.' && /^(?:此项目|这些对话)$/.test(prevText)) {
          node.nodeValue = '。';
          return;
        }
        if (t !== '.' && /Global Permissions|全局权限/.test(parentEl.textContent || '')) {
          const mTrim = raw.match(/^([\s\u00a0]*)([\s\S]*?)([\s\u00a0]*)$/);
          const lead = mTrim ? mTrim[1] : '';
          const trail = mTrim ? mTrim[3] : '';
          if (t === 'when working') {
            node.nodeValue = '，适用于';
            return;
          }
          if (t === 'in this project') {
            node.nodeValue = lead + '此项目' + trail;
            return;
          }
          if (t === 'in these conversations') {
            node.nodeValue = lead + '这些对话' + trail;
            return;
          }
        }
      }
    }
    if (raw === '.') {
      const punct = translateInlineConnector(node, raw);
      if (punct !== raw) node.nodeValue = punct;
      return;
    }
    if (/[\u4e00-\u9fa5]/.test(raw) && !/[A-Za-z]/.test(raw)) {
      healAdjacentCjkSpace(node);
      return;
    }
    if (!/[A-Za-z]/.test(raw)) return;

    const parent = node.parentElement;
    if (parent && parent.closest?.('[data-testid="tab-file-tree-sidebar"]')) {
      if (hasLeadingIconInRow(node)) return;
      const norm = raw.replace(/[\s\u00a0]+/g, ' ').trim();
      const isAllowedHeader = FILE_TREE_SECTION_HEADERS.has(norm);
      const isAllowedPhrase = isMultiTokenPhrase(norm) && phrasesLower.has(norm.toLowerCase());
      if (!isAllowedHeader && !isAllowedPhrase) return;
    }

    const connectorFixed = translateInlineConnector(node, raw);
    if (connectorFixed !== raw) {
      node.nodeValue = connectorFixed;
      return;
    }
    const translated = translate(raw);
    if (translated !== raw) {
      node.nodeValue = translated;
      healAdjacentCjkSpace(node);
    }
  }

  function translateNode(root) {
    if (!root) return;
    if (root.nodeType === Node.ELEMENT_NODE && (root.tagName === 'INPUT' || root.tagName === 'TEXTAREA')) {
      translateElement(root);
      return;
    }
    if (shouldSkip(root)) return;
    if (root.nodeType === Node.TEXT_NODE) {
      translateTextNode(root);
      return;
    }
    if (
      root.nodeType !== Node.ELEMENT_NODE &&
      root.nodeType !== Node.DOCUMENT_NODE &&
      root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE
    ) {
      return;
    }
    if (root.nodeType === Node.ELEMENT_NODE) {
      translateElement(root);
      inspectNestedRoot(root);
    }
    const ownerDoc = root.ownerDocument || document;
    const walker = ownerDoc.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeType === Node.ELEMENT_NODE && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA')) {
        translateElement(node);
        continue;
      }
      if (shouldSkip(node)) continue;
      if (node.nodeType === Node.TEXT_NODE) {
        translateTextNode(node);
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        translateElement(node);
        inspectNestedRoot(node);
      }
    }
  }

  function safeTranslate(fn) {
    if (isPatching) return;
    isPatching = true;
    try {
      fn();
    } finally {
      isPatching = false;
    }
  }

  // ===== 侧边栏历史英文对话标题温和翻译（彻底移除介词/连词/冠词硬翻，仅针对明确实词） =====
  const titleWordDict = new Map([
    ["Setup", "设置"], ["Clean", "清理"], ["Cleanup", "清理"], ["Drive", "驱动器"], ["Program", "程序"],
    ["Desktop", "桌面端"], ["Review", "审查"], ["Guide", "指南"], ["Skill", "技能"], ["Remover", "去除器"],
    ["Remove", "移除"], ["Watermark", "水印"], ["Optimization", "优化"], ["Optimize", "优化"], ["Frontend", "前端"],
    ["Backend", "后端"], ["Analysis", "分析"], ["Analyze", "分析"], ["Style", "样式"], ["Request", "请求"],
    ["Answer", "回答"], ["Learning", "学习"], ["Learn", "学习"], ["Running", "运行中"], ["Proxy", "代理"],
    ["Image", "图片"], ["Generation", "生成"], ["Generator", "生成器"], ["Music", "音乐"], ["Player", "播放器"],
    ["Helper", "辅助"], ["Assistant", "助手"], ["Inspector", "检查器"], ["Worker", "工作线程"], ["Service", "服务"],
    ["Server", "服务器"], ["Client", "客户端"], ["Storage", "存储"], ["Cache", "缓存"], ["Database", "数据库"],
    ["Manager", "管理器"], ["Management", "管理"], ["Auto", "自动"], ["Automated", "自动化"], ["Approval", "审批"],
    ["Approve", "批准"], ["Remote", "远程"], ["Agent", "智能体"], ["Agents", "智能体"], ["Scheme", "方案"],
    ["Solution", "解决方案"], ["Protocol", "协议"], ["Tool", "工具"], ["Tools", "工具"], ["Plugin", "插件"],
    ["Workflow", "工作流"], ["Basic", "基础"], ["Simple", "简单"], ["Quick", "快速"], ["Advanced", "高级"],
    ["New", "新建"], ["Create", "创建"], ["Update", "更新"], ["Delete", "删除"], ["Fix", "修复"],
    ["Debug", "调试"], ["Test", "测试"], ["Testing", "测试"], ["Install", "安装"], ["Config", "配置"],
    ["Configure", "配置"], ["Configuration", "配置"], ["Implementation", "实现"], ["Implement", "实现"],
    ["Build", "构建"], ["Deploy", "部署"], ["Deployment", "部署"], ["Migration", "迁移"], ["Migrate", "迁移"],
    ["Refactor", "重构"], ["Refactoring", "重构"], ["Research", "研究"], ["Explore", "探索"], ["Exploration", "探索"],
    ["Design", "设计"], ["Plan", "计划"], ["Planning", "规划"], ["Architecture", "架构"], ["Structure", "结构"],
    ["Feature", "功能"], ["Function", "函数"], ["Functionality", "功能"], ["Component", "组件"], ["Module", "模块"],
    ["System", "系统"], ["Platform", "平台"], ["Framework", "框架"], ["Application", "应用"], ["App", "应用"],
    ["Interface", "接口"], ["Fullstack", "全栈"], ["Web", "网页"], ["Mobile", "移动端"], ["User", "用户"],
    ["Admin", "管理员"], ["Dashboard", "仪表盘"], ["Login", "登录"], ["Auth", "认证"], ["Authentication", "认证"],
    ["Authorization", "授权"], ["Permission", "权限"], ["Security", "安全"], ["Error", "错误"], ["Bug", "缺陷"],
    ["Issue", "问题"], ["Problem", "问题"], ["Resolution", "解决"], ["Help", "帮助"], ["Support", "支持"],
    ["Tutorial", "教程"], ["Documentation", "文档"], ["Docs", "文档"], ["Code", "代码"], ["Script", "脚本"],
    ["File", "文件"], ["Files", "文件"], ["Folder", "文件夹"], ["Directory", "目录"], ["Path", "路径"],
    ["Page", "页面"], ["Pages", "页面"], ["Route", "路由"], ["Router", "路由器"], ["Theme", "主题"],
    ["Layout", "布局"], ["Form", "表单"], ["Input", "输入"], ["Output", "输出"], ["Button", "按钮"],
    ["Menu", "菜单"], ["Modal", "弹窗"], ["Table", "表格"], ["List", "列表"], ["Grid", "网格"],
    ["Chart", "图表"], ["Graph", "图形"], ["Icon", "图标"], ["Logo", "标志"], ["Avatar", "头像"],
    ["Text", "文本"], ["Content", "内容"], ["Data", "数据"], ["Model", "模型"], ["Machine", "机器"],
    ["Training", "训练"], ["Inference", "推理"], ["Chat", "聊天"], ["Message", "消息"], ["Notification", "通知"],
    ["Email", "邮件"], ["Alert", "警告"], ["Warning", "警告"], ["Report", "报告"], ["Log", "日志"],
    ["History", "历史"], ["Search", "搜索"], ["Filter", "筛选"], ["Sort", "排序"], ["Export", "导出"],
    ["Import", "导入"], ["Upload", "上传"], ["Download", "下载"], ["Sync", "同步"], ["Backup", "备份"],
    ["Restore", "恢复"], ["Reset", "重置"], ["Clear", "清除"], ["Add", "添加"], ["Edit", "编辑"],
    ["Save", "保存"], ["Refresh", "刷新"], ["Open", "打开"], ["Close", "关闭"], ["Show", "显示"],
    ["Hide", "隐藏"], ["Enable", "启用"], ["Disable", "禁用"], ["Start", "启动"], ["Stop", "停止"],
    ["Pause", "暂停"], ["Resume", "恢复"], ["Restart", "重启"], ["Cancel", "取消"], ["Confirm", "确认"],
    ["Connect", "连接"], ["Disconnect", "断开"], ["Connection", "连接"], ["Network", "网络"], ["Response", "响应"],
    ["Header", "头部"], ["Footer", "底部"], ["Sidebar", "侧边栏"], ["Navigation", "导航"], ["Tab", "标签"],
    ["Panel", "面板"], ["Window", "窗口"], ["Dialog", "对话框"], ["Popup", "弹出窗口"], ["Tooltip", "提示"],
    ["Progress", "进度"], ["Loading", "加载中"], ["Pending", "待处理"], ["Complete", "完整"], ["Completed", "已完成"],
    ["Done", "完成"], ["Success", "成功"], ["Failure", "失败"], ["Failed", "失败"], ["Status", "状态"],
    ["State", "状态"], ["Event", "事件"], ["Action", "操作"], ["Task", "任务"], ["Job", "作业"],
    ["Process", "进程"], ["Thread", "线程"], ["Queue", "队列"], ["Memory", "内存"], ["Local", "本地"],
    ["Cloud", "云"], ["Environment", "环境"], ["Performance", "性能"], ["Benchmark", "基准测试"],
    ["Monitor", "监控"], ["Monitoring", "监控"], ["Version", "版本"], ["Release", "发布"], ["Upgrade", "升级"],
    ["Patch", "补丁"], ["Change", "变更"], ["Changes", "变更"], ["Repository", "仓库"], ["Repo", "仓库"],
    ["Package", "包"], ["Extension", "扩展"], ["Widget", "小部件"], ["Library", "库"], ["Port", "端口"],
    ["Host", "主机"], ["Domain", "域名"], ["Session", "会话"], ["Credential", "凭证"], ["Certificate", "证书"],
    ["Gateway", "网关"], ["Cluster", "集群"], ["Container", "容器"], ["Integration", "集成"], ["Pipeline", "流水线"],
    ["Automation", "自动化"], ["Scheduler", "调度器"], ["Sandbox", "沙盒"], ["Localization", "本地化"],
    ["Localize", "本地化"], ["Translation", "翻译"], ["Translate", "翻译"], ["Language", "语言"],
    ["Chinese", "中文"], ["English", "英文"], ["Greeting", "问候"], ["Welcome", "欢迎"], ["Overview", "概述"],
    ["Summary", "摘要"], ["Detail", "详情"], ["Details", "详情"], ["Description", "描述"], ["Title", "标题"],
    ["Project", "项目"], ["Workspace", "工作区"], ["Setting", "设置"], ["Settings", "设置"], ["Option", "选项"],
    ["Options", "选项"], ["Context", "上下文"], ["Prompt", "提示词"], ["Prompts", "提示词"], ["Conversation", "对话"],
    ["Discussion", "讨论"], ["Question", "问题"], ["Feedback", "反馈"], ["Refinement", "优化"],
    ["Improvement", "改进"], ["Enhancement", "增强"], ["Comparison", "比较"], ["Evaluation", "评估"],
    ["Suggestion", "建议"], ["Instruction", "指令"], ["Command", "命令"], ["Execution", "执行"],
    ["Source", "源码"], ["Target", "目标"], ["Troubleshoot", "故障排除"], ["Troubleshooting", "故障排除"],
    ["Diagnostic", "诊断"], ["Diagnostics", "诊断"], ["Repair", "修复"], ["Recovery", "恢复"],
    ["Policy", "策略"], ["Rule", "规则"], ["Rules", "规则"], ["Quota", "配额"], ["Subscription", "订阅"],
    ["Plugins", "插件"], ["Skills", "技能"], ["Hook", "钩子"], ["Hooks", "钩子"], ["Voice", "语音"],
    ["Notebook", "笔记本"], ["Marketplace", "市场"], ["Preview", "预览"], ["Device", "设备"], ["Devices", "设备"],
    ["Subagent", "子智能体"], ["Subagents", "子智能体"], ["Schedule", "调度"], ["Scheduled", "定时"], ["Automations", "自动化"],
  ]);

  const skipWords = new Set(['the', 'a', 'an', 'The', 'A', 'An']);

  function translateTitle(text) {
    if (!text || typeof text !== 'string') return text;
    const trimmed = text.trim();
    if (/[\u4e00-\u9fa5]/.test(trimmed)) return text;
    if (trimmed.length < 3) return text;
    if (!/[A-Za-z]/.test(trimmed)) return text;
    if (/^[\/\\~.]|:\/\/|[{}\\(\)<>]|^\$|^\x60/.test(trimmed)) return text;

    const words = trimmed.split(/\s+/);
    const tokens = [];
    let translatedCount = 0;

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const match = word.match(/^([A-Za-z0-9\-]+)([^A-Za-z0-9]*)$/);
      if (!match) {
        tokens.push({ text: word, isEnglish: /[A-Za-z0-9]/.test(word) });
        continue;
      }
      const [, w, punct] = match;
      if (skipWords.has(w) && i === 0) {
        continue;
      }
      const dictEntry = titleWordDict.get(w);
      if (dictEntry) {
        tokens.push({ text: dictEntry + punct, isEnglish: false });
        translatedCount++;
      } else {
        tokens.push({ text: word, isEnglish: true });
      }
    }

    // 只有当标题中至少有 60% 以上的实词被命中时才进行标题翻译，彻底杜绝中英夹杂的散装半截标题
    if (translatedCount === 0 || translatedCount / words.length < 0.6) return text;

    let result = '';
    for (let i = 0; i < tokens.length; i++) {
      const cur = tokens[i];
      if (i > 0) {
        const prev = tokens[i - 1];
        if (prev.isEnglish && cur.isEnglish) {
          result += ' ';
        }
      }
      result += cur.text;
    }
    return result || text;
  }

  function isConversationTitle(element) {
    if (element.tagName !== 'SPAN') return false;
    const cls = typeof element.className === 'string' ? element.className : '';
    if (cls.includes('truncate') && cls.includes('text-left')) {
      return !!element.closest('[data-testid="conversation-row-sidebar"]');
    }
    return false;
  }

  function translateConversationTitles() {
    const rows = document.querySelectorAll('[data-testid="conversation-row-sidebar"]');
    for (const row of rows) {
      const titleSpans = row.querySelectorAll ? row.querySelectorAll('span.truncate') : [];
      for (const span of titleSpans) {
        const text = span.textContent || '';
        if (!text.trim()) continue;
        if (!/[\u4e00-\u9fa5]/.test(text) && /[A-Za-z]{2,}/.test(text)) {
          const translated = translateTitle(text);
          if (translated !== text) span.textContent = translated;
        }
      }
    }
  }

  // ===== 弹出层、斜杠命令与输入框 Placeholder 零侵入 CSS 汉化支持 =====
  const SLASH_CSS = [
    '[data-testid="menu-option-label"][data-zh-suffix]::after { content: attr(data-zh-suffix); color: var(--muted-foreground, rgba(128, 128, 128, 0.8)); font-size: 11px; font-weight: normal; margin-left: 4px; pointer-events: none; }',
    '[data-testid="menu-option-description"][data-zh-desc] { font-size: 0 !important; }',
    '[data-testid="menu-option-description"][data-zh-desc]::after { content: attr(data-zh-desc); font-size: 12px !important; line-height: normal; }',
    '[data-testid="agent-input-box"] :is(p, div, span).pointer-events-none[data-zh-placeholder] { font-size: 0 !important; }',
    '[data-testid="agent-input-box"] :is(p, div, span).pointer-events-none[data-zh-placeholder]::after { content: attr(data-zh-placeholder); font-size: 0.875rem !important; line-height: 1.25rem !important; }'
  ].join('\n');

  function ensureSlashStyle(rootContainer) {
    const container = rootContainer || document.head || document.documentElement;
    if (!container || !container.querySelector) return;
    let style = container.querySelector('#antigravity-zh-slash-style');
    if (style && style.dataset.zhReady === '1') return;
    if (!style) {
      const ownerDoc = container.ownerDocument || document;
      style = ownerDoc.createElement('style');
      style.id = 'antigravity-zh-slash-style';
      container.appendChild(style);
    }
    style.textContent = SLASH_CSS;
    style.dataset.zhReady = '1';
  }

  const slashOptionSuffixes = new Map([
    ['btw', ' (快速提问)'],
    ['goal', ' (持续达成目标)'],
    ['schedule', ' (计划调度)'],
    ['browser', ' (浏览器)'],
    ['plan', ' (分步规划)'],
    ['grill-me', ' (方案访谈)'],
    ['teamwork', ' (团队协作)'],
    ['teamwork-preview', ' (团队协作)'],
    ['learn', ' (沉淀技能)'],
    ['boost', ' (深度推理)'],
    ['automation', ' (自动化任务)'],
    ['plugin', ' (插件管理)'],
    ['voice', ' (语音模式)'],
    ['mcp', ' (MCP 服务)'],
    ['model', ' (切换模型)'],
    ['permissions', ' (权限管理)'],
    ['new', ' (新建对话)'],
    ['clear', ' (清空上下文)'],
    ['help', ' (命令帮助)'],
    ['list', ' (技能列表)'],
    ['compact', ' (压缩上下文)'],
    ['review', ' (方案审核)'],
    ['agy-customizations', ' (自定义系统指南)'],
    ['android-cli', ' (Android CLI 工具)'],
    ['android-device-hub', ' (Android 设备中心)'],
    ['antigravity-guide', ' (官方参考手册)'],
    ['compose-preview', ' (Compose 预览)'],
    ['generative_ui', ' (交互式组件)'],
    ['image-gen-api', ' (第三方生图)'],
    ['migrate-workflows', ' (迁移工作流)'],
    ['ui-plugin-navigation', ' (插件面板导航)'],
  ]);

  const slashOptionDescriptions = new Map([
    ['Quick question without interrupting the main conversation flow.', '快速提问，不打断主对话流程。'],
    ['Ask a quick question without interrupting the main conversation.', '快速提问，不打断主对话流程。'],
    ['Run continuously until the specified goal is fully achieved.', '持续运行直到指定目标彻底完成。'],
    ['Run until the specified goal is completely finished.', '持续运行直到指定目标彻底完成。'],
    ['Run an instruction on a schedule or set a timer.', '按周期性计划运行指令或设置为一次性定时器。'],
    ['Run an instruction on a recurring schedule or as a one-time timer.', '按周期性计划运行指令，或设置为一次性定时器。'],
    ['Use browser to perform tasks on the web.', '调用浏览器智能体执行网页自动化任务。'],
    ['Invoke a browser agent for web tasks.', '调用浏览器智能体执行网页自动化任务。'],
    ['Create a step-by-step plan before execution.', '在执行前制定清晰的分步实施方案。'],
    ['Careful step-by-step planning before execution.', '在执行前进行严谨的分步规划。'],
    ['Grill me about an idea or plan.', '对我进行方案交互式访谈，以对齐需求与设计。'],
    ['Interview me to align on a plan.', '对我进行交互式访谈，以对齐方案与需求。'],
    ['Run an autonomous team of agents to solve complex problems.', '调用多智能体团队自主协作处理复杂项目。'],
    ['Invoke a team of agents to autonomously tackle large projects.', '调用多智能体团队自主协作处理大型复杂项目。'],
    ['Review recent successes or corrections to persist as a skill.', '沉淀近期成功经验或修正内容为可复用技能。'],
    ['Reflect on recent successes or corrections to capture reusable skills or rules.', '回顾近期的成功经验或修正内容，沉淀为可复用的技能或规则。'],
    ['Run the Boost multi-agent harness for deep thinking.', '为复杂任务调用 Boost 多智能体编排器进行深度推理。'],
    ['Invoke the Boost multi-agent orchestrator for complex tasks.', '为复杂任务调用 Boost 多智能体编排器。'],
    ['Compact or summarize the conversation context to free up the context window.', '压缩并总结当前对话历史，释放上下文窗口空间。'],
    ['Summarize conversation history to save context window space.', '总结并压缩对话历史以节省上下文空间。'],
    ['Design and create a scheduled background automation.', '交互式设计与创建后台定时自动化任务。'],
    ['Interactive guide to design and create a scheduled background automation.', '交互式设计与创建后台定时自动化任务。'],
    ['Manage, enable, disable, install, or create plugins.', '管理、启用、禁用、安装或创建扩展插件。'],
    ['How to manage and create plugins — namespaced bundles of skills, agents, rules, MCP servers and hooks.', '管理与创建包含技能、智能体、规则、MCP 与钩子的插件包。'],
    ['Clear chat history.', '清空对话历史。'],
    ['Show help information.', '显示命令帮助信息。'],
  ]);

  function translateSlashOptionLabels() {
    ensureSlashStyle();
    const labelEls = document.querySelectorAll('[data-testid="menu-option-label"]');
    for (const el of labelEls) {
      const raw = (el.textContent || '').trim();
      if (slashOptionSuffixes.has(raw)) {
        const suffix = slashOptionSuffixes.get(raw);
        if (el.getAttribute('data-zh-suffix') !== suffix) {
          el.setAttribute('data-zh-suffix', suffix);
        }
      }
    }

    const descEls = document.querySelectorAll('[data-testid="menu-option-description"]');
    for (const el of descEls) {
      const raw = (el.textContent || '').trim();
      const norm = raw.replace(/\s+/g, ' ');
      const desc =
        slashOptionDescriptions.get(raw) ??
        slashOptionDescriptions.get(norm) ??
        exactPhrases.get(raw) ??
        phrasesLower.get(norm.toLowerCase());
      if (desc && desc !== raw) {
        if (el.getAttribute('data-zh-desc') !== desc) {
          el.setAttribute('data-zh-desc', desc);
        }
      }
    }

    // 零侵入汉化 Lexical 输入框 Placeholder（兼容 p / div / span 占位节点）
    const placeholders = document.querySelectorAll('[data-testid="agent-input-box"] :is(p, div, span).pointer-events-none');
    for (const p of placeholders) {
      const raw = (p.textContent || '').trim();
      if (!raw) continue;
      const zh = phrasesLower.get(raw.toLowerCase()) ?? exactPhrases.get(raw) ?? translate(raw);
      if (zh && zh !== raw && p.getAttribute('data-zh-placeholder') !== zh) {
        p.setAttribute('data-zh-placeholder', zh);
      }
    }
  }

  const POPUP_SELECTOR = [
    '[data-testid="title-menu-bar-option"]',
    '[data-testid="title-menu-bar-item"] + div',
    '[data-testid="context-menu-popup"]',
    '[role="menu"]',
    '[role="listbox"]',
    '[role="dialog"]',
    '[role="alertdialog"]',
    '[data-radix-popper-content-wrapper]',
    '[data-floating-ui-portal]',
    '[data-base-ui-portal]',
    '[cmdk-root]'
  ].join(', ');

  const TOOLTIP_SELECTOR = '[role="tooltip"], .compact-tooltip, .monaco-hover, [data-testid="hover-card-description"]';

  function translateActivePopups() {
    safeTranslate(() => {
      translateSlashOptionLabels();
      // 1. 顶部菜单栏下拉选项、右键菜单、Radix/Shadcn 下拉选择框与模态框
      const popups = document.querySelectorAll(POPUP_SELECTOR);
      for (const popup of popups) {
        translateNode(popup);
      }
      // 2. 悬浮提示气泡与浮层 (Tooltip / HoverCard)
      const tooltips = document.querySelectorAll(TOOLTIP_SELECTOR);
      for (const tt of tooltips) {
        translateNode(tt);
      }
    });
  }

  // 自愈清理：修复之前旧版在工具调用或动态节点上残留的散装硬翻属性与按钮文案
  function healPollutedToolAttributes() {
    const buttons = document.querySelectorAll('button, [role="tab"], [role="radio"]');
    for (const btn of buttons) {
      if ((btn.textContent || '').trim() === '预览版') {
        for (const child of btn.childNodes) {
          if (child.nodeType === Node.TEXT_NODE && child.nodeValue.trim() === '预览版') {
            child.nodeValue = child.nodeValue.replace('预览版', '预览');
          }
        }
      }
    }
    const els = document.querySelectorAll('[title], [aria-label]');
    for (const el of els) {
      const rawText = (el.textContent || '').trim();
      for (const attr of ['title', 'aria-label']) {
        const val = el.getAttribute(attr);
        if (!val) continue;
        if (/[A-Za-z][与上中通过的到从]|[与上中通过的到从][A-Za-z]/.test(val)) {
          if (rawText && !/[A-Za-z][与上中通过的到从]|[与上中通过的到从][A-Za-z]/.test(rawText)) {
            el.setAttribute(attr, translate(rawText));
          } else {
            const restored = val
              .replace(/·Exited与code (\d+)/g, ' · 退出码 $1')
              .replace(/与/g, ' and ')
              .replace(/通过/g, ' via ')
              .replace(/从/g, ' from ')
              .replace(/的/g, ' of ')
              .replace(/中/g, ' in ')
              .replace(/上/g, ' on ')
              .replace(/到/g, ' to ');
            el.setAttribute(attr, translate(restored));
          }
        }
      }
    }
  }

  const SLASH_MUTATION_SELECTOR = '#typeahead-menu, [id*="typeahead"], [data-testid*="typeahead"], [data-testid*="menu-option"], [data-testid="agent-input-box"]';
  const slashTouchCache = new WeakMap();

  function isInsideSlashArea(element) {
    if (!element) return false;
    const cached = slashTouchCache.get(element);
    if (cached !== undefined) return cached;
    const hit = !!element.closest?.(SLASH_MUTATION_SELECTOR);
    slashTouchCache.set(element, hit);
    return hit;
  }

  function handleMutations(mutations) {
    if (isPatching) return;
    safeTranslate(() => {
      let shouldTranslateTitles = false;
      let shouldCheckSlash = false;
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') {
          translateNode(mutation.target);
          const parentEl = mutation.target.parentElement;
          if (parentEl) {
            if (isConversationTitle(parentEl)) shouldTranslateTitles = true;
            if (!shouldCheckSlash && isInsideSlashArea(parentEl)) shouldCheckSlash = true;
          }
        } else if (mutation.type === 'attributes') {
          translateElement(mutation.target);
        } else {
          if (!shouldCheckSlash && mutation.target && mutation.target.nodeType === Node.ELEMENT_NODE && isInsideSlashArea(mutation.target)) {
            shouldCheckSlash = true;
          }
          for (const node of mutation.addedNodes) {
            translateNode(node);
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (!shouldTranslateTitles) {
                if (
                  node.matches?.('[data-testid="conversation-row-sidebar"]') ||
                  (node.firstElementChild && node.querySelector?.('[data-testid="conversation-row-sidebar"]'))
                ) {
                  shouldTranslateTitles = true;
                }
              }
              if (!shouldCheckSlash) {
                if (
                  isInsideSlashArea(node) ||
                  (node.firstElementChild && node.querySelector?.('[data-testid="menu-option-label"], [data-testid="agent-input-box"]'))
                ) {
                  shouldCheckSlash = true;
                }
              }
            }
          }
        }
      }
      if (shouldTranslateTitles) {
        translateConversationTitles();
      }
      if (shouldCheckSlash) {
        translateSlashOptionLabels();
      }
    });
  }

  function observeRoot(rootNode) {
    if (!rootNode || observedRoots.has(rootNode)) return;
    observedRoots.add(rootNode);
    const observer = new MutationObserver(handleMutations);
    observer.observe(rootNode, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['aria-label', 'title', 'placeholder', 'alt'],
    });
    if (!window.__antigravityZhPatchObservers) {
      window.__antigravityZhPatchObservers = [];
    }
    window.__antigravityZhPatchObservers.push(observer);
    return observer;
  }

  let popupTimer = null;
  let popupFollowupTimer = null;

  function schedulePopupCheck(delayMs, followupMs) {
    if (popupTimer) clearTimeout(popupTimer);
    popupTimer = setTimeout(() => {
      popupTimer = null;
      translateActivePopups();
    }, delayMs);
    if (followupMs) {
      if (popupFollowupTimer) clearTimeout(popupFollowupTimer);
      popupFollowupTimer = setTimeout(() => {
        popupFollowupTimer = null;
        translateActivePopups();
      }, followupMs);
    }
  }

  function run() {
    document.documentElement.lang = 'zh-CN';
    safeTranslate(() => {
      healPollutedToolAttributes();
      translateNode(document.body || document.documentElement);
      translateConversationTitles();
      translateActivePopups();
    });

    window.__antigravityZhPatchObserver = observeRoot(document.documentElement);

    const onInput = () => {
      schedulePopupCheck(50, 0);
    };

    const onClick = () => {
      schedulePopupCheck(20, 120);
    };

    let lastHoverTarget = null;
    let lastHoverTime = 0;
    const onMouseOver = (e) => {
      const target = e.target;
      if (!target || target === lastHoverTarget || !target.closest) return;
      lastHoverTarget = target;
      if (target.closest('[data-testid="title-menu-bar-item"], [data-testid="title-menu-bar-option"]')) {
        schedulePopupCheck(20, 90);
        return;
      }
      const now = Date.now();
      if (now - lastHoverTime < 150) return;
      if (target.closest('button, [role="button"], [role="combobox"], [data-tooltip-id], [role="tab"], .action-item')) {
        lastHoverTime = now;
        schedulePopupCheck(35, 130);
      }
    };

    document.addEventListener('input', onInput, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('mouseover', onMouseOver, true);

    if (window.__antigravityPopupInterval) {
      clearInterval(window.__antigravityPopupInterval);
      window.__antigravityPopupInterval = null;
    }
    if (window.__antigravityTitleInterval) clearInterval(window.__antigravityTitleInterval);
    window.__antigravityTitleInterval = setInterval(() => {
      if (document.hidden) return;
      safeTranslate(translateConversationTitles);
    }, 10000);

    window.__antigravityCleanup = () => {
      window.removeEventListener('DOMContentLoaded', run);
      document.removeEventListener('input', onInput, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('mouseover', onMouseOver, true);
      if (popupTimer) {
        clearTimeout(popupTimer);
        popupTimer = null;
      }
      if (popupFollowupTimer) {
        clearTimeout(popupFollowupTimer);
        popupFollowupTimer = null;
      }
      if (window.__antigravityPopupInterval) {
        clearInterval(window.__antigravityPopupInterval);
        window.__antigravityPopupInterval = null;
      }
      if (window.__antigravityTitleInterval) {
        clearInterval(window.__antigravityTitleInterval);
        window.__antigravityTitleInterval = null;
      }
      if (Array.isArray(window.__antigravityZhPatchObservers)) {
        for (const obs of window.__antigravityZhPatchObservers) {
          try { obs.disconnect(); } catch {}
        }
        window.__antigravityZhPatchObservers = [];
      }
      exactPhrases.clear();
      phrasesLower.clear();
      phrasePrefixMap.clear();
      translateCache.clear();
    };
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    run();
  }
})();
`;

// ===== 跨平台后台 Node.js 守护逻辑（DevToolsActivePort 极速探测 + 严格 CDP JSON 校验过滤 Sidecar 假端口） =====

function getActivePortFileCandidates() {
  const candidates = [];
  const home = os.homedir();
  if (process.platform === 'win32') {
    if (process.env.APPDATA) {
      candidates.push(path.join(process.env.APPDATA, 'Antigravity', 'DevToolsActivePort'));
    }
    candidates.push(path.join(home, 'AppData', 'Roaming', 'Antigravity', 'DevToolsActivePort'));
  } else if (process.platform === 'darwin') {
    candidates.push(path.join(home, 'Library', 'Application Support', 'Antigravity', 'DevToolsActivePort'));
  } else {
    candidates.push(path.join(home, '.config', 'Antigravity', 'DevToolsActivePort'));
  }
  return candidates;
}

function readActivePortInfo() {
  for (const filePath of getActivePortFileCandidates()) {
    try {
      if (fs.existsSync(filePath)) {
        const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
        const firstLine = (lines[0] || '').trim();
        const secondLine = (lines[1] || '').trim();
        const port = Number(firstLine);
        if (Number.isInteger(port) && port > 0 && port < 65536) {
          return {
            port,
            wsPath: secondLine.startsWith('/') ? secondLine : ''
          };
        }
      }
    } catch {}
  }
  return null;
}

function readPortFromActivePortFile() {
  const info = readActivePortInfo();
  return info ? info.port : null;
}

// 严格校验是否为真正的 Chromium CDP 端口（彻底排除返回 200 HTML 的 Sidecar 扩展进程端口）
async function isValidCdpPort(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(600) });
    if (!res.ok) return false;
    const data = await res.json();
    return Boolean(data && typeof data === 'object' && (data.webSocketDebuggerUrl || data['Protocol-Version']));
  } catch {
    return false;
  }
}

function antigravityPids() {
  try {
    if (process.platform === 'win32') {
      const output = execFileSync('tasklist', ['/FI', 'IMAGENAME eq Antigravity.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true });
      const pids = [];
      for (const line of output.split('\n')) {
        const match = line.match(/"Antigravity\.exe","(\d+)"/i);
        if (match) pids.push(match[1]);
      }
      return pids;
    } else {
      const output = execFileSync('pgrep', ['-f', 'Antigravity.app/Contents/MacOS/Antigravity'], { encoding: 'utf8' });
      return output.split(/\s+/).map((s) => s.trim()).filter(Boolean);
    }
  } catch {
    return [];
  }
}

function getListeningPortsForPids(pids) {
  if (pids.length === 0) return [];
  const pidSet = new Set(pids.map(Number));
  const ports = new Set();
  try {
    if (process.platform === 'win32') {
      const netstat = execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8', windowsHide: true });
      for (const line of netstat.split('\n')) {
        if (line.includes('LISTENING')) {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 5) {
            const localAddr = parts[1];
            const pid = Number(parts[parts.length - 1]);
            if (pidSet.has(pid)) {
              const lastColon = localAddr.lastIndexOf(':');
              if (lastColon !== -1) {
                const port = Number(localAddr.slice(lastColon + 1));
                if (Number.isInteger(port) && port > 0) {
                  ports.add(port);
                }
              }
            }
          }
        }
      }
    } else {
      const lsof = execFileSync('lsof', ['-Pan', '-iTCP', '-sTCP:LISTEN', '-p', pids.join(',')], { encoding: 'utf8' });
      for (const line of lsof.split('\n')) {
        const match = line.match(/:(\d+)\s+\(LISTEN\)/);
        if (match) {
          const port = Number(match[1]);
          if (Number.isInteger(port) && port > 0) ports.add(port);
        }
      }
    }
  } catch {}
  return [...ports];
}

let cachedPorts = [];
let lastPortScanTime = 0;

async function getValidDebugPorts() {
  // 1. 优先通过 DevToolsActivePort 文件极速定位主窗口 CDP 端口（零子进程开销）
  const activeFilePort = readPortFromActivePortFile();
  if (activeFilePort && await isValidCdpPort(activeFilePort)) {
    cachedPorts = [activeFilePort];
    return cachedPorts;
  }

  // 2. 检查已缓存的真实 CDP 端口是否仍然有效
  const stillValidPorts = [];
  for (const port of cachedPorts) {
    if (await isValidCdpPort(port)) {
      stillValidPorts.push(port);
    }
  }
  if (stillValidPorts.length > 0) {
    cachedPorts = stillValidPorts;
    return cachedPorts;
  }

  // 3. 兜底：通过进程与端口扫描并严格过滤出真正的 CDP 端口（节流至 12 秒，避免未启动软件时频繁拉起 tasklist）
  const now = Date.now();
  if (now - lastPortScanTime > 12000) {
    lastPortScanTime = now;
    const currentPids = antigravityPids();
    if (currentPids.length === 0) {
      cachedPorts = [];
      return [];
    }
    const candidatePorts = getListeningPortsForPids(currentPids);
    const verifiedPorts = [];
    for (const port of candidatePorts) {
      if (await isValidCdpPort(port)) {
        verifiedPorts.push(port);
      }
    }
    cachedPorts = verifiedPorts;
  }

  return cachedPorts;
}

function isInjectableTarget(target) {
  if (!target) return false;
  const validType = target.type === 'page' || target.type === 'webview' || target.type === 'iframe';
  if (!validType) return false;
  const url = String(target.url || '');
  if (!url || url === 'about:blank' || /^(?:devtools|chrome-extension|data|blob):/i.test(url)) return false;
  if (/^https?:/i.test(url)) {
    try {
      const host = new URL(url).hostname;
      if (host !== '127.0.0.1' && host !== 'localhost' && host !== '[::1]') {
        return false;
      }
    } catch {
      return false;
    }
  }
  return true;
}

async function targetsForPort(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) });
    if (!response.ok) return [];
    const targets = await response.json();
    if (!Array.isArray(targets)) return [];
    return targets.filter((target) => isInjectableTarget(target) && target.webSocketDebuggerUrl);
  } catch {
    return [];
  }
}

function cdpCall(ws, method, params = {}, sessionId = undefined) {
  const id = cdpCall.nextId = (cdpCall.nextId || 0) + 1;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`${method} timed out`));
    }, 2000);

    function onMessage(event) {
      try {
        const message = JSON.parse(event.data);
        if (message.id !== id) return;
        cleanup();
        resolve(message);
      } catch (err) {
        cleanup();
        reject(err);
      }
    }

    function onError(err) {
      cleanup();
      reject(err);
    }

    function onClose() {
      cleanup();
      reject(new Error('WebSocket closed unexpectedly'));
    }

    function cleanup() {
      clearTimeout(timeout);
      ws.removeEventListener('message', onMessage);
      ws.removeEventListener('error', onError);
      ws.removeEventListener('close', onClose);
    }

    ws.addEventListener('message', onMessage);
    ws.addEventListener('error', onError);
    ws.addEventListener('close', onClose);

    try {
      const payload = sessionId ? { id, method, params, sessionId } : { id, method, params };
      ws.send(JSON.stringify(payload));
    } catch (e) {
      cleanup();
      reject(e);
    }
  });
}

// 记录已注入目标的状态（targetId -> { url, version, verifiedAt, scriptId }），避免每轮轮询重复建立 WebSocket 与重复堆叠预加载脚本
const injectedTargetState = new Map();
const TARGET_REVERIFY_INTERVAL_MS = 60000;

function isTargetRecentlyVerified(targetId, url, now) {
  if (!targetId) return false;
  const state = injectedTargetState.get(targetId);
  if (!state) return false;
  return state.version === PATCH_VERSION && state.url === url && (now - state.verifiedAt) < TARGET_REVERIFY_INTERVAL_MS;
}

function pruneStaleTargets(activeIds) {
  for (const key of injectedTargetState.keys()) {
    if (!activeIds.has(key)) {
      injectedTargetState.delete(key);
    }
  }
}

// 兼容 Node.js 18 / 20 LTS（未内置全局 WebSocket 时自动回退到标准库 http + crypto 实现的轻量 RFC 6455 客户端）
class MinimalWebSocket {
  constructor(url) {
    this._listeners = { open: new Set(), message: new Set(), error: new Set(), close: new Set() };
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    this._socket = null;
    this._closed = false;

    const parsed = new URL(url);
    const key = crypto.randomBytes(16).toString('base64');
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port || 80,
      path: parsed.pathname + parsed.search,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': key,
        'Sec-WebSocket-Version': '13'
      }
    });
    this._req = req;

    req.on('error', (err) => this._emit('error', err));
    req.on('response', (res) => {
      res.resume();
      this._emit('error', new Error(`Unexpected HTTP status ${res.statusCode}`));
    });
    req.on('upgrade', (_res, socket, head) => {
      this._req = null;
      if (this._closed) {
        try { socket.destroy(); } catch {}
        return;
      }
      socket.setNoDelay(true);
      this._socket = socket;

      let rxBuf = head && head.length ? Buffer.from(head) : Buffer.alloc(0);
      let fragChunks = [];
      let fragOpcode = 0;

      const parseFrames = () => {
        while (rxBuf.length >= 2) {
          const b0 = rxBuf[0];
          const b1 = rxBuf[1];
          const fin = (b0 & 0x80) !== 0;
          const opcode = b0 & 0x0f;
          const masked = (b1 & 0x80) !== 0;
          let len = b1 & 0x7f;
          let offset = 2;
          if (len === 126) {
            if (rxBuf.length < 4) break;
            len = rxBuf.readUInt16BE(2);
            offset = 4;
          } else if (len === 127) {
            if (rxBuf.length < 10) break;
            len = rxBuf.readUInt32BE(2) * 4294967296 + rxBuf.readUInt32BE(6);
            offset = 10;
          }
          const totalLen = offset + (masked ? 4 : 0) + len;
          if (rxBuf.length < totalLen) break;

          let payload = Buffer.from(rxBuf.subarray(offset + (masked ? 4 : 0), totalLen));
          if (masked) {
            const mask = rxBuf.subarray(offset, offset + 4);
            for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
          }
          rxBuf = rxBuf.subarray(totalLen);

          if (opcode === 0x8) {
            this._closed = true;
            try { socket.end(); } catch {}
            this._emit('close', {});
            return;
          }
          if (opcode === 0x9) {
            this._sendFrame(0x8a, payload);
            continue;
          }
          if (opcode === 0x0a) continue;

          if (opcode !== 0x0) {
            fragOpcode = opcode;
            fragChunks = [payload];
          } else {
            fragChunks.push(payload);
          }
          if (fin) {
            const full = fragChunks.length === 1 ? fragChunks[0] : Buffer.concat(fragChunks);
            fragChunks = [];
            if (fragOpcode === 0x1) {
              this._emit('message', { data: full.toString('utf8') });
            }
          }
        }
      };

      socket.on('data', (chunk) => {
        rxBuf = rxBuf.length === 0 ? chunk : Buffer.concat([rxBuf, chunk]);
        parseFrames();
      });
      socket.on('error', (err) => this._emit('error', err));
      socket.on('close', () => {
        this._closed = true;
        this._emit('close', {});
      });

      queueMicrotask(() => {
        if (!this._closed) {
          this._emit('open', {});
          if (rxBuf.length > 0) parseFrames();
        }
      });
    });

    req.end();
  }

  addEventListener(type, fn) {
    if (this._listeners[type]) this._listeners[type].add(fn);
  }

  removeEventListener(type, fn) {
    if (this._listeners[type]) this._listeners[type].delete(fn);
  }

  _emit(type, event) {
    const handler = this[`on${type}`];
    if (typeof handler === 'function') {
      try { handler(event); } catch {}
    }
    const set = this._listeners[type];
    if (set) {
      for (const fn of [...set]) {
        try { fn(event); } catch {}
      }
    }
  }

  _sendFrame(firstByte, payloadBuf) {
    if (!this._socket || this._closed) return;
    const len = payloadBuf.length;
    const mask = crypto.randomBytes(4);
    let headerLen = 2;
    if (len >= 65536) headerLen = 10;
    else if (len >= 126) headerLen = 4;

    const frame = Buffer.allocUnsafe(headerLen + 4 + len);
    frame[0] = firstByte;
    if (len < 126) {
      frame[1] = 0x80 | len;
    } else if (len < 65536) {
      frame[1] = 0x80 | 126;
      frame.writeUInt16BE(len, 2);
    } else {
      frame[1] = 0x80 | 127;
      frame.writeUInt32BE(0, 2);
      frame.writeUInt32BE(len >>> 0, 6);
    }
    mask.copy(frame, headerLen);
    for (let i = 0; i < len; i++) {
      frame[headerLen + 4 + i] = payloadBuf[i] ^ mask[i & 3];
    }
    this._socket.write(frame);
  }

  send(data) {
    this._sendFrame(0x81, Buffer.from(String(data), 'utf8'));
  }

  close() {
    if (this._closed) return;
    this._closed = true;
    if (this._req) {
      try { this._req.destroy(); } catch {}
      this._req = null;
    }
    if (this._socket) {
      try {
        this._sendFrame(0x88, Buffer.alloc(0));
        this._socket.end();
      } catch {
        try { this._socket.destroy(); } catch {}
      }
    }
  }
}

const WebSocketImpl = typeof WebSocket === 'function' ? WebSocket : MinimalWebSocket;

async function openWebSocket(url) {
  const ws = new WebSocketImpl(url);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error('websocket timed out'));
    }, 1500);
    ws.onopen = () => {
      clearTimeout(timeout);
      resolve();
    };
    ws.onerror = (e) => {
      clearTimeout(timeout);
      reject(e);
    };
  });
  return ws;
}

async function injectTarget(target) {
  const targetId = target.id;
  const targetUrl = String(target.url || '');
  const now = Date.now();
  if (isTargetRecentlyVerified(targetId, targetUrl, now)) {
    return false;
  }

  const ws = await openWebSocket(target.webSocketDebuggerUrl);

  try {
    const prevState = targetId ? injectedTargetState.get(targetId) : null;
    const checkRes = await cdpCall(ws, 'Runtime.evaluate', {
      expression: 'window.__antigravityZhPatchInstalled',
      returnByValue: true
    }).catch(() => null);

    const currentInstalledVersion = checkRes?.result?.result?.value;
    if (currentInstalledVersion === PATCH_VERSION) {
      if (targetId) {
        injectedTargetState.set(targetId, {
          url: targetUrl,
          version: PATCH_VERSION,
          verifiedAt: now,
          scriptId: prevState?.scriptId || null
        });
      }
      return false;
    }

    if (prevState?.scriptId) {
      await cdpCall(ws, 'Page.removeScriptToEvaluateOnNewDocument', { identifier: prevState.scriptId }).catch(() => null);
    }
    const addRes = await cdpCall(ws, 'Page.addScriptToEvaluateOnNewDocument', { source: overlaySource }).catch(() => null);
    const scriptId = addRes?.result?.identifier || null;
    await cdpCall(ws, 'Runtime.evaluate', { expression: overlaySource, awaitPromise: false });

    if (targetId) {
      injectedTargetState.set(targetId, {
        url: targetUrl,
        version: PATCH_VERSION,
        verifiedAt: now,
        scriptId
      });
    }
    return true;
  } finally {
    try { ws.close(); } catch {}
  }
}

// Electron 44+ 浏览器级 CDP WebSocket 兜底（当 /json/list HTTP 接口关闭或为空时直接通过 DevToolsActivePort 第二行路径注入）
async function injectViaBrowserWebSocket(port, wsPath, activeIds) {
  if (!port || !wsPath) return { injectedCount: 0, connected: false };
  let ws;
  try {
    ws = await openWebSocket(`ws://127.0.0.1:${port}${wsPath}`);
  } catch {
    return { injectedCount: 0, connected: false };
  }

  let injectedCount = 0;
  const now = Date.now();
  try {
    const targetsRes = await cdpCall(ws, 'Target.getTargets').catch(() => null);
    const targetInfos = targetsRes?.result?.targetInfos;
    if (!Array.isArray(targetInfos)) return { injectedCount: 0, connected: true };

    for (const info of targetInfos) {
      if (!isInjectableTarget(info) || !info.targetId) continue;
      activeIds.add(info.targetId);
      const targetUrl = String(info.url || '');
      if (isTargetRecentlyVerified(info.targetId, targetUrl, now)) continue;

      let sessionId = null;
      try {
        const prevState = injectedTargetState.get(info.targetId);
        const attachRes = await cdpCall(ws, 'Target.attachToTarget', {
          targetId: info.targetId,
          flatten: true
        });
        sessionId = attachRes?.result?.sessionId;
        if (!sessionId) continue;

        const checkRes = await cdpCall(ws, 'Runtime.evaluate', {
          expression: 'window.__antigravityZhPatchInstalled',
          returnByValue: true
        }, sessionId).catch(() => null);

        if (checkRes?.result?.result?.value === PATCH_VERSION) {
          injectedTargetState.set(info.targetId, {
            url: targetUrl,
            version: PATCH_VERSION,
            verifiedAt: now,
            scriptId: prevState?.scriptId || null
          });
          continue;
        }

        if (prevState?.scriptId) {
          await cdpCall(ws, 'Page.removeScriptToEvaluateOnNewDocument', { identifier: prevState.scriptId }, sessionId).catch(() => null);
        }
        const addRes = await cdpCall(ws, 'Page.addScriptToEvaluateOnNewDocument', { source: overlaySource }, sessionId).catch(() => null);
        const scriptId = addRes?.result?.identifier || null;
        await cdpCall(ws, 'Runtime.evaluate', { expression: overlaySource, awaitPromise: false }, sessionId);
        injectedTargetState.set(info.targetId, {
          url: targetUrl,
          version: PATCH_VERSION,
          verifiedAt: now,
          scriptId
        });
        injectedCount += 1;
      } catch {} finally {
        if (sessionId) {
          await cdpCall(ws, 'Target.detachFromTarget', { sessionId }).catch(() => null);
        }
      }
    }
  } finally {
    try { ws.close(); } catch {}
  }
  return { injectedCount, connected: true };
}

async function injectOnce() {
  let count = 0;
  let foundAnyHttpTargets = false;
  const activeIds = new Set();
  const ports = await getValidDebugPorts();
  for (const port of ports) {
    const targets = await targetsForPort(port);
    if (targets.length > 0) foundAnyHttpTargets = true;
    for (const target of targets) {
      if (target.id) activeIds.add(target.id);
      try {
        const injected = await injectTarget(target);
        if (injected) count += 1;
      } catch {}
    }
  }

  let hasActivePort = ports.length > 0;
  if (!foundAnyHttpTargets) {
    const activeInfo = readActivePortInfo();
    if (activeInfo && activeInfo.port && activeInfo.wsPath) {
      const fallbackRes = await injectViaBrowserWebSocket(activeInfo.port, activeInfo.wsPath, activeIds);
      if (fallbackRes.connected) hasActivePort = true;
      count += fallbackRes.injectedCount;
    }
  }

  pruneStaleTargets(activeIds);
  return { count, hasActivePort };
}

function exitIfScriptModified() {
  if (!INITIAL_SCRIPT_MTIME) return;
  try {
    const currentMtime = fs.statSync(__filename).mtimeMs;
    if (currentMtime && currentMtime !== INITIAL_SCRIPT_MTIME) {
      process.exit(0);
    }
  } catch {}
}

async function watch() {
  for (;;) {
    exitIfScriptModified();
    let hasActivePort = false;
    try {
      const res = await injectOnce();
      hasActivePort = res.hasActivePort;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, hasActivePort ? 5000 : 8000));
  }
}

if (process.argv.includes('--watch')) {
  watch();
} else {
  injectOnce().then(({ count }) => {
    console.log(`已向 ${count} 个 Antigravity 页面注入或更新中文汉化 (v${PATCH_VERSION})。`);
  });
}
