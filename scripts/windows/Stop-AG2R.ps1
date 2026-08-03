param([switch]$Quiet)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

function Show-Message([string]$Text, [string]$Title = 'AG2R') {
  if ($Quiet) {
    Write-Output ("${Title}: ${Text}")
    return
  }
  [System.Windows.Forms.MessageBox]::Show(
    $Text,
    $Title,
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Information
  ) | Out-Null
}

try {
  $projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
  $processFile = Join-Path $projectRoot '.runtime\server.json'
  if (-not (Test-Path -LiteralPath $processFile -PathType Leaf)) {
    Show-Message 'AG2R is not running, or it was started manually.'
    exit 0
  }

  $saved = Get-Content -LiteralPath $processFile -Raw | ConvertFrom-Json
  $process = Get-Process -Id ([int]$saved.Pid) -ErrorAction SilentlyContinue
  if (-not $process) {
    Remove-Item -LiteralPath $processFile -Force
    Show-Message 'AG2R is already stopped.'
    exit 0
  }

  $sameStartTime = $process.StartTime.ToUniversalTime().ToString('O') -eq [string]$saved.StartTime
  if ($process.ProcessName -ne 'node' -or -not $sameStartTime -or [string]$saved.ProjectRoot -ne $projectRoot) {
    throw 'The saved process information is stale. No process was stopped.'
  }

  Stop-Process -Id $process.Id -ErrorAction Stop
  $process.WaitForExit(5000) | Out-Null
  Remove-Item -LiteralPath $processFile -Force
  Show-Message 'AG2R has stopped. Antigravity was left open.'
} catch {
  Show-Message $_.Exception.Message 'AG2R Stop Error'
  exit 1
}
