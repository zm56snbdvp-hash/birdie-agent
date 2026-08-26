[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
$desktopDir = Join-Path $repoRoot 'apps/desktop'
$tauriDir = Join-Path $desktopDir 'src-tauri'
$desktopExe = Join-Path $tauriDir 'target/debug/birdie-desktop.exe'
$coreScript = Join-Path $repoRoot 'services/core/src/server-main.mjs'
$voiceExe = Join-Path $repoRoot 'build/voice/Release/birdie-voice-host.exe'
$whisperModel = Join-Path $repoRoot 'models/whisper/ggml-base.bin'
$whisperSetup = Join-Path $PSScriptRoot 'setup-birdie-whisper-cpp.ps1'

function Require-Command([string]$Name) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $command) {
    throw "Required command '$Name' was not found in PATH."
  }
  return $command.Source
}

function Stop-BirdieProcesses {
  Get-Process birdie-desktop,birdie-voice-host -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue

  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      $_.Name -in @('node.exe','cargo.exe','rustc.exe') -and
      $_.CommandLine -and
      ([string]$_.CommandLine).IndexOf(
        [IO.Path]::GetFullPath($repoRoot),
        [StringComparison]::OrdinalIgnoreCase
      ) -ge 0
    } |
    ForEach-Object {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

$nodeExe = Require-Command 'node'
Require-Command 'npm' | Out-Null
Require-Command 'cargo' | Out-Null

Set-Location $repoRoot
Stop-BirdieProcesses

if (-not (Test-Path -LiteralPath $coreScript -PathType Leaf)) {
  throw "Birdie Core entrypoint was not found: $coreScript"
}
if (-not (Test-Path -LiteralPath $voiceExe -PathType Leaf)) {
  throw "Birdie Voice executable was not found: $voiceExe"
}

if (-not (Test-Path -LiteralPath $whisperModel -PathType Leaf)) {
  if (-not (Test-Path -LiteralPath $whisperSetup -PathType Leaf)) {
    throw "Birdie Whisper setup helper was not found: $whisperSetup"
  }
  Write-Host 'Preparing verified Whisper base model...' -ForegroundColor Green
  & $whisperSetup -Model base | Out-Host
  if ($LASTEXITCODE -ne 0) {
    throw "Whisper model setup failed with exit code $LASTEXITCODE."
  }
}

Write-Host 'Building embedded Birdie frontend...' -ForegroundColor Green
Push-Location $desktopDir
try {
  & npm run build
  if ($LASTEXITCODE -ne 0) {
    throw "Desktop frontend build failed with exit code $LASTEXITCODE."
  }
}
finally {
  Pop-Location
}

$distIndex = Join-Path $desktopDir 'dist/index.html'
if (-not (Test-Path -LiteralPath $distIndex -PathType Leaf)) {
  throw "Embedded frontend index was not produced: $distIndex"
}

Write-Host 'Building Birdie Desktop with embedded frontend (no localhost)...' -ForegroundColor Green
Remove-Item Env:BIRDIE_DEV_FRONTEND_URL -ErrorAction SilentlyContinue
Push-Location $tauriDir
try {
  & cargo build
  if ($LASTEXITCODE -ne 0) {
    throw "Embedded Tauri build failed with exit code $LASTEXITCODE."
  }
}
finally {
  Pop-Location
}

if (-not (Test-Path -LiteralPath $desktopExe -PathType Leaf)) {
  throw "Embedded Birdie executable was not produced: $desktopExe"
}

# Make the child-process contract explicit. The desktop supervisor must not
# depend on PATH or implicit repo-root discovery during this hardware test.
$env:BIRDIE_CORE_PROGRAM = $nodeExe
$env:BIRDIE_CORE_SCRIPT = (Resolve-Path -LiteralPath $coreScript).Path
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
$env:BIRDIE_GATE_STT_USE_GPU = '0'
$env:BIRDIE_GATE_STT_FLASH_ATTN = '0'

Write-Host 'Starting embedded Birdie Desktop...' -ForegroundColor Green
Write-Host 'No Vite server and no localhost are used in this mode.' -ForegroundColor Cyan
Write-Host "Core: $env:BIRDIE_CORE_PROGRAM $env:BIRDIE_CORE_SCRIPT" -ForegroundColor DarkGray
Write-Host "Voice: $env:BIRDIE_VOICE_EXE" -ForegroundColor DarkGray
Write-Host 'Say clearly "Birdie, bist du da?" after Presence reaches IDLE.' -ForegroundColor Cyan

& $desktopExe
$exitCode = $LASTEXITCODE

Stop-BirdieProcesses
if ($exitCode -ne 0) {
  throw "Embedded Birdie Desktop exited with code $exitCode."
}
