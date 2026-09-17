const fs = require('fs');
const { execSync } = require('child_process');

const args = process.argv.slice(2);
const newVersion = args[0];

if (!newVersion) {
  console.error('Vui lòng nhập số phiên bản. Ví dụ: npm run release 2.5.0');
  process.exit(1);
}

console.log(`Đang chuẩn bị phát hành phiên bản v${newVersion}...`);

// 1. Cập nhật package.json
const pkgPath = './package.json';
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.version = newVersion;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));

// 2. Cập nhật app.json
const appJsonPath = './app.json';
const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
appJson.expo.version = newVersion;
fs.writeFileSync(appJsonPath, JSON.stringify(appJson, null, 2));

console.log('Đã cập nhật file cấu hình.');

// 3. Commit và Push lên GitHub kèm Tag
try {
  execSync('git add package.json app.json', { stdio: 'inherit' });
  execSync(`git commit -m "Cập nhật phiên bản lên v${newVersion}"`, { stdio: 'inherit' });
  execSync(`git tag v${newVersion}`, { stdio: 'inherit' });
  execSync('git push', { stdio: 'inherit' });
  execSync('git push --tags', { stdio: 'inherit' });
  
  console.log(`\n🎉 THÀNH CÔNG! Đã đẩy mã nguồn và tag v${newVersion} lên GitHub.`);
  console.log('GitHub Actions đang tự động Build APK và tạo Release. Bạn hãy vào tab "Actions" trên GitHub để xem tiến độ.');
} catch (e) {
  console.error('Lỗi khi chạy lệnh git:', e.message);
}
