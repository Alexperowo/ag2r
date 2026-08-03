param(
  [switch]$SkipAntigravity,
  [switch]$NoBrowser,
  [switch]$Quiet
)

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

function New-HexSecret([int]$ByteCount) {
  $bytes = New-Object byte[] $ByteCount
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
  return -join ($bytes | ForEach-Object { $_.ToString('x2') })
}

function New-Passcode {
  $randomBytes = New-Object byte[] 4
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($randomBytes) } finally { $generator.Dispose() }
  $number = [BitConverter]::ToUInt32($randomBytes, 0)
  return [string](10000000 + ($number % 90000000))
}

function Get-EnvValue([string]$Path, [string]$Name, [string]$DefaultValue = '') {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $DefaultValue }
  $match = Get-Content -LiteralPath $Path | Where-Object { $_ -match ('^' + [regex]::Escape($Name) + '=(.*)$') } | Select-Object -Last 1
  if ($match -and $match -match '^[^=]+=(.*)$') { return $Matches[1].Trim() }
  return $DefaultValue
}

function Set-EnvValue([string]$Path, [string]$Name, [string]$Value) {
  $lines = @(Get-Content -LiteralPath $Path)
  $pattern = '^' + [regex]::Escape($Name) + '='
  $updated = $false
  for ($index = 0; $index -lt $lines.Count; $index++) {
    if ($lines[$index] -match $pattern) {
      $lines[$index] = $Name + '=' + $Value
      $updated = $true
    }
  }
  if (-not $updated) { $lines += ($Name + '=' + $Value) }
  [IO.File]::WriteAllLines($Path, $lines, (New-Object Text.UTF8Encoding($false)))
}

function Test-Health([string]$Url) {
  try {
    $curl = Get-Command 'curl.exe' -ErrorAction Stop
    $json = & $curl.Source -k -sS --connect-timeout 1 --max-time 2 ($Url + '/health') 2>$null
    if ($LASTEXITCODE -ne 0) { return $false }
    $result = $json | ConvertFrom-Json
    return $result.status -eq 'ok'
  } catch { return $false }
}

function Test-Cdp {
  foreach ($port in 9000..9003) {
    try {
      Invoke-RestMethod -Uri ("http://127.0.0.1:$port/json/version") -Method Get -TimeoutSec 1 -UseBasicParsing | Out-Null
      return $true
    } catch {}
  }
  return $false
}

