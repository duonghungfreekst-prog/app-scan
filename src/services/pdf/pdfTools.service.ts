/**
 * pdfTools.service.ts — Các tiện ích xử lý PDF On-Device
 * - Bố cục Thẻ ID 2 mặt (Mặt trước + Mặt sau)
 * - Tách trang sách đôi (Book Double Page Splitter)
 * - Gộp nhiều file PDF (PDF Merge) bằng TypedArray buffer
 * - Tách file PDF theo dải trang (PDF Splitter)
 * - Đóng dấu bản quyền mờ chéo (PDF Watermark)
 * - Tự động đánh số trang (PDF Page Numbering)
 * - Nén giảm dung lượng file PDF (PDF Compression)
 * - Đặt mật khẩu bảo vệ tài liệu PDF (PDF Password Encryption)
 */

import * as Print from 'expo-print';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import {
  PDFDocument,
  rgb,
  degrees,
  StandardFonts,
  PDFName,
  PDFNumber,
  PDFHexString,
  PDFString,
  PDFDict,
  PDFArray,
  PDFRawStream,
} from 'pdf-lib';
import { toByteArray, fromByteArray } from 'base64-js';
import {
  savePdfToDocuments,
  sanitizeFileName,
  getDocumentDirectory,
  getUniqueFilePath,
} from '../../utils/fileHelper';
import { IMAGE_PROCESSING_CONFIG } from '../../constants/config';

/**
 * Phân giải URI hoặc tên file thành đường dẫn file đầy đủ
 */
function resolvePdfPath(uriOrName: string): string {
  if (uriOrName.startsWith('file://') || uriOrName.startsWith('/')) {
    return uriOrName;
  }
  const docDir = getDocumentDirectory();
  return `${docDir}${uriOrName}`;
}

/**
 * Trích xuất tên gốc của file (không kèm đuôi .pdf) từ đường dẫn hoặc URI
 */
function getBaseNameFromUri(uri: string, fallback: string = 'Document'): string {
  const cleanUri = uri.split('?')[0];
  const parts = cleanUri.split(/[/|\\]/);
  const last = parts[parts.length - 1];
  if (!last) return fallback;
  return last.replace(/\.pdf$/i, '') || fallback;
}

/**
 * Chuẩn hóa ký tự Unicode tiếng Việt sang ký tự không dấu (ASCII/WinAnsi)
 * để tránh lỗi mã hóa "WinAnsi cannot encode" của StandardFonts trong pdf-lib
 */
