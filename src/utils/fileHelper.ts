/**
 * fileHelper.ts — Quản lý file an toàn chuẩn Production
 * - Tên file được sanitize tuyệt đối (chống path traversal, ký tự cấm, Windows reserved words)
 * - Tự động đánh số chống ghi đè (file.pdf -> file (1).pdf)
 * - Phân loại thư mục/tập tin bằng FileSystem.getInfoAsync (isDirectory)
 * - Mô hình DocumentItem chuẩn nghiệp vụ
 */

import * as FileSystem from 'expo-file-system/legacy';
import { DocumentItem } from '../types/domain';

export { DocumentItem };

// Danh sách các tên tập tin cấm trên hệ điều hành Windows
const WINDOWS_RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

/**
 * Chuẩn hóa tên file tuyệt đối an toàn:
 * - Loại bỏ ký tự cấm: / \ : * ? " < > | và mã điều khiển
 * - Loại bỏ path traversal: '..'
 * - Xóa khoảng trắng thừa và dấu chấm ở cuối (Windows không cho phép)
 * - Xử lý tên cấm Windows (CON, PRN, AUX, NUL...)
 * - Giữ trọn vẹn chữ cái tiếng Việt có dấu Unicode
 * - Giới hạn độ dài tối đa 120 ký tự
 */
export function sanitizeFileName(rawName: string, fallbackBase: string = 'TaiLieu'): string {
  if (!rawName) return `${fallbackBase}_${Date.now()}`;

  // 1. Loại bỏ path traversal (..)
  let clean = rawName.replace(/\.{2,}/g, '.');

  // 2. Loại bỏ các ký tự đặc biệt nguy hiểm và điều khiển (ASCII 0-31)
  // Chỉ giữ chữ cái (Unicode), số, dấu gạch dưới, gạch ngang, dấu chấm và khoảng trắng
  clean = clean.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');

  // 3. Chuẩn hóa khoảng trắng và dấu chấm ở đầu/cuối
  clean = clean.replace(/\s+/g, ' ').trim();
  clean = clean.replace(/^\.+/, '').replace(/\.+$/, ''); // Xóa dấu chấm ở đầu và cuối tên

  // 4. Giới hạn độ dài tối đa 120 ký tự
  if (clean.length > 120) {
    clean = clean.substring(0, 120).trim();
  }

  // 5. Kiểm tra nếu rỗng sau khi lọc
  if (!clean) {
    clean = `${fallbackBase}_${Date.now()}`;
  }

  // 6. Kiểm tra Windows Reserved Names (CON, PRN, AUX, NUL, COM1-9, LPT1-9)
  const upper = clean.toUpperCase();
  const baseWithoutExt = upper.split('.')[0];
  if (WINDOWS_RESERVED_NAMES.has(baseWithoutExt)) {
    clean = `${clean}_doc`;
  }

  return clean;
}

/**
 * Trả về thư mục Document lưu trữ vĩnh viễn của app.
 * Ném lỗi rõ ràng nếu môi trường không cung cấp, tuyệt đối KHÔNG fallback sang cache.
 */
export function getDocumentDirectory(): string {
  const dir = FileSystem.documentDirectory;
  if (!dir) {
    throw new Error('Lỗi lưu trữ: Thư mục DocumentDirectory không khả dụng trên thiết bị này.');
  }
  return dir.endsWith('/') ? dir : dir + '/';
}

/**
 * Di chuyển file an toàn: copy sang đích rồi xóa nguồn.
 * Tránh lỗi cross-partition trên Android OS.
 */
export async function safeMoveFile(from: string, to: string): Promise<void> {
  await FileSystem.copyAsync({ from, to });
  try {
    await FileSystem.deleteAsync(from, { idempotent: true });
  } catch (e) {
    console.warn('[FileHelper] Warning deleting temporary source file:', e);
  }
}

/**
 * Tìm tên file duy nhất chưa bị trùng trong thư mục (vd: file.pdf -> file (1).pdf)
 */
export async function getUniqueFilePath(dir: string, baseName: string, ext: string): Promise<string> {
  const cleanBase = sanitizeFileName(baseName, 'TaiLieu');
  const formattedExt = ext ? (ext.startsWith('.') ? ext : `.${ext}`) : '';
  
  let targetUri = `${dir}${cleanBase}${formattedExt}`;
  let counter = 1;

  while (true) {
    const info = await FileSystem.getInfoAsync(targetUri);
    if (!info.exists) {
      return targetUri;
    }
    targetUri = `${dir}${cleanBase} (${counter})${formattedExt}`;
    counter++;
  }
}

/**
 * Lưu file PDF từ Print.printToFileAsync vào documentDirectory (tự động chống ghi đè).
 */
