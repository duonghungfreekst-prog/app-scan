/**
 * officeExport.service.ts — Dịch vụ chuyển đổi văn bản sang Word (.docx) và Excel (.xlsx)
 * Hoạt động 100% On-Device sử dụng thư viện docx và xlsx native JS.
 */

import { saveBase64ToDocuments, sanitizeFileName } from '../../utils/fileHelper';

export interface DocxExportOptions {
  font?: 'Times New Roman' | 'Arial';
  fontSize?: number; // Cỡ chữ tính theo pt (mặc định 12pt -> 24 half-points)
}

export class OfficeExportService {
  /**
   * Tạo tài liệu Microsoft Word (.docx) từ chuỗi văn bản
   * Hỗ trợ đầy đủ font Unicode tiếng Việt (Times New Roman / Arial),
   * bảo toàn cấu trúc đoạn văn, ngắt dòng (soft line breaks) và danh sách bullet points.
   */
  public static async exportToDocx(
    text: string,
    rawFileName?: string,
    options?: DocxExportOptions
  ): Promise<string> {
    const { Document, Packer, Paragraph, TextRun } = require('docx');

    const fontName = options?.font || 'Times New Roman';
    const fontSize = options?.fontSize ? options.fontSize * 2 : 24; // docx quy định đơn vị half-points (24 = 12pt)

    // Regex nhận diện các ký tự gạch đầu dòng / bullet phổ biến
    const bulletRegex = /^([ \t]*)([-*+•⁃◦▪▫–—]|\u2022|\u2043|\u25E6|\u25AA|\u25AB|\u2013|\u2014)\s+(.*)$/;

    // Chuẩn hóa văn bản: đổi CRLF -> LF, loại bỏ BOM UTF-8, chuẩn hóa Unicode NFC dựng sẵn
    const normalized = (text || '')
      .replace(/^\uFEFF/, '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .normalize('NFC');
    const rawLines = normalized.split('\n');

    const paragraphs: any[] = [];
    let currentNormalLines: string[] = [];

    const flushNormalLines = () => {
      if (currentNormalLines.length > 0) {
        const runs: any[] = [];
        currentNormalLines.forEach((line, idx) => {
          if (idx > 0) {
            runs.push(new TextRun({ break: 1 }));
          }
          runs.push(new TextRun({
            text: line,
            font: fontName,
            size: fontSize,
          }));
        });

        paragraphs.push(new Paragraph({
          children: runs,
          spacing: { after: 120, line: 276 }, // Cách đoạn 6pt (120 dxa), giãn dòng 1.15 line (276 dxa) chuẩn TCVN
        }));
        currentNormalLines = [];
      }
    };

    let consecutiveEmptyCount = 0;

    for (let i = 0; i < rawLines.length; i++) {
      const rawLine = rawLines[i];
      const trimmed = rawLine.trim();

      if (trimmed === '') {
        flushNormalLines();
        consecutiveEmptyCount++;
        // Giữ lại dòng trống có chủ ý nếu có từ 2 dòng trống liên tiếp trở lên
        if (consecutiveEmptyCount > 1) {
          paragraphs.push(new Paragraph({ spacing: { after: 120 } }));
        }
        continue;
      }

      consecutiveEmptyCount = 0;

      const bulletMatch = rawLine.match(bulletRegex);
      if (bulletMatch) {
        flushNormalLines();
        const indent = bulletMatch[1].replace(/\t/g, '  ').length;
        const level = Math.min(Math.floor(indent / 2), 3);
        const bulletText = bulletMatch[3];

        paragraphs.push(new Paragraph({
          bullet: { level },
          children: [
            new TextRun({
              text: bulletText,
              font: fontName,
              size: fontSize,
            }),
          ],
          spacing: { after: 72, line: 276 },
        }));
      } else {
        currentNormalLines.push(rawLine);
      }
    }

    flushNormalLines();

    // Fallback nếu chuỗi truyền vào hoàn toàn rỗng
    if (paragraphs.length === 0) {
      paragraphs.push(new Paragraph({
        children: [new TextRun({ text: '', font: fontName, size: fontSize })],
        spacing: { after: 120 },
      }));
    }

    const doc = new Document({
      styles: {
        default: {
          document: {
            run: {
              font: fontName,
              size: fontSize,
            },
            paragraph: {
              spacing: { line: 276, after: 120 },
            },
          },
        },
      },
      sections: [{
        properties: {},
        children: paragraphs,
      }],
    });

    const b64 = await Packer.toBase64String(doc);
    const safeName = sanitizeFileName(rawFileName || `Document_${Math.floor(Date.now() / 1000)}`);
    return await saveBase64ToDocuments(b64, `${safeName}.docx`);
  }

  /**
   * Tạo tài liệu Microsoft Word (.docx) từ chuỗi văn bản (Alias tương thích ngược)
   */
  public static async exportToWord(text: string, rawFileName?: string): Promise<string> {
    return this.exportToDocx(text, rawFileName);
  }

  /**
   * Tạo bảng tính Microsoft Excel (.xlsx) từ dữ liệu mảng hoặc chuỗi văn bản
   * Xử lý đúng encoding UTF-8 tiếng Việt, tự động căn chỉnh độ rộng cột (auto-fit column width)
   * dựa theo độ dài chuỗi dài nhất trong từng cột.
   */
  public static async exportToXlsx(
    data: string | (string | number | boolean | null | undefined)[][],
    rawFileName?: string
  ): Promise<string> {
    const XLSX = require('xlsx');

    let rows: (string | number | boolean)[][];

    if (Array.isArray(data)) {
      rows = data.map(row =>
        (row || []).map(cell => {
          if (cell === null || cell === undefined) return '';
          if (typeof cell === 'string') return cell.normalize('NFC');
          return cell;
        })
      );
    } else {
      // Chuẩn hóa chuỗi văn bản đầu vào: loại bỏ BOM UTF-8, chuẩn hóa Unicode NFC dựng sẵn
      const cleanData = (data || '')
        .replace(/^\uFEFF/, '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .normalize('NFC');
      const lines = cleanData.split('\n').filter(l => l.trim().length > 0);

      // Nhận diện định dạng bảng Markdown nếu có (| col1 | col2 |)
      const isMarkdownTable = lines.some(l => /^\|(.+)\|$/.test(l.trim()));

      if (isMarkdownTable) {
        // Loại bỏ dòng ngăn cách tiêu đề Markdown như |---|:---|
        rows = lines
          .filter(l => !/^\|(\s*[-:]+[-| :]*)\|?$/.test(l.trim()))
          .map(l => {
            if (/^\|(.+)\|$/.test(l.trim())) {
              return l.trim().slice(1, -1).split('|').map(c => c.trim());
            }
            return [l.trim()];
          });
      } else {
        rows = lines.map(line => {
          if (line.includes('\t')) return line.split('\t').map(c => c.trim());
          if (line.includes(',') && !line.includes('  ')) return line.split(',').map(c => c.trim());
          if (/\s{2,}/.test(line)) return line.split(/\s{2,}/).map(c => c.trim());
          return [line.trim()];
        });
      }
    }

    if (rows.length === 0) {
      rows = [['Nội dung văn bản']];
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);

    // Tự động căn chỉnh độ rộng cột (auto-fit column width) dựa theo độ dài chuỗi dài nhất trong từng cột
    const numCols = rows.reduce((max, r) => Math.max(max, r ? r.length : 0), 0);
    const colWidths: { wch: number }[] = [];

    for (let colIdx = 0; colIdx < numCols; colIdx++) {
      let maxLength = 0;
      for (const row of rows) {
        if (row && row[colIdx] !== undefined && row[colIdx] !== null) {
          const cellStr = String(row[colIdx]).normalize('NFC');
          // Nếu trong ô có ngắt dòng (\n), tính theo độ dài của dòng dài nhất
          const cellLines = cellStr.split(/\r?\n/);
          for (const line of cellLines) {
            if (line.length > maxLength) {
              maxLength = line.length;
            }
          }
        }
      }
      // Thêm padding 3 ký tự để ô thoáng đẹp và không bị che khuất viền, tối thiểu 10 ký tự
      const autoWidth = Math.max(maxLength + 3, 10);
      colWidths.push({ wch: autoWidth });
    }

    ws['!cols'] = colWidths;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'DuLieu');

    const wbout = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
    const safeName = sanitizeFileName(rawFileName || `Spreadsheet_${Math.floor(Date.now() / 1000)}`);
    return await saveBase64ToDocuments(wbout, `${safeName}.xlsx`);
  }

  /**
   * Tạo bảng tính Microsoft Excel (.xlsx) từ dữ liệu mảng 2 chiều hoặc văn bản (Alias tương thích ngược)
   */
  public static async exportToExcel(
    data: string | (string | number | boolean | null | undefined)[][],
    rawFileName?: string
  ): Promise<string> {
    return this.exportToXlsx(data, rawFileName);
  }
}

export default OfficeExportService;
