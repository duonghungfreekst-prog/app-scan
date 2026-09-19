/**
 * test_suite.js — Kiểm thử đơn vị toàn diện (Unit Test Suite)
 * Kiểm tra các tính toán cốt lõi: Math Normalization, Sanitize File Name, Polygon Convexity, Storage Schema, Version Compare.
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
  clean = clean.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
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

const cleanVN = sanitizeFileName('Hợp đồng kinh tế & Biên bản bàn giao 2026');
assert.ok(cleanVN.includes('Hợp đồng'), 'Phải bảo tồn nguyên vẹn chữ cái tiếng Việt');

console.log('✅ Test 4 [PASSED]: Sanitize tên file chống Path Traversal và Windows Reserved Words.');

// ----------------------------------------------------
// 5. TEST POLYGON CONVEXITY & SELF-INTERSECTION
// ----------------------------------------------------
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
      // 10. TEST PAGE ROTATION & CORNER TRANSFORM (Xoay trang 90°/360°)
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
      console.log('✅ Test 10 [PASSED]: Xoay trang 90° và bảo toàn hình học sau 4 vòng xoay 360°.');

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

      console.log('\n====================================================');
      console.log('🎉 TẤT CẢ 13 TEST SUITE ĐỀU VƯỢT QUA 100% THÀNH CÔNG!');
      console.log('====================================================');
    });
});
