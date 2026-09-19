@echo off
title Push CamScanner Release to GitHub
cls
echo ================================================================
echo    DANG TIEN HANH DAY BAN VA V2.6.0 LEN GITHUB
echo ================================================================
echo.
echo [1/2] Dang day nhanh main len GitHub...
git push origin main
if %errorlevel% neq 0 (
    echo.
    echo [CANH BAO] git push can dang nhap tai khoan GitHub.
    echo Vui long dang nhap tren trinh duyet neu duoc hoi.
    echo.
    pause
    exit /b %errorlevel%
)

echo.
echo [2/2] Dang day tag phat hanh v2.6.0...
git push origin v2.6.0 --force

echo.
echo ================================================================
echo [THANH CONG] Toan bo ma nguon va tag v2.6.0 da len GitHub!
echo GitHub Actions dang tu dong bien dich Release APK v2.6.0!
echo ================================================================
echo.
pause
