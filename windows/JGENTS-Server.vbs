' JGENTS watchdog: starts the local server in the background if it is not already answering, then exits.
' Opens nothing and never shows a window. The scheduled task from Install-JGENTS.ps1 runs it at logon and
' every 3 minutes, so a server that stopped comes back within one interval.
Option Explicit

Dim fso : Set fso = CreateObject("Scripting.FileSystemObject")
Dim sh  : Set sh  = CreateObject("WScript.Shell")
Dim winDir : winDir = fso.GetParentFolderName(WScript.ScriptFullName)
Dim root   : root   = fso.GetParentFolderName(winDir)
Dim URL    : URL    = "http://127.0.0.1:" & Port() & "/"

If ServerUp() Then WScript.Quit
StartServer

Sub StartServer()
  Dim q : q = Chr(34)
  Dim node : node = NodeExe()
  Dim entry : entry = root & "\dist\server\index.js"
  If Not fso.FileExists(entry) Then WScript.Quit 2   ' not built: npm run build
  Dim logDir : logDir = sh.ExpandEnvironmentStrings("%USERPROFILE%") & "\.jgents"
  If Not fso.FolderExists(logDir) Then fso.CreateFolder logDir
  Dim logFile : logFile = logDir & "\server.log"
  If fso.FileExists(logFile) Then
    If fso.GetFile(logFile).Size > 5 * 1024 * 1024 Then fso.DeleteFile logFile, True
  End If
  sh.CurrentDirectory = root
  ' cmd /c ""node" --env-file-if-exists="<root>\.env" "<entry>" >> "<log>" 2>&1"  (outer quotes are stripped by cmd)
  Dim cmd : cmd = "cmd /d /c " & q & q & node & q & " --env-file-if-exists=" & q & root & "\.env" & q & " " & q & entry & q & " >> " & q & logFile & q & " 2>&1" & q
  sh.Run cmd, 0, False   ' 0 = hidden
End Sub

Function NodeExe()
  Dim cfg : cfg = winDir & "\node.path"
  If fso.FileExists(cfg) Then
    Dim p : p = Trim(fso.OpenTextFile(cfg, 1).ReadAll())
    If p <> "" And fso.FileExists(p) Then
      NodeExe = p
      Exit Function
    End If
  End If
  NodeExe = "node.exe"
End Function

Function Port()
  Dim p : p = sh.ExpandEnvironmentStrings("%JGENTS_PORT%")
  If p = "%JGENTS_PORT%" Or p = "" Then p = "4747"
  Port = p
End Function

Function ServerUp()
  On Error Resume Next
  Dim http
  Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  http.SetTimeouts 800, 800, 1500, 1500
  http.Open "GET", URL, False
  http.Send
  ServerUp = (Err.Number = 0) And (http.Status = 200)
  On Error GoTo 0
End Function
