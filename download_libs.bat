@echo off
title FeelCV Library Downloader
echo ===================================================
echo Downloading third-party library files for FeelCV...
echo ===================================================

echo Downloading pdf.min.js...
powershell -Command "Invoke-WebRequest -Uri 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js' -OutFile 'pdf.min.js'"

echo Downloading pdf.worker.min.js...
powershell -Command "Invoke-WebRequest -Uri 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js' -OutFile 'pdf.worker.min.js'"

echo Downloading mammoth.browser.min.js...
powershell -Command "Invoke-WebRequest -Uri 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js' -OutFile 'mammoth.browser.min.js'"

echo.
echo ===================================================
echo Done! All libraries downloaded successfully.
echo ===================================================
pause
