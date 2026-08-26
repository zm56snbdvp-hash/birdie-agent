[CmdletBinding()]
param(
  [switch]$DevelopmentAutoAccept,
  [switch]$SkipVoiceBuild,
  [ValidateSet('Debug', 'Release')]
  [string]$VoiceConfiguration = 'Release',
  [ValidateSet('Unavailable', 'WhisperCpp')]
  [string]$GateSttProvider = 'Unavailable',
  [switch]$SetupWhisperCpp,
  [ValidateSet(
    'tiny', 'tiny.en',
    'base', 'base.en',
    'small', 'small.en',
    'medium', 'medium.en',
    'large-v1',
    'large-v2', 'large-v2-q5_0',
    'large-v3', 'large-v3-q5_0',
    'large-v3-turbo', 'large-v3-turbo-q5_0'
  )]
  [string]$GateSttModelName = 'base',
  [string]$WhisperCppSource,
  [string]$GateSttModel,
  [ValidateRange(1, 64)]
  [int]$GateSttThreads = 4,
  [string]$GateSttLanguage = 'auto',
  [switch]$GateSttCpuOnly,
  [switch]$AllowUnreviewedWhisperCpp
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$reviewedWhisperCppCommit = '978113305b2ead22249b881deafa131dc8884911'
$repoRoot = Split-Path -Parent $PSScriptRoot
$voiceBuild = Join-Path $repoRoot 'build/voice'
$voiceExe = Join-Path $voiceBuild "$VoiceConfiguration/birdie-voice-host.exe"
$desktopDir = Join-Path $repoRoot 'apps/desktop'
$defaultWhisperSource = Join-Path $repoRoot 'third_party/whisper.cpp'
$defaultWhisperModelDirectory = Join-Path $repoRoot 'models/whisper'
$setupWhisperScript = Join-Path $PSScriptRoot 'setup-birdie-whisper-cpp.ps1'

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' was not found in PATH."
  }
}

function Resolve-ExistingDirectory([string]$Path, [string]$Label) {
  if ([string]::IsNullOrWhiteSpace($Path)) {
    throw "$Label is required."
  }
  if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
    throw "$Label directory was not found: $Path"
  }
  return (Resolve-Path -LiteralPath $Path).Path
}

function Resolve-ExistingFile([string]$Path, [string]$Label) {
  if ([string]::IsNullOrWhiteSpace($Path)) {
    throw "$Label is required."
  }
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "$Label file was not found: $Path"
  }
  return (Resolve-Path -LiteralPath $Path).Path
}

Require-Command 'node'
Require-Command 'npm'
Require-Command 'cargo'

if ($DevelopmentAutoAccept -and $GateSttProvider -eq 'WhisperCpp') {
  throw 'DevelopmentAutoAccept bypasses Addressability and cannot be combined with GateSttProvider=WhisperCpp.'
}
if ($SetupWhisperCpp -and $GateSttProvider -ne 'WhisperCpp') {
  throw 'SetupWhisperCpp requires GateSttProvider=WhisperCpp.'
}
if ($SetupWhisperCpp -and -not [string]::IsNullOrWhiteSpace($GateSttModel)) {
  throw 'SetupWhisperCpp manages the model path. Use GateSttModelName instead of GateSttModel for this mode.'
}

