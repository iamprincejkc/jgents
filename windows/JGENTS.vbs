' JGENTS launcher: opens the office in its own app window (Edge --app), starting the local server first
' if it is not answering yet. No console window ever shows. The Desktop and Start menu shortcuts point here.
Option Explicit

Dim fso : Set fso = CreateObject("Scripting.FileSystemObject")
Dim sh  : Set sh  = CreateObject("WScript.Shell")
Dim winDir : winDir = fso.GetParentFolderName(WScript.ScriptFullName)
Dim port : port = sh.ExpandEnvironmentStrings("%JGENTS_PORT%")
If port = "%JGENTS_PORT%" Or port = "" Then port = "4747"
Dim URL : URL = "http://127.0.0.1:" & port & "/"
Dim i, tries

If Not ServerUp() Then
  For tries = 1 To 2
    sh.Run "wscript.exe """ & winDir & "\JGENTS-Server.vbs""", 0, True
    For i = 1 To 40            ' up to ~10 s per attempt
      WScript.Sleep 250
      If ServerUp() Then Exit For
    Next
    If ServerUp() Then Exit For
  Next
End If

Dim edge : edge = FindEdge()
If edge <> "" Then
  sh.Run """" & edge & """ --app=" & URL, 1, False
Else
  sh.Run URL, 1, False         ' no Edge: default browser
End If

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

Function FindEdge()
  Dim p, cands
  cands = Array( _
    sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"), _
    sh.ExpandEnvironmentStrings("%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"), _
    sh.ExpandEnvironmentStrings("%LocalAppData%\Microsoft\Edge\Application\msedge.exe"))
  FindEdge = ""
  For Each p In cands
    If fso.FileExists(p) Then
      FindEdge = p
      Exit Function
    End If
  Next
End Function
