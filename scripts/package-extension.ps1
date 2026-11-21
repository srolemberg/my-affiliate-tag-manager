$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $projectRoot 'manifest.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$packageDefinitionPath = Join-Path $PSScriptRoot 'extension-package.json'
$packageDefinition = Get-Content -LiteralPath $packageDefinitionPath -Raw | ConvertFrom-Json
$releaseDirectory = Join-Path $projectRoot 'release'
$archivePath = Join-Path $releaseDirectory "my-affiliate-tag-manager-v$($manifest.version).zip"
$stagingDirectory = Join-Path ([System.IO.Path]::GetTempPath()) "my-affiliate-tag-manager-$([guid]::NewGuid().ToString('N'))"

& node (Join-Path $PSScriptRoot 'validate-extension-package.js')
if ($LASTEXITCODE -ne 0) {
    throw 'Extension package validation failed. Update scripts/extension-package.json before packaging.'
}

foreach ($file in $packageDefinition.files) {
    $sourcePath = Join-Path $projectRoot $file
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
        throw "Required extension file is missing: $file"
    }
}

foreach ($directory in $packageDefinition.directories) {
    $sourcePath = Join-Path $projectRoot $directory
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Container)) {
        throw "Required extension directory is missing: $directory"
    }
}

New-Item -ItemType Directory -Path $releaseDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $stagingDirectory | Out-Null

try {
    foreach ($file in $packageDefinition.files) {
        $stagedPath = Join-Path $stagingDirectory $file
        $stagedParent = Split-Path -Parent $stagedPath
        New-Item -ItemType Directory -Path $stagedParent -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination $stagedPath
    }
    foreach ($directory in $packageDefinition.directories) {
        $stagedPath = Join-Path $stagingDirectory $directory
        $stagedParent = Split-Path -Parent $stagedPath
        New-Item -ItemType Directory -Path $stagedParent -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $projectRoot $directory) -Destination $stagedPath -Recurse
    }

    $workerPath = Join-Path $stagingDirectory 'background.js'
    $workerSource = Get-Content -LiteralPath $workerPath -Raw
    $utilitySource = Get-Content -LiteralPath (Join-Path $stagingDirectory 'tag-utils.js') -Raw
    $workerImport = "importScripts('tag-utils.js');"
    if (-not $workerSource.Contains($workerImport)) {
        throw 'The service worker does not contain its expected local utility import.'
    }
    $workerSource = $workerSource.Replace($workerImport, '')
    [System.IO.File]::WriteAllText(
        $workerPath,
        "$utilitySource`r`n$workerSource",
        [System.Text.Encoding]::UTF8
    )

    if (Test-Path -LiteralPath $archivePath -PathType Leaf) {
        Remove-Item -LiteralPath $archivePath
    }
    Add-Type -AssemblyName System.IO.Compression
    $archiveStream = [System.IO.File]::Open(
        $archivePath,
        [System.IO.FileMode]::Create,
        [System.IO.FileAccess]::ReadWrite,
        [System.IO.FileShare]::None
    )
    $zipArchive = New-Object System.IO.Compression.ZipArchive(
        $archiveStream,
        [System.IO.Compression.ZipArchiveMode]::Create
    )
    try {
        Get-ChildItem -LiteralPath $stagingDirectory -File -Recurse | ForEach-Object {
            $relativePath = $_.FullName.Substring($stagingDirectory.Length)
            $entryName = $relativePath.TrimStart(
                [char[]]@(
                    [System.IO.Path]::DirectorySeparatorChar,
                    [System.IO.Path]::AltDirectorySeparatorChar
                )
            ).Replace('\', '/')
            $entry = $zipArchive.CreateEntry(
                $entryName,
                [System.IO.Compression.CompressionLevel]::Optimal
            )
            $source = [System.IO.File]::OpenRead($_.FullName)
            $destination = $entry.Open()
            try {
                $source.CopyTo($destination)
            }
            finally {
                $destination.Dispose()
                $source.Dispose()
            }
        }
    }
    finally {
        $zipArchive.Dispose()
        $archiveStream.Dispose()
    }
    Write-Output "Extension package created: $archivePath"
}
finally {
    if (Test-Path -LiteralPath $stagingDirectory -PathType Container) {
        Remove-Item -LiteralPath $stagingDirectory -Recurse -Force
    }
}
