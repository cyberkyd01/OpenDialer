<#
.SYNOPSIS
  Removes the OpenDialer scheduled task created by install-service.ps1.

.DESCRIPTION
  Stops and unregisters the task, stops the running server process started by it and,
  with -RemoveFirewallRule, deletes the "OpenDialer" firewall rule.
  Your data directory (database, recordings, backups, certificate) is NOT touched.
  Run from an elevated PowerShell ("Run as administrator").

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\windows\uninstall-service.ps1 -RemoveFirewallRule

.EXAMPLE
  .\scripts\windows\uninstall-service.ps1 -DryRun
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$TaskName = 'OpenDialer',
  [switch]$RemoveFirewallRule,
  [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$apply = -not $DryRun -and -not $WhatIfPreference

function Write-Step([string]$msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Plan([string]$msg) { Write-Host "    [dry-run] $msg" -ForegroundColor Yellow }

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Warning 'Not running as administrator. Right-click PowerShell -> "Run as administrator".'
  if ($apply) { throw 'Administrator rights are required.' }
}

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
  Write-Host "No scheduled task named '$TaskName' found."
} else {
  Write-Step "Stop and remove scheduled task '$TaskName'"
  if ($apply) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  } else {
    Write-Plan "would stop and unregister '$TaskName'"
  }
}

# Stopping the task ends cmd.exe; make sure the node.exe child running the server is gone too.
Write-Step 'Stop OpenDialer server processes'
$procs = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine -match 'packages[\\/]server[\\/]dist[\\/]index\.js' }
if (-not $procs) {
  Write-Host '    none running'
} else {
  foreach ($p in $procs) {
    if ($apply) { Stop-Process -Id $p.ProcessId -Force -Confirm:$false } else { Write-Plan "would stop node.exe PID $($p.ProcessId)" }
  }
}

if ($RemoveFirewallRule) {
  Write-Step "Remove firewall rule 'OpenDialer'"
  $rule = Get-NetFirewallRule -DisplayName 'OpenDialer' -ErrorAction SilentlyContinue
  if (-not $rule) { Write-Host '    no rule found' }
  elseif ($apply) { $rule | Remove-NetFirewallRule }
  else { Write-Plan "would remove firewall rule 'OpenDialer'" }
}

Write-Host ''
if ($apply) { Write-Host 'OpenDialer service removed. Your data directory was kept.' -ForegroundColor Green }
else { Write-Host 'Dry run finished - nothing was changed.' -ForegroundColor Green }
