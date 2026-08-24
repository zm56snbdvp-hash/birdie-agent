param(
    [string]$UnityPath = "$env:ProgramFiles\Unity\Hub\Editor\6000.0.76f1\Editor\Unity.exe"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ProjectDirectory = $PSScriptRoot
$VersionFile = Join-Path $ProjectDirectory "ProjectSettings\ProjectVersion.txt"
$BuildDirectory = Join-Path $ProjectDirectory "Builds\WebGL"
$LogDirectory = Join-Path $ProjectDirectory "Logs"
$LogFile = Join-Path $LogDirectory "birdieworld-webgl.log"

if (-not (Test-Path -LiteralPath $UnityPath -PathType Leaf)) {
    throw "Unity 6000.0.76f1 was not found at: $UnityPath"
}
if (-not (Test-Path -LiteralPath $VersionFile -PathType Leaf)) {
    throw "BirdieWorld ProjectVersion.txt is missing."
}
$Version = Get-Content -LiteralPath $VersionFile -Raw
if ($Version -notmatch "m_EditorVersion:\s*6000\.0\.76f1") {
    throw "BirdieWorld must be built with Unity 6000.0.76f1."
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "Git is required to record the exact build source."
}

$SourceSha = (& git -C $ProjectDirectory rev-parse --verify HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $SourceSha -notmatch "^[0-9a-f]{40}$") {
    throw "Could not resolve the BirdieWorld source commit."
}
$SourceStatus = & git -C $ProjectDirectory status --porcelain
if ($LASTEXITCODE -ne 0) {
    throw "Could not inspect the BirdieWorld source state."
}
$SourceDirty = -not [string]::IsNullOrWhiteSpace(($SourceStatus -join "`n"))

New-Item -ItemType Directory -Path $LogDirectory -Force | Out-Null
if (Test-Path -LiteralPath $BuildDirectory) {
    Remove-Item -LiteralPath $BuildDirectory -Recurse -Force
}

& $UnityPath `
    -batchmode `
    -nographics `
    -quit `
    -projectPath $ProjectDirectory `
    -executeMethod BirdieWorld.Editor.BirdieWorldWebBuild.BuildWebGL `
    -logFile $LogFile

if ($LASTEXITCODE -ne 0) {
    throw "BirdieWorld WebGL build failed with exit code $LASTEXITCODE. See $LogFile"
}

$IndexFile = Join-Path $BuildDirectory "index.html"
if (-not (Test-Path -LiteralPath $IndexFile -PathType Leaf)) {
    throw "Unity completed without Builds\WebGL\index.html. See $LogFile"
}
$Index = Get-Content -LiteralPath $IndexFile -Raw
if ($Index -notmatch "birdieworld:session" -or $Index -notmatch "BirdieWorld Auth Session") {
    throw "The WebGL build is missing the authenticated BirdieWorld template bridge."
}

$ProvenanceFile = Join-Path $BuildDirectory "birdieworld-build.json"
$Provenance = [ordered]@{
    sourceSha = $SourceSha
    sourceDirty = $SourceDirty
    unityVersion = "6000.0.76f1"
    builtAt = [DateTime]::UtcNow.ToString("o")
}
$Provenance | ConvertTo-Json | Set-Content -LiteralPath $ProvenanceFile -Encoding UTF8

$ManifestFile = Join-Path $BuildDirectory "birdieworld-files.sha256"
$BuildPrefix = $BuildDirectory.TrimEnd("\") + "\"
$ManifestLines = Get-ChildItem -LiteralPath $BuildDirectory -File -Recurse |
    Where-Object { $_.FullName -ne $ManifestFile } |
    Sort-Object FullName |
    ForEach-Object {
        $RelativePath = $_.FullName.Substring($BuildPrefix.Length).Replace("\", "/")
        $FileHash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        "$FileHash  ./$RelativePath"
    }
[System.IO.File]::WriteAllLines($ManifestFile, $ManifestLines, (New-Object System.Text.UTF8Encoding($false)))
$ManifestSha256 = (Get-FileHash -LiteralPath $ManifestFile -Algorithm SHA256).Hash.ToLowerInvariant()

Write-Host "BirdieWorld WebGL build ready: $BuildDirectory"
Write-Host "Build log: $LogFile"
Write-Host "Build provenance: $ProvenanceFile"
Write-Host "Review manifest SHA-256: $ManifestSha256"
