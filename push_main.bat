@echo off
chcp 65001 > nul
cls
echo ================================================================
echo    TIỆN ÍCH ĐẨY BẢN VÁ HOÀN THIỆN V2.6.0 LÊN GITHUB
echo ================================================================
echo.
echo [1/3] Kiểm tra nhánh hiện tại...
git branch --show-current
echo.
echo [2/3] Đang đẩy 7 commits hoàn thiện lên GitHub (nhánh main)...
git push origin main
if %errorlevel% neq 0 (
    echo.
    echo ❌ LỖI: git push thất bại!
    echo Có thể do chưa đăng nhập GitHub trên máy này.
    echo Vui lòng kiểm tra trình duyệt hoặc đăng nhập Git rồi thử lại.
    echo.
    pause
    exit /b 1
)

echo.
echo [3/3] Đang đẩy Release Tag v2.6.0 lên GitHub...
git push origin v2.6.0 --force
if %errorlevel% neq 0 (
    echo ⚠️ Tag push gặp cảnh báo nhưng nhánh main đã được đẩy thành công.
)

echo.
echo ================================================================
echo 🎉 THÀNH CÔNG RỰC RỠ! ĐÃ ĐẨY BẢN VÁ LÊN GITHUB!
echo GitHub Actions đang tự động kích hoạt tiến trình Build APK v2.6.0.
echo Bạn có thể xem trạng thái tại: https://github.com/duonghungfreekst-prog/app-scan/actions
echo ================================================================
echo.
echo Bấm phím bất kỳ để thoát...
pause > nul
