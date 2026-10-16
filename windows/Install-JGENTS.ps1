<#
  Install-JGENTS.ps1
  Makes JGENTS behave like an installed Windows app.

    (no switch)  install: a hidden scheduled task keeps the server running (at logon and every 3 minutes it
                 starts the server if it is down), plus Desktop and Start menu shortcuts that open JGENTS in
                 its own window. Pin it: right-click the Start menu entry or the open window -> Pin to taskbar.
    -Restart     restart the server (after `npm run build`), then wait until it answers
    -Uninstall   remove the shortcuts and the scheduled task, and stop the server

  Usage (from the repo):
    npm run win:install
    npm run win:restart
    npm run win:uninstall
#>
[CmdletBinding()]
param(
  [switch]$Restart,
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$winDir    = $PSScriptRoot
$root      = Split-Path -Parent $winDir
$launcher  = Join-Path $winDir 'JGENTS.vbs'
$watchdog  = Join-Path $winDir 'JGENTS-Server.vbs'
$nodePath  = Join-Path $winDir 'node.path'
$icon      = Join-Path $root 'client\public\assets\brand\jgents.ico'
$entry     = Join-Path $root 'dist\server\index.js'
$wscript   = Join-Path $env:WINDIR 'System32\wscript.exe'
$taskName  = 'JGENTS'
$port      = if ($env:JGENTS_PORT) { [int]$env:JGENTS_PORT } else { 4747 }
$url       = "http://127.0.0.1:$port/"

$startMenu  = Join-Path ([Environment]::GetFolderPath('Programs')) 'JGENTS.lnk'
$desktopLnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'JGENTS.lnk'

# Remove-Item refuses paths with spaces in some shells here; File.Delete does not.
function Remove-File($p) {
  if (Test-Path -LiteralPath $p) { [System.IO.File]::Delete((Convert-Path -LiteralPath $p)); Write-Host "removed  $p" }
}

function New-Shortcut($path, $target, $arguments, $workdir, $iconPath, $desc) {
  $sh = New-Object -ComObject WScript.Shell
  $lnk = $sh.CreateShortcut($path)
  $lnk.TargetPath = $target; $lnk.Arguments = $arguments
  $lnk.WorkingDirectory = $workdir; $lnk.IconLocation = "$iconPath,0"
  $lnk.Description = $desc; $lnk.WindowStyle = 1
  $lnk.Save(); Write-Host "created  $path"
}

function Test-Server {
  try { return (Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 } catch { return $false }
}

# The JGENTS server: the node process listening on the port whose command line runs dist\server\index.js.
function Stop-Server {
  $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  foreach ($c in $conns) {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($c.OwningProcess)"
    if ($p -and $p.CommandLine -match 'dist[\\/]server[\\/]index\.js') {
      Stop-Process -Id $p.ProcessId -Force -Confirm:$false
      Write-Host "stopped  server (pid $($p.ProcessId))"
    } elseif ($p) {
      Write-Warning "port $port is held by something else (pid $($p.ProcessId): $($p.Name)); left running"
    }
  }
}

function Start-Server {
  & $wscript $watchdog | Out-Null
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 250
    if (Test-Server) { Write-Host "running  $url"; return }
  }
  throw "the server did not answer at $url within 10 s; see $env:USERPROFILE\.jgents\server.log"
}

# --- uninstall ---------------------------------------------------------------------------------------------
if ($Uninstall) {
  Remove-File $desktopLnk; Remove-File $startMenu; Remove-File $nodePath
  if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "removed  scheduled task '$taskName'"
  }
  Stop-Server
  Write-Host "`nDone. If you pinned JGENTS to the taskbar, unpin it there."
  return
}

# --- restart -----------------------------------------------------------------------------------------------
if ($Restart) {
  Stop-Server
  Start-Sleep -Milliseconds 500
  Start-Server
  return
}

# --- install -----------------------------------------------------------------------------------------------
foreach ($f in @($launcher, $watchdog, $icon)) { if (-not (Test-Path -LiteralPath $f)) { throw "missing $f" } }
if (-not (Test-Path -LiteralPath $entry)) { throw "JGENTS is not built yet: run npm run build first" }

# Pin the node.exe the scheduled task will use (Task Scheduler does not get the shell's PATH tweaks).
$node = (Get-Command node.exe -ErrorAction Stop).Source
Set-Content -LiteralPath $nodePath -Value $node -Encoding ASCII -NoNewline
Write-Host "node     $node"

$vbsArg = '"{0}"' -f $launcher
New-Shortcut $desktopLnk $wscript $vbsArg $root $icon 'Open JGENTS'
New-Shortcut $startMenu  $wscript $vbsArg $root $icon 'Open JGENTS'

# The task runs the idempotent watchdog: it exits at once when the server answers and starts it when not.
# Firing at logon and every 3 minutes means a stopped server is back within one interval.
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}
$action    = New-ScheduledTaskAction -Execute $wscript -Argument ('"{0}"' -f $watchdog) -WorkingDirectory $root
$atLogon   = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$repeat    = New-ScheduledTaskTrigger -Once -At (Get-Date) `
               -RepetitionInterval (New-TimeSpan -Minutes 3) `
               -RepetitionDuration (New-TimeSpan -Days 3650)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$settings  = New-ScheduledTaskSettingsSet `
               -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
               -StartWhenAvailable -MultipleInstances IgnoreNew `
               -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($atLogon, $repeat) `
  -Principal $principal -Settings $settings `
  -Description 'Keeps the JGENTS server running (checks every 3 min, starts it if down).' | Out-Null
Write-Host "created  scheduled task '$taskName' (logon + every 3 min)"

if (Test-Server) { Write-Host "running  $url (already up)" } else { Start-Server }

Write-Host @"

Done. JGENTS now starts with Windows and restarts itself if it stops.

  Open it:  'JGENTS' on the Desktop or in the Start menu.
  Taskbar:  right-click 'JGENTS' in the Start menu (or its open window) -> Pin to taskbar.
  Logs:     $env:USERPROFILE\.jgents\server.log
"@
