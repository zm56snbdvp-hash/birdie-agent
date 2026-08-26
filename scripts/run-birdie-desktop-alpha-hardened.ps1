[CmdletBinding()]
param(
  [switch]$ForceDesktopDependencyRepair
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
$desktopExeName = 'birdie-desktop.exe'
$vitePort = 1420
$recovery = Join-Path $PSScriptRoot 'repair-and-run-birdie-desktop-alpha.ps1'

function Stop-AllBirdieDesktopInstances {
  Get-CimInstance Win32_Process -Filter "Name = '$desktopExeName'" -ErrorAction SilentlyContinue |
    ForEach-Object {
      Write-Host (
        'Stopping stale Birdie Desktop instance: PID {0} {1}' -f
        $_.ProcessId,
        ([string]$_.ExecutablePath)
      ) -ForegroundColor Yellow
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }

  $deadline = [DateTime]::UtcNow.AddSeconds(5)
  do {
    $remaining = @(
      Get-CimInstance Win32_Process -Filter "Name = '$desktopExeName'" -ErrorAction SilentlyContinue
    )
    if ($remaining.Count -eq 0) { return }
    Start-Sleep -Milliseconds 150
  } while ([DateTime]::UtcNow -lt $deadline)

  throw 'A stale birdie-desktop.exe instance could not be terminated.'
}

function Stop-VitePortOwner {
  $listeners = @(
    Get-NetTCPConnection -LocalPort $vitePort -State Listen -ErrorAction SilentlyContinue
  )

  foreach ($listener in $listeners) {
    $process = Get-CimInstance Win32_Process `
      -Filter "ProcessId = $($listener.OwningProcess)" `
      -ErrorAction SilentlyContinue

    $commandLine = if ($process) { [string]$process.CommandLine } else { '' }
    if ($commandLine -match 'birdie-agent-alpha|vite') {
      Write-Host (
        'Stopping stale Vite listener: PID {0}' -f $listener.OwningProcess
      ) -ForegroundColor Yellow
      Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
    }
    else {
      throw (
        'Port {0} is occupied by a non-Birdie process (PID {1}).' -f
        $vitePort,
        $listener.OwningProcess
      )
    }
  }
}

Set-Location $repoRoot
Stop-AllBirdieDesktopInstances
Stop-VitePortOwner

if (-not (Test-Path -LiteralPath $recovery -PathType Leaf)) {
  throw "Birdie recovery launcher was not found: $recovery"
}

Write-Host 'Starting hardened Birdie Desktop recovery...' -ForegroundColor Green
& powershell.exe `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File $recovery `
  @(
    if ($ForceDesktopDependencyRepair) { '-ForceDesktopDependencyRepair' }
  )

$exitCode = $LASTEXITCODE
if ($exitCode -ne 0) {
  throw "Hardened Birdie Desktop recovery exited with code $exitCode."
}
