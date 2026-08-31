[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$InstallerPath,
  [ValidateRange(15, 180)]
  [int]$ReadyTimeoutSeconds = 60,
  [switch]$KeepInstalled,
  [switch]$AllowExistingBirdieRegistration
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$expectedNodeVersion = '22.23.2'
$expectedNodeSha256 = '0d0f5e39f9f3d9587bc19f73eab3c2c9c4903fd02d6dbf9c853dd81b3d95fad4'
$expectedNodeLicenseSha256 = '8cc9bb466b19fc7e7cc99d03e9df1132021fda8b01eea2624c58bb372dbef576'
$expectedModelSha1 = '465707469ff3a37a2b9b8d8f89f2f99de7299dac'
$resolvedInstaller = (Resolve-Path -LiteralPath $InstallerPath).Path
if (-not (Test-Path -LiteralPath $resolvedInstaller -PathType Leaf)) {
  throw "Installer does not exist: $InstallerPath"
}

$tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$ownedRoot = Join-Path $tempBase ("BirdieBundleSmoke-{0}" -f [Guid]::NewGuid().ToString('N'))
$installRoot = Join-Path $ownedRoot 'Birdie'
$localAppData = Join-Path $ownedRoot 'LocalAppData'
$diagnostic = Join-Path $localAppData 'Birdie/logs/desktop-runtime-diagnostic.log'
$installPrefix = [IO.Path]::GetFullPath($installRoot).TrimEnd('\') + '\'
$ownedPrefix = [IO.Path]::GetFullPath($ownedRoot).TrimEnd('\') + '\'
if (-not $installPrefix.StartsWith($ownedPrefix, [StringComparison]::OrdinalIgnoreCase) -or
    -not ([IO.Path]::GetFileName($ownedRoot)).StartsWith('BirdieBundleSmoke-', [StringComparison]::Ordinal)) {
  throw "Refusing unsafe smoke root: $ownedRoot"
}

$uninstallRegistryRoots = @(
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
$existingBirdie = @(Get-ItemProperty $uninstallRegistryRoots -ErrorAction SilentlyContinue |
    Where-Object {
      $_.PSObject.Properties.Match('DisplayName').Count -gt 0 -and $_.DisplayName -eq 'Birdie'
    })
if ($existingBirdie.Count -gt 0 -and -not $AllowExistingBirdieRegistration) {
  throw 'An existing Birdie installation is registered. Use a clean Windows host; refusing to replace its uninstall registration.'
}

$desktop = $null
$voiceProbe = $null
$installed = $false
$originalEnvironment = @{}
$environmentNames = @(
  'PATH',
  'LOCALAPPDATA',
  'BIRDIE_MANAGE_CORE',
  'BIRDIE_MANAGE_VOICE',
  'BIRDIE_CORE_PROGRAM',
  'BIRDIE_CORE_SCRIPT',
  'BIRDIE_VOICE_EXE'
)
foreach ($name in $environmentNames) {
  $originalEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

function Assert-FileHash(
  [string]$Path,
  [ValidateSet('SHA1', 'SHA256')]
  [string]$Algorithm,
  [string]$Expected
) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Installed payload is missing: $Path"
  }
  $actual = (Get-FileHash -LiteralPath $Path -Algorithm $Algorithm).Hash.ToLowerInvariant()
  if ($actual -ne $Expected) {
    throw "Installed payload hash mismatch for ${Path}: expected=$Expected actual=$actual"
  }
  return $actual
}

function Stop-OwnedProcesses([string]$Prefix) {
  foreach ($process in Get-Process -ErrorAction SilentlyContinue) {
    try {
      $path = $process.Path
      if ($path -and ([IO.Path]::GetFullPath($path)).StartsWith($Prefix, [StringComparison]::OrdinalIgnoreCase)) {
        Stop-Process -Id $process.Id -Force -ErrorAction Stop
        Wait-Process -Id $process.Id -Timeout 10 -ErrorAction SilentlyContinue
      }
    }
    catch [System.ComponentModel.Win32Exception] {
      continue
    }
    catch [System.InvalidOperationException] {
      continue
    }
  }
}

try {
  New-Item -ItemType Directory -Path $ownedRoot, $localAppData -Force | Out-Null
  $installer = Start-Process -FilePath $resolvedInstaller -ArgumentList @('/S', "/D=$installRoot") -WindowStyle Hidden -PassThru -Wait
  if ($installer.ExitCode -ne 0) {
    throw "NSIS installer failed with exit code $($installer.ExitCode)."
  }
  $installed = $true

  $desktopExe = Join-Path $installRoot 'birdie-desktop.exe'
  $nodeExe = Join-Path $installRoot 'build/runtime/node.exe'
  $nodeLicense = Join-Path $installRoot 'build/runtime/LICENSE.node.txt'
  $voiceExe = Join-Path $installRoot 'build/voice/Release/birdie-voice-host.exe'
  $model = Join-Path $installRoot 'models/whisper/ggml-base.bin'
  $coreScript = Join-Path $installRoot 'services/core/src/server-main.mjs'

  foreach ($required in @($desktopExe, $nodeLicense, $voiceExe, $coreScript)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
      throw "Installed payload is missing: $required"
    }
  }
  $nodeSha256 = Assert-FileHash $nodeExe 'SHA256' $expectedNodeSha256
  $nodeLicenseSha256 = Assert-FileHash $nodeLicense 'SHA256' $expectedNodeLicenseSha256
  $modelSha1 = Assert-FileHash $model 'SHA1' $expectedModelSha1
  $nodeVersion = (& $nodeExe -p 'process.versions.node').Trim()
  $nodeArchitecture = (& $nodeExe -p 'process.arch').Trim()
  if ($LASTEXITCODE -ne 0 -or $nodeVersion -ne $expectedNodeVersion -or $nodeArchitecture -ne 'x64') {
    throw "Installed Node identity mismatch: version=$nodeVersion arch=$nodeArchitecture"
  }

  $voiceOutput = & $voiceExe 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0 -or $voiceOutput -notmatch 'Birdie Voice Host') {
    throw "Installed Voice executable probe failed: $voiceOutput"
  }

  $systemRoot = [Environment]::GetFolderPath('Windows')
  $env:PATH = @(
    (Join-Path $systemRoot 'System32'),
    $systemRoot,
    (Join-Path $systemRoot 'System32/Wbem'),
    (Join-Path $systemRoot 'System32/WindowsPowerShell/v1.0')
  ) -join ';'
  $env:LOCALAPPDATA = $localAppData
  $env:BIRDIE_MANAGE_CORE = '1'
  $env:BIRDIE_MANAGE_VOICE = '0'
  Remove-Item Env:BIRDIE_CORE_PROGRAM, Env:BIRDIE_CORE_SCRIPT, Env:BIRDIE_VOICE_EXE -ErrorAction SilentlyContinue

  $desktop = Start-Process -FilePath $desktopExe -WindowStyle Hidden -PassThru
  $deadline = [DateTime]::UtcNow.AddSeconds($ReadyTimeoutSeconds)
  $proof = ''
  do {
    if ($desktop.HasExited) {
      throw "Installed Birdie exited before Core IPC connected (exit=$($desktop.ExitCode))."
    }
    if (Test-Path -LiteralPath $diagnostic -PathType Leaf) {
      $proof = Get-Content -LiteralPath $diagnostic -Raw
      if ($proof -match 'SUPERVISOR_SPAWN_OK component=birdie-core' -and
          $proof -match 'PIPE_CONNECTED') {
        break
      }
    }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $deadline)

  if ($proof -notmatch 'SUPERVISOR_SPAWN_OK component=birdie-core' -or
      $proof -notmatch 'PIPE_CONNECTED') {
    throw "Installed Birdie did not prove bundled Core IPC within ${ReadyTimeoutSeconds}s. Diagnostic=$diagnostic"
  }
  $bundledNodeProcesses = @(Get-Process node -ErrorAction SilentlyContinue | Where-Object {
      $_.Path -and [IO.Path]::GetFullPath($_.Path) -eq [IO.Path]::GetFullPath($nodeExe)
    })
  if ($bundledNodeProcesses.Count -ne 1) {
    throw "Installed Birdie connected Core, but expected exactly one bundled Node process and found $($bundledNodeProcesses.Count)."
  }

  [pscustomobject]@{
    Result = 'PASS'
    Installer = $resolvedInstaller
    InstallRoot = $installRoot
    PathUsesSystemNode = $false
    NodeVersion = $nodeVersion
    NodeArchitecture = $nodeArchitecture
    NodeSha256 = $nodeSha256
    NodeLicenseSha256 = $nodeLicenseSha256
    VoiceProbe = 'PASS_NO_MIC'
    ModelSha1 = $modelSha1
    CoreSpawn = 'BUNDLED_NODE'
    BundledNodeProcessCount = $bundledNodeProcesses.Count
    PipeConnected = $true
    MicrophoneHardware = 'NOT_TESTED'
  }
}
finally {
  if ($desktop -and -not $desktop.HasExited) {
    Stop-Process -Id $desktop.Id -Force -ErrorAction SilentlyContinue
    Wait-Process -Id $desktop.Id -Timeout 10 -ErrorAction SilentlyContinue
  }
  Stop-OwnedProcesses $installPrefix

  foreach ($name in $environmentNames) {
    [Environment]::SetEnvironmentVariable($name, $originalEnvironment[$name], 'Process')
  }

  if ($installed -and -not $KeepInstalled) {
    $uninstaller = Join-Path $installRoot 'uninstall.exe'
    if (Test-Path -LiteralPath $uninstaller -PathType Leaf) {
      $uninstall = Start-Process -FilePath $uninstaller -ArgumentList '/S' -WindowStyle Hidden -PassThru -Wait
      if ($uninstall.ExitCode -ne 0) {
        Write-Warning "NSIS uninstaller exited with code $($uninstall.ExitCode)."
      }
    }
  }

  if (-not $KeepInstalled -and (Test-Path -LiteralPath $ownedRoot)) {
    $resolvedOwnedRoot = [IO.Path]::GetFullPath($ownedRoot)
    if (-not $resolvedOwnedRoot.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase) -or
        -not ([IO.Path]::GetFileName($resolvedOwnedRoot)).StartsWith('BirdieBundleSmoke-', [StringComparison]::Ordinal)) {
      throw "Refusing unsafe cleanup root: $resolvedOwnedRoot"
    }
    Remove-Item -LiteralPath $resolvedOwnedRoot -Recurse -Force
  }
}
