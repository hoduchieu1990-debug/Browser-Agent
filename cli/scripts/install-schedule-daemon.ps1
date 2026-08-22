<#
.SYNOPSIS
  Installs (or removes) a Windows Task Scheduler entry that runs
  `browser-agent schedule run` in the background, starting automatically
  at logon, with no visible console window.

.PARAMETER Uninstall
  Remove the scheduled task instead of creating it.

.PARAMETER Dir
  Folder to watch for .schedule.json files. Defaults to the same folder
  the extension downloads schedules into: Downloads\BrowserAgent-Schedules.

.PARAMETER Interval
  Poll interval in seconds. Default 60.

.EXAMPLE
  .\install-schedule-daemon.ps1
  .\install-schedule-daemon.ps1 -Uninstall
#>
param(
  [switch]$Uninstall,
  [string]$Dir = (Join-Path $env:USERPROFILE 'Downloads\BrowserAgent-Schedules'),
  [int]$Interval = 60
)

$TaskName = 'BrowserAgentSchedule'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$CliEntry = Join-Path $ScriptDir '..\dist\index.js'
$VbsPath = Join-Path $ScriptDir 'run-schedule-daemon.vbs'

if ($Uninstall) {
  schtasks /delete /tn $TaskName /f 2>$null
  if (Test-Path $VbsPath) { Remove-Item $VbsPath -Force }
  Write-Host "Removed scheduled task '$TaskName'."
  exit 0
}

if (-not (Test-Path $CliEntry)) {
  Write-Error "Not found: $CliEntry — run 'npm run build' in the cli/ workspace first."
  exit 1
}

$NodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $NodePath) {
  Write-Error "node.exe not found on PATH."
  exit 1
}

# node.exe is a console-subsystem binary — running it directly through Task
# Scheduler still briefly shows a window. Routing through wscript.exe's
# WshShell.Run(..., 0, False) is the standard way to launch it fully hidden.
$CliEntryResolved = (Resolve-Path $CliEntry).Path
$Command = "`"$NodePath`" `"$CliEntryResolved`" schedule run --dir `"$Dir`" --interval $Interval"
$VbsContent = @"
Set shell = CreateObject("WScript.Shell")
shell.Run "$($Command.Replace('"', '""'))", 0, False
"@
Set-Content -Path $VbsPath -Value $VbsContent -Encoding ASCII

schtasks /create /tn $TaskName /tr "wscript.exe //B `"$VbsPath`"" /sc onlogon /rl limited /f | Out-Null

Write-Host "Installed scheduled task '$TaskName' — starts at logon, watches $Dir every ${Interval}s."
Write-Host "To start it right now without logging out/in: schtasks /run /tn $TaskName"
Write-Host "To remove it later: .\install-schedule-daemon.ps1 -Uninstall"
