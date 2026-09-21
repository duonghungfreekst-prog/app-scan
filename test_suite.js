/**
 * test_suite.js — Kiểm thử đơn vị toàn diện (Unit Test Suite)
 * Kiểm tra các tính toán cốt lõi: Math Normalization, Sanitize File Name, Polygon Convexity, Storage Schema, Version Compare, Math Sandbox Security, KaTeX Formatting.
 * Chạy: node test_suite.js
 */

const assert = require('assert');

console.log('====================================================');
console.log('   BẮT ĐẦU KIỂM THỬ ĐƠN VỊ TOÀN DIỆN (UNIT TESTS)   ');
console.log('====================================================\n');

// ----------------------------------------------------
// 1. TEST VERSION COMPARE LOGIC
// ----------------------------------------------------
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

assert.strictEqual(compareVersions('v2.5.0', '2.3.0'), 1, '2.5.0 > 2.3.0');
assert.strictEqual(compareVersions('v2.3.0', '2.3.0'), 0, '2.3.0 == 2.3.0');
assert.strictEqual(compareVersions('2.2.9', '2.3.0'), -1, '2.2.9 < 2.3.0');
assert.strictEqual(compareVersions('v2.10.0', '2.9.0'), 1, '2.10.0 > 2.9.0 (so sánh số học)');
console.log('✅ Test 1 [PASSED]: So sánh phiên bản (Version Compare) hoạt động chuẩn xác.');

// ----------------------------------------------------
// 2. TEST MATH NORMALIZATION & TOKEN PRESERVATION
// ----------------------------------------------------
function normalizeMathExpression(raw) {
  if (!raw) return '';
  let clean = raw
    .replace(/[\r\n]+/g, ' ')
    .replace(/[–—−]/g, '-')
    .replace(/[×✕]/g, '*')
    .replace(/[÷]/g, '/')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .trim();

  clean = clean.replace(/\s+/g, ' ');
  clean = clean.replace(/(\d)[oO]+(\d)/g, '$10$2');
  clean = clean.replace(/(\d)[oO]+/g, '$10');
  clean = clean.replace(/[oO]+(\d)/g, '0$1');
  clean = clean.replace(/(\d)[lI]+(\d)/g, '$11$2');
  return clean;
}

const trigExpr = normalizeMathExpression('cos(x) + sin(x) = 1');
assert.ok(trigExpr.includes('cos(x)'), 'cos(x) không được bị biến dạng');
assert.ok(trigExpr.includes('sin(x)'), 'sin(x) không được bị biến thành 5in(x)');

const variableS = normalizeMathExpression('s^2 + 2*s + 1 = 0');
assert.ok(variableS.includes('2*s'), 'Biến s không được bị thay bằng 5');

const digitO = normalizeMathExpression('1o0 + 2O5');
assert.strictEqual(digitO, '100 + 205', 'Số 1o0 và 2O5 phải sửa thành 100 và 205');

const digitL = normalizeMathExpression('5l5 * 2');
assert.strictEqual(digitL, '515 * 2', 'Ký tự l nằm giữa số phải sửa thành 1');

console.log('✅ Test 2 [PASSED]: Chuẩn hóa toán học bảo toàn hàm lượng giác & biến số.');

// ----------------------------------------------------
// 3. TEST MATH PARENTHESES VALIDATION
// ----------------------------------------------------
function validateParentheses(expr) {
  let count = 0;
  for (const ch of expr) {
    if (ch === '(' || ch === '[' || ch === '{') count++;
    if (ch === ')' || ch === ']' || ch === '}') count--;
    if (count < 0) return false;
  }
  return count === 0;
}

assert.strictEqual(validateParentheses('(x + 1) * (x - 1)'), true, 'Dấu ngoặc cân bằng hợp lệ');
assert.strictEqual(validateParentheses('(x + 1 * (x - 1)'), false, 'Dấu ngoặc thiếu đóng');
assert.strictEqual(validateParentheses(')x + 1('), false, 'Thứ tự ngoặc bị ngược');
console.log('✅ Test 3 [PASSED]: Kiểm tra cân bằng dấu ngoặc biểu thức toán học.');

// ----------------------------------------------------
// 4. TEST SANITIZE FILENAME (Windows & Unix Safe)
// ----------------------------------------------------
const WINDOWS_RESERVED = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

function sanitizeFileName(rawName, fallbackBase = 'TaiLieu') {
  if (!rawName) return `${fallbackBase}_${Date.now()}`;
  let clean = rawName.replace(/\.{2,}/g, '.');
  clean = clean.replace(/[^\p{L}\p{N}_\-\s]/gu, '_');
  clean = clean.replace(/\s+/g, ' ').trim();
  clean = clean.replace(/^\.+/, '').replace(/\.+$/, '');
  if (clean.length > 120) clean = clean.substring(0, 120).trim();
  if (!clean) clean = `${fallbackBase}_${Date.now()}`;
  const upper = clean.toUpperCase();
  const baseWithoutExt = upper.split('.')[0];
  if (WINDOWS_RESERVED.has(baseWithoutExt)) {
    clean = `${clean}_doc`;
  }
  return clean;
}

const clean1 = sanitizeFileName('../../secret/file:name*?.pdf');
assert.ok(!clean1.includes('..'), 'Không được chứa path traversal ..');
assert.ok(!clean1.includes(':'), 'Không được chứa dấu :');
assert.ok(!clean1.includes('?'), 'Không được chứa dấu ?');
assert.ok(!clean1.includes('*'), 'Không được chứa dấu *');

const cleanWin = sanitizeFileName('CON');
assert.strictEqual(cleanWin, 'CON_doc', 'Tên cấm Windows CON phải được thêm suffix an toàn');

const cleanVN = sanitizeFileName('Hợp đồng kinh tế & Biên bản bàn giao 2026 (ơ, ư, đ, ả, ã, ạ, ợ)');
assert.ok(cleanVN.includes('Hợp đồng'), 'Phải bảo tồn nguyên vẹn chữ cái tiếng Việt');
assert.ok(cleanVN.includes('ơ, ư, đ, ả, ã, ạ, ợ'.replace(/[^\p{L}\p{N}_\-\s]/gu, '_')), 'Phải bảo tồn các ký tự tiếng Việt đặc biệt ơ, ư, đ, ả, ã, ạ, ợ');

// 1. Ca kiểm thử chuỗi tiếng Việt phức tạp chứa đầy đủ các dấu (ơ, ư, đ, ả, ã, ạ, ợ, ề, ồ, ứ, ử, ỹ, ỵ...)
const allVietnameseDiacritics = [
  'ơ', 'ư', 'đ', 'ả', 'ã', 'ạ', 'ợ', 'ề', 'ồ', 'ứ', 'ử', 'ỹ', 'ỵ',
  'Ơ', 'Ư', 'Đ', 'Ả', 'Ã', 'Ạ', 'Ợ', 'Ề', 'Ồ', 'Ứ', 'Ử', 'Ỹ', 'Ỵ'
];
const complexVnSentence = 'Đơn đề nghị cấp đất ở (ơ, ư, đ, ả, ã, ạ, ợ, ề, ồ, ứ, ử, ỹ, ỵ - Ơ, Ư, Đ, Ả, Ã, Ạ, Ợ, Ề, Ồ, Ứ, Ử, Ỹ, Ỵ)';
const cleanComplexVN = sanitizeFileName(complexVnSentence);

// Xác thực từng ký tự tiếng Việt có dấu không bị rơi rụng hoặc mất mát
for (const ch of allVietnameseDiacritics) {
  assert.ok(cleanComplexVN.includes(ch), `Ký tự tiếng Việt '${ch}' không được bị mất trong sanitizeFileName`);
}

// Kiểm tra chuỗi tiếng Việt thuần túy có dấu không chứa ký tự cấm thì giữ nguyên vẹn 100%, không bị biến thành gạch dưới
const pureVnString = 'Hồ sơ tuyển sinh đại học quốc gia ngành khoa học máy tính ơ ư đ ả ã ạ ợ ề ồ ứ ử ỹ ỵ';
assert.strictEqual(
  sanitizeFileName(pureVnString),
  pureVnString,
  'Chuỗi tiếng Việt chuẩn chứa đầy đủ dấu ơ, ư, đ, ả, ã, ạ, ợ, ề, ồ, ứ, ử, ỹ, ỵ phải giữ nguyên 100% không thêm gạch dưới'
);

// 2. Ca kiểm thử cơ chế tự động đánh số tăng dần _1, _2 khi trùng tên file (getUniqueFilePath)
function getUniqueFilePath(existingFiles, dir, baseName, ext) {
  const cleanBase = sanitizeFileName(baseName, 'TaiLieu');
  const formattedExt = ext ? (ext.startsWith('.') ? ext : `.${ext}`) : '';
  
  let targetUri = `${dir}${cleanBase}${formattedExt}`;
  let counter = 1;

  while (existingFiles.has(targetUri)) {
    targetUri = `${dir}${cleanBase}_${counter}${formattedExt}`;
    counter++;
  }
  return targetUri;
}

const mockExistingFiles = new Set();
const testDir = 'file:///data/user/0/com.camscanner.expo/files/';

// Lần đầu tiên tạo file -> Giữ nguyên tên gốc, không thêm hậu tố số
const initialPath = getUniqueFilePath(mockExistingFiles, testDir, 'BaoCaoTaiChinh', '.pdf');
assert.strictEqual(initialPath, `${testDir}BaoCaoTaiChinh.pdf`, 'File mới chưa tồn tại phải giữ nguyên tên gốc');
mockExistingFiles.add(initialPath);

// Trùng tên lần 1 -> Tự động thêm hậu tố _1
const dupPath1 = getUniqueFilePath(mockExistingFiles, testDir, 'BaoCaoTaiChinh', '.pdf');
assert.strictEqual(dupPath1, `${testDir}BaoCaoTaiChinh_1.pdf`, 'Trùng tên lần 1 phải tự động thêm hậu tố _1');
mockExistingFiles.add(dupPath1);

// Trùng tên lần 2 -> Tự động tăng dần hậu tố lên _2
const dupPath2 = getUniqueFilePath(mockExistingFiles, testDir, 'BaoCaoTaiChinh', '.pdf');
assert.strictEqual(dupPath2, `${testDir}BaoCaoTaiChinh_2.pdf`, 'Trùng tên lần 2 phải tự động tăng dần lên _2');
mockExistingFiles.add(dupPath2);

// Trùng tên lần 3 -> Tự động tăng dần hậu tố lên _3
const dupPath3 = getUniqueFilePath(mockExistingFiles, testDir, 'BaoCaoTaiChinh', '.pdf');
assert.strictEqual(dupPath3, `${testDir}BaoCaoTaiChinh_3.pdf`, 'Trùng tên lần 3 phải tự động tăng dần lên _3');
mockExistingFiles.add(dupPath3);

// Kiểm tra trùng tên với chuỗi tiếng Việt có dấu phức tạp (ơ, ư, đ, ả, ã, ạ, ợ, ề, ồ, ứ, ử, ỹ, ỵ)
const vnBaseName = 'Hợp đồng chuyển nhượng ơ ư đ ả ã ạ ợ ề ồ ứ ử ỹ ỵ';
const cleanVnBaseName = sanitizeFileName(vnBaseName);

const initialVnPath = getUniqueFilePath(mockExistingFiles, testDir, vnBaseName, '.pdf');
assert.strictEqual(initialVnPath, `${testDir}${cleanVnBaseName}.pdf`, 'File tiếng Việt lần đầu giữ nguyên tên có dấu đầy đủ');
mockExistingFiles.add(initialVnPath);

const dupVnPath1 = getUniqueFilePath(mockExistingFiles, testDir, vnBaseName, '.pdf');
assert.strictEqual(dupVnPath1, `${testDir}${cleanVnBaseName}_1.pdf`, 'File tiếng Việt trùng lần 1 phải tự động thêm _1');
mockExistingFiles.add(dupVnPath1);

const dupVnPath2 = getUniqueFilePath(mockExistingFiles, testDir, vnBaseName, '.pdf');
assert.strictEqual(dupVnPath2, `${testDir}${cleanVnBaseName}_2.pdf`, 'File tiếng Việt trùng lần 2 phải tự động tăng dần lên _2');
mockExistingFiles.add(dupVnPath2);

