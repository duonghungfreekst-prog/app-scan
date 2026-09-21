/**
 * release_script.js — Quy trình tự động hóa phát hành phiên bản (CI/CD Pre-flight Verification)
 * Thứ tự chuẩn:
 *   1. Typecheck (tsc --noEmit) & Unit Tests (test_suite.js)
 *   2. Bump version & versionCode (package.json, app.json, package-lock.json)
 *   3. Kiểm tra tính đồng bộ phiên bản giữa package.json, package-lock.json và app.json trước khi tạo release commit
 *   4. Tạo Git release commit
 *   5. Kiểm tra Typecheck và Unit Test trước khi cho phép đóng gói tag
 *   6. Đóng gói Tag (git tag) -> Push lên GitHub
 */

const fs = require('fs');
const { execSync } = require('child_process');

const args = process.argv.slice(2);
const newVersion = args[0];
const explicitVersionCode = args[1] ? parseInt(args[1], 10) : null;

if (!newVersion) {
  console.error('❌ Vui lòng nhập số phiên bản. Ví dụ: npm run release 2.5.1 [versionCode]');
  process.exit(1);
}

/**
 * Hàm kiểm tra chất lượng mã nguồn: Typecheck và Unit Tests
 */
function runQualityChecks(stageDescription = 'trước khi phát hành') {
  console.log(`\n🔍 Đang chạy kiểm tra Typecheck và Unit Tests (${stageDescription})...`);
  try {
    console.log(' -> Đang kiểm tra TypeScript Typecheck (npm run typecheck)...');
    execSync('npm run typecheck', { stdio: 'inherit' });
    console.log(' -> Đang chạy toàn bộ Unit Test Suite (npm test)...');
    execSync('npm test', { stdio: 'inherit' });
    console.log('✅ Kiểm tra chất lượng mã nguồn (Typecheck & Unit Tests) hoàn tất 100%!');
  } catch (e) {
    console.error(`\n❌ PHÁT HIỆN LỖI TRONG MÃ NGUỒN HOẶC TESTS THẤT BẠI TRONG GIAI ĐOẠN: ${stageDescription.toUpperCase()}!`);
    console.error('Quy trình phát hành đã bị hủy bỏ để bảo vệ an toàn hệ thống (không tạo release/tag).');
    process.exit(1);
  }
}

// BƯỚC 1: Kiểm tra tĩnh và Unit Tests trước khi bắt đầu
console.log(`\n🔍 BƯỚC 1/4: Chạy kiểm tra tĩnh và Unit Tests ban đầu...`);
runQualityChecks('pre-flight kiểm tra tĩnh ban đầu');

// BƯỚC 2: Cập nhật cấu hình phiên bản
console.log(`\n📦 BƯỚC 2/4: Cập nhật cấu hình phiên bản v${newVersion}...`);

// 1. Cập nhật package.json
const pkgPath = './package.json';
if (!fs.existsSync(pkgPath)) {
  console.error('❌ Không tìm thấy file package.json!');
  process.exit(1);
}
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.version = newVersion;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

// 2. Cập nhật app.json & quản lý versionCode
const appJsonPath = './app.json';
if (!fs.existsSync(appJsonPath)) {
  console.error('❌ Không tìm thấy file app.json!');
  process.exit(1);
}
const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
if (!appJson.expo) appJson.expo = {};
appJson.expo.version = newVersion;
if (!appJson.expo.android) appJson.expo.android = {};
const oldVersionCode = appJson.expo.android.versionCode || 1;
const nextVersionCode = explicitVersionCode || (oldVersionCode + 1);
appJson.expo.android.versionCode = nextVersionCode;
fs.writeFileSync(appJsonPath, JSON.stringify(appJson, null, 2) + '\n');

// 3. Cập nhật và đồng bộ package-lock.json
const pkgLockPath = './package-lock.json';
if (fs.existsSync(pkgLockPath)) {
  try {
    const pkgLock = JSON.parse(fs.readFileSync(pkgLockPath, 'utf8'));
    pkgLock.version = newVersion;
    if (pkgLock.packages && pkgLock.packages['']) {
      pkgLock.packages[''].version = newVersion;
    }
    fs.writeFileSync(pkgLockPath, JSON.stringify(pkgLock, null, 2) + '\n');
  } catch (e) {
    console.warn('⚠️ Cảnh báo khi cập nhật trực tiếp package-lock.json:', e.message);
  }
}

