Option Explicit
' Sawbuck AI launcher. Starts the local app server with no console window and
' shows the loading splash while it boots, then swaps the same window to the app.
Dim fso, sh, scriptDir, bootUrl, browser, cmdLine
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = scriptDir

' 1) Boot the server hidden. Same steps as the old batch, output logged for support.
cmdLine = "cmd /c (npx prisma db push & if exist "".next"" rmdir /s /q "".next"" & npm run build && npm run start) > ""launcher\boot.log"" 2>&1"
sh.Run cmdLine, 0, False

' 2) Open the splash in its own app window (Chrome, then Edge, then default browser).
bootUrl = "file:///" & Replace(scriptDir & "\launcher\boot.html", "\", "/")
browser = FindBrowser(fso, sh)
If browser <> "" Then
  sh.Run """" & browser & """ --app=" & bootUrl & " --window-size=1320,860", 1, False
Else
  sh.Run bootUrl, 1, False
End If

Function FindBrowser(fso, sh)
  Dim list, i, p
  list = Array( _
    sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\Google\Chrome\Application\chrome.exe", _
    sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Google\Chrome\Application\chrome.exe", _
    sh.ExpandEnvironmentStrings("%LocalAppData%") & "\Google\Chrome\Application\chrome.exe", _
    sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Microsoft\Edge\Application\msedge.exe", _
    sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\Microsoft\Edge\Application\msedge.exe" )
  FindBrowser = ""
  For i = 0 To UBound(list)
    p = list(i)
    If fso.FileExists(p) Then
      FindBrowser = p
      Exit Function
    End If
  Next
End Function
