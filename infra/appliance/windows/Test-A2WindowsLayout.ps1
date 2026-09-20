$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "../../..")).Path
$WorkRoot = Join-Path ([System.IO.Path]::GetTempPath()) "a2-windows-layout-test-$([guid]::NewGuid().ToString('N'))"

try {
    $BackendDist = Join-Path $WorkRoot "backend-dist"
    $BackendDependencies = Join-Path $WorkRoot "backend-dependencies"
    $ManagerDist = Join-Path $WorkRoot "manager-dist"
    $LiveDist = Join-Path $WorkRoot "live-dist"
    $OutputDirectory = Join-Path $WorkRoot "output"
    foreach ($Directory in @(
        $BackendDist,
        (Join-Path $BackendDependencies "fastify"),
        (Join-Path $BackendDependencies "ajv"),
        (Join-Path $BackendDependencies "ajv-formats"),
        $ManagerDist,
        $LiveDist,
        $OutputDirectory
    )) {
        [System.IO.Directory]::CreateDirectory($Directory) | Out-Null
    }

    $AudioNode = Join-Path $WorkRoot "audio-node.exe"
    $Supervisor = Join-Path $WorkRoot "supervisor.exe"
    $NodeRuntime = Join-Path $WorkRoot "node.exe"
    $PeFixture = [byte[]]::new(1024)
    $PeFixture[0] = [byte][char]'M'
    $PeFixture[1] = [byte][char]'Z'
    [BitConverter]::GetBytes([uint32]128).CopyTo($PeFixture, 0x3c)
    $PeFixture[128] = [byte][char]'P'
    $PeFixture[129] = [byte][char]'E'
    [BitConverter]::GetBytes([uint16]0x8664).CopyTo($PeFixture, 132)
    [BitConverter]::GetBytes([uint16]1).CopyTo($PeFixture, 134)
    [BitConverter]::GetBytes([uint16]240).CopyTo($PeFixture, 148)
    [BitConverter]::GetBytes([uint16]0x22).CopyTo($PeFixture, 150)
    [BitConverter]::GetBytes([uint16]0x020b).CopyTo($PeFixture, 152)
    [BitConverter]::GetBytes([uint32]0x1000).CopyTo($PeFixture, 168)
    [BitConverter]::GetBytes([uint32]0x1000).CopyTo($PeFixture, 184)
    [BitConverter]::GetBytes([uint32]0x200).CopyTo($PeFixture, 188)
    [BitConverter]::GetBytes([uint32]0x2000).CopyTo($PeFixture, 208)
    [BitConverter]::GetBytes([uint32]0x200).CopyTo($PeFixture, 212)
    [BitConverter]::GetBytes([uint32]16).CopyTo($PeFixture, 260)
    [System.Text.Encoding]::ASCII.GetBytes(".text").CopyTo($PeFixture, 392)
    [BitConverter]::GetBytes([uint32]1).CopyTo($PeFixture, 400)
    [BitConverter]::GetBytes([uint32]0x1000).CopyTo($PeFixture, 404)
    [BitConverter]::GetBytes([uint32]0x200).CopyTo($PeFixture, 408)
    [BitConverter]::GetBytes([uint32]0x200).CopyTo($PeFixture, 412)
    [BitConverter]::GetBytes([uint32]0x60000020).CopyTo($PeFixture, 428)
    $PeFixture[512] = 0xc3
    [System.IO.File]::WriteAllBytes($AudioNode, $PeFixture)
    [System.IO.File]::WriteAllBytes($Supervisor, $PeFixture)
    [System.IO.File]::WriteAllBytes($NodeRuntime, $PeFixture)
    [System.IO.File]::WriteAllText((Join-Path $BackendDist "start.js"), "export {};`n")
    [System.IO.File]::WriteAllText((Join-Path $BackendDependencies "fastify/package.json"), '{"name":"fastify"}')
    [System.IO.File]::WriteAllText((Join-Path $BackendDependencies "ajv/package.json"), '{"name":"ajv"}')
    [System.IO.File]::WriteAllText((Join-Path $BackendDependencies "ajv-formats/package.json"), '{"name":"ajv-formats"}')
    [System.IO.File]::WriteAllText((Join-Path $ManagerDist "index.html"), "<!doctype html>`n")
    [System.IO.File]::WriteAllText((Join-Path $LiveDist "index.html"), "<!doctype html>`n")
    $NodeLicense = Join-Path $WorkRoot "NODE-LICENSE"
    $ReleaseMetadata = Join-Path $WorkRoot "release-metadata.json"
    [System.IO.File]::WriteAllText($NodeLicense, "Node.js test licence input`n")
    [System.IO.File]::WriteAllText(
        $ReleaseMetadata,
        '{"schemaVersion":1,"buildProfile":"release","targetTriple":"x86_64-pc-windows-msvc","protocolVersion":"v0","toolchains":{"node":"24.21.0","npm":"10.9.8","rustc":"1.98.1","cargo":"1.98.1"}}'
    )

    $BuildIdentity = Join-Path $RepositoryRoot "docs/quality/build-identity.json"
    $BuildId = (Get-Content -LiteralPath $BuildIdentity -Raw | ConvertFrom-Json).buildId
    $Arguments = @{
        OutputDirectory = $OutputDirectory
        BuildId = $BuildId
        Arch = "x86_64"
        AudioNode = $AudioNode
        Supervisor = $Supervisor
        BackendDist = $BackendDist
        BackendDependencies = $BackendDependencies
        ProtocolPackage = (Join-Path $RepositoryRoot "packages/protocol")
        ManagerDist = $ManagerDist
        LiveDist = $LiveDist
        NodeRuntime = $NodeRuntime
        BuildIdentity = $BuildIdentity
        ReleaseMetadata = $ReleaseMetadata
        CargoLock = (Join-Path $RepositoryRoot "Cargo.lock")
        NpmLock = (Join-Path $RepositoryRoot "package-lock.json")
        CargoInventory = (Join-Path $RepositoryRoot "docs/quality/cargo-dependency-inventory.json")
        NodeInventory = (Join-Path $RepositoryRoot "docs/quality/node-dependency-inventory.json")
        NodeLicense = $NodeLicense
    }
    $Output = & (Join-Path $PSScriptRoot "New-A2WindowsLayout.ps1") @Arguments
    $LayoutRoot = $Output[-1]
    if (-not $LayoutRoot.EndsWith("-unsigned-layout")) {
        throw "Layout name does not identify its unsigned boundary: $LayoutRoot"
    }
    $Slot = Join-Path $LayoutRoot "slots/$BuildId"
    foreach ($Required in @(
        "slot-manifest.json",
        "bin/a2-synthetic-capture.exe",
        "bin/a2-supervisor-smoke.exe",
        "runtime/node.exe"
    )) {
        if (-not (Test-Path -LiteralPath (Join-Path $Slot $Required) -PathType Leaf)) {
            throw "Layout is missing $Required"
        }
    }
    if (Get-ChildItem -LiteralPath $LayoutRoot -Recurse -File -Filter "*.msi") {
        throw "Windows layout must not contain or claim an MSI"
    }

    $OverwriteRejected = $false
    try {
        & (Join-Path $PSScriptRoot "New-A2WindowsLayout.ps1") @Arguments *> $null
    }
    catch {
        $OverwriteRejected = $true
    }
    if (-not $OverwriteRejected) {
        throw "Layout wrapper overwrote an existing output"
    }

    Write-Output "Windows unsigned layout smoke test passed"
}
finally {
    if (Test-Path -LiteralPath $WorkRoot) {
        if ([System.IO.Path]::DirectorySeparatorChar -eq '/') {
            & chmod -R u+w $WorkRoot
        }
        Remove-Item -LiteralPath $WorkRoot -Recurse -Force
    }
}
