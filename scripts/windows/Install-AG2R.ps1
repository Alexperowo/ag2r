param([switch]$Quiet)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

function Show-Message([string]$Text, [string]$Title = 'AG2R Setup') {
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
  $desktop = [Environment]::GetFolderPath('Desktop')
  $programs = [Environment]::GetFolderPath('Programs')
  $startMenuFolder = Join-Path $programs 'AG2R'
  $powershellExe = Join-Path $PSHOME 'powershell.exe'

  if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'server.js') -PathType Leaf)) {
    throw 'server.js was not found. Keep the installer inside the AG2R project.'
  }

  $nodeCommand = Get-Command 'node.exe' -ErrorAction SilentlyContinue
  $npmCommand = Get-Command 'npm.cmd' -ErrorAction SilentlyContinue
  if (-not $nodeCommand -or -not $npmCommand) {
    throw 'Node.js was not found. Install Node.js 22 or newer, then run this installer again.'
  }

  $nodeVersion = (& $nodeCommand.Source --version).Trim().TrimStart('v')
  $nodeMajor = 0
  if (-not [int]::TryParse(($nodeVersion -split '\.')[0], [ref]$nodeMajor) -or $nodeMajor -lt 22) {
    throw "Node.js 22 or newer is required. Installed version: $nodeVersion"
  }

  $packageLock = Join-Path $projectRoot 'package-lock.json'
  if (-not (Test-Path -LiteralPath $packageLock -PathType Leaf)) {
    throw 'package-lock.json was not found.'
  }
  $runtimeDir = Join-Path $projectRoot '.runtime'
  $dependencyStamp = Join-Path $runtimeDir 'dependencies.sha256'
  New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
  $expectedHash = (Get-FileHash -LiteralPath $packageLock -Algorithm SHA256).Hash
  $installedHash = if (Test-Path -LiteralPath $dependencyStamp -PathType Leaf) {
    (Get-Content -LiteralPath $dependencyStamp -Raw).Trim()
  } else { '' }
  $expressPackage = Join-Path $projectRoot 'node_modules\express\package.json'

  if ($installedHash -ne $expectedHash -or -not (Test-Path -LiteralPath $expressPackage -PathType Leaf)) {
    $serverState = Join-Path $runtimeDir 'server.json'
    if (Test-Path -LiteralPath $serverState -PathType Leaf) {
      throw "AG2R is running or was not stopped normally. Use 'Stop AG2R', then run the installer again."
    }
    Show-Message 'Dependencies will now be installed. This can take several minutes.'
    $npmProcess = Start-Process -FilePath $npmCommand.Source -ArgumentList @('ci', '--no-audit', '--no-fund') -WorkingDirectory $projectRoot -WindowStyle Hidden -Wait -PassThru
    if ($npmProcess.ExitCode -ne 0) {
      throw "Dependency installation failed with exit code $($npmProcess.ExitCode). Check the internet connection and try again."
    }
    [IO.File]::WriteAllText($dependencyStamp, $expectedHash, (New-Object Text.UTF8Encoding($false)))
  }

  New-Item -ItemType Directory -Path $startMenuFolder -Force | Out-Null
  $shell = New-Object -ComObject WScript.Shell
  $shortcuts = @(
    @{ Name = 'Start AG2R'; Script = 'Start-AG2R.ps1'; Description = 'Start AG2R and Antigravity remote access' },
    @{ Name = 'AG2R Status'; Script = 'Show-AG2RStatus.ps1'; Description = 'Show AG2R connection details and passcode' },
    @{ Name = 'Stop AG2R'; Script = 'Stop-AG2R.ps1'; Description = 'Stop the local AG2R server' }
  )

  foreach ($item in $shortcuts) {
    $scriptPath = Join-Path $PSScriptRoot $item.Script
    foreach ($folder in @($desktop, $startMenuFolder)) {
      $shortcutPath = Join-Path $folder ($item.Name + '.lnk')
      $shortcut = $shell.CreateShortcut($shortcutPath)
      $shortcut.TargetPath = $powershellExe
      $shortcut.Arguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $scriptPath + '"'
      $shortcut.WorkingDirectory = $projectRoot
      $shortcut.Description = $item.Description
      $shortcut.WindowStyle = 7
      $shortcut.Save()
    }
  }

  Show-Message "AG2R shortcuts were installed on the Desktop and in the Start menu.`n`nUse 'Start AG2R' for normal operation."
} catch {
  if ($Quiet) { Write-Error $_.Exception.Message }
  else { Show-Message $_.Exception.Message 'AG2R Setup Error' }
  exit 1
}
