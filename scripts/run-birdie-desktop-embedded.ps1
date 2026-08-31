[CmdletBinding()]
param(
  [ValidateRange(60, 600)]
  [int]$ReadyHoldSeconds = 60,
  [switch]$ExitAfterReady
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$installedBirdieRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Birdie'))
$desktopDir = Join-Path $repoRoot 'apps/desktop'
$tauriDir = Join-Path $desktopDir 'src-tauri'
$desktopExe = Join-Path $tauriDir 'target/debug/birdie-desktop.exe'
$releaseDesktopExe = Join-Path $tauriDir 'target/release/birdie-desktop.exe'
$coreScript = Join-Path $repoRoot 'services/core/src/server-main.mjs'
$voiceExe = Join-Path $repoRoot 'build/voice/Release/birdie-voice-host.exe'
$installedDesktopExe = Join-Path $installedBirdieRoot 'birdie-desktop.exe'
$installedCoreScript = Join-Path $installedBirdieRoot 'services/core/src/server-main.mjs'
$installedVoiceExe = Join-Path $installedBirdieRoot 'build/voice/Release/birdie-voice-host.exe'
$whisperModel = Join-Path $repoRoot 'models/whisper/ggml-base.bin'
$whisperSetup = Join-Path $PSScriptRoot 'setup-birdie-whisper-cpp.ps1'
$logDir = Join-Path $repoRoot '.birdie/logs'
$coreOut = Join-Path $logDir 'embedded-core.stdout.log'
$coreErr = Join-Path $logDir 'embedded-core.stderr.log'
$voiceOut = Join-Path $logDir 'embedded-voice.stdout.log'
$voiceErr = Join-Path $logDir 'embedded-voice.stderr.log'
$diagnosticLog = Join-Path $logDir 'desktop-runtime-diagnostic.log'

function Require-Command([string]$Name) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $command) { throw "Required command '$Name' was not found in PATH." }
  return $command.Source
}

function Write-Diagnostic([string]$Event, [string]$Detail) {
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  $timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $compact = ([string]$Detail).Replace("`r", ' ').Replace("`n", ' ')
  Add-Content -LiteralPath $diagnosticLog -Value "$timestamp $Event source=launcher $compact" -Encoding utf8
}

