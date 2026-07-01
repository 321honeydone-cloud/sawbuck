Option Explicit
' Run this once. It puts a "Sawbuck AI" icon (the hex logo) on your desktop and
' in this folder. After that, just double-click the icon to open the app.
Dim fso, sh, scriptDir, desktop, lnk, lnk2
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
desktop = sh.SpecialFolders("Desktop")

Set lnk = sh.CreateShortcut(desktop & "\Sawbuck AI.lnk")
lnk.TargetPath = "wscript.exe"
lnk.Arguments = """" & scriptDir & "\Start Sawbuck.vbs"""
lnk.WorkingDirectory = scriptDir
lnk.IconLocation = scriptDir & "\launcher\Sawbuck.ico"
lnk.Description = "Sawbuck AI"
lnk.Save

Set lnk2 = sh.CreateShortcut(scriptDir & "\Sawbuck AI.lnk")
lnk2.TargetPath = "wscript.exe"
lnk2.Arguments = """" & scriptDir & "\Start Sawbuck.vbs"""
lnk2.WorkingDirectory = scriptDir
lnk2.IconLocation = scriptDir & "\launcher\Sawbuck.ico"
lnk2.Description = "Sawbuck AI"
lnk2.Save

MsgBox "Done. A 'Sawbuck AI' icon is on your desktop. Double-click it to open the app. You can drag it onto the taskbar to pin it.", 64, "Sawbuck AI"
