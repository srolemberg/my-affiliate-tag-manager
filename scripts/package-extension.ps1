$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $projectRoot 'manifest.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$releaseDirectory = Join-Path $projectRoot 'release'
$archivePath = Join-Path $releaseDirectory "my-affiliate-tag-manager-v$($manifest.version).zip"
$stagingDirectory = Join-Path ([System.IO.Path]::GetTempPath()) "my-affiliate-tag-manager-$([guid]::NewGuid().ToString('N'))"
$requiredFiles = @(
    'manifest.json',
    'background.js',
    'popup.html',
    'popup.js',
    'options.html',
    'options.js',
    'footer.html',
    'footer.js',
    'i18n.js',
    'tag-utils.js',
    'tag-16.png',
    'tag-32.png',
    'tag-48.png',
    'tag-128.png'
)

foreach ($file in $requiredFiles) {
    $sourcePath = Join-Path $projectRoot $file
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
        throw "Required extension file is missing: $file"
    }
}

$localesPath = Join-Path $projectRoot '_locales'
if (-not (Test-Path -LiteralPath $localesPath -PathType Container)) {
    throw 'Required extension directory is missing: _locales'
}

New-Item -ItemType Directory -Path $releaseDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $stagingDirectory | Out-Null

try {
    foreach ($file in $requiredFiles) {
        Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination $stagingDirectory
    }
    Copy-Item -LiteralPath $localesPath -Destination $stagingDirectory -Recurse

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
