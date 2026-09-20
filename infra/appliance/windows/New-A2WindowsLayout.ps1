[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$OutputDirectory,
    [Parameter(Mandatory = $true)][string]$BuildId,
    [Parameter(Mandatory = $true)][ValidateSet("x86_64", "aarch64")][string]$Arch,
    [Parameter(Mandatory = $true)][string]$AudioNode,
    [Parameter(Mandatory = $true)][string]$Supervisor,
    [Parameter(Mandatory = $true)][string]$BackendDist,
    [Parameter(Mandatory = $true)][string]$BackendDependencies,
    [Parameter(Mandatory = $true)][string]$ProtocolPackage,
    [Parameter(Mandatory = $true)][string]$ManagerDist,
    [Parameter(Mandatory = $true)][string]$LiveDist,
    [Parameter(Mandatory = $true)][string]$NodeRuntime,
    [Parameter(Mandatory = $true)][string]$BuildIdentity,
    [Parameter(Mandatory = $true)][string]$ReleaseMetadata,
    [Parameter(Mandatory = $true)][string]$CargoLock,
    [Parameter(Mandatory = $true)][string]$NpmLock,
    [Parameter(Mandatory = $true)][string]$CargoInventory,
    [Parameter(Mandatory = $true)][string]$NodeInventory,
    [Parameter(Mandatory = $true)][string]$NodeLicense,
    [Parameter(Mandatory = $true)][string]$ProcessContract
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if (-not [System.IO.Path]::IsPathFullyQualified($OutputDirectory)) {
    throw "OutputDirectory must be an absolute path"
}

$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "../../..")).Path
$Stager = Join-Path $RepositoryRoot "infra/appliance/common/stage-application-slot.mjs"
if (-not (Test-Path -LiteralPath $Stager -PathType Leaf)) {
    throw "Portable stager is missing: $Stager"
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "The repository-pinned Node.js runtime is required"
}

$LayoutName = "a2-monitor-$BuildId-windows-$Arch-unsigned-layout"
$LayoutRoot = Join-Path $OutputDirectory $LayoutName
if (Test-Path -LiteralPath $LayoutRoot) {
    throw "Refusing to overwrite layout: $LayoutRoot"
}
[System.IO.Directory]::CreateDirectory($OutputDirectory) | Out-Null
$TemporaryRoot = Join-Path $OutputDirectory ".$LayoutName.staging-$PID-$([guid]::NewGuid().ToString('N'))"

$StageArguments = @(
    $Stager, "stage",
    "--output-root", $TemporaryRoot,
    "--build-id", $BuildId,
    "--platform", "windows",
    "--arch", $Arch,
    "--audio-node", $AudioNode,
    "--supervisor", $Supervisor,
    "--backend-dist", $BackendDist,
    "--backend-dependencies", $BackendDependencies,
    "--protocol-package", $ProtocolPackage,
    "--manager-dist", $ManagerDist,
    "--live-dist", $LiveDist,
    "--node-runtime", $NodeRuntime,
    "--build-identity", $BuildIdentity,
    "--release-metadata", $ReleaseMetadata,
    "--cargo-lock", $CargoLock,
    "--npm-lock", $NpmLock,
    "--cargo-inventory", $CargoInventory,
    "--node-inventory", $NodeInventory,
    "--node-license", $NodeLicense,
    "--process-contract", $ProcessContract
)
try {
    & node @StageArguments
    if ($LASTEXITCODE -ne 0) {
        throw "Portable staging failed with exit code $LASTEXITCODE"
    }

    $Slot = Join-Path $TemporaryRoot "slots/$BuildId"
    & node $Stager verify --slot $Slot
    if ($LASTEXITCODE -ne 0) {
        throw "Portable layout verification failed with exit code $LASTEXITCODE"
    }

    Move-Item -LiteralPath $TemporaryRoot -Destination $LayoutRoot
}
finally {
    if (Test-Path -LiteralPath $TemporaryRoot) {
        if ([System.IO.Path]::DirectorySeparatorChar -eq '/') {
            & chmod -R u+w $TemporaryRoot
        }
        Remove-Item -LiteralPath $TemporaryRoot -Recurse -Force
    }
}

Write-Output $LayoutRoot
