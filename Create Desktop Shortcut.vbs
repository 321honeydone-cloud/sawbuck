' Run this once. It puts a "HoneyDone Estimating" icon on your desktop
' that launches the app. After that, just double-click the desktop icon.
Set sh = CreateObject("WScript.Shell")
desktop = sh.SpecialFolders("Desktop")
Set lnk = sh.CreateShortcut(desktop & "\HoneyDone Estimating.lnk")
lnk.TargetPath = "C:\Claude\handoff\Start HoneyDone.bat"
lnk.WorkingDirectory = "C:\Claude\handoff"
lnk.WindowStyle = 7
lnk.Description = "Open HoneyDone Estimating"
lnk.Save
MsgBox "Done. 'HoneyDone Estimating' is on your desktop. Double-click it to open the app.", 64, "HoneyDone"
