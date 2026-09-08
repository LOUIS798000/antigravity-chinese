$ErrorActionPreference = "Stop"

$Root = $PSScriptRoot
$ScriptPath = Join-Path $Root "bin\antigravity-zh-patch.js"
$VbsPath = Join-Path $Root "start-silent.vbs"
$LogDir = Join-Path $Root "logs"
$NodePathFile = Join-Path $Root "node_path.txt"
$TaskName = "AntigravityChinesePatch"

# 1. 检查 Node.js 环境
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host "[错误] 未找到 Node.js。请先安装 Node.js 18 或更高版本，然后重新运行 install.ps1。" -ForegroundColor Red
    exit 1
}

# 记录当前有效的 node.exe 路径供 VBS 静默守护使用
$nodeExePath = $node.Source
Set-Content -Path $NodePathFile -Value $nodeExePath -Encoding ASCII
Write-Host "已识别并配置 Node.js 路径: $nodeExePath" -ForegroundColor Green

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# 2. 停止并清理已有后台旧进程（兼容 PowerShell 5.1 与 7+）
try {
    Get-CimInstance Win32_Process | Where-Object { 
        $_.CommandLine -like "*antigravity-zh-patch.js*" -or $_.CommandLine -like "*start-silent.vbs*" 
    } | ForEach-Object {
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
    Write-Host "已清理旧版启动文件夹残留项。" -ForegroundColor Green
}

# 5. 清理可能遗留的计划任务（统一使用 HKCU\Run 静默常驻）
try {
    $existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($existingTask) {
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    }
} catch {}

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
    "- Do NOT use English titles. Translate any English title concepts to Chinese. For example, instead of `"Basic Chinese Greeting`", output `"基础中文问候`"."
)
$ruleLines | Set-Content -Path $GeminiRuleFile -Encoding UTF8
Write-Host "已配置全局大模型规则以强制汉化对话与项目命名。" -ForegroundColor Green

# 7. 立即在后台静默拉起汉化守护进程（完全独立会话脱壳启动）
try {
    Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ 
        CommandLine = "`"$WscriptExe`" //B //Nologo `"$VbsPath`"" 
    } | Out-Null
} catch {
    Start-Process -FilePath $WscriptExe -ArgumentList "//B", "//Nologo", "`"$VbsPath`"" -WindowStyle Hidden
}

# 8. 执行首次即时注入
Write-Host "执行首次汉化注入..." -ForegroundColor Cyan
& "$nodeExePath" "$ScriptPath"

Start-Sleep -Milliseconds 1000
$daemon = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*antigravity-zh-patch.js*--watch*" } | Select-Object -First 1
if ($daemon) {
    Write-Host "后台守护进程已常驻运行 (PID: $($daemon.ProcessId))。" -ForegroundColor Green
}

Write-Host "==========================================" -ForegroundColor Green
Write-Host "Antigravity 中文汉化已成功安装并已开启守护进程！" -ForegroundColor Green
Write-Host "守护策略: 注册表 HKCU\Run 用户常驻静默守护" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
