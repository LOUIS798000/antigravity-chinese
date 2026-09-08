$ErrorActionPreference = "Stop"

$Root = $PSScriptRoot
$ScriptPath = Join-Path $Root "bin\antigravity-zh-patch.js"
$VbsPath = Join-Path $Root "start-silent.vbs"
$LogDir = Join-Path $Root "logs"
$TaskName = "AntigravityChinesePatch"

# 1. 检查 Node.js 环境
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host "[错误] 未找到 Node.js。请先安装 Node.js 22 或更高版本，然后重新运行 install.ps1。" -ForegroundColor Red
    exit 1
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# 2. 停止并清理已有后台旧进程
try {
    Get-WmiObject Win32_Process | Where-Object { $_.CommandLine -like "*antigravity-zh-patch.js*" -or $_.CommandLine -like "*start-silent.vbs*" } | ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
} catch {}

# 3. 配置 Windows 注册表开机自启动项 (HKCU Run - 防掉后台)
$RegPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$WscriptExe = "$env:SystemRoot\System32\wscript.exe"
$RegValue = "`"$WscriptExe`" //B //Nologo `"$VbsPath`""
Set-ItemProperty -Path $RegPath -Name $TaskName -Value $RegValue -Force
Write-Host "已配置注册表用户自启动项 (HKCU\Run)。" -ForegroundColor Green

# 4. 清理旧版可能遗留的启动文件夹自启动项 (避免双实例重复启动)
$StartupFolder = [Environment]::GetFolderPath("Startup")
$StartupVbs = Join-Path $StartupFolder "AntigravityChinesePatch.vbs"
if (Test-Path $StartupVbs) {
    Remove-Item -Force $StartupVbs -ErrorAction SilentlyContinue
    Write-Host "已清理旧版启动文件夹重复项，统一由注册表 HKCU\Run 常驻守护。" -ForegroundColor Green
}

# 5. 尝试配置任务计划程序 (如具有权限)
try {
    $existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($existingTask) {
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    }
    $action = New-ScheduledTaskAction -Execute $WscriptExe -Argument "//B //Nologo `"$VbsPath`""
    $trigger = New-ScheduledTaskTrigger -AtLogOn
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 0) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Force -ErrorAction SilentlyContinue | Out-Null
    Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Write-Host "已配置 Windows 任务计划程序。" -ForegroundColor Green
} catch {
    Write-Host "（已通过注册表与启动目录完成双重自启守护配置）" -ForegroundColor Gray
}

# 6. 配置全局 AI 汉化规则
Write-Host "配置全局 AI 规则..." -ForegroundColor Cyan
$ConfigDir = Join-Path $env:USERPROFILE ".gemini\config"
$GeminiRuleFile = Join-Path $ConfigDir "GEMINI.md"

New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
$ruleLines = @(
    "# Global AI Rules",
    "",
    "## Language and Naming",
    "- ALWAYS communicate and respond in Simplified Chinese (简体中文).",
    "- CRITICAL: When generating a title, name, or summary for a Session/Conversation/Project, you MUST ALWAYS output the title in Simplified Chinese.",
    "- Do NOT use English titles. Translate any English title concepts to Chinese. For example, instead of \`"Basic Chinese Greeting\`", output \`"基础中文问候\`"."
)
$ruleLines | Set-Content -Path $GeminiRuleFile -Encoding UTF8
Write-Host "已配置全局大模型规则以强制汉化对话与项目命名。" -ForegroundColor Green

# 7. 立即在后台静默启动汉化守护进程
cmd.exe /c start "" wscript.exe //B //Nologo `"$VbsPath`"

# 8. 执行首次即时注入
Write-Host "执行首次汉化注入..." -ForegroundColor Cyan
& $node.Source "$ScriptPath"

Write-Host "==========================================" -ForegroundColor Green
Write-Host "Antigravity 中文汉化已成功安装并已开启守护进程！" -ForegroundColor Green
Write-Host "开机自启策略: HKCU 注册表 + 启动文件夹 双重常驻守护 (防掉后台)" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green