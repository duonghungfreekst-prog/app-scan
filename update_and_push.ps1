[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "   TIỆN ÍCH TỰ ĐỘNG ĐẨY BẢN VÁ V2.6.0 LÊN GITHUB RELEASE       " -ForegroundColor Yellow
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "-> [1/2] Đang đẩy 8 commits bản vá lên nhánh main..." -ForegroundColor Green
git push origin main
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "❌ Git Push yêu cầu xác thực tài khoản GitHub." -ForegroundColor Red
    Write-Host "Nếu trình duyệt mở ra, vui lòng bấm 'Sign in with your browser' hoặc cấp quyền." -ForegroundColor Yellow
    Write-Host "Hoặc bạn có thể dán Personal Access Token vào cấu hình." -ForegroundColor Yellow
    pause
    exit 1
}

Write-Host "-> [2/2] Đang đẩy Release Tag v2.6.0..." -ForegroundColor Green
git push origin v2.6.0 --force

Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "🎉 THÀNH CÔNG RỰC RỠ! ĐÃ ĐẨY BẢN VÁ LÊN GITHUB!" -ForegroundColor Green
Write-Host "GitHub Actions đang tự động Build APK Release v2.6.0." -ForegroundColor Green
Write-Host "Theo dõi tại: https://github.com/duonghungfreekst-prog/app-scan/actions" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""
pause
