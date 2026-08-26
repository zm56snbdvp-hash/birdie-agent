[CmdletBinding()]
param(
  [switch]$ForceDesktopDependencyRepair,
  [switch]$RebuildVoice
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
$desktopDir = Join-Path $repoRoot 'apps/desktop'
$voiceExe = Join-Path $repoRoot 'build/voice/Release/birdie-voice-host.exe'
$whisperModel = Join-Path $repoRoot 'models/whisper/ggml-base.bin'
$whisperSetup = Join-Path $PSScriptRoot 'setup-birdie-whisper-cpp.ps1'
$managedTauriConfig = Join-Path $desktopDir 'src-tauri/tauri.managed-dev.conf.json'
$tauriCommand = Join-Path $desktopDir 'node_modules/.bin/tauri.cmd'
$vitePort = 1420
$logDirectory = Join-Path $repoRoot '.birdie/logs'
$viteStdout = Join-Path $logDirectory 'vite.stdout.log'
$viteStderr = Join-Path $logDirectory 'vite.stderr.log'

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' was not found in PATH."
  }
}

function Test-ViteListener {
  return @(
    Get-NetTCPConnection `
      -LocalPort $vitePort `
      -State Listen `
      -ErrorAction SilentlyContinue
  ).Count -gt 0
}

function Stop-StaleBirdieProcesses {
  $repoNeedle = [IO.Path]::GetFullPath($repoRoot)
  $candidateNames = @(
    'node.exe',
    'cargo.exe',
    'rustc.exe',
    'birdie-desktop.exe',
    'birdie-voice-host.exe'
  )

  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      $_.Name -in $candidateNames -and
      -not [string]::IsNullOrWhiteSpace([string]$_.CommandLine) -and
      ([string]$_.CommandLine).IndexOf(
        $repoNeedle,
        [StringComparison]::OrdinalIgnoreCase
      ) -ge 0
    } |
    ForEach-Object {
      Write-Host (
        "Stopping stale Birdie process: {0} PID {1}" -f
        $_.Name,
        $_.ProcessId
      ) -ForegroundColor Yellow
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }

  $deadline = [DateTime]::UtcNow.AddSeconds(5)
  do {
    if (-not (Test-ViteListener)) {
      return
    }
    Start-Sleep -Milliseconds 150
  } while ([DateTime]::UtcNow -lt $deadline)

  $listener = Get-NetTCPConnection `
    -LocalPort $vitePort `
    -State Listen `
    -ErrorAction SilentlyContinue |
    Select-Object -First 1

  if ($listener) {
    $process = Get-CimInstance `
      Win32_Process `
      -Filter "ProcessId = $($listener.OwningProcess)" `
      -ErrorAction SilentlyContinue
    $name = if ($process) { [string]$process.Name } else { 'unknown' }
    $commandLine = if ($process) { [string]$process.CommandLine } else { '' }
    throw (
      "Port $vitePort is occupied by PID {0} ({1}). Command line: {2}" -f
      $listener.OwningProcess,
      $name,
      $commandLine
    )
  }
}

function Test-DesktopJavaScriptToolchain {
  Push-Location $desktopDir
  try {
    & node -e "Promise.all([import('vite'),import('rollup')]).then(()=>process.exit(0)).catch((error)=>{console.error(error?.stack||error);process.exit(1)})"
    return $LASTEXITCODE -eq 0
  }
  finally {
    Pop-Location
  }
}

function Install-DesktopDependencies {
  Write-Host 'Installing Birdie Desktop dependencies including native optional packages...' -ForegroundColor Green
  Push-Location $desktopDir
  try {
    & npm install --include=optional --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) {
      throw "npm install failed with exit code $LASTEXITCODE."
    }
  }
  finally {
    Pop-Location
  }
}

function Repair-DesktopDependencies {
  $nodeModules = Join-Path $desktopDir 'node_modules'
  $lockFile = Join-Path $desktopDir 'package-lock.json'

  $healthy = $false
  if (-not $ForceDesktopDependencyRepair -and
      (Test-Path -LiteralPath $nodeModules -PathType Container)) {
    Write-Host 'Checking Vite and Rollup native dependencies...' -ForegroundColor Cyan
    $healthy = Test-DesktopJavaScriptToolchain
  }

  if ($healthy) {
    Write-Host 'Desktop JavaScript toolchain is ready.' -ForegroundColor Green
    return
  }

  Write-Host 'Repairing the local Vite/Rollup installation...' -ForegroundColor Yellow
  Remove-Item -LiteralPath $nodeModules -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue

  Push-Location $desktopDir
  try {
    & npm cache verify
    if ($LASTEXITCODE -ne 0) {
      throw "npm cache verify failed with exit code $LASTEXITCODE."
    }
  }
  finally {
    Pop-Location
  }

  Install-DesktopDependencies
  if (Test-DesktopJavaScriptToolchain) {
    return
  }

  $architecture = (& node -p "process.arch").Trim()
  $nativePackage = switch ($architecture) {
    'x64' { '@rollup/rollup-win32-x64-msvc' }
    'arm64' { '@rollup/rollup-win32-arm64-msvc' }
    default {
      throw "Unsupported Windows Node architecture for Rollup: $architecture"
    }
  }

  $rollupManifest = Join-Path $desktopDir 'node_modules/rollup/package.json'
  if (-not (Test-Path -LiteralPath $rollupManifest -PathType Leaf)) {
    throw 'Rollup was not installed after the clean npm install.'
  }
  $rollupVersion = (Get-Content -LiteralPath $rollupManifest -Raw |
      ConvertFrom-Json).version

  Write-Host (
    "Installing matching Rollup native package: {0}@{1}" -f
    $nativePackage,
    $rollupVersion
  ) -ForegroundColor Yellow

  Push-Location $desktopDir
  try {
    & npm install `
      --no-save `
      --no-package-lock `
      --include=optional `
      --no-audit `
      --no-fund `
      "$nativePackage@$rollupVersion"
    if ($LASTEXITCODE -ne 0) {
      throw "Native Rollup package install failed with exit code $LASTEXITCODE."
    }
  }
  finally {
    Pop-Location
  }

  if (-not (Test-DesktopJavaScriptToolchain)) {
    throw 'Vite/Rollup still cannot load after a clean dependency repair.'
  }
}

function Show-ViteLogs {
  Write-Host "`n===== Birdie Vite stdout =====" -ForegroundColor Cyan
  if (Test-Path -LiteralPath $viteStdout -PathType Leaf) {
    Get-Content -LiteralPath $viteStdout -ErrorAction SilentlyContinue
  }
  else {
    Write-Host '(no stdout log)'
  }

  Write-Host "`n===== Birdie Vite stderr =====" -ForegroundColor Cyan
  if (Test-Path -LiteralPath $viteStderr -PathType Leaf) {
    Get-Content -LiteralPath $viteStderr -ErrorAction SilentlyContinue
  }
  else {
    Write-Host '(no stderr log)'
  }

  Write-Host "`nLog files: $logDirectory" -ForegroundColor DarkGray
}

function Start-ManagedVite {
  New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
  Remove-Item -LiteralPath $viteStdout -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $viteStderr -Force -ErrorAction SilentlyContinue

  $npmCommand = (Get-Command npm.cmd -ErrorAction Stop).Source
  Write-Host 'Starting Vite as an explicitly managed process...' -ForegroundColor Green
  $process = Start-Process `
    -FilePath $npmCommand `
    -ArgumentList @('run', 'dev') `
    -WorkingDirectory $desktopDir `
    -RedirectStandardOutput $viteStdout `
    -RedirectStandardError $viteStderr `
    -NoNewWindow `
    -PassThru

  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  do {
    $process.Refresh()
    if ($process.HasExited) {
      Start-Sleep -Milliseconds 250
      Show-ViteLogs
      throw "Vite exited before opening port $vitePort (exit code $($process.ExitCode))."
    }
    if (Test-ViteListener) {
      Write-Host "Vite is ready at http://127.0.0.1:$vitePort" -ForegroundColor Green
      return $process
    }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $deadline)

  Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  Show-ViteLogs
  throw "Vite did not open port $vitePort within 30 seconds."
}

function Configure-FullVoiceDemoEnvironment {
  if (-not (Test-Path -LiteralPath $voiceExe -PathType Leaf)) {
    if ($RebuildVoice) {
      throw 'The recovery launcher cannot rebuild Voice independently. Run the normal FullVoiceDemo once without -SkipVoiceBuild, then retry recovery.'
    }
    throw "Birdie Voice executable was not found: $voiceExe"
  }

  if (-not (Test-Path -LiteralPath $whisperModel -PathType Leaf)) {
    if (-not (Test-Path -LiteralPath $whisperSetup -PathType Leaf)) {
      throw "Birdie Whisper setup helper was not found: $whisperSetup"
    }
    Write-Host 'Preparing the verified multilingual Whisper base model...' -ForegroundColor Green
    & $whisperSetup -Model base | Out-Host
    if ($LASTEXITCODE -ne 0) {
      throw "Birdie Whisper model setup failed with exit code $LASTEXITCODE."
    }
  }

  $env:BIRDIE_VOICE_EXE = (Resolve-Path -LiteralPath $voiceExe).Path
  $env:BIRDIE_MANAGE_CORE = '1'
  $env:BIRDIE_MANAGE_VOICE = '1'
  $env:BIRDIE_DEV_AUTO_ACCEPT = '0'
  $env:BIRDIE_BRAIN_PROVIDER = 'development-ack'
  $env:BIRDIE_TTS_PROVIDER = 'windows-sapi'
  $env:BIRDIE_TTS_RATE = '0'
  $env:BIRDIE_TTS_VOLUME = '100'
  $env:BIRDIE_GATE_STT_PROVIDER = 'whisper.cpp'
  $env:BIRDIE_GATE_STT_MODEL = (Resolve-Path -LiteralPath $whisperModel).Path
  $env:BIRDIE_GATE_STT_THREADS = '4'
  $env:BIRDIE_GATE_STT_LANGUAGE = 'de'

  # Recovery mode is intentionally CPU-safe. This removes GPU backend
  # availability from the first hardware-test equation.
  $env:BIRDIE_GATE_STT_USE_GPU = '0'
  $env:BIRDIE_GATE_STT_FLASH_ATTN = '0'
}

Require-Command 'git'
Require-Command 'node'
Require-Command 'npm'
Require-Command 'cargo'

if (-not (Test-Path -LiteralPath $managedTauriConfig -PathType Leaf)) {
  throw "Managed Tauri development config was not found: $managedTauriConfig"
}

Set-Location $repoRoot
Stop-StaleBirdieProcesses
Repair-DesktopDependencies
Configure-FullVoiceDemoEnvironment

if (-not (Test-Path -LiteralPath $tauriCommand -PathType Leaf)) {
  throw "Tauri CLI was not installed: $tauriCommand"
}

$viteProcess = $null
$tauriExitCode = 1
try {
  $viteProcess = Start-ManagedVite

  Write-Host 'Starting Tauri without build.beforeDevCommand...' -ForegroundColor Green
  Write-Host 'Say clearly "Birdie, bist du da?" after the Presence reaches IDLE.' -ForegroundColor Cyan

  Push-Location $desktopDir
  try {
    & $tauriCommand `
      dev `
      --config $managedTauriConfig `
      --no-watch
    $tauriExitCode = $LASTEXITCODE
  }
  finally {
    Pop-Location
  }
}
finally {
  if ($viteProcess) {
    Stop-Process -Id $viteProcess.Id -Force -ErrorAction SilentlyContinue
  }
  Stop-StaleBirdieProcesses
}

if ($tauriExitCode -ne 0) {
  Show-ViteLogs
  throw "Managed Birdie Tauri launch exited with code $tauriExitCode."
}