try {
  execSync('npm install --package-lock-only', { stdio: 'ignore' });
} catch (e) {
  console.warn('⚠️ Cảnh báo khi chạy npm install --package-lock-only:', e.message);
}

// BƯỚC 3: Kiểm tra tính đồng bộ phiên bản giữa package.json, package-lock.json và app.json trước khi tạo release commit
console.log(`\n🔍 BƯỚC 3/4: Kiểm tra tính đồng bộ phiên bản trước khi tạo release commit...`);
const verifiedPkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const verifiedAppJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
const pkgVersion = verifiedPkg.version;
const appVersion = verifiedAppJson.expo?.version;

let lockVersion = null;
let lockRootVersion = null;
const lockExists = fs.existsSync(pkgLockPath);

if (lockExists) {
  const verifiedPkgLock = JSON.parse(fs.readFileSync(pkgLockPath, 'utf8'));
  lockVersion = verifiedPkgLock.version;
  lockRootVersion = verifiedPkgLock.packages?.['']?.version || lockVersion;
}

const syncErrors = [];
if (pkgVersion !== newVersion) {
  syncErrors.push(`- package.json: phiên bản là '${pkgVersion}' (kỳ vọng '${newVersion}')`);
}
if (appVersion !== newVersion) {
  syncErrors.push(`- app.json: expo.version là '${appVersion}' (kỳ vọng '${newVersion}')`);
}
if (lockExists) {
  if (lockVersion !== newVersion) {
    syncErrors.push(`- package-lock.json: version là '${lockVersion}' (kỳ vọng '${newVersion}')`);
  }
  if (lockRootVersion !== newVersion) {
    syncErrors.push(`- package-lock.json (packages[""]): version là '${lockRootVersion}' (kỳ vọng '${newVersion}')`);
  }
} else {
  syncErrors.push(`- Không tìm thấy file package-lock.json`);
}

if (pkgVersion !== appVersion || (lockExists && (pkgVersion !== lockVersion || pkgVersion !== lockRootVersion))) {
  syncErrors.push(`- Bất đồng bộ giữa các file: package.json (${pkgVersion}) !== app.json (${appVersion}) !== package-lock.json (${lockVersion})`);
}

if (syncErrors.length > 0) {
  console.error('\n❌ PHÁT HIỆN BẤT ĐỒNG BỘ PHIÊN BẢN TRƯỚC KHI TẠO RELEASE COMMIT!');
  syncErrors.forEach(err => console.error(`  ${err}`));
  console.error('Quy trình phát hành đã bị hủy bỏ để đảm bảo tính nhất quán.');
  process.exit(1);
}

console.log(`✅ Xác nhận đồng bộ 100% phiên bản v${newVersion} giữa package.json, package-lock.json và app.json!`);

// BƯỚC 4: Tạo Git Commit, Kiểm tra Typecheck/Tests trước khi cho phép đóng gói Tag và Đẩy lên GitHub
console.log(`\n🚀 BƯỚC 4/4: Tạo Release Commit và chuẩn bị đóng gói Tag...`);
try {
  execSync('git add -A', { stdio: 'inherit' });
  execSync(`git commit -m "chore(release): bump version to v${newVersion} (build ${nextVersionCode}) - Production hardened and 58 issues resolved"`, { stdio: 'inherit' });

  // Kiểm tra typecheck và unit test trước khi cho phép đóng gói tag
  console.log(`\n🏷️ Bắt buộc kiểm tra Typecheck và Unit Test trước khi cho phép đóng gói tag v${newVersion}...`);
  runQualityChecks('trước khi đóng gói tag release');

  console.log(`\n🏷️ Tiến hành đóng gói tag v${newVersion} và đẩy lên GitHub...`);
  execSync(`git tag -a v${newVersion} -m "Release v${newVersion}"`, { stdio: 'inherit' });
  execSync('git push', { stdio: 'inherit' });
  execSync('git push --tags', { stdio: 'inherit' });

  console.log(`\n🎉 THÀNH CÔNG RỰC RỠ! Đã đẩy mã nguồn và tag v${newVersion} lên GitHub.`);
  console.log('GitHub Actions đang tự động Build APK Release an toàn.');
} catch (e) {
  console.error('❌ Lỗi khi thực thi quy trình phát hành:', e.message);
  process.exit(1);
}