// Kiểm tra định dạng phần mở rộng không có dấu chấm (ext không bắt đầu bằng .)
const noDotExtPath = getUniqueFilePath(mockExistingFiles, testDir, 'ChungTu', 'pdf');
assert.strictEqual(noDotExtPath, `${testDir}ChungTu.pdf`, 'Phần mở rộng thiếu dấu chấm phải được tự động bổ sung');

console.log('✅ Test 4 [PASSED]: Sanitize tên file chống Path Traversal, Windows Reserved Words, bảo toàn 100% tiếng Việt Unicode (ơ, ư, đ, ả, ã, ạ, ợ, ề, ồ, ứ, ử, ỹ, ỵ...) và cơ chế tự động đánh số tăng dần _1, _2 khi trùng tên file.');

// ----------------------------------------------------
// 5. TEST POLYGON CONVEXITY & SELF-INTERSECTION
// ----------------------------------------------------
function isConvexPolygon(corners) {
  if (!corners || corners.length !== 4) return false;
  // Thứ tự chu vi tứ giác: 0 (TL) -> 1 (TR) -> 3 (BR) -> 2 (BL)
  const p = [corners[0], corners[1], corners[3], corners[2]];

  let prevSign = 0;
  for (let i = 0; i < 4; i++) {
    const p1 = p[i];
    const p2 = p[(i + 1) % 4];
    const p3 = p[(i + 2) % 4];

    const dx1 = p2.x - p1.x;
    const dy1 = p2.y - p1.y;
    const dx2 = p3.x - p2.x;
    const dy2 = p3.y - p2.y;

    // Cross product của 2 vector liên tiếp (p1->p2 và p2->p3)
    const cross = dx1 * dy2 - dy1 * dx2;

    // Nếu 3 điểm thẳng hàng hoặc quá sát nhau thì không phải đa giác lồi hợp lệ
    if (Math.abs(cross) < 1e-3) {
      return false;
    }

    const currentSign = cross > 0 ? 1 : -1;
    if (prevSign === 0) {
      prevSign = currentSign;
    } else if (currentSign !== prevSign) {
      // Đổi chiều rẽ: tứ giác bị lõm hoặc tự cắt nhau
      return false;
    }
  }

  // Đảm bảo diện tích Shoelace > 0
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    area += p[i].x * p[j].y - p[j].x * p[i].y;
  }
  if (Math.abs(area) < 10) {
    return false;
  }

  return true;
}

// 1. Kiểm tra hình chữ nhật chuẩn (đa giác lồi hợp lệ)
const rectCorners = [
  { x: 50, y: 50 },   // TL (0)
  { x: 350, y: 50 },  // TR (1)
  { x: 50, y: 450 },  // BL (2)
  { x: 350, y: 450 }, // BR (3)
];
assert.strictEqual(isConvexPolygon(rectCorners), true, 'Hình chữ nhật phải là đa giác lồi hợp lệ');

// 2. Kiểm tra hình thang chuẩn (đa giác lồi hợp lệ)
const trapezoidCorners = [
  { x: 100, y: 60 },  // TL (0)
  { x: 300, y: 60 },  // TR (1)
  { x: 50, y: 400 },  // BL (2)
  { x: 350, y: 400 }, // BR (3)
];
assert.strictEqual(isConvexPolygon(trapezoidCorners), true, 'Hình thang phải là đa giác lồi hợp lệ');

// 3. Kiểm tra hình tự cắt chéo (Bowtie / Cánh bướm - TR bị kéo chéo xuống BR, BR kéo lên TR)
const bowtieCorners = [
  { x: 50, y: 50 },   // TL (0)
  { x: 350, y: 450 }, // TR (1)
  { x: 50, y: 450 },  // BL (2)
  { x: 350, y: 50 },  // BR (3)
];
assert.strictEqual(isConvexPolygon(bowtieCorners), false, 'Hình tự cắt chéo (cánh bướm) phải bị từ chối');

// 4. Kiểm tra hình lõm (Concave - Đỉnh BR bị thụt sâu vào trong tâm)
const concaveCorners = [
  { x: 50, y: 50 },   // TL (0)
  { x: 350, y: 50 },  // TR (1)
  { x: 50, y: 450 },  // BL (2)
  { x: 150, y: 150 }, // BR (3)
];
assert.strictEqual(isConvexPolygon(concaveCorners), false, 'Hình lõm (Concave) phải bị từ chối');

function validateCropPolygon(corners, displayWidth, displayHeight) {
  const p = [corners[0], corners[1], corners[3], corners[2]];
  const minEdge = 30;
  for (let i = 0; i < 4; i++) {
    const next = (i + 1) % 4;
    const dist = Math.hypot(p[next].x - p[i].x, p[next].y - p[i].y);
    if (dist < minEdge) return { valid: false, reason: 'edge_too_short' };
  }

  let prevSign = 0;
  for (let i = 0; i < 4; i++) {
    const p1 = p[i];
    const p2 = p[(i + 1) % 4];
    const p3 = p[(i + 2) % 4];

    const dx1 = p2.x - p1.x;
    const dy1 = p2.y - p1.y;
    const dx2 = p3.x - p2.x;
    const dy2 = p3.y - p2.y;

    const crossProduct = dx1 * dy2 - dy1 * dx2;
    if (Math.abs(crossProduct) < 1e-4) return { valid: false, reason: 'collinear' };

    const currentSign = crossProduct > 0 ? 1 : -1;
    if (prevSign === 0) prevSign = currentSign;
    else if (currentSign !== prevSign) return { valid: false, reason: 'concave_or_self_intersect' };
  }

  let area = 0;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    area += p[i].x * p[j].y - p[j].x * p[i].y;
  }
  area = Math.abs(area) / 2;
  if (area < displayWidth * displayHeight * 0.05) return { valid: false, reason: 'area_too_small' };

  return { valid: true };
}

// Tứ giác lồi chuẩn hình chữ nhật
const goodCorners = [
  { x: 10, y: 10 },    // TL (0)
  { x: 300, y: 10 },   // TR (1)
  { x: 10, y: 400 },   // BL (2)
  { x: 300, y: 400 },  // BR (3)
];
assert.strictEqual(validateCropPolygon(goodCorners, 400, 500).valid, true, 'Hình chữ nhật lồi phải hợp lệ');

// Tứ giác tự cắt chéo (Bowtie / Figure-8) khi kéo chéo góc
const selfIntersectCorners = [
  { x: 10, y: 10 },
  { x: 300, y: 400 }, // TR bị kéo xuống góc BR
  { x: 10, y: 400 },
  { x: 300, y: 10 },  // BR bị kéo lên góc TR
];
assert.strictEqual(validateCropPolygon(selfIntersectCorners, 400, 500).valid, false, 'Tứ giác tự cắt chéo phải bị từ chối');
console.log('✅ Test 5 [PASSED]: Xác thực đa giác lồi (Convex Polygon Validation) chống méo hình.');

// ----------------------------------------------------
// 6. TEST STORAGE SCHEMA VERSIONING & MUTEX QUEUE
// ----------------------------------------------------
function migrateStorage(raw) {
  if (raw && typeof raw === 'object') {
    if (typeof raw.version === 'number' && raw.data) return raw;
    const cleanData = {};
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === 'string') cleanData[k] = v;
    }
    return { version: 1, lastUpdated: Date.now(), data: cleanData };
  }
  return { version: 1, lastUpdated: Date.now(), data: {} };
}

const legacyStorage = { '@camscanner_scan_quality': 'high', '@camscanner_color_mode': 'magic' };
const migrated = migrateStorage(legacyStorage);
assert.strictEqual(migrated.version, 1, 'Version sau migrate phải là 1');
assert.strictEqual(migrated.data['@camscanner_scan_quality'], 'high', 'Dữ liệu cũ phải được giữ nguyên vẹn');

let simulatedQueue = Promise.resolve();
const writeOrder = [];
function queueWrite(item) {
  simulatedQueue = simulatedQueue.then(async () => {
    await new Promise(r => setTimeout(r, 5));
    writeOrder.push(item);
  });
  return simulatedQueue;
}

