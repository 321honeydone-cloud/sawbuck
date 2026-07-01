Option Explicit
' Stops the local Sawbuck AI server (closes the hidden node process).
Dim sh, answer
Set sh = CreateObject("WScript.Shell")
answer = MsgBox("Stop the Sawbuck AI server? This closes the local app.", 4 + 32, "Sawbuck AI")
If answer = 6 Then
  sh.Run "cmd /c taskkill /F /IM node.exe /T", 0, True
  MsgBox "Sawbuck AI server stopped.", 64, "Sawbuck AI"
End If
