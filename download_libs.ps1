# download_libs.ps1
# downloads the vendored pdf/docx parsing libraries and verifies each one
# against vendor_libs.lock.json — the single source of truth for exactly
# which build of each file this extension ships.

$lock = Get-Content -Raw -Path (Join-Path $PSScriptRoot "vendor_libs.lock.json") | ConvertFrom-Json
$anyMismatch = $false

foreach ($name in $lock.libs.PSObject.Properties.Name) {
    $entry = $lock.libs.$name
    $destPath = Join-Path $PSScriptRoot $name

    if (Test-Path $destPath) {
        $existingHash = (Get-FileHash -Path $destPath -Algorithm SHA256).Hash.ToLower()
        if ($existingHash -eq $entry.sha256) {
            Write-Host "$name already matches vendor_libs.lock.json ($($entry.version))." -ForegroundColor Yellow
            continue
        }
        Write-Host "$name exists but doesn't match the locked hash — re-downloading." -ForegroundColor Yellow
    }

    Write-Host "Downloading $name ($($entry.version)) from CDN..." -ForegroundColor Cyan
    try {
        Invoke-WebRequest -Uri $entry.url -OutFile $destPath -UseBasicParsing
        $actualHash = (Get-FileHash -Path $destPath -Algorithm SHA256).Hash.ToLower()
        if ($actualHash -ne $entry.sha256) {
            Write-Host "Downloaded $name, but its hash doesn't match vendor_libs.lock.json." -ForegroundColor Red
            Write-Host "  expected: $($entry.sha256)" -ForegroundColor Red
            Write-Host "  got:      $actualHash" -ForegroundColor Red
            $anyMismatch = $true
        } else {
            Write-Host "Verified $name against vendor_libs.lock.json." -ForegroundColor Green
        }
    } catch {
        Write-Host "Error downloading $name : $_" -ForegroundColor Red
        $anyMismatch = $true
    }
}

if ($anyMismatch) {
    Write-Host "`nOne or more files didn't verify — don't ship these as-is." -ForegroundColor Red
    exit 1
} else {
    Write-Host "`nAll libraries present and verified." -ForegroundColor Green
}
