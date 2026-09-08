#!/bin/zsh
set -euo pipefail

PLIST_NAME="com.louis.antigravity.zhpatch.plist"
DEST_PLIST="$HOME/Library/LaunchAgents/$PLIST_NAME"

launchctl bootout "gui/$(id -u)" "$DEST_PLIST" 2>/dev/null || true
rm -f "$DEST_PLIST"

echo "Antigravity 中文汉化脚本已停止，并已移除 LaunchAgent。"
