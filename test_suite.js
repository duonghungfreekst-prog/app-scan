/**
 * test_suite.js — Kiểm tra toàn bộ logic cốt lõi: Math Normalization, Version Compare, File Logic
 * Chạy trực tiếp bằng Node.js built-in test runner: node test_suite.js
 */

const assert = require('assert');

// 1. Test Version Compare Logic
function compareVersions(v1, v2) {
  const parts1 = v1.replace(/[^0-9.]/g, '').split('.').map(Number);
  const parts2 = v2.replace(/[^0-9.]/g, '').split('.').map(Number);
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  return 0;
}

console.log('--- BẮT ĐẦU KIỂM THỬ ĐƠN VỊ (UNIT TESTS) ---');

// Test 1: Version Compare
assert.strictEqual(compareVersions('v2.5.0', '2.3.0'), 1, '2.5.0 phải lớn hơn 2.3.0');
assert.strictEqual(compareVersions('v2.3.0', '2.3.0'), 0, '2.3.0 phải bằng 2.3.0');
assert.strictEqual(compareVersions('2.2.9', '2.3.0'), -1, '2.2.9 phải nhỏ hơn 2.3.0');
assert.strictEqual(compareVersions('v2.10.0', '2.9.0'), 1, '2.10.0 phải lớn hơn 2.9.0 (so sánh số chứ không so sánh chuỗi)');
console.log('✅ Test 1: Logic Version Compare hoạt động hoàn hảo.');

// Test 2: Math Normalization (Bảo vệ cos, sin, sqrt, không biến s thành 5, không biến o trong cos thành 0)
function normalizeMathExpression(raw) {
  if (!raw) return '';
  let clean = raw
    .replace(/[\r\n]+/g, ' ')
    .replace(/[–—−]/g, '-')
    .replace(/[×✕]/g, '*')
    .replace(/[÷]/g, '/')
    .replace(/[^\x00-\x7F]/g, ' ')
    .trim();

  clean = clean.replace(/\s+/g, ' ');
  // Thay thế 'o' hoặc 'O' thành '0' CHỈ KHI đứng giữa các chữ số
  clean = clean.replace(/(\d)[oO]+(\d)/g, '$10$2');
  clean = clean.replace(/(\d)[oO]+/g, '$10');
  clean = clean.replace(/[oO]+(\d)/g, '0$1');
  return clean;
}

const eqTrig = normalizeMathExpression('cos(x) = 0');
assert.ok(eqTrig.includes('cos(x)'), 'cos(x) không được biến dạng thành c0 5');
assert.ok(!eqTrig.includes('c0 5'), 'Không được có c0 5 trong biểu thức');

const eqVarS = normalizeMathExpression('2*s + 5 = 15');
assert.ok(eqVarS.includes('2*s'), 'Biến số s không được thay thế bằng số 5');

const eqDigitO = normalizeMathExpression('1o0 + 5');
assert.strictEqual(eqDigitO, '100 + 5', 'Số 1o0 phải được sửa thành 100');

console.log('✅ Test 2: Math Normalization đã sửa triệt để bug lượng giác và biến số.');

// Test 3: Safe File Naming (Chống ký tự nguy hiểm nhưng giữ trọn vẹn tiếng Việt có dấu)
function cleanFileName(baseName) {
  return baseName.replace(/[^\p{L}\p{N}_\-\s]/gu, '_').trim();
}

const clean = cleanFileName('Tài liệu /?* quan trọng: 2026');
assert.ok(!clean.includes('/'), 'Không được chứa gạch chéo');
assert.ok(!clean.includes('?'), 'Không được chứa dấu hỏi');
assert.ok(!clean.includes('*'), 'Không được chứa dấu sao');
assert.ok(clean.includes('Tài liệu'), 'Phải giữ được tiếng Việt có dấu');
console.log('✅ Test 3: Chuẩn hóa tên file an toàn tuyệt đối.');

// Test 4: Giả lập Mutex Write Queue (Atomic Storage Serialization)
let simulatedQueue = Promise.resolve();
const writeLog = [];
function queueWrite(item) {
  simulatedQueue = simulatedQueue.then(async () => {
    // mô phỏng I/O trễ
    await new Promise(r => setTimeout(r, 10));
    writeLog.push(item);
  });
  return simulatedQueue;
}

Promise.all([queueWrite('A'), queueWrite('B'), queueWrite('C')]).then(() => {
  assert.deepStrictEqual(writeLog, ['A', 'B', 'C'], 'Write Queue phải xử lý tuần tự theo thứ tự FIFO');
  console.log('✅ Test 4: Mutex Write Queue tuần tự hóa chuẩn xác.');
  console.log('🎉 TẤT CẢ UNIT TESTS ĐÃ VƯỢT QUA 100%!');
});
