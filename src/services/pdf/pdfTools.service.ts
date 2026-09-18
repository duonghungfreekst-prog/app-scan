/**
 * pdfTools.service.ts — Các tiện ích xử lý PDF On-Device
 * - Bố cục Thẻ ID 2 mặt (Mặt trước + Mặt sau)
 * - Tách trang sách đôi (Book Double Page Splitter)
 * - Gộp nhiều file PDF (PDF Merge) qua pdf-lib
 */

import * as Print from 'expo-print';
import * as FileSystem from 'expo-file-system/legacy';
import { savePdfToDocuments, sanitizeFileName, getDocumentDirectory } from '../../utils/fileHelper';

export class PdfToolsService {
  /**
   * Tạo PDF thẻ ID (CCCD / Bằng lái xe) chứa cả 2 mặt trên cùng một trang chuẩn A4
   */
  public static async createIdCardPdf(
    frontUri: string,
    backUri: string,
    rawDocName: string
  ): Promise<string> {
    const html = `<!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8"/>
          <style>
            @page { margin: 0; size: 2480px 3508px; }
            body { margin: 0; padding: 0; background: white; font-family: sans-serif; }
            .card-section {
              width: 2480px;
              height: 1754px;
              display: flex;
              flex-direction: column;
              justify-content: center;
              align-items: center;
              background: white;
              border-bottom: 2px dashed #ddd;
            }
            .card-section:last-child {
              border-bottom: none;
            }
            .card-img {
              width: 1560px;
              height: 980px;
              object-fit: contain;
              border: 3px solid #bbb;
              border-radius: 28px;
              box-shadow: 0 4px 16px rgba(0,0,0,0.08);
            }
            .card-label {
              font-size: 42px;
              color: #555;
              font-weight: 600;
              margin-top: 20px;
            }
          </style>
        </head>
        <body>
          <div class="card-section">
            <img class="card-img" src="${frontUri}" />
            <div class="card-label">Mặt trước (Front)</div>
          </div>
          <div class="card-section">
            <img class="card-img" src="${backUri}" />
            <div class="card-label">Mặt sau (Back)</div>
          </div>
        </body>
      </html>`;

    const { uri } = await Print.printToFileAsync({ html, width: 595.28, height: 841.89 });
    const safeName = sanitizeFileName(rawDocName || `IDCard_${Date.now()}`);
    return await savePdfToDocuments(uri, `${safeName}.pdf`);
  }

  /**
   * Tách ảnh chụp sách mở đôi thành 2 trang PDF riêng biệt (Trang trái & Trang phải)
   */
  public static async createSplitBookPdf(
    bookUri: string,
    rawDocName: string
  ): Promise<string> {
    const html = `<!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8"/>
          <style>
            @page { margin: 0; size: 2480px 3508px; }
            body { margin: 0; padding: 0; background: white; }
            .page-box {
              width: 2480px;
              height: 3508px;
              overflow: hidden;
              position: relative;
              page-break-after: always;
              display: flex;
              justify-content: center;
              align-items: center;
            }
            .clip-container {
              width: 100%;
              height: 100%;
              overflow: hidden;
              position: relative;
            }
            .page-img-left {
              position: absolute;
              top: 0;
              left: 0;
              width: 200%;
              height: 100%;
              object-fit: fill;
            }
            .page-img-right {
              position: absolute;
              top: 0;
              left: -100%;
              width: 200%;
              height: 100%;
              object-fit: fill;
            }
          </style>
        </head>
        <body>
          <!-- Trang 1: Nửa bên trái -->
          <div class="page-box">
            <div class="clip-container">
              <img class="page-img-left" src="${bookUri}" />
            </div>
          </div>
          <!-- Trang 2: Nửa bên phải -->
          <div class="page-box">
            <div class="clip-container">
              <img class="page-img-right" src="${bookUri}" />
            </div>
          </div>
        </body>
      </html>`;

    const { uri } = await Print.printToFileAsync({ html, width: 595.28, height: 841.89 });
    const safeName = sanitizeFileName(rawDocName || `Book_${Date.now()}`);
    return await savePdfToDocuments(uri, `${safeName}.pdf`);
  }

  /**
   * Gộp 2 hoặc nhiều tập tin PDF thành một tập tin duy nhất
   */
  public static async mergePdfs(
    fileNames: string[],
    rawOutputName: string
  ): Promise<string> {
    const { PDFDocument } = require('pdf-lib');
    const docDir = getDocumentDirectory();
    const mergedDoc = await PDFDocument.create();

    for (const fileName of fileNames) {
      const filePath = docDir + fileName;
      const fileBytes = await FileSystem.readAsStringAsync(filePath, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const pdf = await PDFDocument.load(fileBytes);
      const copiedPages = await mergedDoc.copyPages(pdf, pdf.getPageIndices());
      copiedPages.forEach((page: any) => mergedDoc.addPage(page));
    }

    const mergedBase64 = await mergedDoc.saveAsBase64();
    const safeName = sanitizeFileName(rawOutputName || `Merged_${Date.now()}`);
    const tempPath = `${docDir}_tmp_merged_${Date.now()}.pdf`;

    await FileSystem.writeAsStringAsync(tempPath, mergedBase64, {
      encoding: FileSystem.EncodingType.Base64,
    });

    return await savePdfToDocuments(tempPath, `${safeName}.pdf`);
  }
}

export default PdfToolsService;