try {
  $projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
  $envPath = Join-Path $projectRoot '.env'
  $runtimeDir = Join-Path $projectRoot '.runtime'
  $logsDir = Join-Path $projectRoot 'logs'
  New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
  New-Item -ItemType Directory -Path $logsDir -Force | Out-Null

  $generatedPasscode = $null
  if (-not (Test-Path -LiteralPath $envPath -PathType Leaf)) {
    $generatedPasscode = New-Passcode
    $lines = @(
      'PORT=3000',
      'CDP_HOST=127.0.0.1',
      'CDP_PORT=9000',
      'AUTH_ENABLED=true',
      ('APP_PASSWORD=' + $generatedPasscode),
      ('SESSION_SECRET=' + (New-HexSecret 32)),
      'POLL_INTERVAL_MS=500',
      'TUNNEL_ENABLED=false',
      'HTTP_ONLY=false'
    )
    [IO.File]::WriteAllLines($envPath, $lines, (New-Object Text.UTF8Encoding($false)))
  }

  $configuredPasscode = Get-EnvValue $envPath 'APP_PASSWORD' ''
  if ([string]::IsNullOrWhiteSpace($configuredPasscode)) {
    $generatedPasscode = New-Passcode
    Set-EnvValue $envPath 'APP_PASSWORD' $generatedPasscode
  }
  $configuredSessionSecret = Get-EnvValue $envPath 'SESSION_SECRET' ''
  if ([string]::IsNullOrWhiteSpace($configuredSessionSecret)) {
    Set-EnvValue $envPath 'SESSION_SECRET' (New-HexSecret 32)
  }

  $portValue = Get-EnvValue $envPath 'PORT' '3000'
  $port = 0
  if (-not [int]::TryParse($portValue, [ref]$port) -or $port -lt 1 -or $port -gt 65535) {
    throw 'PORT in .env must be a number between 1 and 65535.'
  }
  $httpOnly = (Get-EnvValue $envPath 'HTTP_ONLY' 'false') -eq 'true'
  $protocol = if ($httpOnly) { 'http' } else { 'https' }
  $localUrl = "${protocol}://localhost:$port"

  if (Test-Health $localUrl) {
    if (-not $NoBrowser) { Start-Process $localUrl }
    Show-Message "AG2R is already running.`n`nAddress: $localUrl"
    exit 0
  }

  if (-not $SkipAntigravity -and -not (Test-Cdp)) {
    $runningAntigravity = Get-Process -Name 'Antigravity' -ErrorAction SilentlyContinue
    if ($runningAntigravity) {
      Show-Message "Antigravity is already open without remote control enabled.`n`nSave your work, close all Antigravity windows, and run 'Start AG2R' again." 'AG2R Needs Attention'
      exit 2
    }

    $antigravityCandidates = @(
      (Join-Path $env:LOCALAPPDATA 'Programs\antigravity\Antigravity.exe'),
      (Join-Path $env:ProgramFiles 'Antigravity\Antigravity.exe')
    )
    $antigravityExe = $antigravityCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    if (-not $antigravityExe) {
      throw 'Antigravity.exe was not found. Install Antigravity, then run this shortcut again.'
    }

    Start-Process -FilePath $antigravityExe -ArgumentList @('--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9000')
    foreach ($attempt in 1..40) {
      if (Test-Cdp) { break }
      Start-Sleep -Milliseconds 500
    }
  }

  $nodeCommand = Get-Command 'node.exe' -ErrorAction SilentlyContinue
  if (-not $nodeCommand) { throw 'Node.js was not found. Install Node.js 22 or newer and try again.' }
  if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules') -PathType Container)) {
    throw 'AG2R dependencies are not installed. Run Install AG2R again after connecting to the internet.'
  }

  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $stdoutLog = Join-Path $logsDir ("server-$stamp.out.log")
  $stderrLog = Join-Path $logsDir ("server-$stamp.error.log")
  $serverProcess = Start-Process -FilePath $nodeCommand.Source -ArgumentList @('server.js') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -PassThru
  $processInfo = @{
    Pid = $serverProcess.Id
    StartTime = $serverProcess.StartTime.ToUniversalTime().ToString('O')
    ProjectRoot = $projectRoot
  } | ConvertTo-Json
  [IO.File]::WriteAllText((Join-Path $runtimeDir 'server.json'), $processInfo, (New-Object Text.UTF8Encoding($false)))

  $started = $false
  foreach ($attempt in 1..30) {
    if (Test-Health $localUrl) { $started = $true; break }
    if ($serverProcess.HasExited) { break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $started) {
    if ($serverProcess -and -not $serverProcess.HasExited) {
      Stop-Process -Id $serverProcess.Id -ErrorAction SilentlyContinue
    }
    $details = if (Test-Path -LiteralPath $stderrLog) { (Get-Content -LiteralPath $stderrLog -Tail 8) -join "`n" } else { 'No error details were written.' }
    throw "AG2R did not start.`n`n$details"
  }

  $passcode = Get-EnvValue $envPath 'APP_PASSWORD' $generatedPasscode
  $cdpState = if (Test-Cdp) { 'connected' } else { 'not connected' }
  Show-Message "AG2R is running.`n`nAddress: $localUrl`nAntigravity: $cdpState`nPasscode: $passcode`n`nThe status shortcut shows phone addresses."
  if (-not $NoBrowser) { Start-Process $localUrl }
} catch {
  if ($serverProcess -and -not $serverProcess.HasExited) {
    Stop-Process -Id $serverProcess.Id -ErrorAction SilentlyContinue
  }
  Show-Message $_.Exception.Message 'AG2R Start Error'
  exit 1
}