function toSafePdfText(str: string): string {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

/**
 * Đọc dữ liệu file PDF thành TypedArray (Uint8Array) trực tiếp:
 * Ưu tiên File API native của Expo để tránh nạp chuỗi Base64 khổng lồ vào JS heap.
 */
async function readPdfBytes(uri: string): Promise<Uint8Array> {
  const path = resolvePdfPath(uri);
  try {
    const { File } = require('expo-file-system');
    if (File) {
      const file = new File(path);
      const bytes = await file.bytes();
      if (bytes && bytes.length > 0) {
        return bytes;
      }
    }
  } catch {
    // Chuyển sang fallback nếu File API không khả dụng
  }

  const base64 = await FileSystem.readAsStringAsync(path, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return toByteArray(base64);
}

/**
 * Ghi TypedArray (Uint8Array) trực tiếp xuống đĩa:
 * Ưu tiên File API native của Expo, fallback sang FileSystem legacy
 */
async function writePdfBytes(uri: string, bytes: Uint8Array): Promise<void> {
  try {
    const { File } = require('expo-file-system');
    if (File) {
      const file = new File(uri);
      file.write(bytes);
      return;
    }
  } catch {
    // Chuyển sang fallback nếu File API không khả dụng
  }

  const base64 = fromByteArray(bytes);
  await FileSystem.writeAsStringAsync(uri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });
}

/**
 * Phân tích chuỗi dải trang (ví dụ: '1-3', '4,5', '1-2, 4-6') thành danh sách trang (1-based)
 */
function parsePageRange(
  rangeStr: string,
  totalPages: number
): { start: number; end: number; pages: number[] } {
  if (!rangeStr || typeof rangeStr !== 'string') {
    throw new Error('Dải trang không được để trống.');
  }

  const trimmed = rangeStr.trim();
  if (!trimmed) {
    throw new Error('Dải trang không được để trống.');
  }

  const parts = trimmed.split(',');
  const pageSet = new Set<number>();

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
    if (end > totalPages) {
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

  return {
    start: pages[0],
    end: pages[pages.length - 1],
    pages,
  };
}

/**
 * Chuỗi đệm 32-byte tiêu chuẩn theo đặc tả ISO 32000-1 (PDF Reference 1.7 - Section 3.5.2)
 */
const PDF_ENCRYPTION_PADDING = new Uint8Array([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41,
  0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80,
  0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

/**
 * Hàm băm MD5 thuần túy cho Uint8Array theo RFC 1321
 * Đảm bảo tính toán đồng bộ, tương thích 100% trên React Native (iOS/Android) và Web
 */
function md5Bytes(bytes: Uint8Array): Uint8Array {
  function safeAdd(x: number, y: number): number {
    const lsw = (x & 0xffff) + (y & 0xffff);
    const msw = (x >> 16) + (y >> 16) + (lsw >> 16);
    return (msw << 16) | (lsw & 0xffff);
  }
  function bitRol(num: number, cnt: number): number {
    return (num << cnt) | (num >>> (32 - cnt));
  }
  function md5cmn(q: number, a: number, b: number, x: number, s: number, t: number): number {
    return safeAdd(bitRol(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b);
  }
  function md5ff(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
    return md5cmn((b & c) | (~b & d), a, b, x, s, t);
  }
  function md5gg(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
    return md5cmn((b & d) | (c & ~d), a, b, x, s, t);
  }
  function md5hh(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
    return md5cmn(b ^ c ^ d, a, b, x, s, t);
  }
  function md5ii(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
    return md5cmn(c ^ (b | ~d), a, b, x, s, t);
  }

  const nblk = ((bytes.length + 8) >> 6) + 1;
  const blks = new Int32Array(nblk * 16);
  for (let i = 0; i < bytes.length; i++) {
    blks[i >> 2] |= bytes[i] << ((i % 4) * 8);
  }
  blks[bytes.length >> 2] |= 0x80 << ((bytes.length % 4) * 8);
  blks[nblk * 16 - 2] = bytes.length * 8;

  let a = 1732584193;
  let b = -271733879;
  let c = -1732584194;
  let d = 271733878;

  for (let i = 0; i < blks.length; i += 16) {
    const olda = a;
    const oldb = b;
    const oldc = c;
    const oldd = d;

    a = md5ff(a, b, c, d, blks[i], 7, -680876936);
    d = md5ff(d, a, b, c, blks[i + 1], 12, -389564586);
    c = md5ff(c, d, a, b, blks[i + 2], 17, 606105819);
    b = md5ff(b, c, d, a, blks[i + 3], 22, -1044525330);
    a = md5ff(a, b, c, d, blks[i + 4], 7, -176418897);
    d = md5ff(d, a, b, c, blks[i + 5], 12, 1200080426);
    c = md5ff(c, d, a, b, blks[i + 6], 17, -1473231341);
    b = md5ff(b, c, d, a, blks[i + 7], 22, -45705983);
    a = md5ff(a, b, c, d, blks[i + 8], 7, 1770035416);
    d = md5ff(d, a, b, c, blks[i + 9], 12, -1958414417);
    c = md5ff(c, d, a, b, blks[i + 10], 17, -42063);
    b = md5ff(b, c, d, a, blks[i + 11], 22, -1990404162);
    a = md5ff(a, b, c, d, blks[i + 12], 7, 1804603682);
    d = md5ff(d, a, b, c, blks[i + 13], 12, -40341101);
    c = md5ff(c, d, a, b, blks[i + 14], 17, -1502002290);
    b = md5ff(b, c, d, a, blks[i + 15], 22, 1236535329);

    a = md5gg(a, b, c, d, blks[i + 1], 5, -165796510);
    d = md5gg(d, a, b, c, blks[i + 6], 9, -1069501632);
    c = md5gg(c, d, a, b, blks[i + 11], 14, 643717713);
    b = md5gg(b, c, d, a, blks[i], 20, -373897302);
    a = md5gg(a, b, c, d, blks[i + 5], 5, -701558691);
    d = md5gg(d, a, b, c, blks[i + 10], 9, 38016083);
    c = md5gg(c, d, a, b, blks[i + 15], 14, -660478335);
    b = md5gg(b, c, d, a, blks[i + 4], 20, -405537848);
    a = md5gg(a, b, c, d, blks[i + 9], 5, 568446438);
    d = md5gg(d, a, b, c, blks[i + 14], 9, -1019803690);
    c = md5gg(c, d, a, b, blks[i + 3], 14, -187363961);
    b = md5gg(b, c, d, a, blks[i + 8], 20, 1163531501);
    a = md5gg(a, b, c, d, blks[i + 13], 5, -1444681467);
    d = md5gg(d, a, b, c, blks[i + 2], 9, -51403784);
    c = md5gg(c, d, a, b, blks[i + 7], 14, 1735328473);
    b = md5gg(b, c, d, a, blks[i + 12], 20, -1926607734);

    a = md5hh(a, b, c, d, blks[i + 5], 4, -378558);
    d = md5hh(d, a, b, c, blks[i + 8], 11, -2022574463);
    c = md5hh(c, d, a, b, blks[i + 11], 16, 1839030562);
    b = md5hh(b, c, d, a, blks[i + 14], 23, -35309556);
    a = md5hh(a, b, c, d, blks[i + 1], 4, -1530992060);
    d = md5hh(d, a, b, c, blks[i + 4], 11, 1272893353);
    c = md5hh(c, d, a, b, blks[i + 7], 16, -155497632);
    b = md5hh(b, c, d, a, blks[i + 10], 23, -1094730640);
    a = md5hh(a, b, c, d, blks[i + 13], 4, 681279174);
    d = md5hh(d, a, b, c, blks[i], 11, -358537222);
    c = md5hh(c, d, a, b, blks[i + 3], 16, -722521979);
    b = md5hh(b, c, d, a, blks[i + 6], 23, 76029189);
    a = md5hh(a, b, c, d, blks[i + 9], 4, -640364487);
    d = md5hh(d, a, b, c, blks[i + 12], 11, -421815835);
    c = md5hh(c, d, a, b, blks[i + 15], 16, 530742520);
    b = md5hh(b, c, d, a, blks[i + 2], 23, -995338651);

    a = md5ii(a, b, c, d, blks[i], 6, -198630844);
    d = md5ii(d, a, b, c, blks[i + 7], 10, 1126891415);
    c = md5ii(c, d, a, b, blks[i + 14], 15, -1416354905);
    b = md5ii(b, c, d, a, blks[i + 5], 21, -57434055);
    a = md5ii(a, b, c, d, blks[i + 12], 6, 1700485571);
    d = md5ii(d, a, b, c, blks[i + 3], 10, -1894986606);
    c = md5ii(c, d, a, b, blks[i + 10], 15, -1051523);
    b = md5ii(b, c, d, a, blks[i + 1], 21, -2054922799);
    a = md5ii(a, b, c, d, blks[i + 8], 6, 1873313359);
    d = md5ii(d, a, b, c, blks[i + 15], 10, -30611744);
    c = md5ii(c, d, a, b, blks[i + 6], 15, -1560198380);
    b = md5ii(b, c, d, a, blks[i + 13], 21, 1309151649);
    a = md5ii(a, b, c, d, blks[i + 4], 6, -145523070);
    d = md5ii(d, a, b, c, blks[i + 11], 10, -1120210379);
    c = md5ii(c, d, a, b, blks[i + 2], 15, 718787259);
    b = md5ii(b, c, d, a, blks[i + 9], 21, -343485551);

    a = safeAdd(a, olda);
    b = safeAdd(b, oldb);
    c = safeAdd(c, oldc);
    d = safeAdd(d, oldd);
  }

  const result = new Uint8Array(16);
  const words = [a, b, c, d];
  for (let i = 0; i < 4; i++) {
    const w = words[i];
    result[i * 4] = w & 0xff;
    result[i * 4 + 1] = (w >> 8) & 0xff;
    result[i * 4 + 2] = (w >> 16) & 0xff;
    result[i * 4 + 3] = (w >> 24) & 0xff;
  }
  return result;
}

/**
 * Thuật toán mã hóa đối xứng ARC4 (RC4) theo ISO 32000-1 Algorithm 3.1
 */
function rc4Bytes(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    s[i] = i;
  }
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 255;
    const tmp = s[i];
    s[i] = s[j];
    s[j] = tmp;
  }
  let i = 0;
  j = 0;
  const out = new Uint8Array(data.length);
  for (let k = 0; k < data.length; k++) {
    i = (i + 1) & 255;
    j = (j + s[i]) & 255;
    const tmp = s[i];
    s[i] = s[j];
    s[j] = tmp;
    out[k] = data[k] ^ s[(s[i] + s[j]) & 255];
  }
  return out;
}

/**
 * Đệm hoặc cắt chuỗi mật khẩu thành đúng 32 bytes sử dụng PDF_ENCRYPTION_PADDING
 */
function padPasswordBytes(pwd: string): Uint8Array {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(pwd);
  const padded = new Uint8Array(32);
  if (bytes.length >= 32) {
    padded.set(bytes.subarray(0, 32));
  } else {
    padded.set(bytes);
    padded.set(
      PDF_ENCRYPTION_PADDING.subarray(0, 32 - bytes.length),
      bytes.length
    );
  }
  return padded;
}

/**
 * Ghép nhiều mảng Uint8Array thành một mảng liên tục
 */
function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((acc, a) => acc + a.length, 0);
  const out = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    out.set(arr, offset);
    offset += arr.length;
  }
  return out;
}

/**
 * Chuyển đổi Uint8Array sang chuỗi Hexadecimal chữ thường
 */
function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Tính toán giá trị O (Owner Hash) theo ISO 32000-1 Algorithm 3.3 (Revision 3)
 */
function computePdfOwnerHash(
  userPassword: string,
  ownerPassword: string,
  keyLength: number = 16
): Uint8Array {
  const paddedOwner = padPasswordBytes(ownerPassword);
  let hash = md5Bytes(paddedOwner);
  for (let i = 0; i < 50; i++) {
    hash = md5Bytes(hash.subarray(0, keyLength));
  }
  const ownerKey = hash.subarray(0, keyLength);

  let enc = rc4Bytes(ownerKey, padPasswordBytes(userPassword));
  for (let i = 1; i <= 19; i++) {
    const tempKey = new Uint8Array(keyLength);
    for (let j = 0; j < keyLength; j++) {
      tempKey[j] = ownerKey[j] ^ i;
    }
    enc = rc4Bytes(tempKey, enc);
  }
  return enc;
}

/**
 * Tính toán Khóa mã hóa tập tin (File Encryption Key) theo ISO 32000-1 Algorithm 3.2 (Revision 3)
 */
function computePdfEncryptionKey(
  userPassword: string,
  O: Uint8Array,
  P: number,
  id0: Uint8Array,
  keyLength: number = 16
): Uint8Array {
  const paddedUser = padPasswordBytes(userPassword);
  const pBytes = new Uint8Array([
    P & 0xff,
    (P >> 8) & 0xff,
    (P >> 16) & 0xff,
    (P >> 24) & 0xff,
  ]);
  const input = concatBytes(paddedUser, O, pBytes, id0);
  let hash = md5Bytes(input);
  for (let i = 0; i < 50; i++) {
    hash = md5Bytes(hash.subarray(0, keyLength));
  }
  return hash.subarray(0, keyLength);
}

/**
 * Tính toán giá trị U (User Hash) theo ISO 32000-1 Algorithm 3.5 (Revision 3)
 */
function computePdfUserHash(
  fileKey: Uint8Array,
  id0: Uint8Array,
  keyLength: number = 16
): Uint8Array {
  const input = concatBytes(PDF_ENCRYPTION_PADDING, id0);
  let hash = md5Bytes(input);
  let enc = rc4Bytes(fileKey, hash);
  for (let i = 1; i <= 19; i++) {
    const tempKey = new Uint8Array(keyLength);
    for (let j = 0; j < keyLength; j++) {
      tempKey[j] = fileKey[j] ^ i;
    }
    enc = rc4Bytes(tempKey, enc);
  }
  return concatBytes(enc, PDF_ENCRYPTION_PADDING.subarray(0, 16));
}

/**
 * Tính toán Khóa mã hóa cho từng Indirect Object theo ISO 32000-1 Algorithm 3.1
 */
function computePdfObjectKey(
  fileKey: Uint8Array,
  objectNumber: number,
  generationNumber: number,
  keyLength: number = 16
): Uint8Array {
  const input = new Uint8Array(keyLength + 5);
  input.set(fileKey, 0);
  input[keyLength] = objectNumber & 0xff;
  input[keyLength + 1] = (objectNumber >> 8) & 0xff;
  input[keyLength + 2] = (objectNumber >> 16) & 0xff;
  input[keyLength + 3] = generationNumber & 0xff;
  input[keyLength + 4] = (generationNumber >> 8) & 0xff;

  const hash = md5Bytes(input);
  return hash.subarray(0, Math.min(16, keyLength + 5));
}

/**
 * Duyệt đệ quy và mã hóa các giá trị chuỗi (PDFString, PDFHexString) bên trong đối tượng PDF
 */
function encryptStringsInPdfObject(obj: any, objKey: Uint8Array): void {
  if (!obj) return;
  if (obj instanceof PDFDict) {
    const entries = obj.entries();
    for (const [key, val] of entries) {
      if (key.asString() === '/Encrypt') continue;
      if (val instanceof PDFString || val instanceof PDFHexString) {
        const encBytes = rc4Bytes(objKey, val.asBytes());
        obj.set(key, PDFHexString.of(bytesToHex(encBytes)));
      } else if (val instanceof PDFDict || val instanceof PDFArray) {
        encryptStringsInPdfObject(val, objKey);
      }
    }
  } else if (obj instanceof PDFArray) {
    const size = obj.size();
    for (let i = 0; i < size; i++) {
      const val = obj.get(i);
      if (val instanceof PDFString || val instanceof PDFHexString) {
        const encBytes = rc4Bytes(objKey, val.asBytes());
        obj.set(i, PDFHexString.of(bytesToHex(encBytes)));
      } else if (val instanceof PDFDict || val instanceof PDFArray) {
        encryptStringsInPdfObject(val, objKey);
      }
    }
  }
}

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
   * Tối ưu hóa bộ nhớ: Dùng TypedArray (Uint8Array) buffer, tránh nạp toàn bộ Base64 vào JS heap
   */
  public static async mergePdfs(
    fileNames: string[],
    rawOutputName: string
  ): Promise<string> {
    const docDir = getDocumentDirectory();
    const mergedDoc = await PDFDocument.create();

    for (const fileName of fileNames) {
      const filePath = resolvePdfPath(fileName);
      const fileBytes = await readPdfBytes(filePath);
      const pdf = await PDFDocument.load(fileBytes);
      const copiedPages = await mergedDoc.copyPages(pdf, pdf.getPageIndices());
      copiedPages.forEach((page) => mergedDoc.addPage(page));
    }

    const mergedBytes = await mergedDoc.save();
    const safeName = sanitizeFileName(rawOutputName || `Merged_${Date.now()}`);
    const tempPath = `${docDir}_tmp_merged_${Date.now()}.pdf`;

    await writePdfBytes(tempPath, mergedBytes);
    return await savePdfToDocuments(tempPath, `${safeName}.pdf`);
  }

  /**
   * Tách file PDF nhiều trang thành các file con theo dải trang (ví dụ: '1-3', '4-5')
   * @param sourceUri Đường dẫn URI hoặc tên file PDF nguồn
   * @param ranges Mảng dải trang cần tách (ví dụ: ['1-3', '4-5'])
   * @returns Danh sách đường dẫn file PDF con đã tạo
   */
  public static async splitPdf(
    sourceUri: string,
    ranges: string[]
  ): Promise<string[]> {
    if (!ranges || ranges.length === 0) {
      throw new Error('Danh sách dải trang (ranges) không được để trống.');
    }

    const docDir = getDocumentDirectory();
    const resolvedSource = resolvePdfPath(sourceUri);
    const fileBytes = await readPdfBytes(resolvedSource);
    const srcDoc = await PDFDocument.load(fileBytes);
    const totalPages = srcDoc.getPageCount();
    const baseName = getBaseNameFromUri(resolvedSource, 'Document');

    const resultUris: string[] = [];

    for (let i = 0; i < ranges.length; i++) {
      const { pages } = parsePageRange(ranges[i], totalPages);

      const subDoc = await PDFDocument.create();
      const pageIndices: number[] = pages.map((p) => p - 1); // Đổi sang 0-based index

      const copiedPages = await subDoc.copyPages(srcDoc, pageIndices);
      copiedPages.forEach((page) => subDoc.addPage(page));

      const subBytes = await subDoc.save();
      const rangeTag = ranges[i].replace(/\s+/g, '').replace(/,/g, '_');
      const subDocName = sanitizeFileName(
        `${baseName}_part${i + 1}_trang_${rangeTag}`
      );
      const tempPath = `${docDir}_tmp_split_${Date.now()}_${i}.pdf`;

      await writePdfBytes(tempPath, subBytes);
      const savedUri = await savePdfToDocuments(tempPath, `${subDocName}.pdf`);
      resultUris.push(savedUri);
    }

    return resultUris;
  }

  /**
   * Đóng dấu bản quyền mờ chéo trên từng trang PDF
   * @param sourceUri Đường dẫn URI hoặc tên file PDF nguồn
   * @param text Nội dung đóng dấu bản quyền
   * @param opacity Độ mờ đục của watermark (0.0 đến 1.0, mặc định 0.3)
   * @returns Đường dẫn URI của file PDF mới đã đóng dấu bản quyền
   */
  public static async addWatermarkToPdf(
    sourceUri: string,
    text: string,
    opacity: number = 0.3
  ): Promise<string> {
    if (!text || text.trim().length === 0) {
      throw new Error('Nội dung watermark không được để trống.');
    }

    const docDir = getDocumentDirectory();
    const resolvedSource = resolvePdfPath(sourceUri);
    const fileBytes = await readPdfBytes(resolvedSource);
    const pdfDoc = await PDFDocument.load(fileBytes);

    const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const safeText = toSafePdfText(text.trim());
    const effectiveOpacity = Math.max(0.01, Math.min(1.0, opacity ?? 0.3));
    const pages = pdfDoc.getPages();

    for (const page of pages) {
      const { width, height } = page.getSize();
      // Kích thước font chữ tự động điều chỉnh theo kích thước trang
      const estimatedFontSize = Math.min(width, height) / 8;
      const fontSize = Math.max(16, Math.min(estimatedFontSize, 54));
      const textWidth = font.widthOfTextAtSize(safeText, fontSize);
      const textHeight = font.heightAtSize(fontSize);

      // Đặt góc xoay chéo 45 độ từ góc dưới trái lên góc trên phải
      const angleInDegrees = 45;
      const angleInRadians = (angleInDegrees * Math.PI) / 180;
      const cos = Math.cos(angleInRadians);
      const sin = Math.sin(angleInRadians);

      // Tọa độ để tâm dòng chữ trùng với tâm trang giấy khi xoay 45 độ
      const x = width / 2 - (textWidth / 2) * cos + (textHeight / 2) * sin;
      const y = height / 2 - (textWidth / 2) * sin - (textHeight / 2) * cos;

      page.drawText(safeText, {
        x,
        y,
        size: fontSize,
        font,
        color: rgb(0.65, 0.65, 0.65),
        opacity: effectiveOpacity,
        rotate: degrees(angleInDegrees),
      });
    }

    const outputBytes = await pdfDoc.save();
    const baseName = getBaseNameFromUri(resolvedSource, 'Document');
    const safeName = sanitizeFileName(`${baseName}_watermark`);
    const tempPath = `${docDir}_tmp_wm_${Date.now()}.pdf`;

    await writePdfBytes(tempPath, outputBytes);
    return await savePdfToDocuments(tempPath, `${safeName}.pdf`);
  }

  /**
   * Tự động đánh số trang (Trang X/Y) ở chân trang PDF
   * @param sourceUri Đường dẫn URI hoặc tên file PDF nguồn
   * @returns Đường dẫn URI của file PDF mới đã đánh số trang
   */
  public static async addPageNumbersToPdf(
    sourceUri: string
  ): Promise<string> {
    const docDir = getDocumentDirectory();
    const resolvedSource = resolvePdfPath(sourceUri);
    const fileBytes = await readPdfBytes(resolvedSource);
    const pdfDoc = await PDFDocument.load(fileBytes);

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const totalPages = pdfDoc.getPageCount();
    const pages = pdfDoc.getPages();
    const fontSize = 10;

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const pageNumberText = `Trang ${i + 1}/${totalPages}`;
      const textWidth = font.widthOfTextAtSize(pageNumberText, fontSize);
      const { width } = page.getSize();

      // Căn giữa chân trang, cách đáy 22pt
      const x = (width - textWidth) / 2;
      const y = 22;

      page.drawText(pageNumberText, {
        x,
        y,
        size: fontSize,
        font,
        color: rgb(0.3, 0.3, 0.3),
      });
    }

    const outputBytes = await pdfDoc.save();
    const baseName = getBaseNameFromUri(resolvedSource, 'Document');
    const safeName = sanitizeFileName(`${baseName}_numbered`);
    const tempPath = `${docDir}_tmp_num_${Date.now()}.pdf`;

    await writePdfBytes(tempPath, outputBytes);
    return await savePdfToDocuments(tempPath, `${safeName}.pdf`);
  }

  /**
   * Nén giảm dung lượng file PDF bằng cách tối ưu hóa cấu trúc Object Streams,
   * tái nén hình ảnh (DCTDecode/JPEG) theo mức chất lượng và ghi trực tiếp vào thư mục documents/.
   *
   * @param sourceUri Đường dẫn URI hoặc tên file PDF nguồn
   * @param quality Mức độ nén ('low': nén tối đa | 'medium': cân bằng | 'high': chất lượng cao)
   * @returns Đường dẫn URI của file PDF đã nén trong thư mục documents/
   */
  public static async compressPdf(
    sourceUri: string,
    quality: 'low' | 'medium' | 'high' = 'medium'
  ): Promise<string> {
    const resolvedSource = resolvePdfPath(sourceUri);
    const fileInfo = await FileSystem.getInfoAsync(resolvedSource);
    if (!fileInfo.exists) {
      throw new Error(`Tệp PDF nguồn không tồn tại: ${resolvedSource}`);
    }

    const fileBytes = await readPdfBytes(resolvedSource);
    const pdfDoc = await PDFDocument.load(fileBytes, { ignoreEncryption: true });

    const qualityMap: Record<'low' | 'medium' | 'high', { maxWidth: number; compress: number }> = {
      low: {
        maxWidth: IMAGE_PROCESSING_CONFIG.QUALITY.low.width,
        compress: IMAGE_PROCESSING_CONFIG.QUALITY.low.compress,
      },
      medium: {
        maxWidth: IMAGE_PROCESSING_CONFIG.QUALITY.medium.width,
        compress: IMAGE_PROCESSING_CONFIG.QUALITY.medium.compress,
      },
      high: {
        maxWidth: IMAGE_PROCESSING_CONFIG.QUALITY.high.width,
        compress: IMAGE_PROCESSING_CONFIG.QUALITY.high.compress,
      },
    };

    const selectedQuality = qualityMap[quality] || qualityMap.medium;
    const objects = pdfDoc.context.enumerateIndirectObjects();

    let imgIdx = 0;
    for (const [ref, obj] of objects) {
      if (!(obj instanceof PDFRawStream)) continue;

      const subtype = obj.dict.get(PDFName.of('Subtype'));
      const isImage = subtype === PDFName.of('Image') || subtype?.toString() === '/Image';
      if (!isImage) continue;

      const filter = obj.dict.get(PDFName.of('Filter'));
      const filterStr = filter ? filter.toString() : '';
      const isJpeg = filterStr.includes('DCTDecode');
      if (!isJpeg) continue;

      const originalBytes = obj.getContents();
      if (!originalBytes || originalBytes.length < 25600) continue;
      // Kiểm tra SOI marker của JPEG (0xFF, 0xD8)
      if (originalBytes[0] !== 0xff || originalBytes[1] !== 0xd8) continue;

      let tempImgPath = '';
      let manipResultUri = '';

      try {
        imgIdx++;
        const cacheDir = FileSystem.cacheDirectory || '';
        tempImgPath = `${cacheDir}pdf_comp_raw_${Date.now()}_${imgIdx}.jpg`;
        await writePdfBytes(tempImgPath, originalBytes);

        let origWidth = 0;
        const widthVal = pdfDoc.context.lookup(obj.dict.get(PDFName.of('Width')));
        if (widthVal instanceof PDFNumber) {
          origWidth = widthVal.asNumber();
        }

        const actions: ImageManipulator.Action[] = [];
        if (origWidth > selectedQuality.maxWidth) {
          actions.push({ resize: { width: selectedQuality.maxWidth } });
        }

        const manipResult = await ImageManipulator.manipulateAsync(
          tempImgPath,
          actions,
          {
            compress: selectedQuality.compress,
            format: ImageManipulator.SaveFormat.JPEG,
            base64: false,
          }
        );
        manipResultUri = manipResult.uri;

        const compressedImgBytes = await readPdfBytes(manipResultUri);

        // Chỉ thay thế nếu ảnh sau nén thực sự có dung lượng nhỏ hơn ảnh gốc
        if (
          compressedImgBytes &&
          compressedImgBytes.length > 0 &&
          compressedImgBytes.length < originalBytes.length
        ) {
          if (manipResult.width && manipResult.height) {
            obj.dict.set(PDFName.of('Width'), PDFNumber.of(manipResult.width));
            obj.dict.set(PDFName.of('Height'), PDFNumber.of(manipResult.height));
          }
          const newStream = PDFRawStream.of(obj.dict, compressedImgBytes);
          pdfDoc.context.assign(ref, newStream);
        }
      } catch (err) {
        console.warn(`[PdfToolsService] Bỏ qua lỗi nén ảnh số ${imgIdx}:`, err);
      } finally {
        if (tempImgPath) {
          try {
            await FileSystem.deleteAsync(tempImgPath, { idempotent: true });
          } catch {}
        }
        if (manipResultUri) {
          try {
            await FileSystem.deleteAsync(manipResultUri, { idempotent: true });
          } catch {}
        }
      }
    }

    // Tối ưu hóa cấu trúc và đóng gói các Indirect Objects thành Object Streams nén Flate
    const outputBytes = await pdfDoc.save({
      useObjectStreams: true,
      addDefaultPage: false,
    });

    // Tối ưu hóa: Ghi trực tiếp tệp nén vào thư mục documents/, không qua file trung gian
    const docDir = getDocumentDirectory();
    const dirInfo = await FileSystem.getInfoAsync(docDir);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(docDir, { intermediates: true });
    }

    const baseName = getBaseNameFromUri(resolvedSource, 'Document');
    const safeName = sanitizeFileName(`${baseName}_compressed`);
    const targetUri = await getUniqueFilePath(docDir, safeName, '.pdf');

    await writePdfBytes(targetUri, outputBytes);
    return targetUri;
  }

  /**
   * Đặt mật khẩu bảo vệ tài liệu PDF (PDF Standard Encryption Revision 3 - RC4 128-bit)
   * Tuân thủ tiêu chuẩn quốc tế ISO 32000-1, tương thích với tất cả các trình đọc PDF tiêu chuẩn.
   * @param sourceUri Đường dẫn URI hoặc tên file PDF nguồn cần đặt mật khẩu
   * @param userPassword Mật khẩu người dùng để mở và giải mã tài liệu PDF
   * @returns Đường dẫn URI của file PDF đã được bảo vệ trong thư mục documents/
   */
  public static async encryptPdf(
    sourceUri: string,
    userPassword: string
  ): Promise<string> {
    if (!userPassword || typeof userPassword !== 'string' || userPassword.length === 0) {
      throw new Error('Mật khẩu bảo vệ PDF không được để trống.');
    }

    const docDir = getDocumentDirectory();
    const resolvedSource = resolvePdfPath(sourceUri);
    const fileBytes = await readPdfBytes(resolvedSource);

    // Tải tài liệu PDF bằng pdf-lib (sử dụng ignoreEncryption: true để kiểm tra trạng thái)
    const pdfDoc = await PDFDocument.load(fileBytes, { ignoreEncryption: true });
    if (pdfDoc.isEncrypted) {
      throw new Error('Tài liệu PDF này đã được đặt mật khẩu bảo vệ từ trước.');
    }

    // 1. Khởi tạo Document ID cho Trailer nếu chưa có
    let id0: Uint8Array;
    const trailerId = pdfDoc.context.trailerInfo.ID;
    if (trailerId instanceof PDFArray && trailerId.size() > 0) {
      const firstId = trailerId.get(0);
      if (firstId instanceof PDFHexString || firstId instanceof PDFString) {
        id0 = firstId.asBytes();
      } else {
        id0 = new Uint8Array(16);
        for (let i = 0; i < 16; i++) id0[i] = (Math.random() * 256) | 0;
      }
    } else {
      id0 = new Uint8Array(16);
      for (let i = 0; i < 16; i++) id0[i] = (Math.random() * 256) | 0;
      const idHex = bytesToHex(id0);
      pdfDoc.context.trailerInfo.ID = pdfDoc.context.obj([
        PDFHexString.of(idHex),
        PDFHexString.of(idHex),
      ]);
    }

    const keyLength = 16; // 128-bit RC4 key
    const P = -1028; // Permissions flag chuẩn: in ấn, đọc, hỗ trợ thiết bị trợ năng

    // 2. Tính toán giá trị O, File Encryption Key và U theo chuẩn ISO 32000-1
    const O = computePdfOwnerHash(userPassword, userPassword, keyLength);
    const fileKey = computePdfEncryptionKey(userPassword, O, P, id0, keyLength);
    const U = computePdfUserHash(fileKey, id0, keyLength);

    // 3. Khởi tạo và đăng ký từ điển /Encrypt vào Trailer của PDF
    const encryptDict = pdfDoc.context.obj({
      Filter: PDFName.of('Standard'),
      V: PDFNumber.of(2),
      R: PDFNumber.of(3),
      Length: PDFNumber.of(128),
      P: PDFNumber.of(P),
      O: PDFHexString.of(bytesToHex(O)),
      U: PDFHexString.of(bytesToHex(U)),
    });
    const encryptRef = pdfDoc.context.register(encryptDict);
    pdfDoc.context.trailerInfo.Encrypt = encryptRef;

    // 4. Duyệt và mã hóa tất cả các Indirect Objects (Stream data & String literals)
    const indirectObjects = pdfDoc.context.enumerateIndirectObjects();
    for (const [ref, obj] of indirectObjects) {
      if (ref === encryptRef) continue;

      const objKey = computePdfObjectKey(
        fileKey,
        ref.objectNumber,
        ref.generationNumber,
        keyLength
      );

      if (obj instanceof PDFRawStream) {
        const originalContents = obj.getContents();
        const encryptedContents = rc4Bytes(objKey, originalContents);
        (obj as any).contents = encryptedContents;
        obj.dict.set(PDFName.of('Length'), PDFNumber.of(encryptedContents.length));
        encryptStringsInPdfObject(obj.dict, objKey);
      } else {
        encryptStringsInPdfObject(obj, objKey);
      }
    }

    // 5. Lưu tài liệu đã mã hóa (tắt Object Streams để giữ nguyên cấu trúc Indirect Objects đã mã hóa)
    const outputBytes = await pdfDoc.save({
      useObjectStreams: false,
      addDefaultPage: false,
    });

    // 6. Ghi file trực tiếp vào thư mục documents/ và trả về URI
    const dirInfo = await FileSystem.getInfoAsync(docDir);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(docDir, { intermediates: true });
    }

    const baseName = getBaseNameFromUri(resolvedSource, 'Document');
    const safeName = sanitizeFileName(`${baseName}_protected`);
    const targetUri = await getUniqueFilePath(docDir, safeName, '.pdf');

    await writePdfBytes(targetUri, outputBytes);
    return targetUri;
  }
}

export default PdfToolsService;
