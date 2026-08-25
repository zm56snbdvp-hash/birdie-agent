[CmdletBinding()]
param(
  [switch]$DevelopmentAutoAccept,
  [switch]$SkipVoiceBuild,
  [ValidateSet('Debug', 'Release')]
  [string]$VoiceConfiguration = 'Release'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
$voiceBuild = Join-Path $repoRoot 'build/voice'
$voiceExe = Join-Path $voiceBuild "$VoiceConfiguration/birdie-voice-host.exe"
$desktopDir = Join-Path $repoRoot 'apps/desktop'

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' was not found in PATH."
  }
}

Require-Command 'node'
Require-Command 'npm'
Require-Command 'cargo'

if (-not $SkipVoiceBuild) {
  Require-Command 'cmake'
  Write-Host 'Building Birdie Voice Host...' -ForegroundColor Green
  & cmake -S (Join-Path $repoRoot 'services/voice') -B $voiceBuild -A x64
  if ($LASTEXITCODE -ne 0) { throw "CMake configure failed with exit code $LASTEXITCODE." }

  & cmake --build $voiceBuild --config $VoiceConfiguration --parallel
  if ($LASTEXITCODE -ne 0) { throw "Birdie Voice build failed with exit code $LASTEXITCODE." }
}

if (-not (Test-Path -LiteralPath $voiceExe -PathType Leaf)) {
  throw "Birdie Voice executable not found: $voiceExe"
}

$env:BIRDIE_VOICE_EXE = $voiceExe
$env:BIRDIE_MANAGE_CORE = '1'
$env:BIRDIE_MANAGE_VOICE = '1'
$env:BIRDIE_DEV_AUTO_ACCEPT = if ($DevelopmentAutoAccept) { '1' } else { '0' }

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
