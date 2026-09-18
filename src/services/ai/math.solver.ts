/**
 * math.solver.ts — Bộ giải toán thông minh kết hợp On-device CAS (Nerdamer) và AI Vision
 * Khắc phục hoàn toàn lỗi regex thay thế s/5 và o/0 gây phá hủy các hàm toán học (cos, sin, sqrt...).
 */

export class MathSolverService {
  /**
   * Chuẩn hóa biểu thức toán học từ chuỗi OCR thô một cách an toàn
   */
  public static normalizeMathExpression(raw: string): string {
    if (!raw) return '';

    let clean = raw
      .replace(/[\r\n]+/g, ' ')
      .replace(/[–—−]/g, '-')
      .replace(/[×✕]/g, '*')
      .replace(/[÷]/g, '/')
      .replace(/[^\x00-\x7F]/g, ' ') // Xóa các ký tự unicode rác không chuẩn
      .trim();

    // Chuẩn hóa khoảng trắng
    clean = clean.replace(/\s+/g, ' ');

    // Thay thế 'o' hoặc 'O' thành '0' CHỈ KHI đứng giữa các chữ số (ví dụ: '1o0' -> '100')
    clean = clean.replace(/(\d)[oO]+(\d)/g, '$10$2');
    clean = clean.replace(/(\d)[oO]+/g, '$10');
    clean = clean.replace(/[oO]+(\d)/g, '0$1');

    // Tuyệt đối KHÔNG thay thế chữ 's' thành '5' toàn cục vì 's' là biến số hợp lệ hoặc nằm trong sin, cos, sqrt...
    return clean;
  }

  /**
   * Giải toán bằng thư viện On-device CAS (Nerdamer)
   */
  public static solveWithCas(rawEquation: string): { success: boolean; result: string; cleanEquation: string } {
    const cleanEq = this.normalizeMathExpression(rawEquation).replace(/\s+/g, '');
    if (!cleanEq) {
      return { success: false, result: '', cleanEquation: '' };
    }

    try {
      const nerdamer = require('nerdamer');
      require('nerdamer/Algebra');
      require('nerdamer/Calculus');
      require('nerdamer/Solve');

      let ans: any;
      if (cleanEq.includes('=')) {
        // Phương trình
        ans = nerdamer.solveEquations(cleanEq, 'x');
      } else {
        // Biểu thức tính toán
        ans = nerdamer(cleanEq).evaluate();
      }

      const resultStr = ans ? ans.toString() : '';
      return {
        success: true,
        result: `📐 Kết quả CAS On-Device:\nBiểu thức: ${cleanEq}\nNghiệm / Giá trị: ${resultStr}`,
        cleanEquation: cleanEq,
      };
    } catch (e: any) {
      return {
        success: false,
        result: `Không thể giải tự động bằng CAS: ${e.message || String(e)}`,
        cleanEquation: cleanEq,
      };
    }
  }
}

export default MathSolverService;
