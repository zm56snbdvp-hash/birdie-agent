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
$logDir = Join-Path $repoRoot '.birdie/logs'
$coreOut = Join-Path $logDir 'embedded-core.stdout.log'
$coreErr = Join-Path $logDir 'embedded-core.stderr.log'
$voiceOut = Join-Path $logDir 'embedded-voice.stdout.log'
$voiceErr = Join-Path $logDir 'embedded-voice.stderr.log'

function Require-Command([string]$Name) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $command) { throw "Required command '$Name' was not found in PATH." }
  return $command.Source
}

function Stop-BirdieProcesses {
  Get-Process birdie-desktop,birdie-voice-host -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue

  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      $_.Name -in @('node.exe','cargo.exe','rustc.exe') -and
      $_.CommandLine -and
      ([string]$_.CommandLine).IndexOf([IO.Path]::GetFullPath($repoRoot), [StringComparison]::OrdinalIgnoreCase) -ge 0
    } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

function Get-CoreSnapshot {
  $pipe = New-Object System.IO.Pipes.NamedPipeClientStream(
    '.', 'birdie.core.control.v1', [System.IO.Pipes.PipeDirection]::InOut
  )
  try {
    $pipe.Connect(900)
    $writer = New-Object System.IO.StreamWriter($pipe)
    $writer.AutoFlush = $true
    $reader = New-Object System.IO.StreamReader($pipe)

    $hello = @{
      type = 'component.hello'
      requestId = 'embedded-preflight'
      payload = @{
        component = 'birdie-embedded-preflight'
        role = 'observer'
        instanceId = "embedded-preflight-$PID"
        contractVersion = '1.0'
      }
    } | ConvertTo-Json -Compress

    $writer.WriteLine($hello)
    $ack = $reader.ReadLine()
    if (-not $ack) { return $null }
    $ackJson = $ack | ConvertFrom-Json
    if ($ackJson.type -ne 'component.hello.ack' -or -not $ackJson.payload.accepted) { return $null }

    $snapshotLine = $reader.ReadLine()
    if (-not $snapshotLine) { return $null }
    $snapshot = $snapshotLine | ConvertFrom-Json
    if ($snapshot.type -ne 'runtime.snapshot') { return $null }
    return $snapshot.payload
  }
  catch {
    return $null
  }
  finally {
    $pipe.Dispose()
  }
}

function Wait-CoreReady([int]$Seconds = 15) {
  $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
  do {
    $snapshot = Get-CoreSnapshot
    if ($snapshot -and $snapshot.lifecycle -eq 'READY') { return $snapshot }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $deadline)
  return $null
}

$nodeExe = Require-Command 'node'
Require-Command 'npm' | Out-Null
Require-Command 'cargo' | Out-Null

Set-Location $repoRoot
Stop-BirdieProcesses
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
Remove-Item $coreOut,$coreErr,$voiceOut,$voiceErr -Force -ErrorAction SilentlyContinue

if (-not (Test-Path -LiteralPath $coreScript -PathType Leaf)) { throw "Birdie Core entrypoint was not found: $coreScript" }
if (-not (Test-Path -LiteralPath $voiceExe -PathType Leaf)) { throw "Birdie Voice executable was not found: $voiceExe" }

if (-not (Test-Path -LiteralPath $whisperModel -PathType Leaf)) {
  if (-not (Test-Path -LiteralPath $whisperSetup -PathType Leaf)) { throw "Birdie Whisper setup helper was not found: $whisperSetup" }
  Write-Host 'Preparing verified Whisper base model...' -ForegroundColor Green
  & $whisperSetup -Model base | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "Whisper model setup failed with exit code $LASTEXITCODE." }
}

Write-Host 'Building embedded Birdie frontend...' -ForegroundColor Green
Push-Location $desktopDir
try {
  & npm run build
  if ($LASTEXITCODE -ne 0) { throw "Desktop frontend build failed with exit code $LASTEXITCODE." }
}
finally { Pop-Location }

$distIndex = Join-Path $desktopDir 'dist/index.html'
if (-not (Test-Path -LiteralPath $distIndex -PathType Leaf)) { throw "Embedded frontend index was not produced: $distIndex" }

