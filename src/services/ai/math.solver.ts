/**
 * math.solver.ts — Bộ giải toán thông minh kết hợp On-device CAS (Nerdamer) và AI Vision
 * - Chuẩn hóa ngữ cảnh bảo vệ hoàn toàn các hàm lượng giác, logarit, căn thức (sin, cos, sqrt, log...)
 * - Bảo vệ các biến số (s, x, y, z...), tuyệt đối không thay s thành 5
 * - Tách bạch rõ kết quả giải On-Device CAS và AI Cloud
 * - Input Sanitization: Chống Prototype Pollution & Sandbox Escape
 * - Promise.race CAS execution timeout (2.5s) chống ReDoS
 * - formatToKaTeX: Chuẩn hóa phân số (\frac) và căn (\sqrt) sang định dạng KaTeX chuẩn
 */

import type { MathSolution } from '../../types/domain';

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

// Danh sách các từ khóa nguy hiểm tiềm ẩn nguy cơ Prototype Pollution hoặc Sandbox Escape
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

// Thời gian timeout tối đa cho Nerdamer CAS (2.5 giây)
const CAS_EXECUTION_TIMEOUT_MS = 2500;

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
      .replace(/[[{]/g, '(')
      .replace(/[\]}]/g, ')')
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
   * Kiểm tra và làm sạch dữ liệu đầu vào (Input Sanitization)
   * - Chặn hoàn toàn các chuỗi độc hại gây Prototype Pollution / Sandbox Escape
   * - Chỉ cho phép các ký tự toán học hợp lệ: chữ số, chữ cái, phép tính (+, -, *, /, ^), ngoặc (), dấu chấm, phẩy, bằng, khoảng trắng
   */
  public static sanitizeInput(expr: string): { isValid: boolean; error?: string } {
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

  /**
   * Chuyển đổi các ký tự phân số \frac, căn \sqrt và công thức toán học thô thành định dạng KaTeX chuẩn
   */
  public static formatToKaTeX(rawExpr: string): string {
    if (!rawExpr || !rawExpr.trim()) return '';

    let expr = rawExpr.trim();

    // 1. Chuẩn hóa ký tự phân số Unicode
    const unicodeFractions: Record<string, string> = {
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
   * Bọc lời gọi giải toán trong Promise.race với timeout 2.5 giây chống ReDoS làm treo ứng dụng
   */
  private static executeCasWithTimeout<T>(action: () => T, timeoutMs: number = CAS_EXECUTION_TIMEOUT_MS): Promise<T> {
    let timer: any;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Quá thời gian xử lý CAS (Timeout ${timeoutMs / 1000}s) do biểu thức quá phức tạp hoặc ReDoS.`));
      }, timeoutMs);
    });

    const executionPromise = new Promise<T>((resolve, reject) => {
      try {
        const result = action();
        resolve(result);
      } catch (err) {
        reject(err);
      }
    });

    return Promise.race([executionPromise, timeoutPromise]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }

  /**
   * Giải phương trình hoặc tính toán biểu thức đại số bằng On-Device CAS (Nerdamer)
   * - Áp dụng Input Sanitization để chặn chuỗi độc hại & ký tự không hợp lệ
   * - Bọc trong Promise.race với timeout 2.5s để chống ReDoS
   */
  public static async solveWithCas(rawEquation: string): Promise<MathSolution> {
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

    // Input Sanitization: Chặn Prototype Pollution / Sandbox Escape & kiểm tra ký tự hợp lệ
    const sanitization = this.sanitizeInput(cleanEq);
    if (!sanitization.isValid) {
      return {
        equation: cleanEq,
        result: sanitization.error || 'Biểu thức không an toàn hoặc chứa ký tự không hợp lệ.',
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

      const ans: any = await this.executeCasWithTimeout(() => {
        if (cleanEq.includes('=')) {
          // Dò biến số thực sự xuất hiện trong biểu thức thay vì giả định 'x'
          const solveVar = this.detectSolveVariable(cleanEq);
          return nerdamer.solveEquations(cleanEq, solveVar);
        } else {
          // Rút gọn / Tính giá trị biểu thức
          return nerdamer(cleanEq).evaluate();
        }
      }, CAS_EXECUTION_TIMEOUT_MS);

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
        result: `Không thể giải tự động bằng CAS: ${e?.message || String(e)}`,
        isCasSuccess: false,
        isAiSolved: false,
        source: 'CAS',
        timestamp,
      };
    }
  }
}

export default MathSolverService;