export async function savePdfToDocuments(
  tempUri: string,
  rawName: string,
  subDir: string = ''
): Promise<string> {
  const root = getDocumentDirectory();
  const dir = subDir ? `${root}${subDir}/` : root;
  
  // Đảm bảo thư mục đích tồn tại
  const dirInfo = await FileSystem.getInfoAsync(dir);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }

  const baseName = rawName.replace(/\.pdf$/i, '');
  const targetUri = await getUniqueFilePath(dir, baseName, '.pdf');
  await safeMoveFile(tempUri, targetUri);
  return targetUri;
}

/**
 * Lưu dữ liệu base64 ra file trong documentDirectory (tự động chống ghi đè).
 */
export async function saveBase64ToDocuments(
  base64Data: string,
  fileName: string,
  subDir: string = ''
): Promise<string> {
  const root = getDocumentDirectory();
  const dir = subDir ? `${root}${subDir}/` : root;

  // Đảm bảo thư mục đích tồn tại
  const dirInfo = await FileSystem.getInfoAsync(dir);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }

  const lastDot = fileName.lastIndexOf('.');
  const baseName = lastDot !== -1 ? fileName.substring(0, lastDot) : fileName;
  const ext = lastDot !== -1 ? fileName.substring(lastDot) : '';

  const targetUri = await getUniqueFilePath(dir, baseName, ext);
  await FileSystem.writeAsStringAsync(targetUri, base64Data, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return targetUri;
}

/**
 * Copy file từ ngoài vào documentDirectory an toàn (tự động chống ghi đè).
 */
export async function copyFileToDocuments(
  sourceUri: string,
  fileName: string,
  subDir: string = ''
): Promise<string> {
  const root = getDocumentDirectory();
  const dir = subDir ? `${root}${subDir}/` : root;

  // Đảm bảo thư mục đích tồn tại
  const dirInfo = await FileSystem.getInfoAsync(dir);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }

  const lastDot = fileName.lastIndexOf('.');
  const baseName = lastDot !== -1 ? fileName.substring(0, lastDot) : fileName;
  const ext = lastDot !== -1 ? fileName.substring(lastDot) : '';

  const targetUri = await getUniqueFilePath(dir, baseName, ext);
  await FileSystem.copyAsync({ from: sourceUri, to: targetUri });
  return targetUri;
}

export const DEFAULT_SUPPORTED_EXTENSIONS = ['.pdf', '.docx', '.xlsx', '.jpg', '.jpeg', '.png', '.txt'];

/**
 * Đọc toàn bộ danh sách tập tin và thư mục kèm metadata chi tiết
 */
export async function listDocumentItems(
  subDir: string = '',
  supportedExts: string[] = DEFAULT_SUPPORTED_EXTENSIONS
): Promise<DocumentItem[]> {
  try {
    const root = getDocumentDirectory();
    const targetDir = subDir ? `${root}${subDir}/` : root;

    const dirInfo = await FileSystem.getInfoAsync(targetDir);
    if (!dirInfo.exists) {
      return [];
    }

    const fileNames = await FileSystem.readDirectoryAsync(targetDir);
    const items: DocumentItem[] = [];

    for (const name of fileNames) {
      if (name.startsWith('.')) continue; // Bỏ qua file ẩn

      const fileUri = `${targetDir}${name}`;
      try {
        const info = await FileSystem.getInfoAsync(fileUri);
        if (!info.exists) continue;

        const isDirectory = !!info.isDirectory;
        const lastDot = name.lastIndexOf('.');
        const ext = lastDot !== -1 ? name.substring(lastDot).toLowerCase() : '';

        // Nếu là thư mục hoặc là file thuộc extension được hỗ trợ
        if (isDirectory || supportedExts.includes(ext) || supportedExts.length === 0) {
          items.push({
            id: fileUri,
            name,
            uri: fileUri,
            isDirectory,
            size: info.size ?? 0,
            modificationTime: (info as any).modificationTime ?? Date.now(),
            extension: ext,
          });
        }
      } catch (e) {
        console.warn(`[FileHelper] Error getting info for ${name}:`, e);
      }
    }

    // Sắp xếp: Thư mục lên trước, sau đó sắp xếp theo thời gian sửa đổi mới nhất
    return items.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return b.modificationTime - a.modificationTime;
    });
  } catch (error) {
    console.error('[FileHelper] Error listing document items:', error);
    return [];
  }
}

/**
 * Hàm tương thích ngược với code cũ: trả về mảng string tên file
 */
export async function listDocumentFiles(
  extensions: string[] = DEFAULT_SUPPORTED_EXTENSIONS
): Promise<string[]> {
  const items = await listDocumentItems('', extensions);
  return items.map(item => item.name);
}
