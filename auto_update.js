/**
 * auto_update.js — Bộ công cụ 1-Click tự động hóa cập nhật và phát hành
 * Tính năng:
 *   1. Tự động kiểm tra chất lượng mã nguồn (TypeScript Typecheck + Unit Tests)
 *   2. Tự động tăng phiên bản (Patch version: 2.6.0 -> 2.6.1) và tăng versionCode (+1)
 *   3. Tự động đóng gói Git commit + Release Tag
 *   4. Tự động đẩy lên GitHub để kích hoạt CI/CD Build APK tự động
 */

const fs = require('fs');
const { execSync } = require('child_process');

const args = process.argv.slice(2);
const customMessage = args.join(' ').trim();

console.log('================================================================');
console.log('   🚀 BẮT ĐẦU QUY TRÌNH TỰ ĐỘNG HÓA CẬP NHẬT & ĐẨY LÊN GITHUB   ');
console.log('================================================================\n');

// 1. Kiểm tra Typecheck & Unit Tests
console.log('🔍 Bước 1/4: Đang kiểm tra toàn vẹn mã nguồn...');
try {
  console.log(' -> Đang chạy Typecheck (tsc --noEmit)...');
  execSync('npm run typecheck', { stdio: 'inherit' });
  console.log(' -> Đang chạy toàn bộ 6 Unit Test Suites...');
  execSync('npm test', { stdio: 'inherit' });
  console.log('✅ Mã nguồn hợp lệ 100%, không có lỗi!');
} catch (e) {
  console.error('\n❌ PHÁT HIỆN LỖI TRONG MÃ NGUỒN! Quy trình cập nhật tự động dừng lại.');
  process.exit(1);
}

// 2. Tính toán phiên bản mới
console.log('\n📦 Bước 2/4: Tính toán số hiệu phiên bản mới...');
const pkgPath = './package.json';
const appJsonPath = './app.json';

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));

const currentVer = pkg.version || '2.6.0';
const parts = currentVer.split('.').map(Number);
parts[parts.length - 1] = (parts[parts.length - 1] || 0) + 1;
const newVersion = parts.join('.');

if (!appJson.expo.android) appJson.expo.android = {};
const oldCode = appJson.expo.android.versionCode || 1;
const newCode = oldCode + 1;

pkg.version = newVersion;
appJson.expo.version = newVersion;
appJson.expo.android.versionCode = newCode;

fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
fs.writeFileSync(appJsonPath, JSON.stringify(appJson, null, 2) + '\n');

// Tự động đồng bộ package-lock.json
try {
  execSync('npm install --package-lock-only', { stdio: 'ignore' });
} catch (e) {}

console.log(` -> Phiên bản nâng cấp: v${currentVer} -> v${newVersion}`);
console.log(` -> Android Build Code: ${oldCode} -> ${newCode}`);

// 3. Git Commit & Tag
console.log('\n📝 Bước 3/4: Đóng gói Git commit và tạo Release Tag...');
const commitMsg = customMessage
  ? `feat(update): ${customMessage} (v${newVersion})`
  : `feat(update): auto release v${newVersion} (build ${newCode})`;

try {
  execSync('git add -A', { stdio: 'inherit' });
  execSync(`git commit -m "${commitMsg}"`, { stdio: 'inherit' });
  execSync(`git tag -a v${newVersion} -m "Release v${newVersion}"`, { stdio: 'inherit' });
  console.log(`✅ Đã commit và tạo Tag: v${newVersion}`);
} catch (e) {
  console.warn('⚠️ Ghi chú Git: Có thể không có file mới nào thay đổi hoặc tag đã tồn tại.');
}

// 4. Git Push lên GitHub
console.log('\n🌐 Bước 4/4: Đang đẩy mã nguồn và tag lên GitHub...');
try {
  execSync('git push origin main', { stdio: 'inherit' });
  execSync('git push origin --tags', { stdio: 'inherit' });
  console.log('\n================================================================');
  console.log(`🎉 THÀNH CÔNG RỰC RỠ! Phiên bản v${newVersion} đã được đẩy lên GitHub!`);
  console.log('GitHub Actions đang tự động Build APK Release mới nhất.');
  console.log('Bạn có thể theo dõi tiến trình tại tab "Actions" trên GitHub repo.');
  console.log('================================================================\n');
} catch (e) {
  console.error('\n⚠️ LƯU Ý: Lệnh git push cần xác thực tài khoản GitHub một lần.');
  console.error('Nếu trình duyệt vừa bật lên, vui lòng đăng nhập để hoàn tất đẩy code.');
  console.error('Hoặc bạn có thể mở terminal và gõ: git push origin main --tags');
}