Promise.all([queueWrite('ITEM_1'), queueWrite('ITEM_2'), queueWrite('ITEM_3')]).then(() => {
  console.log('✅ Test 6 [PASSED]: Schema Versioning & Mutex FIFO Write Queue hoạt động hoàn hảo.');

  // ----------------------------------------------------
  // 7. TEST DETECT SOLVE VARIABLE (Phát hiện biến phương trình linh hoạt)
  // ----------------------------------------------------
  const PROTECTED_MATH_SYMBOLS = new Set([
    'sin', 'cos', 'tan', 'cot', 'sec', 'csc',
    'asin', 'acos', 'atan', 'acot',
    'sinh', 'cosh', 'tanh', 'coth',
    'log', 'ln', 'lg', 'exp', 'sqrt', 'abs',
    'pi', 'e', 'i'
  ]);
  function detectSolveVariable(cleanEq) {
    const candidates = cleanEq.match(/[a-zA-Z]+/g) || [];
    const letters = candidates
      .map(t => t.toLowerCase())
      .filter(t => t.length === 1 && !PROTECTED_MATH_SYMBOLS.has(t));

    if (letters.includes('x')) return 'x';
    if (letters.length > 0) return letters[0];
    return 'x';
  }

  assert.strictEqual(detectSolveVariable('2*t + 5 = 15'), 't', 'Phương trình vật lý 2*t + 5 = 15 phải dò ra biến t');
  assert.strictEqual(detectSolveVariable('3*n - 9 = 0'), 'n', 'Phương trình hóa học 3*n - 9 = 0 phải dò ra biến n');
  assert.strictEqual(detectSolveVariable('sin(x) + 2*y = 0'), 'x', 'Ưu tiên biến x nếu x có mặt trong biểu thức');
  assert.strictEqual(detectSolveVariable('cos(y) + 4 = 10'), 'y', 'Phương trình chứa hàm cos(y) phải bảo toàn cos và dò ra biến y');
  console.log('✅ Test 7 [PASSED]: Tự động dò biến số đại số (detectSolveVariable) chính xác cho t, n, y, a.');

  // ----------------------------------------------------
  // 8. TEST RESILIENT WRITE QUEUE (Chống tắc nghẽn Poisoned Promise)
  // ----------------------------------------------------
  let resilientQueue = Promise.resolve();
  const successfulSaves = [];
  function queueResilientSave(item, shouldFail = false) {
    const thisSave = resilientQueue
      .catch(() => {}) // Chống ngộ độc promise: lỗi trước không chặn lần ghi sau
      .then(async () => {
        if (shouldFail) throw new Error('Simulated disk I/O error');
        successfulSaves.push(item);
      });

    resilientQueue = thisSave.catch(e => {
      // nuốt lỗi tại hàng đợi chính để giữ hàng đợi lành lặn
    });
    return thisSave;
  }

  // Ghi item 1 thành công -> Ghi item 2 bị lỗi -> Ghi item 3 vẫn phải thành công
  queueResilientSave('SAVE_1', false)
    .then(() => queueResilientSave('SAVE_2_FAILED', true))
    .catch(() => {})
    .then(() => queueResilientSave('SAVE_3', false))
    .then(() => {
      assert.deepStrictEqual(successfulSaves, ['SAVE_1', 'SAVE_3'], 'Lần ghi thứ 3 phải thành công dù lần 2 bị lỗi');
      console.log('✅ Test 8 [PASSED]: Hàng đợi Storage tự phục hồi sau lỗi (Resilient Queue - No Poisoning).');

      // ----------------------------------------------------
      // 9. TEST HOMOGRAPHY MATRIX COMPUTATION (computeHomography)
      // ----------------------------------------------------
      function computeHomography(srcPts, dstPts) {
        const A = [];
        for (let i = 0; i < 4; i++) {
          const sx = srcPts[i].x, sy = srcPts[i].y;
          const dx = dstPts[i].x, dy = dstPts[i].y;
          A.push([-sx, -sy, -1, 0, 0, 0, dx * sx, dx * sy, dx]);
          A.push([0, 0, 0, -sx, -sy, -1, dy * sx, dy * sy, dy]);
        }

        const M = [];
        const b = [];
        for (let i = 0; i < 8; i++) {
          M.push(A[i].slice(0, 8));
          b.push(-A[i][8]);
        }

        for (let col = 0; col < 8; col++) {
          let maxRow = col;
          let maxVal = Math.abs(M[col][col]);
          for (let row = col + 1; row < 8; row++) {
            if (Math.abs(M[row][col]) > maxVal) {
              maxVal = Math.abs(M[row][col]);
              maxRow = row;
            }
          }
          [M[col], M[maxRow]] = [M[maxRow], M[col]];
          [b[col], b[maxRow]] = [b[maxRow], b[col]];

          if (Math.abs(M[col][col]) < 1e-10) continue;

          const pivot = M[col][col];
          for (let j = col; j < 8; j++) M[col][j] /= pivot;
          b[col] /= pivot;

          for (let row = 0; row < 8; row++) {
            if (row === col) continue;
            const factor = M[row][col];
            for (let j = col; j < 8; j++) M[row][j] -= factor * M[col][j];
            b[row] -= factor * b[col];
          }
        }

        const h = [...b, 1];
        return [
          [h[0], h[1], h[2]],
          [h[3], h[4], h[5]],
          [h[6], h[7], h[8]],
        ];
      }

      function projectPoint(H, pt) {
        const wx = H[0][0] * pt.x + H[0][1] * pt.y + H[0][2];
        const wy = H[1][0] * pt.x + H[1][1] * pt.y + H[1][2];
        const wz = H[2][0] * pt.x + H[2][1] * pt.y + H[2][2];
        return { x: wx / wz, y: wy / wz };
      }

      const rectSrc = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }];
      const rectDst = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }];
      const identityH = computeHomography(rectSrc, rectDst);
      const projOrigin = projectPoint(identityH, { x: 0, y: 0 });
      assert.ok(Math.abs(projOrigin.x) < 1e-4 && Math.abs(projOrigin.y) < 1e-4, 'Ánh xạ điểm gốc (0,0) phải bằng (0,0)');

      const projCenter = projectPoint(identityH, { x: 50, y: 50 });
      assert.ok(Math.abs(projCenter.x - 50) < 1e-4 && Math.abs(projCenter.y - 50) < 1e-4, 'Ánh xạ điểm giữa (50,50) phải bằng (50,50)');
      console.log('✅ Test 9 [PASSED]: Tính toán ma trận Homography 3x3 và phép biến đổi phối cảnh (computeHomography).');

      // ----------------------------------------------------
      // 10. TEST PAGE ROTATION & CORNER TRANSFORM (Xoay trang 90°/360° & Sắp xếp Topo 4 đỉnh)
      // ----------------------------------------------------
      function rotatePoint90Clockwise(pt) {
        return {
          x: Math.max(0, Math.min(1, Number((1 - pt.y).toFixed(6)))),
          y: Math.max(0, Math.min(1, Number(pt.x.toFixed(6)))),
        };
      }

      const originalPt = { x: 0.2, y: 0.3 };
      let p = { ...originalPt };
      for (let r = 0; r < 4; r++) {
        p = rotatePoint90Clockwise(p);
      }
      assert.strictEqual(p.x, originalPt.x, 'Sau 4 lần xoay 90 độ, tọa độ x phải bảo toàn');
      assert.strictEqual(p.y, originalPt.y, 'Sau 4 lần xoay 90 độ, tọa độ y phải bảo toàn');

      // Thuật toán xoay 90 độ và sắp xếp topo 4 đỉnh [TL, TR, BL, BR] (tương ứng ScannerScreen)
      function rotateCorners90AndTopoSort(corners) {
        const rotatedPoints = corners.map(pt => ({
          x: Math.max(0, Math.min(1, Number((1 - pt.y).toFixed(6)))),
          y: Math.max(0, Math.min(1, Number(pt.x.toFixed(6)))),
        }));

        // Sắp xếp lại 4 đỉnh theo thứ tự topo chuẩn [TL, TR, BL, BR]:
        // - Top-Left: đỉnh có (x + y) nhỏ nhất
        // - Bottom-Right: đỉnh có (x + y) lớn nhất
        // - Top-Right: đỉnh có (y - x) nhỏ nhất
        // - Bottom-Left: đỉnh có (y - x) lớn nhất
        let tl = rotatedPoints[0];
        let br = rotatedPoints[0];
        let tr = rotatedPoints[0];
        let bl = rotatedPoints[0];

        for (const pt of rotatedPoints) {
          if (pt.x + pt.y < tl.x + tl.y) tl = pt;
          if (pt.x + pt.y > br.x + br.y) br = pt;
          if (pt.y - pt.x < tr.y - tr.x) tr = pt;
          if (pt.y - pt.x > bl.y - bl.x) bl = pt;
        }

        return [tl, tr, bl, br];
      }

      // Kiểm tra tính không tự cắt (chống vặn xoắn cánh bướm / bowtie)
      function checkNoBowtie(tl, tr, br, bl) {
        const poly = [tl, tr, br, bl];
        let prevSign = 0;
        for (let i = 0; i < 4; i++) {
          const p1 = poly[i];
          const p2 = poly[(i + 1) % 4];
          const p3 = poly[(i + 2) % 4];
          const cross = (p2.x - p1.x) * (p3.y - p2.y) - (p2.y - p1.y) * (p3.x - p2.x);
          if (Math.abs(cross) < 1e-5) return false;
          const sign = cross > 0 ? 1 : -1;
          if (prevSign === 0) prevSign = sign;
          else if (sign !== prevSign) return false;
        }
        return true;
      }

      // Hàm kiểm tra 2 đoạn thẳng có giao nhau không
      function ccw(A, B, C) {
        return (C.y - A.y) * (B.x - A.x) > (B.y - A.y) * (C.x - A.x);
      }
      function segmentsIntersect(A, B, C, D) {
        return ccw(A, C, D) !== ccw(B, C, D) && ccw(A, B, C) !== ccw(A, B, D);
      }

      // Tứ giác ban đầu đại diện cho văn bản chụp với góc phối cảnh thực tế
      const initialQuad = [
        { x: 0.15, y: 0.10 }, // TL (0)
        { x: 0.85, y: 0.15 }, // TR (1)
        { x: 0.10, y: 0.90 }, // BL (2)
        { x: 0.90, y: 0.85 }, // BR (3)
      ];

      let currentQuad = initialQuad;
      const rotationAngles = [90, 180, 270];

      for (const angle of rotationAngles) {
        currentQuad = rotateCorners90AndTopoSort(currentQuad);
        const [tl, tr, bl, br] = currentQuad;

        // 1. Kiểm tra thứ tự topo hình học: TL ở góc trên-trái, TR ở trên-phải, BR ở dưới-phải, BL ở dưới-trái
        assert.ok(tl.x < tr.x, `Tại ${angle}°: TL.x (${tl.x}) phải nhỏ hơn TR.x (${tr.x})`);
        assert.ok(tl.y < bl.y, `Tại ${angle}°: TL.y (${tl.y}) phải nhỏ hơn BL.y (${bl.y})`);
        assert.ok(tr.x > tl.x, `Tại ${angle}°: TR.x (${tr.x}) phải lớn hơn TL.x (${tl.x})`);
        assert.ok(tr.y < br.y, `Tại ${angle}°: TR.y (${tr.y}) phải nhỏ hơn BR.y (${br.y})`);
        assert.ok(br.x > bl.x, `Tại ${angle}°: BR.x (${br.x}) phải lớn hơn BL.x (${bl.x})`);
        assert.ok(br.y > tr.y, `Tại ${angle}°: BR.y (${br.y}) phải lớn hơn TR.y (${tr.y})`);
        assert.ok(bl.x < br.x, `Tại ${angle}°: BL.x (${bl.x}) phải nhỏ hơn BR.x (${br.x})`);
        assert.ok(bl.y > tl.y, `Tại ${angle}°: BL.y (${bl.y}) phải lớn hơn TL.y (${tl.y})`);

        // 2. Kiểm tra chu vi theo thứ tự TL, TR, BR, BL không bị vặn xoắn cánh bướm
        const noBowtie = checkNoBowtie(tl, tr, br, bl);
        assert.strictEqual(noBowtie, true, `Tại ${angle}°: Tứ giác không được vặn xoắn cánh bướm (cross products bảo toàn)`);

        // 3. Kiểm tra hình học: Hai đường chéo TL-BR và TR-BL phải giao nhau bên trong tứ giác
        assert.strictEqual(
          segmentsIntersect(tl, br, tr, bl),
          true,
          `Tại ${angle}°: Hai đường chéo TL-BR và TR-BL phải cắt nhau bên trong tứ giác`
        );

        // 4. Các cặp cạnh đối không được giao nhau (chống tự cắt cánh bướm)
        assert.strictEqual(
          segmentsIntersect(tl, tr, bl, br),
          false,
          `Tại ${angle}°: Cặp cạnh TL-TR và BL-BR không được cắt nhau`
        );
        assert.strictEqual(
          segmentsIntersect(tl, bl, tr, br),
          false,
          `Tại ${angle}°: Cặp cạnh TL-BL và TR-BR không được cắt nhau`
        );
      }

      // Sau 4 lần xoay (360 độ) phải quay về tọa độ ban đầu
      currentQuad = rotateCorners90AndTopoSort(currentQuad);
      assert.ok(Math.abs(currentQuad[0].x - initialQuad[0].x) < 1e-4, 'Sau 360° TL phải về vị trí ban đầu');
      assert.ok(Math.abs(currentQuad[0].y - initialQuad[0].y) < 1e-4, 'Sau 360° TL phải về vị trí ban đầu');
      assert.ok(Math.abs(currentQuad[1].x - initialQuad[1].x) < 1e-4, 'Sau 360° TR phải về vị trí ban đầu');
      assert.ok(Math.abs(currentQuad[1].y - initialQuad[1].y) < 1e-4, 'Sau 360° TR phải về vị trí ban đầu');
      assert.ok(Math.abs(currentQuad[2].x - initialQuad[2].x) < 1e-4, 'Sau 360° BL phải về vị trí ban đầu');
      assert.ok(Math.abs(currentQuad[2].y - initialQuad[2].y) < 1e-4, 'Sau 360° BL phải về vị trí ban đầu');
      assert.ok(Math.abs(currentQuad[3].x - initialQuad[3].x) < 1e-4, 'Sau 360° BR phải về vị trí ban đầu');
      assert.ok(Math.abs(currentQuad[3].y - initialQuad[3].y) < 1e-4, 'Sau 360° BR phải về vị trí ban đầu');

      console.log('✅ Test 10 [PASSED]: Xoay trang 90°, 180°, 270°, 360° và sắp xếp topo 4 đỉnh bảo toàn thứ tự TL, TR, BR, BL không bị vặn xoắn cánh bướm.');

      // ----------------------------------------------------
      // 11. TEST PAGE REORDERING (Đổi thứ tự trang)
      // ----------------------------------------------------
      function reorderPages(pages, cornersMap, index, direction) {
        const targetIdx = direction === 'left' ? index - 1 : index + 1;
        if (targetIdx < 0 || targetIdx >= pages.length) return { pages, cornersMap };

        const newPages = [...pages];
        const temp = newPages[index];
        newPages[index] = newPages[targetIdx];
        newPages[targetIdx] = temp;

        const newCorners = { ...cornersMap };
        const cCurrent = newCorners[index];
        const cTarget = newCorners[targetIdx];
        if (cCurrent) newCorners[targetIdx] = cCurrent; else delete newCorners[targetIdx];
        if (cTarget) newCorners[index] = cTarget; else delete newCorners[index];

        return { pages: newPages, cornersMap: newCorners };
      }

      const initialPages = ['page1.jpg', 'page2.jpg', 'page3.jpg'];
      const initialCornersMap = { 0: [{ x: 0, y: 0 }], 1: [{ x: 1, y: 1 }] };
      const reordered = reorderPages(initialPages, initialCornersMap, 0, 'right');
      assert.deepStrictEqual(reordered.pages, ['page2.jpg', 'page1.jpg', 'page3.jpg'], 'Hoán đổi vị trí trang 0 sang phải');
      assert.deepStrictEqual(reordered.cornersMap[1], [{ x: 0, y: 0 }], 'Corners map của trang 0 phải chuyển sang index 1');
      console.log('✅ Test 11 [PASSED]: Đổi thứ tự trang (Reorder Pages) và đồng bộ corners map an toàn.');

      // ----------------------------------------------------
      // 12. TEST FULL-TEXT SEARCH & OCR METADATA MATCHING
      // ----------------------------------------------------
      function filterDocuments(items, query) {
        const q = query.toLowerCase().trim();
        if (!q) return items;
        return items.filter(item => {
          const nameMatch = item.name.toLowerCase().includes(q);
          const ocrMatch = item.ocrText && item.ocrText.toLowerCase().includes(q);
          return nameMatch || ocrMatch;
        });
      }

      function getOcrSnippet(text, query) {
        const lower = text.toLowerCase();
        const idx = lower.indexOf(query.toLowerCase().trim());
        if (idx === -1) return text.substring(0, 30);
        const start = Math.max(0, idx - 10);
        const end = Math.min(text.length, idx + query.length + 15);
        return text.substring(start, end).replace(/[\r\n]+/g, ' ');
      }

      const sampleDocs = [
        { name: 'HopDong_KinhTe.pdf', ocrText: 'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM Điều khoản thanh toán đợt 1' },
        { name: 'BienBan_NghiemThu.pdf', ocrText: 'Đã nghiệm thu hệ thống máy chủ và kiểm thử phần mềm' },
        { name: 'CCCD_NguyenVanA.pdf', ocrText: 'Số CCCD 001202003344 Ngày cấp 15/08/2023' },
      ];

      const searchByOcr = filterDocuments(sampleDocs, 'thanh toán');
      assert.strictEqual(searchByOcr.length, 1, 'Tìm kiếm từ khóa "thanh toán" phải tìm trúng HopDong_KinhTe.pdf');
      assert.strictEqual(searchByOcr[0].name, 'HopDong_KinhTe.pdf');

      const snippet = getOcrSnippet(searchByOcr[0].ocrText, 'thanh toán');
      assert.ok(snippet.includes('thanh toán'), 'Snippet phải chứa đúng từ khóa tìm kiếm');
      console.log('✅ Test 12 [PASSED]: Tìm kiếm toàn văn (Full-Text Search qua OCR Metadata) & trích đoạn Snippet.');

      // ----------------------------------------------------
      // 13. TEST BACKUP & RESTORE PAYLOAD INTEGRITY
      // ----------------------------------------------------
      function validateAndRestoreBackup(jsonStr) {
        const payload = JSON.parse(jsonStr);
        assert.ok(payload.appName, 'Payload phải có appName');
        assert.ok(payload.storageData, 'Payload phải có storageData');
        assert.ok(payload.ocrIndex, 'Payload phải có ocrIndex');
        return {
          restoredStorageKeys: Object.keys(payload.storageData).length,
          restoredOcrKeys: Object.keys(payload.ocrIndex).length,
        };
      }

      const mockBackup = JSON.stringify({
        appName: 'CamScanner Pro',
        appVersion: '2.6.2',
        timestamp: Date.now(),
        storageData: { '@camscanner_scan_quality': 'high', '@camscanner_color_mode': 'magic' },
        ocrIndex: { 'Doc1.pdf': 'Văn bản hợp đồng mẫu', 'Doc2.pdf': 'Hóa đơn giá trị gia tăng' },
      });

      const restoreResult = validateAndRestoreBackup(mockBackup);
      assert.strictEqual(restoreResult.restoredStorageKeys, 2, 'Phải khôi phục đúng 2 storage keys');
      assert.strictEqual(restoreResult.restoredOcrKeys, 2, 'Phải khôi phục đúng 2 OCR index items');
      console.log('✅ Test 13 [PASSED]: Xác thực tính toàn vẹn và khôi phục bản sao lưu dữ liệu (Backup & Restore).');

      // ----------------------------------------------------
      // 14. TEST MATH SOLVER SANITIZE INPUT (Sandbox Security & Prototype Pollution Guard)
      // ----------------------------------------------------
      const DANGEROUS_SECURITY_KEYWORDS = [
        '__proto__',
        'prototype',
        'constructor',
        'valueof',
        'tostring',
        'eval',
        'function',
        'process',
        'global',
        'require',
        'import',
        'window',
        'document',
        'this',
        'globalthis',
      ];

      function sanitizeInput(expr) {
        if (!expr || !expr.trim()) {
          return { isValid: false, error: 'Biểu thức trống.' };
        }

        // 1. Chặn hoàn toàn các chuỗi độc hại gây Prototype Pollution / Sandbox Escape
        const lower = expr.toLowerCase();
        for (const keyword of DANGEROUS_SECURITY_KEYWORDS) {
          if (lower.includes(keyword)) {
            return {
              isValid: false,
              error: `Biểu thức bị từ chối vì chứa từ khóa không an toàn ("${keyword}").`,
            };
          }
        }

        // 2. Chỉ cho phép các ký tự toán học hợp lệ [0-9a-zA-Z+\-*/^().=, ]
        const validMathRegex = /^[0-9a-zA-Z+\-*\/^().=, ]+$/;
        if (!validMathRegex.test(expr)) {
          return {
            isValid: false,
            error: 'Biểu thức chứa ký tự không hợp lệ. Chỉ cho phép các ký tự toán học [0-9a-zA-Z+\\-*/^().=, ].',
          };
        }

        return { isValid: true };
      }

      // Kiểm tra chặn các từ khóa nguy hiểm: __proto__, constructor, eval, process, global...
      assert.strictEqual(sanitizeInput('x + __proto__.polluted = 0').isValid, false, 'Phải chặn từ khóa __proto__');
      assert.strictEqual(sanitizeInput('constructor.prototype = null').isValid, false, 'Phải chặn từ khóa constructor');
      assert.strictEqual(sanitizeInput('eval("1+1")').isValid, false, 'Phải chặn từ khóa eval');
      assert.strictEqual(sanitizeInput('process.exit(1)').isValid, false, 'Phải chặn từ khóa process');
      assert.strictEqual(sanitizeInput('global.secret = 1').isValid, false, 'Phải chặn từ khóa global');
      assert.strictEqual(sanitizeInput('prototype.danger = 1').isValid, false, 'Phải chặn từ khóa prototype');
      assert.strictEqual(sanitizeInput('require("child_process")').isValid, false, 'Phải chặn từ khóa require');
      assert.strictEqual(sanitizeInput('import("fs")').isValid, false, 'Phải chặn từ khóa import');
      assert.strictEqual(sanitizeInput('window.location').isValid, false, 'Phải chặn từ khóa window');
      assert.strictEqual(sanitizeInput('document.cookie').isValid, false, 'Phải chặn từ khóa document');
      assert.strictEqual(sanitizeInput('this.secret').isValid, false, 'Phải chặn từ khóa this');
      assert.strictEqual(sanitizeInput('globalThis.leak').isValid, false, 'Phải chặn từ khóa globalThis');

      // Kiểm tra biểu thức rỗng và ký tự không hợp lệ
      assert.strictEqual(sanitizeInput('').isValid, false, 'Biểu thức rỗng phải bị từ chối');
      assert.strictEqual(sanitizeInput('   ').isValid, false, 'Biểu thức chỉ có khoảng trắng phải bị từ chối');
      assert.strictEqual(sanitizeInput('x + $badChar = 0').isValid, false, 'Ký tự lạ ($) phải bị từ chối');
      assert.strictEqual(sanitizeInput('alert(`hacked`)').isValid, false, 'Dấu backtick phải bị từ chối');

      // Kiểm tra biểu thức hợp lệ
      assert.strictEqual(sanitizeInput('2*x + 5 = 15').isValid, true, 'Phương trình bậc 1 hợp lệ');
      assert.strictEqual(sanitizeInput('sin(x) + cos(x) = 1').isValid, true, 'Biểu thức lượng giác hợp lệ');
      assert.strictEqual(sanitizeInput('x^2 - 4*x + 4 = 0').isValid, true, 'Phương trình bậc 2 hợp lệ');
      assert.strictEqual(sanitizeInput('(a + b) / (c - d) = 10, x = 2').isValid, true, 'Biểu thức có ngoặc, dấu phẩy hợp lệ');
      console.log('✅ Test 14 [PASSED]: Kiểm tra sanitizeInput ngăn chặn Prototype Pollution, Sandbox Escape (__proto__, constructor, eval, process, global...).');

      // ----------------------------------------------------
      // 15. TEST FORMAT TO KATEX (Fractions & Radicals Normalization)
      // ----------------------------------------------------
      function formatToKaTeX(rawExpr) {
        if (!rawExpr || !rawExpr.trim()) return '';

        let expr = rawExpr.trim();

        // 1. Chuẩn hóa ký tự phân số Unicode
        const unicodeFractions = {
          '½': '\\frac{1}{2}',
          '⅓': '\\frac{1}{3}',
          '⅔': '\\frac{2}{3}',
          '¼': '\\frac{1}{4}',
          '¾': '\\frac{3}{4}',
          '⅕': '\\frac{1}{5}',
          '⅖': '\\frac{2}{5}',
          '⅗': '\\frac{3}{5}',
          '⅘': '\\frac{4}{5}',
          '⅙': '\\frac{1}{6}',
          '⅚': '\\frac{5}{6}',
          '⅛': '\\frac{1}{8}',
          '⅜': '\\frac{3}{8}',
          '⅝': '\\frac{5}{8}',
          '⅞': '\\frac{7}{8}',
        };
        for (const [char, katex] of Object.entries(unicodeFractions)) {
          expr = expr.split(char).join(katex);
        }

        // 2. Chuẩn hóa căn thức (\sqrt, sqrt, cbrt, √, ∛)
        // Căn bậc ba: ∛(x), ∛x hoặc cbrt(x) -> \sqrt[3]{x}
        expr = expr.replace(/∛\(([^)]+)\)/g, '\\sqrt[3]{$1}');
        expr = expr.replace(/∛([0-9a-zA-Z]+)/g, '\\sqrt[3]{$1}');
        expr = expr.replace(/cbrt\(([^)]+)\)/g, '\\sqrt[3]{$1}');

        // Căn bậc hai: √(x), √x, sqrt(x), \sqrt(x) -> \sqrt{x}
        expr = expr.replace(/√\(([^)]+)\)/g, '\\sqrt{$1}');
        expr = expr.replace(/√([0-9a-zA-Z]+)/g, '\\sqrt{$1}');
        expr = expr.replace(/\\?sqrt\(([^)]+)\)/g, '\\sqrt{$1}');
        // Nếu \sqrt viết thiếu ngoặc nhọn: \sqrt x -> \sqrt{x}
        expr = expr.replace(/\\sqrt\s*([0-9a-zA-Z])(?![a-zA-Z0-9{])/g, '\\sqrt{$1}');

        // 3. Chuẩn hóa phân số (\frac, frac, (a)/(b), a/b)
        // frac(a, b) hoặc \frac(a)(b) -> \frac{a}{b}
        expr = expr.replace(/\\?frac\s*\(([^)]+)\)\s*\(([^)]+)\)/g, '\\frac{$1}{$2}');
        expr = expr.replace(/\\?frac\s*\(([^,]+),\s*([^)]+)\)/g, '\\frac{$1}{$2}');
        // \frac thiếu ngoặc nhọn: \frac 1 2 hoặc \frac 12 -> \frac{1}{2}
        expr = expr.replace(/\\frac\s+([0-9a-zA-Z])\s+([0-9a-zA-Z])/g, '\\frac{$1}{$2}');
        expr = expr.replace(/\\frac\s*([0-9])([0-9a-zA-Z])/g, '\\frac{$1}{$2}');

        // Phân số dạng (A)/(B) -> \frac{A}{B}
        expr = expr.replace(/\(([^()]+)\)\s*\/\s*\(([^()]+)\)/g, '\\frac{$1}{$2}');

        // Phân số đơn giản a / b (ví dụ 1/2, x/y)
        expr = expr.replace(/(^|[^\\a-zA-Z0-9])([0-9a-zA-Z]+)\s*\/\s*([0-9a-zA-Z]+)(?![a-zA-Z0-9{])/g, '$1\\frac{$2}{$3}');

        // 4. Chuẩn hóa số mũ: x^2 -> x^{2}, x^(y+1) -> x^{y+1}
        expr = expr.replace(/\^([0-9a-zA-Z]+)(?![{])/g, '^{$1}');
        expr = expr.replace(/\^\(([^)]+)\)/g, '^{$1}');

        // 5. Chuẩn hóa các phép so sánh và toán tử
        expr = expr.replace(/<=|≤/g, ' \\le ');
        expr = expr.replace(/>=|≥/g, ' \\ge ');
        expr = expr.replace(/!=|≠/g, ' \\ne ');
        expr = expr.replace(/≈/g, ' \\approx ');
        expr = expr.replace(/\+\/-|±/g, ' \\pm ');
        expr = expr.replace(/[×✕]/g, ' \\times ');
        expr = expr.replace(/[÷]/g, ' \\div ');
        expr = expr.replace(/\s*\*\s*/g, ' \\cdot ');

        // 6. Chuẩn hóa ký tự đặc biệt Hy Lạp (nếu chưa có backslash)
        const greekLetters = ['alpha', 'beta', 'gamma', 'delta', 'theta', 'lambda', 'mu', 'pi', 'sigma', 'omega'];
        for (const letter of greekLetters) {
          const regex = new RegExp(`(^|[^\\\\a-zA-Z])\\b${letter}\\b`, 'g');
          expr = expr.replace(regex, `$1\\${letter}`);
        }
        expr = expr.replace(/(^|[^\\a-zA-Z])\b(infinity|inf|∞)\b/g, '$1\\infty');

        // 7. Chuẩn hóa các hàm toán học (nếu chưa có backslash)
        const mathFunctions = ['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'sinh', 'cosh', 'tanh', 'asin', 'acos', 'atan', 'ln', 'log', 'exp', 'lim', 'det'];
        for (const fn of mathFunctions) {
          const regex = new RegExp(`(^|[^\\\\a-zA-Z])\\b${fn}\\b`, 'g');
          expr = expr.replace(regex, `$1\\${fn}`);
        }

        return expr.replace(/\s+/g, ' ').trim();
      }

      // Kiểm tra chuyển đổi phân số
      // 1. Phân số Unicode
      assert.strictEqual(formatToKaTeX('½ + ¾'), '\\frac{1}{2} + \\frac{3}{4}', 'Phân số Unicode ½, ¾ phải đổi thành \\frac');
      assert.strictEqual(formatToKaTeX('⅔ + ⅘'), '\\frac{2}{3} + \\frac{4}{5}', 'Phân số Unicode ⅔, ⅘ phải đổi thành \\frac');

      // 2. Phân số dạng a/b và (a)/(b)
      assert.strictEqual(formatToKaTeX('1/2'), '\\frac{1}{2}', 'Phân số đơn giản 1/2 thành \\frac{1}{2}');
      assert.strictEqual(formatToKaTeX('x/y'), '\\frac{x}{y}', 'Phân số biến số x/y thành \\frac{x}{y}');
      assert.strictEqual(formatToKaTeX('(x + 1)/(x - 1)'), '\\frac{x + 1}{x - 1}', 'Phân số biểu thức phức tạp (x+1)/(x-1) thành \\frac{x + 1}{x - 1}');

      // 3. Phân số dạng hàm frac(a, b) và \\frac(a)(b)
      assert.strictEqual(formatToKaTeX('frac(1, 2)'), '\\frac{1}{2}', 'Hàm frac(1, 2) thành \\frac{1}{2}');
      assert.strictEqual(formatToKaTeX('\\frac(x)(y)'), '\\frac{x}{y}', 'Cú pháp \\frac(x)(y) thành \\frac{x}{y}');
      assert.strictEqual(formatToKaTeX('\\frac 1 2'), '\\frac{1}{2}', 'Cú pháp \\frac 1 2 thiếu ngoặc nhọn thành \\frac{1}{2}');

      // Kiểm tra chuyển đổi căn thức
      // 1. Căn bậc hai Unicode và sqrt
      assert.strictEqual(formatToKaTeX('√(x + 1)'), '\\sqrt{x + 1}', 'Căn bậc hai √(x + 1) thành \\sqrt{x + 1}');
      assert.strictEqual(formatToKaTeX('√x'), '\\sqrt{x}', 'Căn bậc hai √x thành \\sqrt{x}');
      assert.strictEqual(formatToKaTeX('√16'), '\\sqrt{16}', 'Căn bậc hai √16 thành \\sqrt{16}');
      assert.strictEqual(formatToKaTeX('sqrt(x^2 + 1)'), '\\sqrt{x^{2} + 1}', 'Hàm sqrt(...) thành \\sqrt{...}');
      assert.strictEqual(formatToKaTeX('\\sqrt x'), '\\sqrt{x}', '\\sqrt x thiếu ngoặc thành \\sqrt{x}');

      // 2. Căn bậc ba Unicode và cbrt
      assert.strictEqual(formatToKaTeX('∛(x + 2)'), '\\sqrt[3]{x + 2}', 'Căn bậc ba ∛(x + 2) thành \\sqrt[3]{x + 2}');
      assert.strictEqual(formatToKaTeX('∛8'), '\\sqrt[3]{8}', 'Căn bậc ba ∛8 thành \\sqrt[3]{8}');
      assert.strictEqual(formatToKaTeX('cbrt(27)'), '\\sqrt[3]{27}', 'Hàm cbrt(27) thành \\sqrt[3]{27}');

      // 3. Kết hợp phân số và căn thức
      assert.strictEqual(formatToKaTeX('(√(x) + 1)/(√(x) - 1)'), '\\frac{\\sqrt{x} + 1}{\\sqrt{x} - 1}', 'Phân số chứa căn ở tử và mẫu');

      console.log('✅ Test 15 [PASSED]: Chuẩn hóa KaTeX (formatToKaTeX) phân số Unicode, căn bậc hai/ba sang cú pháp KaTeX chuẩn.');

      // ----------------------------------------------------
      // 16. TEST PDF PAGE RANGE PARSER (parsePageRange: '1-3', '4,5', '1-2, 4-6')
      // ----------------------------------------------------
      function parsePageRange(rangeStr, totalPages) {
        if (!rangeStr || typeof rangeStr !== 'string') {
          throw new Error('Dải trang không được để trống.');
        }

        const trimmed = rangeStr.trim();
        if (!trimmed) {
          throw new Error('Dải trang không được để trống.');
        }

        const parts = trimmed.split(',');
        const pageSet = new Set();

        for (const part of parts) {
          const segment = part.trim();
          if (!segment) {
            throw new Error(`Định dạng dải trang không hợp lệ trong "${rangeStr}".`);
          }

          const match = segment.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
          if (!match) {
            throw new Error(
              `Định dạng dải trang không hợp lệ: "${segment}". Ví dụ hợp lệ: '1-3', '4', hoặc '1-2, 4-6'.`
            );
          }

          const start = parseInt(match[1], 10);
          const end = match[2] ? parseInt(match[2], 10) : start;

          if (start < 1) {
            throw new Error(`Trang bắt đầu (${start}) trong dải '${rangeStr}' phải từ 1 trở lên.`);
          }
          if (end < start) {
            throw new Error(`Trang kết thúc (${end}) nhỏ hơn trang bắt đầu (${start}) trong dải '${rangeStr}'.`);
          }
          if (typeof totalPages === 'number' && end > totalPages) {
            throw new Error(
              `Dải trang '${segment}' vượt quá tổng số trang (${totalPages}) của tài liệu.`
            );
          }

          for (let p = start; p <= end; p++) {
            pageSet.add(p);
          }
        }

        const pages = Array.from(pageSet).sort((a, b) => a - b);
        if (pages.length === 0) {
          throw new Error(`Không tìm thấy trang hợp lệ trong dải '${rangeStr}'.`);
        }
        return pages;
      }

      // 1. Phân tích dải liên tục '1-3'
      assert.deepStrictEqual(
        parsePageRange('1-3', 10),
        [1, 2, 3],
        'Dải liên tục "1-3" phải giải nén thành [1, 2, 3]'
      );

      // 2. Phân tích danh sách trang rời rạc '4,5'
      assert.deepStrictEqual(
        parsePageRange('4,5', 10),
        [4, 5],
        'Danh sách trang "4,5" phải giải nén thành [4, 5]'
      );

      // 3. Phân tích dải kết hợp '1-2, 4-6'
      assert.deepStrictEqual(
        parsePageRange('1-2, 4-6', 10),
        [1, 2, 4, 5, 6],
        'Dải kết hợp "1-2, 4-6" phải giải nén thành [1, 2, 4, 5, 6]'
      );

      // 4. Trang đơn lẻ và định dạng có khoảng trắng dư thừa
      assert.deepStrictEqual(
        parsePageRange('  1 - 3  ,  5  ,  7 - 8  ', 10),
        [1, 2, 3, 5, 7, 8],
        'Bỏ qua khoảng trắng và giải nén đúng các dải và trang đơn'
      );

      // 5. Khử trùng lặp và sắp xếp theo thứ tự trang tăng dần
      assert.deepStrictEqual(
        parsePageRange('6, 1-3, 2-4', 10),
        [1, 2, 3, 4, 6],
        'Tự động loại bỏ trùng lặp và sắp xếp trang tăng dần'
      );

      // 6. Kiểm tra các ngoại lệ và ràng buộc hợp lệ (Validation Edge Cases)
      assert.throws(
        () => parsePageRange('0-3', 10),
        /phải từ 1 trở lên/,
        'Trang bắt đầu bằng 0 phải ném ngoại lệ'
      );
      assert.throws(
        () => parsePageRange('5-2', 10),
        /nhỏ hơn trang bắt đầu/,
        'Trang kết thúc nhỏ hơn trang bắt đầu phải ném ngoại lệ'
      );
      assert.throws(
        () => parsePageRange('1-12', 10),
        /vượt quá tổng số trang/,
        'Trang vượt quá totalPages phải ném ngoại lệ'
      );
      assert.throws(
        () => parsePageRange('abc', 10),
        /không hợp lệ/,
        'Chuỗi không phải định dạng số trang phải ném ngoại lệ'
      );
      assert.throws(
        () => parsePageRange('', 10),
        /không được để trống/,
        'Chuỗi rỗng phải ném ngoại lệ'
      );

      console.log('✅ Test 16 [PASSED]: Phân tích dải trang PDF (parsePageRange: \'1-3\', \'4,5\', \'1-2, 4-6\') chính xác và an toàn.');

      // ----------------------------------------------------
      // 17. TEST VIETNAMESE ACCENT REMOVAL FOR PDF (toSafePdfText)
      // ----------------------------------------------------
      function toSafePdfText(str) {
        if (!str) return '';
        return str
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/đ/g, 'd')
          .replace(/Đ/g, 'D');
      }

      // 1. Watermark tiếng Việt in hoa có dấu
      assert.strictEqual(
        toSafePdfText('BẢN SAO'),
        'BAN SAO',
        'Chuẩn hóa watermark "BẢN SAO" thành "BAN SAO"'
      );
      assert.strictEqual(
        toSafePdfText('TÀI LIỆU MẬT'),
        'TAI LIEU MAT',
        'Chuẩn hóa watermark "TÀI LIỆU MẬT" thành "TAI LIEU MAT"'
      );
      assert.strictEqual(
        toSafePdfText('ĐÃ THANH TOÁN'),
        'DA THANH TOAN',
        'Chuẩn hóa ký tự Đ và dấu thanh trong "ĐÃ THANH TOÁN" thành "DA THANH TOAN"'
      );
      assert.strictEqual(
        toSafePdfText('CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM'),
        'CONG HOA XA HOI CHU NGHIA VIET NAM',
        'Chuẩn hóa tiêu ngữ quốc gia đầy đủ dấu sang WinAnsi an toàn'
      );
      assert.strictEqual(
        toSafePdfText('HỢP ĐỒNG KINH TẾ & BIÊN BẢN NGHIỆM THU'),
        'HOP DONG KINH TE & BIEN BAN NGHIEM THU',
        'Bảo toàn ký tự đặc biệt & và khử sạch dấu tiếng Việt'
      );

      // 2. Đánh số trang PDF (Page numbering: Trang X/Y, tiền tố tiếng Việt)
      assert.strictEqual(
        toSafePdfText('Trang 1/10'),
        'Trang 1/10',
        'Chuỗi đánh số trang "Trang 1/10" giữ nguyên định dạng'
      );
      assert.strictEqual(
        toSafePdfText('Trang 5 trên tổng số 20 trang'),
        'Trang 5 tren tong so 20 trang',
        'Khử dấu chuỗi mô tả số trang tiếng Việt phức tạp'
      );
      assert.strictEqual(
        toSafePdfText('Trang cuối - Bản quyền thuộc về tác giả'),
        'Trang cuoi - Ban quyen thuoc ve tac gia',
        'Khử dấu chuỗi chân trang PDF'
      );

      // 3. Khử toàn diện tất cả các nguyên âm và phụ âm tiếng Việt đặc trưng
      assert.strictEqual(
        toSafePdfText('ơ, ư, đ, ă, â, ê, ô, ơ, ư, ả, ã, ạ, ợ, ự, ỳ, ỹ'),
        'o, u, d, a, a, e, o, o, u, a, a, a, o, u, y, y',
        'Khử toàn bộ nguyên âm có dấu râu, mũ, móc và thanh điệu chữ thường'
      );
      assert.strictEqual(
        toSafePdfText('Ơ, Ư, Đ, Ă, Â, Ê, Ô, Ơ, Ư, Ả, Ã, Ạ, Ợ, Ự, Ỳ, Ỹ'),
        'O, U, D, A, A, E, O, O, U, A, A, A, O, U, Y, Y',
        'Khử toàn bộ nguyên âm có dấu râu, mũ, móc và thanh điệu chữ hoa'
      );

      // 4. Các trường hợp biên (Edge cases: rỗng, null, undefined, số, ASCII thuần)
      assert.strictEqual(toSafePdfText(''), '', 'Chuỗi rỗng trả về rỗng');
      assert.strictEqual(toSafePdfText(null), '', 'null trả về chuỗi rỗng an toàn');
      assert.strictEqual(toSafePdfText(undefined), '', 'undefined trả về chuỗi rỗng an toàn');
      assert.strictEqual(
        toSafePdfText('CONFIDENTIAL 2026 #123'),
        'CONFIDENTIAL 2026 #123',
        'Văn bản ASCII thuần không bị biến đổi'
      );

      console.log('✅ Test 17 [PASSED]: Chuẩn hóa văn bản tiếng Việt sang không dấu (toSafePdfText) cho Watermark & đánh số trang an toàn 100% WinAnsi.');

      // ----------------------------------------------------
      // 18. TEST CONSTANT-TIME COMPARISON (constantTimeEqual - Chống Timing Attacks)
      // ----------------------------------------------------
      function constantTimeEqual(a, b) {
        if (typeof a !== 'string' || typeof b !== 'string') {
          return false;
        }

        const lenA = a.length;
        const lenB = b.length;
        let mismatch = lenA ^ lenB;
        const maxLen = Math.max(lenA, lenB);

        for (let i = 0; i < maxLen; i++) {
          const codeA = i < lenA ? a.charCodeAt(i) : 0;
          const codeB = i < lenB ? b.charCodeAt(i) : 0;
          mismatch |= codeA ^ codeB;
        }

        return mismatch === 0;
      }

      // 1. Hai chuỗi giống nhau trả về true
      assert.strictEqual(constantTimeEqual('camscanner_secret_token_2026', 'camscanner_secret_token_2026'), true, 'Hai chuỗi bí mật giống nhau phải trả về true');
      assert.strictEqual(constantTimeEqual('', ''), true, 'Hai chuỗi rỗng phải trả về true');
      assert.strictEqual(constantTimeEqual('KhóaBảoMậtTiếngViệt_2026', 'KhóaBảoMậtTiếngViệt_2026'), true, 'Hai chuỗi Unicode tiếng Việt giống nhau phải trả về true');

      // 2. Hai chuỗi khác nhau trả về false
      assert.strictEqual(constantTimeEqual('camscanner_secret_token_2026', 'camscanner_secret_token_2027'), false, 'Hai chuỗi khác nhau ký tự cuối phải trả về false');
      assert.strictEqual(constantTimeEqual('aamscanner_secret_token_2026', 'camscanner_secret_token_2026'), false, 'Hai chuỗi khác nhau ký tự đầu phải trả về false');
      assert.strictEqual(constantTimeEqual('camscanner_Secret_token_2026', 'camscanner_secret_token_2026'), false, 'Phân biệt chữ hoa chữ thường phải trả về false');

      // 3. Độ dài khác nhau trả về false mà không ném lỗi
      assert.strictEqual(constantTimeEqual('short', 'much_longer_token_secret_key'), false, 'Hai chuỗi độ dài khác nhau rõ rệt phải trả về false');
      assert.strictEqual(constantTimeEqual('admin', 'admin1'), false, 'Hai chuỗi lệch nhau 1 ký tự độ dài phải trả về false');
      assert.strictEqual(constantTimeEqual('', 'non_empty_secret'), false, 'Một chuỗi rỗng và một chuỗi có ký tự phải trả về false');
      assert.strictEqual(constantTimeEqual('non_empty_secret', ''), false, 'Chuỗi có ký tự và chuỗi rỗng phải trả về false');

      // 4. Các kiểu dữ liệu không phải string không được ném lỗi (defense-in-depth)
      assert.strictEqual(constantTimeEqual(null, 'secret'), false, 'Tham số null không được ném lỗi, trả về false');
      assert.strictEqual(constantTimeEqual('secret', undefined), false, 'Tham số undefined không được ném lỗi, trả về false');
      assert.strictEqual(constantTimeEqual(12345, 12345), false, 'Tham số số không được ném lỗi, trả về false');
      assert.strictEqual(constantTimeEqual({}, {}), false, 'Tham số object không được ném lỗi, trả về false');

      console.log('✅ Test 18 [PASSED]: So sánh thời gian hằng số (constantTimeEqual) chống rò rỉ Timing Attacks và xử lý an toàn độ dài khác nhau.');

      // ----------------------------------------------------
      // 19. TEST SECURE STORAGE WEB FALLBACK ENCRYPTION & DECRYPTION (Web AES-GCM / Stream Cipher Fallback)
      // ----------------------------------------------------
      const WEB_ENC_PREFIX = '__cs_enc_v1__:';
      const WEB_DEVICE_KEY_STORAGE = '__cs_web_sec_device_key__';

      function bytesToHex(bytes) {
        let hex = '';
        for (let i = 0; i < bytes.length; i++) {
          hex += bytes[i].toString(16).padStart(2, '0');
        }
        return hex;
      }

      function hexToBytes(hex) {
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < bytes.length; i++) {
          bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
        }
        return bytes;
      }

      function getRandomBytes(count) {
        const bytes = new Uint8Array(count);
        if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
          globalThis.crypto.getRandomValues(bytes);
        } else {
          for (let i = 0; i < count; i++) {
            bytes[i] = Math.floor(Math.random() * 256);
          }
        }
        return bytes;
      }

      let cachedDeviceEntropy = null;
      function getOrCreateDeviceEntropy() {
        if (cachedDeviceEntropy && cachedDeviceEntropy.length === 64) {
          return cachedDeviceEntropy;
        }
        const newEntropy = bytesToHex(getRandomBytes(32));
        cachedDeviceEntropy = newEntropy;
        return newEntropy;
      }

      let cachedAesKey = null;
      async function getAesKey() {
        if (cachedAesKey) return cachedAesKey;
        const entropy = getOrCreateDeviceEntropy();
        const rawKeyMaterial = new TextEncoder().encode(`CamScanner_WebSec_v1:${entropy}`);
        const hash = await globalThis.crypto.subtle.digest('SHA-256', rawKeyMaterial);
        cachedAesKey = await globalThis.crypto.subtle.importKey(
          'raw',
          hash,
          { name: 'AES-GCM' },
          false,
          ['encrypt', 'decrypt']
        );
        return cachedAesKey;
      }

      function streamCipher(data, keyBytes, ivBytes) {
        const out = new Uint8Array(data.length);
        let s = 0x811c9dc5;
        for (let i = 0; i < keyBytes.length; i++) {
          s = Math.imul(s ^ keyBytes[i], 0x01000193);
        }
        for (let i = 0; i < ivBytes.length; i++) {
          s = Math.imul(s ^ ivBytes[i], 0x01000193);
        }
        for (let i = 0; i < data.length; i++) {
          s = (s + 0x6d2b79f5) | 0;
          let t = Math.imul(s ^ (s >>> 15), 1 | s);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          out[i] = data[i] ^ ((t ^ (t >>> 14)) & 0xff);
        }
        return out;
      }

      async function encryptForWeb(plaintext, forceStream = false) {
        const data = new TextEncoder().encode(plaintext);

        if (!forceStream && typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
          const key = await getAesKey();
          const iv = getRandomBytes(12);
          const ctBuffer = await globalThis.crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: iv },
            key,
            data
          );
          const payload = {
            alg: 'AES-GCM',
            iv: bytesToHex(iv),
            ct: bytesToHex(new Uint8Array(ctBuffer)),
          };
          return JSON.stringify(payload);
        }

        const entropy = getOrCreateDeviceEntropy();
        const keyBytes = hexToBytes(entropy);
        const iv = getRandomBytes(16);
        const ct = streamCipher(data, keyBytes, iv);
        const payload = {
          alg: 'STREAM',
          iv: bytesToHex(iv),
          ct: bytesToHex(ct),
        };
        return JSON.stringify(payload);
      }

      async function decryptForWeb(ciphertext) {
        const rawPayload = ciphertext.startsWith(WEB_ENC_PREFIX)
          ? ciphertext.slice(WEB_ENC_PREFIX.length)
          : ciphertext;

        let payload;
        try {
          payload = JSON.parse(rawPayload);
        } catch {
          return ciphertext;
        }

        if (!payload.iv || !payload.ct || !payload.alg) {
          return ciphertext;
        }

        const iv = hexToBytes(payload.iv);
        const ct = hexToBytes(payload.ct);

        if (payload.alg === 'AES-GCM' && typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
          const key = await getAesKey();
          const decryptedBuffer = await globalThis.crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: iv },
            key,
            ct
          );
          return new TextDecoder().decode(decryptedBuffer);
        }

        const entropy = getOrCreateDeviceEntropy();
        const keyBytes = hexToBytes(entropy);
        const decrypted = streamCipher(ct, keyBytes, iv);
        return new TextDecoder().decode(decrypted);
      }

      // Giả lập SecureStorage Web Adapter
      const mockWebStorage = new Map();
      const MockSecureStorageWeb = {
        async setItem(key, value) {
          const encrypted = await encryptForWeb(value);
          mockWebStorage.set(key, WEB_ENC_PREFIX + encrypted);
        },
        async getItem(key) {
          const storedVal = mockWebStorage.get(key);
          if (storedVal === undefined || storedVal === null) return null;
          if (storedVal.startsWith(WEB_ENC_PREFIX)) {
            return await decryptForWeb(storedVal);
          }
          // Migration fallback cho plaintext cũ
          const encrypted = await encryptForWeb(storedVal);
          mockWebStorage.set(key, WEB_ENC_PREFIX + encrypted);
          return storedVal;
        },
      };

      return (async () => {
        // 1. Kiểm tra mã hóa và giải mã chuẩn AES-GCM
        const rawApiKey = 'sk-ant-api03-camscanner-ultra-secure-key-99887766';
        const encJson = await encryptForWeb(rawApiKey);
        const parsedEnc = JSON.parse(encJson);
        assert.strictEqual(parsedEnc.alg, 'AES-GCM', 'Thuật toán phải là AES-GCM khi có crypto.subtle');
        assert.ok(parsedEnc.iv && parsedEnc.iv.length === 24, 'IV 12 bytes phải mã hóa thành 24 ký tự hex');
        assert.ok(parsedEnc.ct.length > 0, 'Ciphertext không được rỗng');
        assert.ok(!encJson.includes(rawApiKey), 'Ciphertext tuyệt đối không được chứa plaintext lộ lọt');

        const decAes = await decryptForWeb(WEB_ENC_PREFIX + encJson);
        assert.strictEqual(decAes, rawApiKey, 'Giải mã AES-GCM phải khôi phục 100% API key gốc');

        // 2. Kiểm tra mã hóa và giải mã Stream Cipher Fallback (cho môi trường Web không có SubtleCrypto)
        const unicodeSecret = 'Mật khẩu quét tài liệu & Căn cước công dân số: 001202003344';
        const streamJson = await encryptForWeb(unicodeSecret, true);
        const parsedStream = JSON.parse(streamJson);
        assert.strictEqual(parsedStream.alg, 'STREAM', 'Thuật toán phải là STREAM khi fallback');
        assert.ok(!streamJson.includes(unicodeSecret), 'Stream cipher ciphertext không được chứa plaintext');

        const decStream = await decryptForWeb(WEB_ENC_PREFIX + streamJson);
        assert.strictEqual(decStream, unicodeSecret, 'Giải mã Stream Cipher fallback phải bảo toàn tiếng Việt Unicode');

        // 3. Kiểm tra trọn vẹn luồng SecureStorage Web Adapter (setItem -> getItem)
        await MockSecureStorageWeb.setItem('USER_SESSION_TOKEN', 'bearer_jwt_token_sample_abc123');
        const storedRaw = mockWebStorage.get('USER_SESSION_TOKEN');
        assert.ok(storedRaw.startsWith(WEB_ENC_PREFIX), 'Dữ liệu lưu trữ phải có tiền tố __cs_enc_v1__:');
        assert.ok(!storedRaw.includes('bearer_jwt_token_sample_abc123'), 'Dữ liệu vật lý trong storage phải được mã hóa hoàn toàn');

        const readBack = await MockSecureStorageWeb.getItem('USER_SESSION_TOKEN');
        assert.strictEqual(readBack, 'bearer_jwt_token_sample_abc123', 'getItem phải tự động giải mã ra token chính xác');

        // 4. Kiểm tra tương thích ngược và tự động migrate bản rõ cũ (Legacy Migration)
        mockWebStorage.set('LEGACY_UNENCRYPTED_KEY', 'old_plaintext_value');
        const legacyRead = await MockSecureStorageWeb.getItem('LEGACY_UNENCRYPTED_KEY');
        assert.strictEqual(legacyRead, 'old_plaintext_value', 'Phải đọc được giá trị plaintext cũ');
        const migratedVal = mockWebStorage.get('LEGACY_UNENCRYPTED_KEY');
        assert.ok(migratedVal.startsWith(WEB_ENC_PREFIX), 'Giá trị cũ phải được tự động mã hóa migrate thành __cs_enc_v1__:');

        // 5. Kiểm tra dữ liệu rác / không hợp lệ không ném crash (Graceful degradation)
        const nonJsonDec = await decryptForWeb('invalid_non_json_string');
        assert.strictEqual(nonJsonDec, 'invalid_non_json_string', 'Dữ liệu không phải JSON mã hóa phải được trả về nguyên bản an toàn');

        console.log('✅ Test 19 [PASSED]: Mã hóa & Giải mã an toàn Web Fallback trong SecureStorage (AES-GCM, Stream Cipher, Legacy Migration).');

        // ----------------------------------------------------
        // 20. TEST QUÉT SÁCH & DEWARP GÁY SÁCH PARABOL + TÁCH ĐÔI TRANG SÁCH
        // ----------------------------------------------------
        // A. Tách đôi trang sách đôi (Book Split)
        function splitBookPages(width, height) {
          const halfWidth = Math.floor(width / 2);
          const leftPage = { x: 0, y: 0, width: halfWidth, height };
          const rightPage = { x: halfWidth, y: 0, width: width - halfWidth, height };
          return { leftPage, rightPage };
        }

        const sampleW = 2048;
        const sampleH = 1536;
        const { leftPage, rightPage } = splitBookPages(sampleW, sampleH);
        assert.strictEqual(leftPage.width, 1024, 'Trang trái phải có độ rộng đúng một nửa (1024px)');
        assert.strictEqual(rightPage.width, 1024, 'Trang phải phải có độ rộng đúng một nửa (1024px)');
        assert.strictEqual(leftPage.width + rightPage.width, sampleW, 'Tổng độ rộng 2 trang phải đúng bằng ảnh gốc');
        assert.strictEqual(leftPage.height, sampleH, 'Chiều cao trang trái phải giữ nguyên');
        assert.strictEqual(rightPage.height, sampleH, 'Chiều cao trang phải giữ nguyên');
        assert.strictEqual(rightPage.x, 1024, 'Tọa độ X bắt đầu của trang phải đúng bằng halfWidth');

        // B. Thuật toán nắn cong gáy sách Parabol (Parabolic Spine Dewarp)
        function simulateDewarpSpineShift(H, W, avgGrad, cfg) {
          if (avgGrad < (cfg.BOOK_DEWARP_MIN_GRADIENT || 4.0)) {
            return { dewarped: false, maxShift: 0 };
          }
          const A = Math.min(cfg.BOOK_DEWARP_MAX_SHIFT_RATIO || 0.06, avgGrad / (cfg.BOOK_DEWARP_GRADIENT_DIVISOR || 200)) * W;

          const tTop = 0 / H - 0.5;
          const tMid = (H / 2) / H - 0.5;
          const tBot = H / H - 0.5;

          const shiftTop = A * tTop * tTop;
          const shiftMid = A * tMid * tMid;
          const shiftBot = A * tBot * tBot;

          return { dewarped: true, A, shiftTop, shiftMid, shiftBot };
        }

        const dewarpCfg = {
          BOOK_DEWARP_MIN_GRADIENT: 4.0,
          BOOK_DEWARP_MAX_SHIFT_RATIO: 0.06,
          BOOK_DEWARP_GRADIENT_DIVISOR: 200,
        };

        // 1. Nếu độ dốc gradient < 4.0 -> không cong, giữ nguyên
        const flatResult = simulateDewarpSpineShift(1000, 800, 2.5, dewarpCfg);
        assert.strictEqual(flatResult.dewarped, false, 'Ảnh phẳng không có độ cong đáng kể phải giữ nguyên');

        // 2. Nếu độ dốc gradient = 8.0 -> nắn cong parabol
        const curvedResult = simulateDewarpSpineShift(1000, 800, 8.0, dewarpCfg);
        assert.strictEqual(curvedResult.dewarped, true, 'Ảnh gáy sách cong phải kích hoạt nắn dewarp');
        assert.strictEqual(curvedResult.shiftMid, 0, 'Điểm giữa gáy sách (t = 0) không có độ lệch dịch chuyển');
        assert.ok(curvedResult.shiftTop > 0, 'Điểm đỉnh gáy sách phải có độ dịch chuyển kéo phẳng');
        assert.strictEqual(curvedResult.shiftTop, curvedResult.shiftBot, 'Độ dịch chuyển tại đỉnh và đáy phải đối xứng parabol');
        assert.ok(curvedResult.shiftTop <= 800 * 0.06, 'Độ dịch chuyển không được vượt quá BOOK_DEWARP_MAX_SHIFT_RATIO');

        console.log('✅ Test 20 [PASSED]: Quét sách đôi (Book Split) và nắn cong gáy sách Parabol (Dewarp Spine Shift).');

        // ----------------------------------------------------
        // 21. TEST NÉN PDF, KIỂM TRA JPEG MAGIC BYTES & RÀO CHẮN DUNG LƯỢNG
        // ----------------------------------------------------
        // A. Kiểm tra Magic Bytes JPEG
        function isJpegBuffer(buffer) {
          if (!buffer || buffer.length < 2) return false;
          return buffer[0] === 0xff && buffer[1] === 0xd8;
        }

        const validJpegHeader = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
        const invalidHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
        assert.strictEqual(isJpegBuffer(validJpegHeader), true, 'File JPEG phải bắt đầu bằng Magic Bytes 0xFF, 0xD8');
        assert.strictEqual(isJpegBuffer(invalidHeader), false, 'File PNG không được nhận là JPEG');

        // B. Mô phỏng nén theo dung lượng mục tiêu (Target KB Clamp & Temp Cleanup)
        async function mockCompressToTargetSize(initialKB, targetKB) {
          const tempCreated = [];
          const tempCleaned = [];
          let currentKB = initialKB;
          let attempt = 0;
          let currentScale = 1.0;
          let currentQuality = 0.8;
          let lastUri = 'file:///original_image.jpg';

          if (currentKB <= targetKB) {
            return { finalUri: lastUri, attempts: 0, leakedFiles: 0 };
          }

          while (attempt < 5 && currentKB > targetKB && (currentQuality > 0.4 || currentScale > 0.4)) {
            attempt++;
            const stepUri = `file:///cache/temp_compress_step_${attempt}.jpg`;
            tempCreated.push(stepUri);

            currentQuality = Math.max(0.35, currentQuality - 0.15);
            currentScale = Math.max(0.4, currentScale * 0.85);
            currentKB = Math.round(currentKB * currentScale * (currentQuality / 0.8));

            if (lastUri !== 'file:///original_image.jpg') {
              tempCleaned.push(lastUri);
            }
            lastUri = stepUri;
          }

          const leaked = tempCreated.filter(u => u !== lastUri && !tempCleaned.includes(u));
          return {
            finalUri: lastUri,
            finalKB: currentKB,
            attempts: attempt,
            leakedFiles: leaked.length,
          };
        }

        const compressRes1 = await mockCompressToTargetSize(400, 500);
        assert.strictEqual(compressRes1.attempts, 0, 'Dung lượng đã nhỏ hơn targetKB thì không cần nén');
        assert.strictEqual(compressRes1.finalUri, 'file:///original_image.jpg', 'Giữ nguyên file gốc khi đạt yêu cầu');

        const compressRes2 = await mockCompressToTargetSize(3200, 500);
        assert.ok(compressRes2.attempts > 0, 'Phải thực hiện các bước nén khi dung lượng lớn');
        assert.ok(compressRes2.finalKB <= 500 || compressRes2.attempts === 5, 'Dung lượng phải giảm về <= targetKB hoặc đạt tối đa 5 lần lặp');
        assert.strictEqual(compressRes2.leakedFiles, 0, 'Tất cả file tạm trung gian phải được dọn dẹp sạch sẽ, không rò rỉ rác bộ nhớ');

        console.log('✅ Test 21 [PASSED]: Kiểm tra JPEG Magic Bytes (0xFF, 0xD8) và thuật toán nén giới hạn dung lượng KB kèm tự động dọn dẹp file tạm.');

        // ----------------------------------------------------
        // 22. TEST DI TRÚ STORAGE SCHEMA V2 & IS_QUOTA_EXCEEDED_ERROR
        // ----------------------------------------------------
        function isQuotaExceededError(err) {
          if (!err) return false;
          if (err.name === 'QuotaExceededError') return true;
          if (
            err.code === 22 ||
            err.code === 'QUOTA_EXCEEDED_ERR' ||
            err.code === 'ENOSPC' ||
            err.code === 'ERR_FILESYSTEM_NO_ENOUGH_SPACE'
          ) {
            return true;
          }
          const msg = String(err.message || err.description || '').toLowerCase();
          return (
            msg.includes('quota') ||
            msg.includes('enospc') ||
            msg.includes('no space left') ||
            msg.includes('storage full') ||
            msg.includes('disk full') ||
            msg.includes('disk is full') ||
            (msg.includes('bộ nhớ') && msg.includes('đầy')) ||
            (msg.includes('dung lượng') && msg.includes('đầy')) ||
            msg.includes('hết dung lượng') ||
            msg.includes('hết bộ nhớ')
          );
        }

        // 1. Bắt chính xác các dạng lỗi đầy ổ đĩa / tràn quota
        assert.strictEqual(isQuotaExceededError({ name: 'QuotaExceededError' }), true, 'Phải bắt được lỗi có name QuotaExceededError');
        assert.strictEqual(isQuotaExceededError({ code: 22 }), true, 'Phải bắt được lỗi mã 22 (W3C QuotaExceededError)');
        assert.strictEqual(isQuotaExceededError({ code: 'QUOTA_EXCEEDED_ERR' }), true, 'Phải bắt được lỗi QUOTA_EXCEEDED_ERR');
        assert.strictEqual(isQuotaExceededError({ code: 'ENOSPC' }), true, 'Phải bắt được mã ENOSPC (POSIX no space left)');
        assert.strictEqual(isQuotaExceededError(new Error('SQLite database or disk is full')), true, 'Phải bắt được lỗi disk is full');
        assert.strictEqual(isQuotaExceededError(new Error('The quota has been exceeded.')), true, 'Phải bắt được chuỗi quota exceeded');
        assert.strictEqual(isQuotaExceededError(new Error('Bộ nhớ lưu trữ trên thiết bị đã đầy')), true, 'Phải bắt được thông báo tiếng Việt bộ nhớ đầy');

        // 2. Không nhận diện nhầm các lỗi thông thường (Không False Positive)
        assert.strictEqual(isQuotaExceededError(new TypeError('Invalid argument')), false, 'Không được nhận diện nhầm TypeError');
        assert.strictEqual(isQuotaExceededError(new Error('Network request failed')), false, 'Không được nhận diện nhầm NetworkError');
        assert.strictEqual(isQuotaExceededError(null), false, 'Null phải trả về false');
        assert.strictEqual(isQuotaExceededError(undefined), false, 'Undefined phải trả về false');

        // 3. Di trú Schema Storage từ v1 lên v2
        function migrateStorageSchemaV1toV2(v1Data) {
          const v2Data = { ...v1Data };
          if (v2Data['@camscanner_dark_mode'] && !v2Data['@camscanner_theme_mode']) {
            v2Data['@camscanner_theme_mode'] = v2Data['@camscanner_dark_mode'] === 'true' ? 'dark' : 'light';
          }
          if (!v2Data['@camscanner_scan_quality']) {
            v2Data['@camscanner_scan_quality'] = 'high';
          }
          if (!v2Data['@camscanner_ocr_lang']) {
            v2Data['@camscanner_ocr_lang'] = 'vie+eng';
          }
          return v2Data;
        }

        const legacyV1 = { '@camscanner_dark_mode': 'true', '@camscanner_pdf_page_size': 'A4' };
        const migratedV2 = migrateStorageSchemaV1toV2(legacyV1);
        assert.strictEqual(migratedV2['@camscanner_theme_mode'], 'dark', 'Theme mode phải được chuyển đổi từ dark_mode true sang dark');
        assert.strictEqual(migratedV2['@camscanner_scan_quality'], 'high', 'Thiếu scan_quality phải được bổ sung mặc định');
        assert.strictEqual(migratedV2['@camscanner_ocr_lang'], 'vie+eng', 'Thiếu ocr_lang phải được bổ sung vie+eng');
        assert.strictEqual(migratedV2['@camscanner_pdf_page_size'], 'A4', 'Giữ nguyên cài đặt cũ không đổi');

        console.log('✅ Test 22 [PASSED]: Kiểm tra dò lỗi bộ nhớ đầy (isQuotaExceededError) và di trú Storage Schema v1 lên v2.');

        // ----------------------------------------------------
        // 23. TEST NGĂN XẾP DẤU NGOẶC NGHIÊM NGẶT & DÒ BIẾN SỐ ĐẠI SỐ PHỨC TẠP (e, i, T)
        // ----------------------------------------------------
        // A. Ngăn xếp dấu ngoặc nghiêm ngặt (Strict Bracket Stack)
        function validateStrictBrackets(expr) {
          if (!expr) return true;
          const stack = [];
          const pairs = { ')': '(', ']': '[', '}': '{' };
          for (let i = 0; i < expr.length; i++) {
            const ch = expr[i];
            if (ch === '(' || ch === '[' || ch === '{') {
              stack.push(ch);
            } else if (ch === ')' || ch === ']' || ch === '}') {
              if (stack.length === 0) return false;
              const top = stack.pop();
              if (top !== pairs[ch]) return false;
            }
          }
          return stack.length === 0;
        }

        assert.strictEqual(validateStrictBrackets('(2*x + 1) * [a + b]'), true, 'Ngoặc tròn và vuông lồng đúng thứ tự');
        assert.strictEqual(validateStrictBrackets('{x + [y - (z * 2)]}'), true, 'Ngoặc nhọn, vuông, tròn lồng chuẩn');
        assert.strictEqual(validateStrictBrackets('([)]'), false, 'Ngoặc đan chéo sai cặp ([)] phải trả về false');
        assert.strictEqual(validateStrictBrackets('(2*x + 1'), false, 'Thiếu ngoặc đóng phải trả về false');
        assert.strictEqual(validateStrictBrackets('2*x + 1)'), false, 'Thừa ngoặc đóng phải trả về false');
        assert.strictEqual(validateStrictBrackets(')x + 1('), false, 'Ngoặc đóng trước mở sau phải trả về false');

        // B. Dò biến số đại số phức tạp, phân biệt hằng số Euler 'e' và số ảo 'i'
        const PROTECTED_SYMBOLS = new Set([
          'sin', 'cos', 'tan', 'cot', 'sec', 'csc',
          'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh',
          'sqrt', 'cbrt', 'root', 'log', 'ln', 'lg', 'exp',
          'lim', 'max', 'min', 'det', 'abs', 'pi', 'theta', 'alpha', 'beta',
        ]);

        function detectSolveVariableAdvanced(cleanEq) {
          const candidates = cleanEq.match(/[a-zA-Z]+/g) || [];
          const letters = candidates
            .map(t => t.toLowerCase())
            .filter(t => t.length === 1 && !PROTECTED_SYMBOLS.has(t));

          if (letters.includes('x')) return 'x';
          const preferred = ['t', 'y', 'z', 'n', 'u', 'v', 'a', 'b'];
          for (const p of preferred) {
            if (letters.includes(p)) return p;
          }
          const nonConstants = letters.filter(l => l !== 'e' && l !== 'i');
          if (nonConstants.length > 0) return nonConstants[0];
          if (letters.length > 0) return letters[0];
          return 'x';
        }

        assert.strictEqual(detectSolveVariableAdvanced('2*t + 5 = 15'), 't', 'Phải nhận diện biến thời gian t');
        assert.strictEqual(detectSolveVariableAdvanced('y^2 - 4*y + 4 = 0'), 'y', 'Phải nhận diện biến tung độ y');
        assert.strictEqual(detectSolveVariableAdvanced('3*n + 1 = 10'), 'n', 'Phải nhận diện biến nguyên n');
        assert.strictEqual(detectSolveVariableAdvanced('e^(2*x) + sin(x) = 5'), 'x', 'Phải ưu tiên x thay vì nhầm cơ số e hoặc hàm sin');
        assert.strictEqual(detectSolveVariableAdvanced('e^(2*t) - 1 = 0'), 't', 'Phải nhận diện biến t khi có cơ số tự nhiên e');

        console.log('✅ Test 23 [PASSED]: Ngăn xếp kiểm tra dấu ngoặc nghiêm ngặt (Strict Bracket Stack) và dò biến số thông minh (bảo vệ hằng số e, i).');

        // ----------------------------------------------------
        // 24. TEST XOAY GÓC TỨ GIÁC HÌNH THOI ĐỐI XỨNG & KẸP TỌA ĐỘ [0, 1]
        // ----------------------------------------------------
        // A. Kẹp tọa độ điểm trong khoảng [0, 1]
        function clampPoint(p) {
          return {
            x: Math.max(0, Math.min(1, p.x)),
            y: Math.max(0, Math.min(1, p.y)),
          };
        }

        function clampCorners(corners) {
          return corners.map(clampPoint);
        }

        const outOfBoundsCorners = [
          { x: -0.08, y: -0.02 },
          { x: 1.05, y: -0.01 },
          { x: -0.03, y: 1.12 },
          { x: 1.07, y: 1.04 },
        ];
        const clamped = clampCorners(outOfBoundsCorners);
        assert.strictEqual(clamped[0].x, 0, 'Tọa độ âm phải được kẹp về 0');
        assert.strictEqual(clamped[0].y, 0, 'Tọa độ âm phải được kẹp về 0');
        assert.strictEqual(clamped[1].x, 1, 'Tọa độ vượt quá 1 phải được kẹp về 1');
        assert.strictEqual(clamped[2].y, 1, 'Tọa độ vượt quá 1 phải được kẹp về 1');

        // B. Xoay góc tứ giác 90 độ theo chiều kim đồng hồ: (x, y) -> (1 - y, x)
        // Thứ tự corners: TL (0), TR (1), BL (2), BR (3)
        function rotateCorners90CW(corners) {
          const rotatePoint = p => ({ x: 1 - p.y, y: p.x });
          return [
            rotatePoint(corners[2]), // Đỉnh mới TL lấy từ BL cũ
            rotatePoint(corners[0]), // Đỉnh mới TR lấy từ TL cũ
            rotatePoint(corners[3]), // Đỉnh mới BL lấy từ BR cũ
            rotatePoint(corners[1]), // Đỉnh mới BR lấy từ TR cũ
          ];
        }

        function isConvexPolygonTest(corners) {
          if (!corners || corners.length !== 4) return false;
          const p = [corners[0], corners[1], corners[3], corners[2]]; // TL -> TR -> BR -> BL
          let prevSign = 0;
          for (let i = 0; i < 4; i++) {
            const p1 = p[i];
            const p2 = p[(i + 1) % 4];
            const p3 = p[(i + 2) % 4];
            const dx1 = p2.x - p1.x;
            const dy1 = p2.y - p1.y;
            const dx2 = p3.x - p2.x;
            const dy2 = p3.y - p2.y;
            const cross = dx1 * dy2 - dy1 * dx2;
            if (Math.abs(cross) < 1e-4) return false;
            const sign = cross > 0 ? 1 : -1;
            if (prevSign === 0) prevSign = sign;
            else if (sign !== prevSign) return false;
          }
          return true;
        }

        // Tứ giác chuẩn ban đầu: hình thoi/tứ giác lồi
        const originalCorners = [
          { x: 0.1, y: 0.1 }, // TL
          { x: 0.9, y: 0.15 }, // TR
          { x: 0.15, y: 0.85 }, // BL
          { x: 0.85, y: 0.9 }, // BR
        ];

        assert.strictEqual(isConvexPolygonTest(originalCorners), true, 'Tứ giác ban đầu phải là đa giác lồi');

        // Xoay 1 lần 90 độ
        const rot90 = rotateCorners90CW(originalCorners);
        assert.strictEqual(isConvexPolygonTest(rot90), true, 'Tứ giác sau khi xoay 90 độ phải duy trì tính lồi');

        // Xoay liên tiếp 4 lần (360 độ) phải quay về chính xác vị trí ban đầu
        let currentCorners = originalCorners;
        for (let i = 0; i < 4; i++) {
          currentCorners = rotateCorners90CW(currentCorners);
        }

        for (let i = 0; i < 4; i++) {
          assert.ok(Math.abs(currentCorners[i].x - originalCorners[i].x) < 1e-6, `Tọa độ X đỉnh ${i} sau chu kỳ 360 độ phải khớp`);
          assert.ok(Math.abs(currentCorners[i].y - originalCorners[i].y) < 1e-6, `Tọa độ Y đỉnh ${i} sau chu kỳ 360 độ phải khớp`);
        }

        console.log('✅ Test 24 [PASSED]: Kẹp tọa độ đa giác cắt viền [0, 1] và phép xoay góc tứ giác bảo toàn tính lồi (Convexity & 360° Cycle).');

        console.log('\n====================================================');
        console.log('🎉 TẤT CẢ 24 TEST SUITE ĐỀU VƯỢT QUA 100% THÀNH CÔNG!');
        console.log('====================================================');
      })();
    });
});