Write-Host 'Building Birdie Desktop with embedded frontend (no localhost)...' -ForegroundColor Green
Remove-Item Env:BIRDIE_DEV_FRONTEND_URL -ErrorAction SilentlyContinue
Push-Location $tauriDir
try {
  & cargo build
  if ($LASTEXITCODE -ne 0) { throw "Embedded Tauri build failed with exit code $LASTEXITCODE." }
}
finally { Pop-Location }

if (-not (Test-Path -LiteralPath $desktopExe -PathType Leaf)) { throw "Embedded Birdie executable was not produced: $desktopExe" }

# Configure the runtime before starting either process.
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

$coreProcess = $null
$voiceProcess = $null
$desktopExitCode = 1
try {
  Write-Host '1/3 Starting Birdie Core before Desktop...' -ForegroundColor Green
  $coreProcess = Start-Process -FilePath $nodeExe -ArgumentList @($coreScript) -WorkingDirectory $repoRoot -RedirectStandardOutput $coreOut -RedirectStandardError $coreErr -NoNewWindow -PassThru

  $coreSnapshot = Wait-CoreReady 15
  if (-not $coreSnapshot) {
    Write-Host 'Birdie Core did not become READY.' -ForegroundColor Red
    if (Test-Path $coreOut) { Get-Content $coreOut -Tail 40 }
    if (Test-Path $coreErr) { Get-Content $coreErr -Tail 40 }
    throw 'Embedded preflight failed: Core is not READY.'
  }
  Write-Host "CORE READY: presence=$($coreSnapshot.presence.state) brain=$($coreSnapshot.brainState)" -ForegroundColor Green

  Write-Host '2/3 Starting Birdie Voice against the ready Core...' -ForegroundColor Green
  $voiceProcess = Start-Process -FilePath $voiceExe -ArgumentList @('--mic') -WorkingDirectory $repoRoot -RedirectStandardOutput $voiceOut -RedirectStandardError $voiceErr -NoNewWindow -PassThru

  $voiceDeadline = [DateTime]::UtcNow.AddSeconds(20)
  $voiceSnapshot = $null
  do {
    $voiceProcess.Refresh()
    if ($voiceProcess.HasExited) {
      Write-Host "Birdie Voice exited with code $($voiceProcess.ExitCode)." -ForegroundColor Red
      if (Test-Path $voiceOut) { Get-Content $voiceOut -Tail 60 }
      if (Test-Path $voiceErr) { Get-Content $voiceErr -Tail 60 }
      throw 'Embedded preflight failed: Voice exited.'
    }
    $voiceSnapshot = Get-CoreSnapshot
    if ($voiceSnapshot -and $voiceSnapshot.microphoneState -eq 'ENABLED') { break }
    Start-Sleep -Milliseconds 300
  } while ([DateTime]::UtcNow -lt $voiceDeadline)

  if (-not $voiceSnapshot -or $voiceSnapshot.microphoneState -ne 'ENABLED') {
    throw "Embedded preflight failed: Voice did not enable the microphone. Last state=$($voiceSnapshot.microphoneState)"
  }
  Write-Host "VOICE READY: microphone=$($voiceSnapshot.microphoneState) presence=$($voiceSnapshot.presence.state)" -ForegroundColor Green

  # Core and Voice are intentionally external for this hardware test. Desktop
  # only connects to an already proven runtime, removing the startup race.
  $env:BIRDIE_MANAGE_CORE = '0'
  $env:BIRDIE_MANAGE_VOICE = '0'

  Write-Host '3/3 Starting embedded Birdie Desktop against READY runtime...' -ForegroundColor Green
  Write-Host 'No Vite server and no localhost are used in this mode.' -ForegroundColor Cyan
  Write-Host 'Expected initial state: IDLE / Wake-on-Speak · Local first' -ForegroundColor Cyan

  & $desktopExe
  $desktopExitCode = $LASTEXITCODE
}
finally {
  if ($voiceProcess -and -not $voiceProcess.HasExited) { Stop-Process -Id $voiceProcess.Id -Force -ErrorAction SilentlyContinue }
  if ($coreProcess -and -not $coreProcess.HasExited) { Stop-Process -Id $coreProcess.Id -Force -ErrorAction SilentlyContinue }
  Stop-BirdieProcesses
}

if ($desktopExitCode -ne 0) { throw "Embedded Birdie Desktop exited with code $desktopExitCode." }