function Get-NormalizedFullPath([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) { return $null }
  try {
    $normalized = [IO.Path]::GetFullPath($Path).Replace('/', '\').TrimEnd('\')
    if ($normalized.StartsWith('\\?\', [StringComparison]::Ordinal)) {
      $normalized = $normalized.Substring(4)
    }
    return $normalized
  }
  catch { return $null }
}

function Test-SamePath([string]$Left, [string]$Right) {
  $leftPath = Get-NormalizedFullPath $Left
  $rightPath = Get-NormalizedFullPath $Right
  return (
    $null -ne $leftPath -and
    $null -ne $rightPath -and
    $leftPath.Equals($rightPath, [StringComparison]::OrdinalIgnoreCase)
  )
}

function Test-CommandLineContainsPath([string]$CommandLine, [string]$Path) {
  if ([string]::IsNullOrWhiteSpace($CommandLine)) { return $false }
  $normalizedPath = Get-NormalizedFullPath $Path
  if ($null -eq $normalizedPath) { return $false }
  $normalizedCommandLine = $CommandLine.Replace('/', '\')
  $argumentPattern = '(?:^|[\s"])' + [regex]::Escape($normalizedPath) + '(?=$|[\s"])'
  return [regex]::IsMatch(
    $normalizedCommandLine,
    $argumentPattern,
    [Text.RegularExpressions.RegexOptions]::IgnoreCase -bor
      [Text.RegularExpressions.RegexOptions]::CultureInvariant
  )
}

function Get-BirdieOwnedProcesses {
  return @(
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
      Where-Object {
        $name = [string]$_.Name
        if ($name -in @('birdie-desktop.exe', 'birdie-voice-host.exe')) {
          return (
            (Test-SamePath $_.ExecutablePath $desktopExe) -or
            (Test-SamePath $_.ExecutablePath $releaseDesktopExe) -or
            (Test-SamePath $_.ExecutablePath $voiceExe) -or
            (Test-SamePath $_.ExecutablePath $installedDesktopExe) -or
            (Test-SamePath $_.ExecutablePath $installedVoiceExe)
          )
        }

        if ($name -eq 'node.exe') {
          return (
            (Test-CommandLineContainsPath $_.CommandLine $coreScript) -or
            (Test-CommandLineContainsPath $_.CommandLine $installedCoreScript)
          )
        }

        return $false
      }
  )
}

function Stop-BirdieProcesses {
  $ownedProcesses = @(Get-BirdieOwnedProcesses)
  $ownedProcesses | ForEach-Object {
      Write-Diagnostic 'STALE_PROCESS' "name=$($_.Name) pid=$($_.ProcessId) path=$($_.ExecutablePath) commandLine=$($_.CommandLine)"
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }

  $deadline = [DateTime]::UtcNow.AddSeconds(5)
  do {
    $survivors = @(Get-BirdieOwnedProcesses)
    if ($survivors.Count -eq 0) {
      Write-Diagnostic 'PROCESS_CLEAN' 'ownedProcesses=0'
      return
    }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $deadline)

  $summary = ($survivors | ForEach-Object { "$($_.Name):$($_.ProcessId)" }) -join ','
  Write-Diagnostic 'ERROR' "stage=process.cleanup survivors=$summary"
  throw "Stale Birdie processes survived cleanup: $summary"
}

function Read-PipeLineWithTimeout(
  [System.IO.StreamReader]$Reader,
  [int]$Milliseconds,
  [string]$Stage
) {
  $readTask = $Reader.ReadLineAsync()
  if (-not $readTask.Wait($Milliseconds)) {
    throw "Named pipe read timed out after ${Milliseconds}ms during $Stage."
  }
  return $readTask.GetAwaiter().GetResult()
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
    $ack = Read-PipeLineWithTimeout $reader 900 'component.hello.ack'
    if (-not $ack) { return $null }
    $ackJson = $ack | ConvertFrom-Json
    if ($ackJson.type -ne 'component.hello.ack' -or -not $ackJson.payload.accepted) { return $null }

    $snapshotLine = Read-PipeLineWithTimeout $reader 900 'runtime.snapshot'
    if (-not $snapshotLine) { return $null }
    $snapshot = $snapshotLine | ConvertFrom-Json
    if ($snapshot.type -ne 'runtime.snapshot') { return $null }
    return $snapshot.payload
  }
  catch {
    Write-Diagnostic 'ERROR' "stage=embedded.preflight exception=$($_.Exception.Message)"
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

function Get-DiagnosticLinesSince([long]$SinceMilliseconds) {
  if (-not (Test-Path -LiteralPath $diagnosticLog -PathType Leaf)) { return @() }
  return @(
    Get-Content -LiteralPath $diagnosticLog -Tail 4096 -ErrorAction SilentlyContinue |
      Where-Object {
        $parts = ([string]$_) -split ' ', 2
        $lineTimestamp = [long]0
        $parts.Count -gt 1 -and
          [long]::TryParse($parts[0], [ref]$lineTimestamp) -and
          $lineTimestamp -ge $SinceMilliseconds
      }
  )
}

function Get-RuntimeFatalLine([object[]]$Lines) {
  return $Lines | Where-Object {
    $_ -match '\sRUNTIME_DISCONNECTED\s' -or
    $_ -match '\sJS_STATUS source=js status=(OFFLINE|CONNECTING)\b' -or
    $_ -match '\blifecycle=(DEGRADED|OFFLINE)\b' -or
    $_ -match '\bpresence\.state=OFFLINE\b' -or
    $_ -match '\bmicrophoneState=(?!ENABLED\b)\S+' -or
    $_ -match '\bbrainState=(?!READY\b)\S+'
  } | Select-Object -First 1
}

function Get-LatestReadyJsSnapshotTimestamp([object[]]$Lines) {
  $latestTimestamp = [long]0
  foreach ($line in $Lines) {
    if (
      $line -match '\sJS_SNAPSHOT source=js\s' -and
      $line -match '\blifecycle=READY\b' -and
      $line -match '\bpresence\.state=(?!OFFLINE\b)\S+' -and
      $line -match '\bmicrophoneState=ENABLED\b' -and
      $line -match '\bbrainState=READY\b'
    ) {
      $parts = ([string]$line) -split ' ', 2
      $lineTimestamp = [long]0
      if ([long]::TryParse($parts[0], [ref]$lineTimestamp) -and $lineTimestamp -gt $latestTimestamp) {
        $latestTimestamp = $lineTimestamp
      }
    }
  }
  return $latestTimestamp
}

function Assert-JsRuntimeLive([long]$StabilityStartMilliseconds, [long]$LatestJsSnapshotMilliseconds) {
  $nowMilliseconds = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  if ($nowMilliseconds - $StabilityStartMilliseconds -le 5000) { return }
  if ($LatestJsSnapshotMilliseconds -lt $StabilityStartMilliseconds) {
    throw 'Birdie WebView produced no fresh READY JS snapshot during the stability gate.'
  }
  if ($nowMilliseconds - $LatestJsSnapshotMilliseconds -gt 3000) {
    throw "Birdie WebView READY snapshot is stale by $($nowMilliseconds - $LatestJsSnapshotMilliseconds)ms."
  }
}

function Assert-CoreSnapshotReady([object]$Snapshot, [string]$Stage) {
  if (-not $Snapshot) { throw "Birdie Core returned no snapshot during $Stage." }
  if ($Snapshot.lifecycle -ne 'READY') {
    throw "Birdie Core lifecycle changed during ${Stage}: $($Snapshot.lifecycle)"
  }
  if ($Snapshot.presence.state -eq 'OFFLINE') {
    throw "Birdie Core presence changed to OFFLINE during $Stage."
  }
  if ($Snapshot.microphoneState -ne 'ENABLED') {
    throw "Birdie microphone left the ENABLED state during ${Stage}: $($Snapshot.microphoneState)"
  }
  if ($Snapshot.brainState -ne 'READY') {
    throw "Birdie brain left READY during ${Stage}: $($Snapshot.brainState)"
  }
}

function Stop-TrackedProcess([object]$Process, [string]$Label) {
  if (-not $Process) { return }
  try {
    $Process.Refresh()
    if (-not $Process.HasExited) {
      Write-Diagnostic 'TRACKED_PROCESS_STOP' "label=$Label pid=$($Process.Id)"
      Stop-Process -InputObject $Process -Force -ErrorAction Stop
      $Process.WaitForExit(3000) | Out-Null
    }
  }
  catch {
    Write-Diagnostic 'ERROR' "stage=tracked_process.stop label=$Label pid=$($Process.Id) exception=$($_.Exception.Message)"
  }
}

$originalLocation = (Get-Location).Path
$managedEnvironmentNames = @(
  'BIRDIE_DESKTOP_BUILD_ID',
  'BIRDIE_DESKTOP_DIAGNOSTIC_LOG',
  'BIRDIE_BRAIN_PROVIDER',
  'BIRDIE_TTS_PROVIDER',
  'BIRDIE_TTS_RATE',
  'BIRDIE_TTS_VOLUME',
  'BIRDIE_GATE_STT_PROVIDER',
  'BIRDIE_GATE_STT_MODEL',
  'BIRDIE_GATE_STT_THREADS',
  'BIRDIE_GATE_STT_LANGUAGE',
  'BIRDIE_GATE_STT_USE_GPU',
  'BIRDIE_GATE_STT_FLASH_ATTN',
  'BIRDIE_MANAGE_CORE',
  'BIRDIE_MANAGE_VOICE',
  'BIRDIE_DEV_FRONTEND_URL'
)
$originalEnvironment = @{}
foreach ($environmentName in $managedEnvironmentNames) {
  $originalEnvironment[$environmentName] = [Environment]::GetEnvironmentVariable($environmentName, 'Process')
}

try {
  $nodeExe = Require-Command 'node'
  Require-Command 'git' | Out-Null
  Require-Command 'npm' | Out-Null
  Require-Command 'cargo' | Out-Null

  Set-Location $repoRoot
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  Remove-Item $coreOut,$coreErr,$voiceOut,$voiceErr -Force -ErrorAction SilentlyContinue
  Remove-Item $diagnosticLog -Force -ErrorAction SilentlyContinue
  Write-Diagnostic 'SCRIPT_START' "repoRoot=$repoRoot readyHoldSeconds=$ReadyHoldSeconds exitAfterReady=$ExitAfterReady"
  Stop-BirdieProcesses

$branch = (& git branch --show-current).Trim()
$gitSha = (& git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($gitSha)) { throw 'Could not resolve the current Git commit.' }
if ($branch -ne 'feature/birdie-desktop-alpha') {
  Write-Diagnostic 'ERROR' "stage=git.branch expected=feature/birdie-desktop-alpha actual=$branch"
  throw "Embedded alpha must run on feature/birdie-desktop-alpha, not '$branch'."
}
$buildId = "$($gitSha.Substring(0, 12))-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
$env:BIRDIE_DESKTOP_BUILD_ID = $buildId
$env:BIRDIE_DESKTOP_DIAGNOSTIC_LOG = $diagnosticLog
Write-Diagnostic 'GIT_STATE' "branch=$branch sha=$gitSha buildId=$buildId"

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
$distFiles = @(Get-ChildItem -LiteralPath (Join-Path $desktopDir 'dist') -Recurse -File | Sort-Object FullName)
$pathSeparator = [string][IO.Path]::DirectorySeparatorChar
$desktopPrefix = [IO.Path]::GetFullPath($desktopDir).TrimEnd([char[]]@('\','/')) + $pathSeparator
$distManifest = ($distFiles | ForEach-Object {
  $fullPath = [IO.Path]::GetFullPath($_.FullName)
  if (-not $fullPath.StartsWith($desktopPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Frontend build output escaped the desktop directory: $fullPath"
  }
  $relative = $fullPath.Substring($desktopPrefix.Length)
  $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  "$relative=$hash"
}) -join ';'
$buildIdEmbedded = $false
foreach ($distFile in $distFiles) {
  if (Select-String -LiteralPath $distFile.FullName -SimpleMatch $buildId -Quiet -ErrorAction SilentlyContinue) {
    $buildIdEmbedded = $true
    break
  }
}
if (-not $buildIdEmbedded) { throw "Frontend bundle does not contain build ID $buildId." }
Write-Diagnostic 'FRONTEND_BUILD' "buildId=$buildId manifest=$distManifest"

Write-Host 'Building Birdie Desktop with embedded frontend (no localhost)...' -ForegroundColor Green
Remove-Item Env:BIRDIE_DEV_FRONTEND_URL -ErrorAction SilentlyContinue
Push-Location $tauriDir
try {
  & cargo build
  if ($LASTEXITCODE -ne 0) { throw "Embedded Tauri build failed with exit code $LASTEXITCODE." }
}
finally { Pop-Location }

if (-not (Test-Path -LiteralPath $desktopExe -PathType Leaf)) { throw "Embedded Birdie executable was not produced: $desktopExe" }
$desktopExeHash = (Get-FileHash -LiteralPath $desktopExe -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Diagnostic 'TAURI_BUILD' "buildId=$buildId exe=$desktopExe sha256=$desktopExeHash"

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
$desktopProcess = $null
$desktopExitCode = 1
$cleanupSurvivors = @()
try {
  Write-Host '1/3 Starting Birdie Core before Desktop...' -ForegroundColor Green
  $coreProcess = Start-Process -FilePath $nodeExe -ArgumentList @($coreScript) -WorkingDirectory $repoRoot -RedirectStandardOutput $coreOut -RedirectStandardError $coreErr -NoNewWindow -PassThru
  Write-Diagnostic 'CORE_PROCESS_STARTED' "pid=$($coreProcess.Id) script=$coreScript"
  Start-Sleep -Milliseconds 200
  $coreProcess.Refresh()
  if ($coreProcess.HasExited) {
    Write-Diagnostic 'ERROR' "stage=core.start pid=$($coreProcess.Id) exitCode=$($coreProcess.ExitCode)"
    throw "Birdie Core exited immediately with code $($coreProcess.ExitCode)."
  }

  $coreSnapshot = Wait-CoreReady 15
  if (-not $coreSnapshot) {
    Write-Host 'Birdie Core did not become READY.' -ForegroundColor Red
    if (Test-Path $coreOut) { Get-Content $coreOut -Tail 40 }
    if (Test-Path $coreErr) { Get-Content $coreErr -Tail 40 }
    throw 'Embedded preflight failed: Core is not READY.'
  }
  $coreProcess.Refresh()
  if ($coreProcess.HasExited) {
    Write-Diagnostic 'ERROR' "stage=core.ownership pid=$($coreProcess.Id) exitCode=$($coreProcess.ExitCode) pipeMayBelongToForeignCore=true"
    throw "The launched Birdie Core exited while another process answered the global pipe (code $($coreProcess.ExitCode))."
  }
  Write-Host "CORE READY: presence=$($coreSnapshot.presence.state) brain=$($coreSnapshot.brainState)" -ForegroundColor Green
  Write-Diagnostic 'CORE_READY' "pid=$($coreProcess.Id) lifecycle=$($coreSnapshot.lifecycle) presence.state=$($coreSnapshot.presence.state) presence.revision=$($coreSnapshot.presence.revision) microphoneState=$($coreSnapshot.microphoneState) brainState=$($coreSnapshot.brainState)"

  Write-Host '2/3 Starting Birdie Voice against the ready Core...' -ForegroundColor Green
  $voiceProcess = Start-Process -FilePath $voiceExe -ArgumentList @('--mic') -WorkingDirectory $repoRoot -RedirectStandardOutput $voiceOut -RedirectStandardError $voiceErr -NoNewWindow -PassThru
  Write-Diagnostic 'VOICE_PROCESS_STARTED' "pid=$($voiceProcess.Id) exe=$voiceExe"

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
  Write-Diagnostic 'VOICE_READY' "pid=$($voiceProcess.Id) lifecycle=$($voiceSnapshot.lifecycle) presence.state=$($voiceSnapshot.presence.state) presence.revision=$($voiceSnapshot.presence.revision) microphoneState=$($voiceSnapshot.microphoneState) brainState=$($voiceSnapshot.brainState)"

  # Core and Voice are intentionally external for this hardware test. Desktop
  # only connects to an already proven runtime, removing the startup race.
  $env:BIRDIE_MANAGE_CORE = '0'
  $env:BIRDIE_MANAGE_VOICE = '0'

  Write-Host '3/3 Starting embedded Birdie Desktop against READY runtime...' -ForegroundColor Green
  Write-Host 'No Vite server and no localhost are used in this mode.' -ForegroundColor Cyan
  Write-Host 'Expected initial state: IDLE / Wake-on-Speak · Local first' -ForegroundColor Cyan

  $desktopProcess = Start-Process -FilePath $desktopExe -WorkingDirectory $repoRoot -PassThru
  Write-Diagnostic 'DESKTOP_PROCESS_STARTED' "pid=$($desktopProcess.Id) exe=$desktopExe buildId=$buildId"
  Start-Sleep -Milliseconds 1200
  $desktopProcess.Refresh()
  if ($desktopProcess.HasExited) {
    $desktopExitCode = $desktopProcess.ExitCode
    Write-Diagnostic 'ERROR' "stage=desktop.early_exit pid=$($desktopProcess.Id) exitCode=$desktopExitCode possibleSingleInstance=true"
    throw "Birdie Desktop exited before the hardware test started (code $desktopExitCode). Check $diagnosticLog for a stale single-instance process."
  }
  Write-Diagnostic 'DESKTOP_RUNNING' "pid=$($desktopProcess.Id) buildId=$buildId"

  # Do not infer success from a still-running process. The hardware path is
  # accepted only after the same build identity and authoritative READY
  # snapshot have crossed the native host, WebView, IPC, and JS boundaries.
  $bridgeDeadline = [DateTime]::UtcNow.AddSeconds(30)
  $frontendReady = $false
  $nativeBuildReady = $false
  $pipeReady = $false
  $helloReady = $false
  $rustReady = $false
  $invokeReady = $false
  $statusReady = $false
  $projectionReady = $false
  do {
    $desktopProcess.Refresh()
    if ($desktopProcess.HasExited) {
      $desktopExitCode = $desktopProcess.ExitCode
      throw "Birdie Desktop exited while waiting for bridge proof (code $desktopExitCode)."
    }

    if (Test-Path -LiteralPath $diagnosticLog -PathType Leaf) {
      $proofLines = @(Get-Content -LiteralPath $diagnosticLog -ErrorAction SilentlyContinue)
      $frontendReady = @($proofLines | Where-Object {
        $_ -like "*DESKTOP_FRONTEND source=js buildId=$buildId mode=headless*"
      }).Count -gt 0
      $nativeBuildReady = @($proofLines | Where-Object {
        $_ -like "*DESKTOP_START pid=$($desktopProcess.Id) buildId=$buildId*"
      }).Count -gt 0
      $pipeReady = @($proofLines | Where-Object {
        $_ -like '*PIPE_CONNECTED*'
      }).Count -gt 0
      $helloReady = @($proofLines | Where-Object {
        $_ -like '*HELLO_ACK accepted=true*'
      }).Count -gt 0
      $rustReady = @($proofLines | Where-Object {
        $_ -like '*RUST_STATE_UPDATED*' -and
        $_ -like '*lifecycle=READY*' -and
        $_ -like '*presence.state=IDLE*' -and
        $_ -like '*microphoneState=ENABLED*' -and
        $_ -like '*brainState=READY*'
      }).Count -gt 0
      $invokeReady = @($proofLines | Where-Object {
        $_ -like '*TAURI_INVOKE_RESULT source=js command=runtime_get_snapshot*' -and
        $_ -like '*lifecycle=READY*' -and
        $_ -like '*presence.state=IDLE*' -and
        $_ -like '*microphoneState=ENABLED*' -and
        $_ -like '*brainState=READY*'
      }).Count -gt 0
      $statusReady = @($proofLines | Where-Object {
        $_ -like '*JS_STATUS source=js status=READY*'
      }).Count -gt 0
      $projectionReady = @($proofLines | Where-Object {
        $_ -like '*JS_SNAPSHOT source=js*' -and
        $_ -like '*lifecycle=READY*' -and
        $_ -like '*presence.state=IDLE*' -and
        $_ -like '*microphoneState=ENABLED*' -and
        $_ -like '*brainState=READY*'
      }).Count -gt 0
    }

    if ($frontendReady -and $nativeBuildReady -and $pipeReady -and $helloReady -and $rustReady -and $invokeReady -and $statusReady -and $projectionReady) {
      break
    }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $bridgeDeadline)

  if (-not ($frontendReady -and $nativeBuildReady -and $pipeReady -and $helloReady -and $rustReady -and $invokeReady -and $statusReady -and $projectionReady)) {
    Write-Diagnostic 'ERROR' "stage=desktop.bridge_proof frontend=$frontendReady nativeBuild=$nativeBuildReady pipe=$pipeReady hello=$helloReady rust=$rustReady invoke=$invokeReady status=$statusReady projection=$projectionReady"
    Write-Host 'Desktop bridge did not reach the headless READY state. Consolidated diagnostic:' -ForegroundColor Red
    if (Test-Path -LiteralPath $diagnosticLog) {
      Get-Content -LiteralPath $diagnosticLog -Tail 160 | Out-Host
    }
    throw "Desktop bridge proof failed. Full diagnostic: $diagnosticLog"
  }

  Write-Host 'DESKTOP BRIDGE PROVEN: stability check pending...' -ForegroundColor Cyan
  Write-Diagnostic 'DESKTOP_BRIDGE_PROVEN' "pid=$($desktopProcess.Id) buildId=$buildId mode=headless state=IDLE microphoneState=ENABLED brainState=READY"

  $stabilityStartMilliseconds = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $stabilityDeadline = [DateTime]::UtcNow.AddSeconds($ReadyHoldSeconds)
  $nextSnapshotCheck = [DateTime]::UtcNow
  $nextHeartbeat = [DateTime]::UtcNow.AddSeconds(10)
  $consecutiveSnapshotFailures = 0
  $lastStableSnapshot = $voiceSnapshot
  $lastReadyJsSnapshotMilliseconds = [long]0
  Write-Diagnostic 'STABILITY_GATE_START' "seconds=$ReadyHoldSeconds desktopPid=$($desktopProcess.Id) corePid=$($coreProcess.Id) voicePid=$($voiceProcess.Id)"

  do {
    $desktopProcess.Refresh()
    if ($desktopProcess.HasExited) {
      $desktopExitCode = $desktopProcess.ExitCode
      throw "Birdie Desktop exited during the READY stability gate (code $desktopExitCode)."
    }

    $coreProcess.Refresh()
    if ($coreProcess.HasExited) {
      throw "Birdie Core exited during the READY stability gate (code $($coreProcess.ExitCode))."
    }

    $voiceProcess.Refresh()
    if ($voiceProcess.HasExited) {
      throw "Birdie Voice exited during the READY stability gate (code $($voiceProcess.ExitCode))."
    }

    $stabilityLines = @(Get-DiagnosticLinesSince $stabilityStartMilliseconds)
    $fatalLine = Get-RuntimeFatalLine $stabilityLines
    if ($fatalLine) {
      Write-Diagnostic 'ERROR' "stage=desktop.stability diagnostic=$fatalLine"
      throw "Birdie left READY during the stability gate: $fatalLine"
    }
    $latestJsSnapshotMilliseconds = Get-LatestReadyJsSnapshotTimestamp $stabilityLines
    if ($latestJsSnapshotMilliseconds -gt $lastReadyJsSnapshotMilliseconds) {
      $lastReadyJsSnapshotMilliseconds = $latestJsSnapshotMilliseconds
    }
    Assert-JsRuntimeLive $stabilityStartMilliseconds $lastReadyJsSnapshotMilliseconds

    $now = [DateTime]::UtcNow
    if ($now -ge $nextSnapshotCheck) {
      $stabilitySnapshot = Get-CoreSnapshot
      $nextSnapshotCheck = [DateTime]::UtcNow.AddSeconds(1)
      if (-not $stabilitySnapshot) {
        $consecutiveSnapshotFailures += 1
        if ($consecutiveSnapshotFailures -ge 3) {
          throw 'Birdie Core failed three consecutive snapshot probes during the READY stability gate.'
        }
      }
      else {
        $consecutiveSnapshotFailures = 0
        $lastStableSnapshot = $stabilitySnapshot
        Assert-CoreSnapshotReady $stabilitySnapshot 'the READY stability gate'
      }
    }

    if ($now -ge $nextHeartbeat) {
      $jsAgeMilliseconds = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - $lastReadyJsSnapshotMilliseconds
      Write-Diagnostic 'STABILITY_HEARTBEAT' "lifecycle=$($lastStableSnapshot.lifecycle) presence.state=$($lastStableSnapshot.presence.state) microphoneState=$($lastStableSnapshot.microphoneState) brainState=$($lastStableSnapshot.brainState) jsSnapshotAgeMs=$jsAgeMilliseconds"
      $nextHeartbeat = $now.AddSeconds(10)
    }

    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $stabilityDeadline)

  # Close the final sleep race with one authoritative process, Core, and JS
  # revalidation before publishing the first success result.
  $desktopProcess.Refresh()
  if ($desktopProcess.HasExited) {
    $desktopExitCode = $desktopProcess.ExitCode
    throw "Birdie Desktop exited at the READY stability boundary (code $desktopExitCode)."
  }
  $coreProcess.Refresh()
  if ($coreProcess.HasExited) {
    throw "Birdie Core exited at the READY stability boundary (code $($coreProcess.ExitCode))."
  }
  $voiceProcess.Refresh()
  if ($voiceProcess.HasExited) {
    throw "Birdie Voice exited at the READY stability boundary (code $($voiceProcess.ExitCode))."
  }
  $finalSnapshot = Get-CoreSnapshot
  Assert-CoreSnapshotReady $finalSnapshot 'the READY stability boundary'
  $finalStabilityLines = @(Get-DiagnosticLinesSince $stabilityStartMilliseconds)
  $finalFatalLine = Get-RuntimeFatalLine $finalStabilityLines
  if ($finalFatalLine) {
    throw "Birdie left READY at the stability boundary: $finalFatalLine"
  }
  $lastReadyJsSnapshotMilliseconds = Get-LatestReadyJsSnapshotTimestamp $finalStabilityLines
  Assert-JsRuntimeLive $stabilityStartMilliseconds $lastReadyJsSnapshotMilliseconds
  $lastStableSnapshot = $finalSnapshot

  Write-Host "DESKTOP STABLE READY: seconds=$ReadyHoldSeconds mode=headless microphone=ENABLED brain=READY" -ForegroundColor Green
  Write-Diagnostic 'STABILITY_GATE_COMPLETE' "seconds=$ReadyHoldSeconds lifecycle=$($lastStableSnapshot.lifecycle) presence.state=$($lastStableSnapshot.presence.state) microphoneState=$($lastStableSnapshot.microphoneState) brainState=$($lastStableSnapshot.brainState) jsSnapshotAgeMs=$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - $lastReadyJsSnapshotMilliseconds)"

  if ($ExitAfterReady) {
    $desktopExitCode = 0
    Write-Diagnostic 'DESKTOP_TEST_COMPLETE' "pid=$($desktopProcess.Id) exitAfterReady=true"
  }
  else {
    $nextRuntimeSnapshotCheck = [DateTime]::UtcNow
    $consecutiveSnapshotFailures = 0
    while ($true) {
      $desktopProcess.Refresh()
      if ($desktopProcess.HasExited) {
        $desktopExitCode = $desktopProcess.ExitCode
        Write-Diagnostic 'DESKTOP_EXIT' "pid=$($desktopProcess.Id) exitCode=$desktopExitCode"
        break
      }

      $coreProcess.Refresh()
      if ($coreProcess.HasExited) {
        throw "Birdie Core exited after sustained READY (code $($coreProcess.ExitCode))."
      }
      $voiceProcess.Refresh()
      if ($voiceProcess.HasExited) {
        throw "Birdie Voice exited after sustained READY (code $($voiceProcess.ExitCode))."
      }

      $runtimeLines = @(Get-DiagnosticLinesSince $stabilityStartMilliseconds)
      $runtimeFatalLine = Get-RuntimeFatalLine $runtimeLines
      if ($runtimeFatalLine) {
        throw "Birdie left sustained READY: $runtimeFatalLine"
      }
      $lastReadyJsSnapshotMilliseconds = Get-LatestReadyJsSnapshotTimestamp $runtimeLines
      Assert-JsRuntimeLive $stabilityStartMilliseconds $lastReadyJsSnapshotMilliseconds

      $now = [DateTime]::UtcNow
      if ($now -ge $nextRuntimeSnapshotCheck) {
        $runtimeSnapshot = Get-CoreSnapshot
        $nextRuntimeSnapshotCheck = [DateTime]::UtcNow.AddSeconds(1)
        if (-not $runtimeSnapshot) {
          $consecutiveSnapshotFailures += 1
          if ($consecutiveSnapshotFailures -ge 3) {
            throw 'Birdie Core failed three consecutive snapshot probes after sustained READY.'
          }
        }
        else {
          $consecutiveSnapshotFailures = 0
          Assert-CoreSnapshotReady $runtimeSnapshot 'sustained READY monitoring'
        }
      }

      Start-Sleep -Milliseconds 250
    }
  }
}
catch {
  Write-Diagnostic 'ERROR' "stage=embedded.runtime exception=$($_.Exception.Message)"
  throw
}
finally {
  Write-Diagnostic 'CLEANUP_START' "desktopExitCode=$desktopExitCode"
  Stop-TrackedProcess $desktopProcess 'desktop'
  Stop-TrackedProcess $voiceProcess 'voice'
  Stop-TrackedProcess $coreProcess 'core'

  $trackedProcesses = @(@($desktopProcess, $voiceProcess, $coreProcess) | Where-Object { $null -ne $_ })
  $cleanupDeadline = [DateTime]::UtcNow.AddSeconds(5)
  do {
    $cleanupSurvivors = @(
      foreach ($trackedProcess in $trackedProcesses) {
        try {
          $trackedProcess.Refresh()
          if (-not $trackedProcess.HasExited) { $trackedProcess }
        }
        catch { }
      }
    )
    if ($cleanupSurvivors.Count -eq 0) { break }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $cleanupDeadline)

  if ($cleanupSurvivors.Count -gt 0) {
    $cleanupSummary = ($cleanupSurvivors | ForEach-Object { "$($_.ProcessName):$($_.Id)" }) -join ','
    Write-Diagnostic 'ERROR' "stage=tracked_process.cleanup survivors=$cleanupSummary"
  }
  else {
    Write-Diagnostic 'PROCESS_CLEAN' 'trackedProcesses=0'
  }
  Write-Diagnostic 'CLEANUP_COMPLETE' "desktopExitCode=$desktopExitCode"
}

if ($cleanupSurvivors.Count -gt 0) { throw "Tracked Birdie processes survived cleanup: $cleanupSummary" }
if ($desktopExitCode -ne 0) { throw "Embedded Birdie Desktop exited with code $desktopExitCode." }
}
finally {
  foreach ($environmentName in $managedEnvironmentNames) {
    [Environment]::SetEnvironmentVariable(
      $environmentName,
      $originalEnvironment[$environmentName],
      'Process'
    )
  }
  Set-Location -LiteralPath $originalLocation -ErrorAction SilentlyContinue
}
