param([switch]$Quiet)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

function Show-Message([string]$Text, [string]$Title = 'AG2R Status') {
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

function Get-EnvValue([string]$Path, [string]$Name, [string]$DefaultValue = '') {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $DefaultValue }
  $match = Get-Content -LiteralPath $Path | Where-Object { $_ -match ('^' + [regex]::Escape($Name) + '=(.*)$') } | Select-Object -Last 1
  if ($match -and $match -match '^[^=]+=(.*)$') { return $Matches[1].Trim() }
  return $DefaultValue
}

function Get-Health([string]$Url) {
  try {
    $curl = Get-Command 'curl.exe' -ErrorAction Stop
    $json = & $curl.Source -k -sS --connect-timeout 1 --max-time 2 ($Url + '/health') 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    return $json | ConvertFrom-Json
  } catch { return $null }
}

try {
  $projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
  $envPath = Join-Path $projectRoot '.env'
  if (-not (Test-Path -LiteralPath $envPath -PathType Leaf)) {
    Show-Message "AG2R has not been configured yet.`n`nUse 'Start AG2R' first."
    exit 0
  }

  $port = Get-EnvValue $envPath 'PORT' '3000'
  $httpOnly = (Get-EnvValue $envPath 'HTTP_ONLY' 'false') -eq 'true'
  $protocol = if ($httpOnly) { 'http' } else { 'https' }
  $localUrl = "${protocol}://localhost:$port"
  $passcode = Get-EnvValue $envPath 'APP_PASSWORD' '(temporary passcode is shown at startup)'

  $health = Get-Health $localUrl
  if (-not $health) {
    Show-Message "AG2R is not running.`n`nUse the 'Start AG2R' shortcut."
    exit 0
  }

  $addresses = [Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() |
    Where-Object { $_.OperationalStatus -eq 'Up' -and $_.NetworkInterfaceType -ne 'Loopback' } |
    ForEach-Object { $_.GetIPProperties().UnicastAddresses } |
    ForEach-Object { $_.Address } |
    Where-Object { $_.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork -and -not $_.ToString().StartsWith('169.254.') } |
    ForEach-Object { "${protocol}://$($_.ToString()):$port" } |
    Sort-Object -Unique

  $phoneAddresses = if ($addresses) { $addresses -join "`n" } else { 'No local network address was found.' }
  $cdpState = if ($health.cdpConnected) { 'connected' } else { 'not connected' }
  Show-Message "Server: running`nAntigravity: $cdpState`nPasscode: $passcode`n`nComputer:`n$localUrl`n`nPhone (same Wi-Fi):`n$phoneAddresses`n`nA browser warning about the local certificate is expected on first access."
} catch {
  Show-Message $_.Exception.Message 'AG2R Status Error'
  exit 1
}
