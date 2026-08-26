[CmdletBinding()]
param(
  [switch]$ForceDesktopDependencyRepair,
  [switch]$RebuildVoice
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
$desktopDir = Join-Path $repoRoot 'apps/desktop'
$launcher = Join-Path $PSScriptRoot 'run-birdie-desktop-alpha.ps1'
$voiceExe = Join-Path $repoRoot 'build/voice/Release/birdie-voice-host.exe'
$vitePort = 1420

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' was not found in PATH."
  }
}

function Stop-StaleBirdieProcesses {
  $repoNeedle = [IO.Path]::GetFullPath($repoRoot)
  $candidateNames = @(
    'node.exe',
    'cargo.exe',
    'rustc.exe',
    'birdie-desktop.exe'
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
    $listeners = @(
      Get-NetTCPConnection `
        -LocalPort $vitePort `
        -State Listen `
        -ErrorAction SilentlyContinue
    )
    if ($listeners.Count -eq 0) {
      return
    }
    Start-Sleep -Milliseconds 150
  } while ([DateTime]::UtcNow -lt $deadline)

  foreach ($listener in $listeners) {
    $process = Get-CimInstance `
      Win32_Process `
      -Filter "ProcessId = $($listener.OwningProcess)" `
      -ErrorAction SilentlyContinue
    $name = if ($process) { [string]$process.Name } else { 'unknown' }
    $commandLine = if ($process) { [string]$process.CommandLine } else { '' }
    throw (
      "Port $vitePort is still occupied by PID {0} ({1}). " +
      "Command line: {2}" -f
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

Require-Command 'git'
Require-Command 'node'
Require-Command 'npm'
Require-Command 'cargo'

if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) {
  throw "Birdie launcher was not found: $launcher"
}

Set-Location $repoRoot
Stop-StaleBirdieProcesses
Repair-DesktopDependencies

$arguments = @(
  '-NoProfile',
  '-ExecutionPolicy', 'Bypass',
  '-File', $launcher,
  '-FullVoiceDemo'
)
if (-not $RebuildVoice -and
    (Test-Path -LiteralPath $voiceExe -PathType Leaf)) {
  $arguments += '-SkipVoiceBuild'
  Write-Host 'Reusing the existing native Birdie Voice build.' -ForegroundColor Green
}
else {
  Write-Host 'Birdie Voice will be rebuilt.' -ForegroundColor Yellow
}

Write-Host 'Starting the repaired Birdie Desktop Alpha...' -ForegroundColor Green
& powershell.exe @arguments
if ($LASTEXITCODE -ne 0) {
  throw "Birdie recovery launch exited with code $LASTEXITCODE."
}
