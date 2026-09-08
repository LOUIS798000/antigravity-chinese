Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
nodeScript = scriptDir & "\bin\antigravity-zh-patch.js"
nodeExe = "node.exe"
If fso.FileExists("D:\Program Files\nodejs\node.exe") Then
    nodeExe = "D:\Program Files\nodejs\node.exe"
ElseIf fso.FileExists("C:\Program Files\nodejs\node.exe") Then
    nodeExe = "C:\Program Files\nodejs\node.exe"
End If
Do
    WshShell.Run """" & nodeExe & """ """ & nodeScript & """ --watch", 0, True
    WScript.Sleep 3000
Loop
