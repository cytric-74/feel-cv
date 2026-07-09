# download_libs.ps1
# PowerShell script to download the required PDF and Word parsing library files locally.

$libs = @{
    "pdf.min.js" = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"
    "pdf.worker.min.js" = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"
    "mammoth.browser.min.js" = "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js"
}

foreach ($lib in $libs.Keys) {
    if (-not (Test-Path $lib)) {
        Write-Host "Downloading $lib from CDN..." -ForegroundColor Cyan
        try {
            Invoke-WebRequest -Uri $libs[$lib] -OutFile $lib -UseBasicParsing
            Write-Host "Successfully downloaded $lib!" -ForegroundColor Green
        } catch {
            Write-Host "Error downloading $lib : $_" -ForegroundColor Red
        }
    } else {
        Write-Host "$lib already exists locally." -ForegroundColor Yellow
    }
}

Write-Host "`nAll libraries checked/downloaded successfully!" -ForegroundColor Green
