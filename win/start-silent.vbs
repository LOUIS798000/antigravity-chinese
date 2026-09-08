Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
nodeScript = scriptDir & "\bin\antigravity-zh-patch.js"
nodeExe = ""

' 1. ??? install.ps1 ??? node_path.txt ????
nodePathFile = scriptDir & "\node_path.txt"
If fso.FileExists(nodePathFile) Then
    On Error Resume Next
    Set ts = fso.OpenTextFile(nodePathFile, 1)
    If Not ts.AtEndOfStream Then
        savedPath = Trim(ts.ReadLine())
        If fso.FileExists(savedPath) Then
            nodeExe = savedPath
        End If
    End If
    ts.Close
    On Error GoTo 0
End If

' 2. ??????????
If nodeExe = "" Then
    candidates = Array( _
        "D:\Program Files\nodejs\node.exe", _
        "C:\Program Files\nodejs\node.exe", _
        WshShell.ExpandEnvironmentStrings("%ProgramFiles%\nodejs\node.exe"), _
        WshShell.ExpandEnvironmentStrings("%LOCALAPPDATA%\Programs\nodejs\node.exe"), _
        WshShell.ExpandEnvironmentStrings("%APPDATA%\nvm\current\node.exe") _
    )
    For Each c In candidates
        If c <> "" And fso.FileExists(c) Then
            nodeExe = c
            Exit For
        End If
    Next
End If

' 3. ????????????????? node.exe
If nodeExe = "" Then
    nodeExe = "node.exe"
End If

' 4. ??????
Do
    exitCode = WshShell.Run("""" & nodeExe & """ """ & nodeScript & """ --watch", 0, True)
    ' ????????? 3 ???????????? CPU
    WScript.Sleep 3000
Loop
