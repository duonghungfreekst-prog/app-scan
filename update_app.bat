@echo off
chcp 65001 > nul
cls
echo ================================================================
echo    TIỆN ÍCH TỰ ĐỘNG CẬP NHẬT VÀ PHÁT HÀNH CAMSCANNER PRO
echo ================================================================
echo.
echo Nhập nội dung cập nhật của phiên bản mới (hoặc bấm ENTER để tự động):
set /p USER_MSG="> "

echo.
if "%USER_MSG%"=="" (
    node auto_update.js
) else (
    node auto_update.js %USER_MSG%
)

echo.
echo Bấm phím bất kỳ để đóng cửa sổ này...
pause > nul
