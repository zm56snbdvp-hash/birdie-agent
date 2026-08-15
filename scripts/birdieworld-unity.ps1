param(
    [ValidateSet("check", "prepare", "build")]
    [string]$Action = "check",
    [string]$ProjectPath = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$expectedEditor = "6000.5.8f1"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

if ([string]::IsNullOrWhiteSpace($ProjectPath)) {
    $ProjectPath = Join-Path $repositoryRoot "unity\BirdieWorld"
}

$ProjectPath = (Resolve-Path $ProjectPath).Path
$unityExe = Join-Path ${env:ProgramFiles} "Unity\Hub\Editor\$expectedEditor\Editor\Unity.exe"
$projectVersionPath = Join-Path $ProjectPath "ProjectSettings\ProjectVersion.txt"
$manifestPath = Join-Path $repositoryRoot "client\birdie-app-v1\src\contracts\birdieworld-estate-handoff-v1.json"

if (-not (Test-Path $unityExe -PathType Leaf)) {
    throw "Unity $expectedEditor was not found at $unityExe"
}

foreach ($folder in @("Assets", "Packages", "ProjectSettings")) {
    if (-not (Test-Path (Join-Path $ProjectPath $folder) -PathType Container)) {
        throw "Not a BirdieWorld Unity project: missing $folder in $ProjectPath"
    }
}

if (-not (Test-Path $projectVersionPath -PathType Leaf)) {
    throw "Missing Unity project version file: $projectVersionPath"
}

$projectVersion = (Get-Content $projectVersionPath -Raw).Trim()
if ($projectVersion -ne "m_EditorVersion: $expectedEditor") {
    throw "Expected Unity $expectedEditor but project contains '$projectVersion'"
}

if (-not (Test-Path $manifestPath -PathType Leaf)) {
    throw "Canonical BirdieWorld handoff is missing: $manifestPath"
}

Write-Host "BirdieWorld automation check PASS"
Write-Host "Project: $ProjectPath"
Write-Host "Unity:   $expectedEditor"

if ($Action -eq "check") {
    exit 0
}

$runningEditor = Get-Process -Name "Unity" -ErrorAction SilentlyContinue
if ($null -ne $runningEditor) {
    throw "Close the Unity Editor before running the '$Action' automation."
}

$artifactFolder = Join-Path $repositoryRoot "artifacts\unity"
New-Item -ItemType Directory -Path $artifactFolder -Force | Out-Null
$logFile = Join-Path $artifactFolder "birdieworld-$Action.log"
$executeMethod = if ($Action -eq "prepare") {
    "BirdieWorld.Editor.BirdieWorldFoundationBuilder.PrepareFoundation"
} else {
    "BirdieWorld.Editor.BirdieWorldFoundationBuilder.BuildSupporterWeb"
}

Write-Host "Running BirdieWorld '$Action' automation..."
& $unityExe `
    -batchmode `
    -nographics `
    -quit `
    -projectPath $ProjectPath `
    -executeMethod $executeMethod `
    -logFile $logFile

if ($LASTEXITCODE -ne 0) {
    throw "Unity automation failed with exit code $LASTEXITCODE. See $logFile"
}

if ($Action -eq "build") {
    $webBuild = Join-Path $ProjectPath "Builds\Web"
    if (-not (Test-Path $webBuild -PathType Container)) {
        throw "Unity reported success but the Web build folder is missing: $webBuild"
    }
    Write-Host "Web build ready: $webBuild"
}

Write-Host "BirdieWorld '$Action' automation PASS"
Write-Host "Log: $logFile"
