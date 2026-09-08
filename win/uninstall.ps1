$ErrorActionPreference = "Stop"

$Root = $PSScriptRoot
$TaskName = "AntigravityChinesePatch"
$NodePathFile = Join-Path $Root "node_path.txt"

# 1. 移除注册表自启动项
$RegPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
if (Get-ItemProperty -Path $RegPath -Name $TaskName -ErrorAction SilentlyContinue) {
    Remove-ItemProperty -Path $RegPath -Name $TaskName -Force -ErrorAction SilentlyContinue
    Write-Host "已移除注册表自启动项。" -ForegroundColor Green
}

# 2. 移除启动文件夹自启动项
$StartupFolder = [Environment]::GetFolderPath("Startup")
$StartupVbs = Join-Path $StartupFolder "AntigravityChinesePatch.vbs"
if (Test-Path $StartupVbs) {
    Remove-Item -Force $StartupVbs -ErrorAction SilentlyContinue
    Write-Host "已清理启动文件夹自启动项。" -ForegroundColor Green
}

# 3. 移除任务计划程序（若存在）
try {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($task) {
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
        Write-Host "已注销计划任务 $TaskName。" -ForegroundColor Green
    }
} catch {}

# 4. 停止后台运行的守护进程与 node 汉化进程
try {
    Get-CimInstance Win32_Process | Where-Object { 
        $_.CommandLine -like "*antigravity-zh-patch.js*" -or $_.CommandLine -like "*start-silent.vbs*" 
    } | ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Write-Host "已停止后台汉化守护进程。" -ForegroundColor Green
} catch {}

# 5. 清理临时配置文件
if (Test-Path $NodePathFile) {
    Remove-Item -Force $NodePathFile -ErrorAction SilentlyContinue
}

Write-Host "Antigravity 中文汉化服务已完全停用并卸载。" -ForegroundColor Green
