/**
 * officeExport.service.ts — Dịch vụ chuyển đổi văn bản sang Word (.docx) và Excel (.xlsx)
 * Hoạt động 100% On-Device sử dụng thư viện docx và xlsx native JS.
 */

import { saveBase64ToDocuments, sanitizeFileName } from '../../utils/fileHelper';

export class OfficeExportService {
  /**
   * Tạo tài liệu Microsoft Word (.docx) từ chuỗi văn bản
   */
  public static async exportToWord(text: string, rawFileName?: string): Promise<string> {
    const { Document, Packer, Paragraph, TextRun } = require('docx');
    
    const lines = text ? text.split('\n') : [''];
    const doc = new Document({
      sections: [{
        properties: {},
        children: lines.map(line => new Paragraph({
          children: [new TextRun({ text: line, size: 24, font: 'Calibri' })],
          spacing: { after: 120 },
        })),
      }],
    });

    const b64 = await Packer.toBase64String(doc);
    const safeName = sanitizeFileName(rawFileName || `Document_${Math.floor(Date.now() / 1000)}`);
    return await saveBase64ToDocuments(b64, `${safeName}.docx`);
  }

  /**
   * Tạo bảng tính Microsoft Excel (.xlsx) từ dữ liệu mảng 2 chiều hoặc văn bản
   */
  public static async exportToExcel(data: string | string[][], rawFileName?: string): Promise<string> {
    const XLSX = require('xlsx');

    let rows: string[][];
    if (Array.isArray(data)) {
      rows = data;
    } else {
      const lines = data ? data.split('\n').filter(l => l.trim().length > 0) : [];
      rows = lines.map(line => {
        if (line.includes('\t')) return line.split('\t');
        if (line.includes(',') && !line.includes('  ')) return line.split(',');
        if (/\s{2,}/.test(line)) return line.split(/\s{2,}/);
        return [line.trim()];
      });
    }

    const ws = XLSX.utils.aoa_to_sheet(rows.length > 0 ? rows : [['Nội dung văn bản']]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'DuLieu');

    const wbout = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
    const safeName = sanitizeFileName(rawFileName || `Spreadsheet_${Math.floor(Date.now() / 1000)}`);
    return await saveBase64ToDocuments(wbout, `${safeName}.xlsx`);
  }
}

export default OfficeExportService;
