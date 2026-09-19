/**
 * math.solver.ts — Bộ giải toán thông minh kết hợp On-device CAS (Nerdamer) và AI Vision
 * - Chuẩn hóa ngữ cảnh bảo vệ hoàn toàn các hàm lượng giác, logarit, căn thức (sin, cos, sqrt, log...)
 * - Bảo vệ các biến số (s, x, y, z...), tuyệt đối không thay s thành 5
 * - Tách bạch rõ kết quả giải On-Device CAS và AI Cloud
 */

import { MathSolution } from '../../types/domain';

// Danh sách các hàm và hằng số toán học cần bảo toàn
const PROTECTED_MATH_SYMBOLS = new Set([
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc',
  'asin', 'acos', 'atan',
  'sinh', 'cosh', 'tanh',
  'sqrt', 'cbrt', 'root',
  'log', 'ln', 'lg', 'exp',
  'lim', 'max', 'min', 'det', 'abs',
  'pi', 'theta', 'alpha', 'beta',
]);

export class MathSolverService {
  /**
   * Chuẩn hóa biểu thức toán học từ OCR thô bằng phân tích ngữ cảnh (Contextual Normalization)
   */
  public static normalizeMathExpression(raw: string): string {
    if (!raw) return '';

    let clean = raw
      .replace(/[\r\n]+/g, ' ')
      .replace(/[–—−]/g, '-')
      .replace(/[×✕]/g, '*')
      .replace(/[÷]/g, '/')
      .replace(/²/g, '^2')
      .replace(/³/g, '^3')
      .trim();

    // Chuẩn hóa khoảng trắng
    clean = clean.replace(/\s+/g, ' ');

    // Thay thế 'o' hoặc 'O' thành '0' CHỈ KHI nằm giữa các chữ số (ví dụ: '1o0' -> '100')
    clean = clean.replace(/(\d)[oO]+(\d)/g, '$10$2');
    clean = clean.replace(/(\d)[oO]+/g, '$10');
    clean = clean.replace(/[oO]+(\d)/g, '0$1');

    // Thay thế chữ 'l' hoặc 'I' thành '1' CHỈ KHI kẹp giữa các chữ số
    clean = clean.replace(/(\d)[lI]+(\d)/g, '$11$2');

    // Tuyệt đối KHÔNG thay thế ký tự 's' thành '5' vì 's' là biến số (Laplace/vận tốc/thời gian) hoặc nằm trong hàm lượng giác (sin, cos...)
    return clean;
  }

  /**
   * Kiểm tra biểu thức có hợp lệ sơ bộ về mặt cú pháp không (cân bằng ngoặc)
   */
  public static validateParentheses(expr: string): boolean {
    let count = 0;
    for (const ch of expr) {
      if (ch === '(' || ch === '[' || ch === '{') count++;
      if (ch === ')' || ch === ']' || ch === '}') count--;
      if (count < 0) return false;
    }
    return count === 0;
  }

  /**
   * Dò biến số cần giải trong phương trình thay vì ép cứng là 'x'.
   * Ưu tiên 'x' nếu có mặt (thói quen phổ biến), nếu không thì lấy chữ cái đơn
   * đầu tiên xuất hiện mà không nằm trong danh sách hàm/hằng số được bảo vệ.
   */
  public static detectSolveVariable(cleanEq: string): string {
    const candidates = cleanEq.match(/[a-zA-Z]+/g) || [];
    const letters = candidates
      .map(t => t.toLowerCase())
      .filter(t => t.length === 1 && !PROTECTED_MATH_SYMBOLS.has(t));

    if (letters.includes('x')) return 'x';
    if (letters.length > 0) return letters[0];
    return 'x'; // fallback an toàn nếu không dò được biến nào
  }

  /**
   * Giải phương trình hoặc tính toán biểu thức đại số bằng On-Device CAS (Nerdamer)
   */
  public static solveWithCas(rawEquation: string): MathSolution {
    const cleanEq = this.normalizeMathExpression(rawEquation).replace(/\s+/g, '');
    const timestamp = Date.now();

    if (!cleanEq) {
      return {
        equation: rawEquation,
        result: 'Biểu thức trống.',
        isCasSuccess: false,
        isAiSolved: false,
        source: 'CAS',
        timestamp,
      };
    }

    if (!this.validateParentheses(cleanEq)) {
      return {
        equation: cleanEq,
        result: 'Biểu thức thiếu hoặc mất cân bằng dấu đóng/mở ngoặc.',
        isCasSuccess: false,
        isAiSolved: false,
        source: 'CAS',
        timestamp,
      };
    }

    try {
      const nerdamer = require('nerdamer');
      require('nerdamer/Algebra');
      require('nerdamer/Calculus');
      require('nerdamer/Solve');

      let ans: any;
      if (cleanEq.includes('=')) {
        // FIX: biến giải luôn bị ép cứng là 'x'. Nếu đề bài dùng biến khác (y, t, a, n...)
        // — rất phổ biến với đề Vật lý/Hóa (t = thời gian, n = số mol...) — Nerdamer sẽ
        // không tìm được nghiệm hoặc trả về nghiệm rỗng dù phương trình hợp lệ.
        // Giờ tự dò biến số thực sự xuất hiện trong biểu thức thay vì giả định 'x'.
        const solveVar = this.detectSolveVariable(cleanEq);
        ans = nerdamer.solveEquations(cleanEq, solveVar);
      } else {
        // Rút gọn / Tính giá trị biểu thức
        ans = nerdamer(cleanEq).evaluate();
      }

      const resultStr = ans ? ans.toString() : '';
      if (!resultStr || resultStr === '[]') {
        return {
          equation: cleanEq,
          result: 'Không tìm thấy nghiệm đại số đơn giản bằng bộ giải On-Device.',
          isCasSuccess: false,
          isAiSolved: false,
          source: 'CAS',
          timestamp,
        };
      }

      return {
        equation: cleanEq,
        result: `📐 Kết quả CAS On-Device (Nerdamer):\nPhương trình/Biểu thức: ${cleanEq}\nNghiệm / Giá trị: ${resultStr}`,
        isCasSuccess: true,
        isAiSolved: false,
        source: 'CAS',
        timestamp,
      };
    } catch (e: any) {
      return {
        equation: cleanEq,
        result: `Không thể giải tự động bằng CAS: ${e.message || String(e)}`,
        isCasSuccess: false,
        isAiSolved: false,
        source: 'CAS',
        timestamp,
      };
    }
  }
}

export default MathSolverService;
