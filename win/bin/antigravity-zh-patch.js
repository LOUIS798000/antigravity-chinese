#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const PATCH_VERSION = 61;

const overlaySource = String.raw`
(() => {
  const CURRENT_PATCH_VERSION = 61;
  if (window.__antigravityZhPatchInstalled === CURRENT_PATCH_VERSION) return;
  if (window.__antigravityZhPatchObserver) {
    try { window.__antigravityZhPatchObserver.disconnect(); } catch {}
  }
  if (window.__antigravityPopupInterval) clearInterval(window.__antigravityPopupInterval);
  if (window.__antigravityTitleInterval) clearInterval(window.__antigravityTitleInterval);
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
    ["High", "高"],
    ["Medium", "中等"],
    ["Low", "低"],
    ["Local", "本地"],
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
  ]);

  // ===== 第二级：多词安全短语与完整句字典 (均为 2 词以上明确 UI 短语，无单字歧义) =====
  const phrases = new Map([
    // 旧版半截翻译自愈修复（无需重启即可修复已污染节点）
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
  ]);

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

  // ===== 第三级：动态上下文正则替换规则 =====
  const patterns = [
    [/^Version (\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)?)$/gi, '版本 $1'],
    [/^Thought for (\d+)s$/gi, '思考耗时 $1 秒'],
    [/^Thought for (\d+)m$/gi, '思考耗时 $1 分钟'],
    [/^Thought for (\d+)ms$/gi, '思考耗时 $1 毫秒'],
    [/^Worked for (\d+)s$/gi, '已工作 $1 秒'],
    [/^Worked for (\d+)m$/gi, '已工作 $1 分钟'],
    [/^Worked for (\d+)h$/gi, '已工作 $1 小时'],
    [/^Updated (.+)$/gi, '更新于 $1'],
    [/^Created (.+)$/gi, '创建于 $1'],
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
    [/^Agent permissions preset selector, current: (.+)$/gi, '智能体权限预设选择器，当前：$1'],
    [/^Select model, current: (.+)$/gi, '选择模型，当前：$1'],
    [/· Exited with code (\d+)/g, '· 退出码 $1'],
    [/·Exited与code (\d+)/g, '· 退出码 $1'],
    [/See all \((\d+)\)/g, '查看全部 ($1)'],
    [/(\d+) agents running/g, '$1 个代理正在运行'],
    [/1 agent running/g, '1 个代理正在运行'],
    [/^(\d+)mo$/g, '$1 个月前'],
    [/^(\d+)y$/g, '$1 年前'],
    [/^(\d+)w$/g, '$1 周前'],
    [/^(\d+)d$/g, '$1 天前'],
    [/^(\d+)h$/g, '$1 小时前'],
    [/^(\d+)m$/g, '$1 分钟前'],
    [/^(\d+)s$/g, '$1 秒前'],
    [/(\d+(?:\.\d+)?)% of the customization budget is available\./g, '自定义预算还剩 $1%。'],
    [/Your Plan: (.+)/g, '你的套餐：$1'],
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
    [/Gemini ([^(]+) \((High|Medium|Low)\)/g, (_match, model, effort) => 'Gemini ' + model.trim() + ' (' + (exactPhrases.get(effort) ?? effort) + ')'],
    [/Antigravity has been redesigned to put agents first with new capabilities\. If you'd still like a code editor, you can download it as a separate app named Antigravity IDE\./g, 'Antigravity 已重新设计为智能体优先，并加入了新能力。如果你仍然需要代码编辑器，可以下载名为 Antigravity IDE 的独立应用。'],
  ];

  // ===== 高性能安全汉化引擎（精确整词 O(1) + 多词大正则 + 变动互斥锁） =====
  const sortedPhrases = [...phrases].sort((a, b) => b[0].length - a[0].length);
  const phraseRegex = new RegExp(
    sortedPhrases.map(([s]) => {
      const startsWord = /^[A-Za-z0-9]/.test(s);
      const endsWord = /[A-Za-z0-9]$/.test(s);
      return (startsWord ? '(?<![A-Za-z0-9])' : '') + escapeRegExp(s) + (endsWord ? '(?![A-Za-z0-9])' : '');
    }).join('|'),
    'g'
  );

  const translateCache = new Map();
  const TRANSLATE_CACHE_MAX = 5000;
  let isPatching = false;

  function escapeRegExp(value) {
    return value.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
  }

  function translate(value) {
    if (!value || !/[A-Za-z]/.test(value)) return value;
    const cached = translateCache.get(value);
    if (cached !== undefined) return cached;

    const trimmed = value.trim();
    if (!trimmed) return value;

    // 1. 优先尝试整词/整句 O(1) 哈希匹配（保留原始首尾空白）
    const exactMatch = exactPhrases.get(trimmed) ?? phrases.get(trimmed);
    if (exactMatch !== undefined) {
      const startIdx = value.indexOf(trimmed);
      const result = value.slice(0, startIdx) + exactMatch + value.slice(startIdx + trimmed.length);
      if (translateCache.size >= TRANSLATE_CACHE_MAX) translateCache.clear();
      translateCache.set(value, result);
      return result;
    }

    // 2. 多词安全短语替换与上下文正则匹配
    let next = value.replace(phraseRegex, (m) => phrases.get(m) ?? m);
    for (const [pattern, target] of patterns) {
      next = next.replace(pattern, target);
    }

    if (translateCache.size >= TRANSLATE_CACHE_MAX) translateCache.clear();
    translateCache.set(value, next);
    return next;
  }

  // 严格安全边界过滤：保护 AI 回答正文、用户消息、Markdown 渲染块、思考过程、内置代码查看器与富文本输入区不被篡改
  const SKIP_SELECTOR = [
    'script', 'style', 'textarea', 'input', 'select', 'code', 'pre',
    '.xterm', '.monaco-editor', '.cm-editor',
    '.code-line', '.line-content', '[data-testid="code-gutter"]',
    '[contenteditable="true"]', '[contenteditable=""]',
    '[role="combobox"]', '[role="textbox"]', '[role="listbox"]',
    '[data-lexical-editor]', '[data-lexical-text]', '[data-mention-menu]',
    '[data-testid="agent-input-box"] p.pointer-events-none',
    '[data-testid="planner-response-text"]',
    '[data-testid="user-input-step"]',
    '[data-testid="user-message-bubble"]',
    '[data-testid="voice-user-message"]',
    '[data-testid="voice-agent-message"]',
    '[data-testid="comment-card-text"]',
    '[data-testid="pdf-text-layer"]',
    '[data-testid="tab-file-tree-sidebar"]',
    '[data-testid="breadcrumb-segment"]',
    '[data-testid="tool-group-collapsible"]',
    'nav[aria-label*="breadcrumbs"] *',
    'nav[aria-label*="面包屑"] *',
    '.md-divider-spacing', '.markdown-frontmatter', '.prose', '.markdown', '.cursor-edit',
    '[translate="no"]', '.notranslate'
  ].join(', ');

  function shouldSkip(node) {
    if (!node) return true;
    if (node.nodeType === Node.DOCUMENT_NODE || node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) return false;
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return !element || !!element.closest?.(SKIP_SELECTOR);
  }

  function translateElement(element) {
    for (const attr of ['aria-label', 'title', 'placeholder', 'alt']) {
      const value = element.getAttribute?.(attr);
      if (!value || !/[A-Za-z]/.test(value)) continue;
      const translated = translate(value);
      if (translated !== value) {
        element.setAttribute(attr, translated);
      }
    }
  }

  function translateNode(root) {
    if (!root) return;
    if (shouldSkip(root)) return;
    if (root.nodeType === Node.TEXT_NODE) {
      const raw = root.nodeValue || '';
      if (!raw.trim() || !/[A-Za-z]/.test(raw)) return;
      const translated = translate(raw);
      if (translated !== raw) {
        root.nodeValue = translated;
      }
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
    if (root.nodeType === Node.ELEMENT_NODE) translateElement(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (shouldSkip(node)) continue;
      if (node.nodeType === Node.TEXT_NODE) {
        const raw = node.nodeValue || '';
        if (!raw.trim() || !/[A-Za-z]/.test(raw)) continue;
        const translated = translate(raw);
        if (translated !== raw) {
          node.nodeValue = translated;
        }
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        translateElement(node);
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
  function ensureSlashStyle() {
    let style = document.getElementById('antigravity-zh-slash-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'antigravity-zh-slash-style';
      (document.head || document.documentElement).appendChild(style);
    }
    const css = [
      '[data-testid="menu-option-label"][data-zh-suffix]::after { content: attr(data-zh-suffix); color: var(--muted-foreground, rgba(128, 128, 128, 0.8)); font-size: 11px; font-weight: normal; margin-left: 4px; pointer-events: none; }',
      '[data-testid="menu-option-description"][data-zh-desc] { font-size: 0 !important; }',
      '[data-testid="menu-option-description"][data-zh-desc]::after { content: attr(data-zh-desc); font-size: 12px !important; line-height: normal; }',
      '[data-testid="agent-input-box"] p.pointer-events-none[data-zh-placeholder] { font-size: 0 !important; }',
      '[data-testid="agent-input-box"] p.pointer-events-none[data-zh-placeholder]::after { content: attr(data-zh-placeholder); font-size: 0.875rem !important; line-height: 1.25rem !important; }'
    ].join('\n');
    if (style.textContent !== css) {
      style.textContent = css;
    }
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
    ['Grill me about an idea or plan.', '对我进行方案交互式访谈，以对齐需求与设计。'],
    ['Interview me to align on a plan.', '对我进行交互式访谈，以对齐方案与需求。'],
    ['Run an autonomous team of agents to solve complex problems.', '调用多智能体团队自主协作处理复杂项目。'],
    ['Invoke a team of agents to autonomously tackle large projects.', '调用多智能体团队自主协作处理大型复杂项目。'],
    ['Review recent successes or corrections to persist as a skill.', '沉淀近期成功经验或修正内容为可复用技能。'],
    ['Reflect on recent successes or corrections to capture reusable skills or rules.', '回顾近期的成功经验或修正内容，沉淀为可复用的技能或规则。'],
    ['Run the Boost multi-agent harness for deep thinking.', '为复杂任务调用 Boost 多智能体编排器进行深度推理。'],
    ['Invoke the Boost multi-agent orchestrator for complex tasks.', '为复杂任务调用 Boost 多智能体编排器。'],
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
      const desc = slashOptionDescriptions.get(raw) ?? exactPhrases.get(raw) ?? phrases.get(raw);
      if (desc && desc !== raw) {
        if (el.getAttribute('data-zh-desc') !== desc) {
          el.setAttribute('data-zh-desc', desc);
        }
      }
    }

    // 零侵入汉化 Lexical 输入框 Placeholder
    const placeholders = document.querySelectorAll('[data-testid="agent-input-box"] p.pointer-events-none');
    for (const p of placeholders) {
      const raw = (p.textContent || '').trim();
      if (!raw) continue;
      const zh = phrases.get(raw) ?? exactPhrases.get(raw);
      if (zh && p.getAttribute('data-zh-placeholder') !== zh) {
        p.setAttribute('data-zh-placeholder', zh);
      }
    }
  }

  function translateActivePopups() {
    safeTranslate(() => {
      translateSlashOptionLabels();
      // 1. 顶部菜单栏下拉选项与右键菜单
      const menuOptions = document.querySelectorAll('[data-testid="title-menu-bar-option"], [data-testid="title-menu-bar-item"] + div, [data-testid="context-menu-popup"], [role="menu"]');
      for (const opt of menuOptions) {
        translateNode(opt);
      }
      // 2. 悬浮提示气泡与浮层 (Tooltip / HoverCard)
      const tooltips = document.querySelectorAll('[role="tooltip"], .compact-tooltip, .monaco-hover, [data-testid="hover-card-description"]');
      for (const tt of tooltips) {
        translateNode(tt);
      }
    });
  }

  // 自愈清理：修复之前旧版在工具调用或动态节点上残留的散装硬翻属性
  function healPollutedToolAttributes() {
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

  function run() {
    document.documentElement.lang = 'zh-CN';
    safeTranslate(() => {
      healPollutedToolAttributes();
      translateNode(document.body || document.documentElement);
      translateConversationTitles();
      translateActivePopups();
    });

    window.__antigravityZhPatchObserver = new MutationObserver((mutations) => {
      if (isPatching) return;
      safeTranslate(() => {
        let shouldTranslateTitles = false;
        for (const mutation of mutations) {
          if (mutation.type === 'characterData') {
            translateNode(mutation.target);
            if (mutation.target.parentElement && isConversationTitle(mutation.target.parentElement)) {
              shouldTranslateTitles = true;
            }
          } else if (mutation.type === 'attributes') {
            translateElement(mutation.target);
          } else {
            for (const node of mutation.addedNodes) {
              translateNode(node);
              if (node.nodeType === Node.ELEMENT_NODE) {
                if (node.querySelector && node.querySelector('[data-testid="conversation-row-sidebar"]')) {
                  shouldTranslateTitles = true;
                }
                if (node.matches && node.matches('[data-testid="conversation-row-sidebar"]')) {
                  shouldTranslateTitles = true;
                }
              }
            }
          }
        }
        if (shouldTranslateTitles) {
          translateConversationTitles();
        }
        translateSlashOptionLabels();
      });
    });

    window.__antigravityZhPatchObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['aria-label', 'title', 'placeholder', 'alt'],
    });

    let inputDebounce = null;
    document.addEventListener('input', () => {
      if (inputDebounce) clearTimeout(inputDebounce);
      inputDebounce = setTimeout(translateActivePopups, 50);
    }, true);

    document.addEventListener('click', () => {
      setTimeout(translateActivePopups, 20);
      setTimeout(translateActivePopups, 120);
    }, true);

    document.addEventListener('mouseover', (e) => {
      if (!e.target || !e.target.closest) return;
      if (e.target.closest('[data-testid="title-menu-bar-item"]') || e.target.closest('[data-testid="title-menu-bar-option"]')) {
        setTimeout(translateActivePopups, 20);
        setTimeout(translateActivePopups, 80);
      } else if (e.target.closest('button, [role="button"], [data-tooltip-id], [role="tab"], .action-item')) {
        setTimeout(translateActivePopups, 30);
        setTimeout(translateActivePopups, 120);
      }
    }, true);

    if (window.__antigravityPopupInterval) clearInterval(window.__antigravityPopupInterval);
    window.__antigravityPopupInterval = setInterval(translateActivePopups, 500);

    if (window.__antigravityTitleInterval) clearInterval(window.__antigravityTitleInterval);
    window.__antigravityTitleInterval = setInterval(() => {
      safeTranslate(translateConversationTitles);
    }, 2000);
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

function readPortFromActivePortFile() {
  for (const filePath of getActivePortFileCandidates()) {
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        const firstLine = (content.split(/\r?\n/)[0] || '').trim();
        const port = Number(firstLine);
        if (Number.isInteger(port) && port > 0 && port < 65536) {
          return port;
        }
      }
    } catch {}
  }
  return null;
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

  // 3. 兜底：通过进程与端口扫描并严格过滤出真正的 CDP 端口
  const now = Date.now();
  if (now - lastPortScanTime > 1500) {
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

async function targetsForPort(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) });
    if (!response.ok) return [];
    const targets = await response.json();
    if (!Array.isArray(targets)) return [];
    return targets.filter((target) => target.type === 'page' && target.webSocketDebuggerUrl);
  } catch {
    return [];
  }
}

function cdpCall(ws, method, params = {}) {
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
      ws.send(JSON.stringify({ id, method, params }));
    } catch (e) {
      cleanup();
      reject(e);
    }
  });
}

const injectedTargetVersions = new Map();

async function injectTarget(target) {
  const targetId = target.id;
  const ws = new WebSocket(target.webSocketDebuggerUrl);

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('websocket timed out')), 1500);
    ws.onopen = () => {
      clearTimeout(timeout);
      resolve();
    };
    ws.onerror = (e) => {
      clearTimeout(timeout);
      reject(e);
    };
  });

  try {
    const checkRes = await cdpCall(ws, 'Runtime.evaluate', {
      expression: 'window.__antigravityZhPatchInstalled',
      returnByValue: true
    }).catch(() => null);

    const currentInstalledVersion = checkRes?.result?.result?.value;
    if (currentInstalledVersion === PATCH_VERSION) {
      injectedTargetVersions.set(targetId, PATCH_VERSION);
      return false;
    }

    await cdpCall(ws, 'Page.addScriptToEvaluateOnNewDocument', { source: overlaySource });
    await cdpCall(ws, 'Runtime.evaluate', { expression: overlaySource, awaitPromise: false });

    injectedTargetVersions.set(targetId, PATCH_VERSION);
    return true;
  } finally {
    try { ws.close(); } catch {}
  }
}

async function injectOnce() {
  let count = 0;
  const ports = await getValidDebugPorts();
  for (const port of ports) {
    const targets = await targetsForPort(port);
    for (const target of targets) {
      try {
        const injected = await injectTarget(target);
        if (injected) count += 1;
      } catch {}
    }
  }
  return count;
}

async function watch() {
  for (;;) {
    try {
      await injectOnce();
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
}

if (process.argv.includes('--watch')) {
  watch();
} else {
  injectOnce().then((count) => {
    console.log(`已向 ${count} 个 Antigravity 页面注入或更新中文汉化 (v${PATCH_VERSION})。`);
  });
}