$resolvedWhisperCppSource = $null
$resolvedGateSttModel = $null
if ($GateSttProvider -eq 'WhisperCpp') {
  Require-Command 'git'

  if ([string]::IsNullOrWhiteSpace($WhisperCppSource)) {
    $WhisperCppSource = $defaultWhisperSource
  }
  if ([string]::IsNullOrWhiteSpace($GateSttModel)) {
    $GateSttModel = Join-Path $defaultWhisperModelDirectory "ggml-$GateSttModelName.bin"
  }

  if ($SetupWhisperCpp) {
    if (-not (Test-Path -LiteralPath $setupWhisperScript -PathType Leaf)) {
      throw "Birdie Whisper setup helper was not found: $setupWhisperScript"
    }

    Write-Host 'Preparing reviewed whisper.cpp source and verified model...' -ForegroundColor Green
    & $setupWhisperScript `
      -Model $GateSttModelName `
      -SourceDirectory $WhisperCppSource `
      -ModelDirectory $defaultWhisperModelDirectory | Out-Host
    if ($LASTEXITCODE -ne 0) {
      throw "Birdie Whisper setup failed with exit code $LASTEXITCODE."
    }
  }

  if (-not (Test-Path -LiteralPath $WhisperCppSource -PathType Container) -or
      -not (Test-Path -LiteralPath $GateSttModel -PathType Leaf)) {
    $setupCommand = ".\scripts\run-birdie-desktop-alpha.ps1 -GateSttProvider WhisperCpp -SetupWhisperCpp -GateSttModelName $GateSttModelName -GateSttLanguage de"
    throw "Local Whisper source/model is missing. Run: $setupCommand"
  }

  $resolvedWhisperCppSource = Resolve-ExistingDirectory $WhisperCppSource 'WhisperCppSource'
  $resolvedGateSttModel = Resolve-ExistingFile $GateSttModel 'GateSttModel'

  if (-not (Test-Path -LiteralPath (Join-Path $resolvedWhisperCppSource 'include/whisper.h') -PathType Leaf)) {
    throw "WhisperCppSource is not a whisper.cpp checkout: $resolvedWhisperCppSource"
  }

  $actualCommit = (& git -C $resolvedWhisperCppSource rev-parse HEAD 2>$null).Trim()
  if ($LASTEXITCODE -ne 0) {
    throw "Could not read whisper.cpp revision from: $resolvedWhisperCppSource"
  }
  if ($actualCommit -ne $reviewedWhisperCppCommit) {
    $message = "whisper.cpp revision '$actualCommit' is not the reviewed Birdie revision '$reviewedWhisperCppCommit'."
    if (-not $AllowUnreviewedWhisperCpp) {
      throw "$message Use -AllowUnreviewedWhisperCpp only after reviewing the new revision."
    }
    Write-Warning $message
  }
}

if (-not $SkipVoiceBuild) {
  Require-Command 'cmake'
  Write-Host 'Building Birdie Voice Host...' -ForegroundColor Green

  $cmakeArguments = @(
    '-S', (Join-Path $repoRoot 'services/voice'),
    '-B', $voiceBuild,
    '-A', 'x64',
    '-DGGML_NATIVE=OFF'
  )
  if ($GateSttProvider -eq 'WhisperCpp') {
    $cmakeArguments += '-DBIRDIE_WITH_WHISPER_CPP=ON'
    $cmakeArguments += "-DBIRDIE_WHISPER_CPP_SOURCE_DIR=$resolvedWhisperCppSource"
  }
  else {
    $cmakeArguments += '-DBIRDIE_WITH_WHISPER_CPP=OFF'
  }

  & cmake @cmakeArguments
  if ($LASTEXITCODE -ne 0) { throw "CMake configure failed with exit code $LASTEXITCODE." }

  & cmake --build $voiceBuild --config $VoiceConfiguration --parallel
  if ($LASTEXITCODE -ne 0) { throw "Birdie Voice build failed with exit code $LASTEXITCODE." }
}
elseif ($GateSttProvider -eq 'WhisperCpp') {
  Write-Warning 'SkipVoiceBuild is active. The existing Voice binary must already contain BIRDIE_WITH_WHISPER_CPP=ON.'
}

if (-not (Test-Path -LiteralPath $voiceExe -PathType Leaf)) {
  throw "Birdie Voice executable not found: $voiceExe"
}

$env:BIRDIE_VOICE_EXE = $voiceExe
$env:BIRDIE_MANAGE_CORE = '1'
$env:BIRDIE_MANAGE_VOICE = '1'
$env:BIRDIE_DEV_AUTO_ACCEPT = if ($DevelopmentAutoAccept) { '1' } else { '0' }
$env:BIRDIE_GATE_STT_THREADS = [string]$GateSttThreads
$env:BIRDIE_GATE_STT_LANGUAGE = if ([string]::IsNullOrWhiteSpace($GateSttLanguage)) { 'auto' } else { $GateSttLanguage }
$env:BIRDIE_GATE_STT_USE_GPU = if ($GateSttCpuOnly) { '0' } else { '1' }
$env:BIRDIE_GATE_STT_FLASH_ATTN = if ($GateSttCpuOnly) { '0' } else { '1' }

if ($GateSttProvider -eq 'WhisperCpp') {
  $env:BIRDIE_GATE_STT_PROVIDER = 'whisper.cpp'
  $env:BIRDIE_GATE_STT_MODEL = $resolvedGateSttModel
  Write-Host "Gate-STT: whisper.cpp · $([IO.Path]::GetFileName($resolvedGateSttModel)) · language=$($env:BIRDIE_GATE_STT_LANGUAGE) · threads=$GateSttThreads" -ForegroundColor Green
}
else {
  $env:BIRDIE_GATE_STT_PROVIDER = 'unavailable'
  Remove-Item Env:BIRDIE_GATE_STT_MODEL -ErrorAction SilentlyContinue
  Write-Host 'Gate-STT: unavailable (fail-closed)' -ForegroundColor Yellow
}

if ($DevelopmentAutoAccept) {
  Write-Warning 'DevelopmentAutoAccept is enabled. Every qualifying speech candidate may be treated as addressed to Birdie. Do not use this mode for privacy validation.'
}

if (-not (Test-Path -LiteralPath (Join-Path $desktopDir 'node_modules'))) {
  Write-Host 'Installing Birdie Desktop dependencies...' -ForegroundColor Green
  & npm install --prefix $desktopDir --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE." }
}

Write-Host 'Starting Birdie Desktop Alpha...' -ForegroundColor Green
Push-Location $desktopDir
try {
  & npm run tauri -- dev
  if ($LASTEXITCODE -ne 0) { throw "Tauri dev exited with code $LASTEXITCODE." }
}
finally {
  Pop-Location
}
