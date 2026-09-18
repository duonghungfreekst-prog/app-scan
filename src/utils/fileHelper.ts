/**
 * fileHelper.ts — Quản lý file an toàn chuẩn Production
 * - Không fallback sang cacheDirectory (chống mất dữ liệu người dùng)
 * - Tự động đánh số tránh ghi đè file cũ
 * - Phân loại thư mục/tập tin bằng FileSystem.getInfoAsync (isDirectory)
 * - Cung cấp model DocumentItem hoàn chỉnh
 */

import * as FileSystem from 'expo-file-system/legacy';

export interface DocumentItem {
  id: string;
  name: string;
  uri: string;
  isDirectory: boolean;
  size: number;
  modificationTime: number;
  extension: string;
}

/**
 * Trả về thư mục Document lưu trữ vĩnh viễn của app.
 * Ném lỗi rõ ràng nếu môi trường không cung cấp, tuyệt đối KHÔNG fallback sang cache.
 */
export function getDocumentDirectory(): string {
  const fs = FileSystem as any;
  const dir = fs.documentDirectory;
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
  let cleanName = baseName.replace(/[^\p{L}\p{N}_\-\s]/gu, '_').trim();
  if (!cleanName) cleanName = 'TaiLieu_' + Date.now();

  const formattedExt = ext.startsWith('.') ? ext : `.${ext}`;
  let targetUri = `${dir}${cleanName}${formattedExt}`;
  let counter = 1;

  while (true) {
    const info = await FileSystem.getInfoAsync(targetUri);
    if (!info.exists) {
      return targetUri;
    }
    targetUri = `${dir}${cleanName} (${counter})${formattedExt}`;
    counter++;
  }
}

/**
 * Lưu file PDF từ Print.printToFileAsync vào documentDirectory (tự động chống ghi đè).
 */
export async function savePdfToDocuments(
  tempUri: string,
  safeName: string,
  subDir: string = ''
): Promise<string> {
  const root = getDocumentDirectory();
  const dir = subDir ? `${root}${subDir}/` : root;
  
  // Đảm bảo thư mục đích tồn tại
  const dirInfo = await FileSystem.getInfoAsync(dir);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }

  const cleanBaseName = safeName.replace(/\.pdf$/i, '');
  const targetUri = await getUniqueFilePath(dir, cleanBaseName, '.pdf');
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
 * Copy file từ ngoài vào documentDirectory an toàn.
 */
export async function copyFileToDocuments(
  sourceUri: string,
  fileName: string,
  subDir: string = ''
): Promise<string> {
  const root = getDocumentDirectory();
  const dir = subDir ? `${root}${subDir}/` : root;

  const lastDot = fileName.lastIndexOf('.');
  const baseName = lastDot !== -1 ? fileName.substring(0, lastDot) : fileName;
  const ext = lastDot !== -1 ? fileName.substring(lastDot) : '';

  const targetUri = await getUniqueFilePath(dir, baseName, ext);
  await FileSystem.copyAsync({ from: sourceUri, to: targetUri });
  return targetUri;
}

/**
 * Đọc toàn bộ danh sách tập tin và thư mục kèm metadata chi tiết
 */
export async function listDocumentItems(
  subDir: string = '',
  supportedExts: string[] = ['.pdf', '.docx', '.xlsx']
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
 * Hàm tương thích ngược với code cũ: trả về mảng string tên file/folder
 */
export async function listDocumentFiles(
  extensions: string[] = ['.pdf', '.docx', '.xlsx']
): Promise<string[]> {
  const items = await listDocumentItems('', extensions);
  return items.map(item => item.name);
}
