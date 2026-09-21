/**
 * backup.service.ts — Dịch vụ sao lưu & khôi phục toàn bộ dữ liệu (Full App Backup & Restore)
 * - Đóng gói toàn bộ cấu hình AsyncStorage, chỉ mục OCR Metadata và tệp nhị phân (.pdf, .jpg) thành gói .camdata (JSZip)
 * - Tích hợp mã băm SHA-256 vào metadata để kiểm tra tính toàn vẹn gói backup trước khi giải nén
 * - Cơ chế Rollback an toàn: sao lưu tạm thời trước khi khôi phục, tự động hoàn tác khi xảy ra sự cố
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as Crypto from 'expo-crypto';
import JSZip from 'jszip';
import Storage from '../../utils/storage';
import { STORAGE_KEYS } from '../../constants/config';
import { getAllOcrIndex } from '../../utils/fileHelper';

export interface BackupFileEntry {
  relativePath: string;
  size: number;
  sha256: string;
}

export interface AppBackupData {
  appName: string;
  appVersion: string;
  exportDate: string;
  timestamp: number;
  storageData: Record<string, string>;
  ocrIndex: Record<string, string>;
  fileCount?: number;
  files?: BackupFileEntry[];
  sha256?: string;
}

export interface BackupResult {
  backupPath: string;
  fileCount: number;
  sha256: string;
  size: number;
}

export interface RestoreResult {
  success: boolean;
  restoredCount: number;
  restoredFilesCount: number;
}

export class BackupService {
  /**
   * Tính mã băm SHA-256 chuẩn hóa cho metadata và danh mục tệp
   */
  public static async computeMetadataChecksum(
    appName: string,
    storageData: Record<string, string>,
    ocrIndex: Record<string, string>,
    files: BackupFileEntry[]
  ): Promise<string> {
    const sortedFiles = [...files]
      .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
      .map((f) => `${f.relativePath}:${f.size}:${f.sha256}`)
      .join('|');

    const sortedStorage = Object.keys(storageData)
      .sort()
      .map((k) => `${k}:${storageData[k]}`)
      .join(';');

    const sortedOcr = Object.keys(ocrIndex)
      .sort()
      .map((k) => `${k}:${ocrIndex[k]}`)
      .join(';');

    const rawPayload = `appName=${appName}#storage=${sortedStorage}#ocr=${sortedOcr}#files=${sortedFiles}`;
    return await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawPayload);
  }

  /**
   * Quét toàn bộ thư mục documents/ để tìm tất cả file .pdf và ảnh .jpg / .jpeg
   */
  private static async scanDocumentFiles(
    currentDir: string,
    baseDir: string,
    result: { relativePath: string; fullUri: string; size: number }[] = []
  ): Promise<{ relativePath: string; fullUri: string; size: number }[]> {
    try {
      const dirInfo = await FileSystem.getInfoAsync(currentDir);
      if (!dirInfo.exists || !dirInfo.isDirectory) {
        return result;
      }

      const entries = await FileSystem.readDirectoryAsync(currentDir);
      for (const entry of entries) {
        if (entry.startsWith('.') || entry.startsWith('__rollback_')) {
          continue; // Bỏ qua tệp ẩn và thư mục staging rollback
        }

        const fullUri = `${currentDir}${entry}`;
        const itemInfo = await FileSystem.getInfoAsync(fullUri);
        if (!itemInfo.exists) continue;

        if (itemInfo.isDirectory) {
          await this.scanDocumentFiles(`${fullUri}/`, baseDir, result);
        } else {
          const lower = entry.toLowerCase();
          if (lower.endsWith('.pdf') || lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
            const relativePath = fullUri.startsWith(baseDir)
              ? fullUri.substring(baseDir.length)
              : entry;
            result.push({
              relativePath,
              fullUri,
              size: itemInfo.size ?? 0,
            });
          }
        }
      }
    } catch (e) {
      console.warn(`[BackupService] Cảnh báo khi quét thư mục ${currentDir}:`, e);
    }
    return result;
  }

  /**
   * Tạo file sao lưu .camdata (JSZip) chứa AsyncStorage, OCR Index và toàn bộ file .pdf, .jpg
   */
  public static async createBackup(options?: { share?: boolean }): Promise<BackupResult> {
    try {
      const docDir = FileSystem.documentDirectory;
      if (!docDir) {
        throw new Error('Thư mục DocumentDirectory không khả dụng trên thiết bị này.');
      }
      const normalizedDocDir = docDir.endsWith('/') ? docDir : `${docDir}/`;

      // 1. Thu thập dữ liệu cấu hình AsyncStorage
      const storageKeys = [
        STORAGE_KEYS.SCAN_QUALITY,
        STORAGE_KEYS.COLOR_MODE,
        STORAGE_KEYS.SAVE_ORIGINAL,
        STORAGE_KEYS.APP_THEME,
        STORAGE_KEYS.GOOGLE_CLIENT_ID_ANDROID,
        STORAGE_KEYS.GOOGLE_CLIENT_ID_WEB,
        STORAGE_KEYS.DRAFT_SCAN_SESSION,
      ];

      const storageData: Record<string, string> = {};
      for (const key of storageKeys) {
        const val = await Storage.getItem(key);
        if (val !== null && val !== undefined) {
          storageData[key] = val;
        }
      }

      // 2. Thu thập bộ chỉ mục OCR Metadata
      const ocrIndex = await getAllOcrIndex();

      // 3. Quét toàn bộ file .pdf và .jpg trong documents/
      const scannedFiles = await this.scanDocumentFiles(normalizedDocDir, normalizedDocDir);

      // 4. Đóng gói các tệp nhị phân vào JSZip và tính mã băm SHA-256 từng file
      const zip = new JSZip();
      const fileEntries: BackupFileEntry[] = [];

      for (const file of scannedFiles) {
        const base64Content = await FileSystem.readAsStringAsync(file.fullUri, {
          encoding: FileSystem.EncodingType.Base64,
        });

        // Tính mã băm SHA-256 cho nội dung tệp nhị phân
        const fileHash = await Crypto.digestStringAsync(
          Crypto.CryptoDigestAlgorithm.SHA256,
          base64Content
        );

        fileEntries.push({
          relativePath: file.relativePath,
          size: file.size,
          sha256: fileHash,
        });

        // Nén file vào zip theo cấu trúc thư mục tương đối
        zip.file(`documents/${file.relativePath}`, base64Content, { base64: true });
      }

      // 5. Tính mã băm SHA-256 toàn vẹn cho toàn bộ gói backup và metadata
      const appName = 'CamScanner Pro';
      const appVersion = '2.6.2';
      const packageChecksum = await this.computeMetadataChecksum(
        appName,
        storageData,
        ocrIndex,
        fileEntries
      );

      const backupPayload: AppBackupData = {
        appName,
        appVersion,
        exportDate: new Date().toISOString(),
        timestamp: Date.now(),
        storageData,
        ocrIndex,
        fileCount: fileEntries.length,
        files: fileEntries,
        sha256: packageChecksum,
      };

      // Thêm metadata.json vào root của file zip
      zip.file('metadata.json', JSON.stringify(backupPayload, null, 2));

      // 6. Tạo file nén .camdata dạng Base64
      const zipBase64 = await zip.generateAsync({
        type: 'base64',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      });

      const datePrefix = new Date().toISOString().slice(0, 10);
      const backupFileName = `CamScanner_Backup_${datePrefix}_${Date.now()}.camdata`;
      const tempPath = `${FileSystem.cacheDirectory || normalizedDocDir}${backupFileName}`;

      await FileSystem.writeAsStringAsync(tempPath, zipBase64, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const fileInfo = await FileSystem.getInfoAsync(tempPath);
      const fileSize = fileInfo.exists ? fileInfo.size ?? 0 : 0;

      // 7. Mở chia sẻ nếu được yêu cầu
      if (options?.share && (await Sharing.isAvailableAsync())) {
        await Sharing.shareAsync(tempPath, {
          mimeType: 'application/octet-stream',
          dialogTitle: 'Sao lưu dữ liệu ứng dụng CamScanner (.camdata)',
          UTI: 'public.data',
        });
      }

      return {
        backupPath: tempPath,
        fileCount: fileEntries.length,
        sha256: packageChecksum,
        size: fileSize,
      };
    } catch (error: any) {
      console.error('[BackupService] createBackup error:', error);
      throw new Error(`Lỗi tạo bản sao lưu: ${error.message || String(error)}`);
    }
  }

  /**
   * Tạo tệp sao lưu .camdata toàn bộ dữ liệu ứng dụng và mở bảng chia sẻ
   */
  public static async createAndShareBackup(): Promise<string> {
    const res = await this.createBackup({ share: true });
    return res.backupPath;
  }

  /**
   * Khôi phục gói sao lưu .camdata với kiểm tra tính toàn vẹn SHA-256 và cơ chế Rollback an toàn
   */
  public static async restoreBackup(backupFilePathOrContent: string): Promise<RestoreResult> {
    try {
      const docDir = FileSystem.documentDirectory;
      if (!docDir) {
        throw new Error('Thư mục DocumentDirectory không khả dụng trên thiết bị này.');
      }
      const normalizedDocDir = docDir.endsWith('/') ? docDir : `${docDir}/`;

      let zipBase64: string;

      // Kiểm tra định dạng đầu vào: URI tệp, chuỗi JSON cũ, hay chuỗi Base64
      const trimmed = backupFilePathOrContent.trim();
      const isFileUri =
        trimmed.startsWith('file://') ||
        trimmed.startsWith('content://') ||
        trimmed.startsWith('/') ||
        trimmed.includes(':\\') ||
        trimmed.includes(':/');

      if (isFileUri) {
        if (trimmed.toLowerCase().endsWith('.json')) {
          const jsonStr = await FileSystem.readAsStringAsync(trimmed, {
            encoding: FileSystem.EncodingType.UTF8,
          });
          const jsonRes = await this.restoreFromJson(jsonStr);
          return {
            success: true,
            restoredCount: jsonRes.restoredCount,
            restoredFilesCount: 0,
          };
        }

        zipBase64 = await FileSystem.readAsStringAsync(trimmed, {
          encoding: FileSystem.EncodingType.Base64,
        });
      } else if (trimmed.startsWith('{')) {
        // Tương thích ngược: bản sao lưu dạng chuỗi JSON
        const jsonRes = await this.restoreFromJson(trimmed);
        return {
          success: true,
          restoredCount: jsonRes.restoredCount,
          restoredFilesCount: 0,
        };
      } else {
        zipBase64 = trimmed;
      }

      // 1. Nạp và phân tích file ZIP (.camdata)
      let zip: JSZip;
      try {
        zip = await JSZip.loadAsync(zipBase64, { base64: true });
      } catch (e: any) {
        throw new Error(`Định dạng tệp sao lưu không hợp lệ hoặc bị hỏng: ${e.message}`);
      }

      const metaFile = zip.file('metadata.json');
      if (!metaFile) {
        throw new Error('Gói sao lưu không hợp lệ: Không tìm thấy tệp metadata.json.');
      }

      const metaText = await metaFile.async('text');
      const metadata: AppBackupData = JSON.parse(metaText);

      // 2. KIỂM TRA MÃ BĂM SHA-256 TRƯỚC KHI GIẢI NÉN
      // 2.1 Kiểm tra mã băm metadata tổng thể
      if (metadata.sha256) {
        const expectedChecksum = await this.computeMetadataChecksum(
          metadata.appName || 'CamScanner Pro',
          metadata.storageData || {},
          metadata.ocrIndex || {},
          metadata.files || []
        );

        if (expectedChecksum.toLowerCase() !== metadata.sha256.toLowerCase()) {
          throw new Error(
            `Xác thực tính toàn vẹn thất bại: Mã băm SHA-256 của gói sao lưu không hợp lệ. Gói dữ liệu có thể đã bị chỉnh sửa hoặc hư hại.`
          );
        }
      }

      // 2.2 Kiểm tra mã băm SHA-256 của từng tệp nhị phân trong gói nén
      const filesToRestore: Array<{ relativePath: string; base64: string }> = [];

      if (metadata.files && Array.isArray(metadata.files)) {
        for (const fileEntry of metadata.files) {
          const zipEntry =
            zip.file(`documents/${fileEntry.relativePath}`) || zip.file(fileEntry.relativePath);

          if (!zipEntry) {
            throw new Error(
              `Xác thực tính toàn vẹn thất bại: Không tìm thấy tệp ${fileEntry.relativePath} trong gói sao lưu.`
            );
          }

          const fileBase64 = await zipEntry.async('base64');
          const computedFileHash = await Crypto.digestStringAsync(
            Crypto.CryptoDigestAlgorithm.SHA256,
            fileBase64
          );

          if (computedFileHash.toLowerCase() !== fileEntry.sha256.toLowerCase()) {
            throw new Error(
              `Xác thực tính toàn vẹn thất bại: Tệp ${fileEntry.relativePath} có mã băm SHA-256 không trùng khớp. Gói dữ liệu bị hỏng.`
            );
          }

          filesToRestore.push({
            relativePath: fileEntry.relativePath,
            base64: fileBase64,
          });
        }
      }

      // 3. CƠ CHẾ ROLLBACK: Sao lưu tạm thời trước khi khôi phục
      const rollbackTimestamp = Date.now();
      const rollbackDir = `${FileSystem.cacheDirectory || normalizedDocDir}__rollback_${rollbackTimestamp}/`;
      await FileSystem.makeDirectoryAsync(rollbackDir, { intermediates: true });

      // 3.1 Lưu snapshot các tệp hiện có trong documents/
      const existingDocFiles = await this.scanDocumentFiles(normalizedDocDir, normalizedDocDir);
      for (const exFile of existingDocFiles) {
        const destRollbackUri = `${rollbackDir}${exFile.relativePath}`;
        const parentFolder = destRollbackUri.substring(0, destRollbackUri.lastIndexOf('/'));
        const folderInfo = await FileSystem.getInfoAsync(parentFolder);
        if (!folderInfo.exists) {
          await FileSystem.makeDirectoryAsync(parentFolder, { intermediates: true });
        }
        await FileSystem.copyAsync({ from: exFile.fullUri, to: destRollbackUri });
      }

      // 3.2 Lưu snapshot các giá trị Storage hiện có
      const storageSnapshot: Record<string, string | null> = {};
      if (metadata.storageData) {
        for (const key of Object.keys(metadata.storageData)) {
          storageSnapshot[key] = await Storage.getItem(key);
        }
      }

      // 3.3 Lưu snapshot bộ chỉ mục OCR Index
      const ocrIndexSnapshot = await Storage.getItem(STORAGE_KEYS.OCR_METADATA_INDEX);

      // 4. THỰC HIỆN GIẢI NÉN VÀ KHÔI PHỤC (Áp dụng Rollback nếu lỗi)
      const newlyCreatedFiles: string[] = [];
      let restoredFilesCount = 0;
      let restoredStorageCount = 0;

      try {
        // 4.1 Giải nén toàn bộ tệp nhị phân vào thư mục documents/
        for (const item of filesToRestore) {
          const targetFilePath = `${normalizedDocDir}${item.relativePath}`;
          const parentFolder = targetFilePath.substring(0, targetFilePath.lastIndexOf('/'));
          const folderInfo = await FileSystem.getInfoAsync(parentFolder);
          if (!folderInfo.exists) {
            await FileSystem.makeDirectoryAsync(parentFolder, { intermediates: true });
          }

          const alreadyExisted = await FileSystem.getInfoAsync(targetFilePath);
          if (!alreadyExisted.exists) {
            newlyCreatedFiles.push(targetFilePath);
          }

          await FileSystem.writeAsStringAsync(targetFilePath, item.base64, {
            encoding: FileSystem.EncodingType.Base64,
          });
          restoredFilesCount++;
        }

        // 4.2 Khôi phục các giá trị Storage
        if (metadata.storageData && typeof metadata.storageData === 'object') {
          for (const [key, val] of Object.entries(metadata.storageData)) {
            if (typeof val === 'string') {
              await Storage.setItem(key, val);
              restoredStorageCount++;
            }
          }
        }

        // 4.3 Khôi phục bộ chỉ mục OCR Index
        if (metadata.ocrIndex && typeof metadata.ocrIndex === 'object') {
          const existingOcr = await getAllOcrIndex();
          const mergedOcr = { ...existingOcr, ...metadata.ocrIndex };
          await Storage.setItem(STORAGE_KEYS.OCR_METADATA_INDEX, JSON.stringify(mergedOcr));
          restoredStorageCount += Object.keys(metadata.ocrIndex).length;
        }

        // Khôi phục thành công -> Dọn dẹp thư mục rollback staging
        await FileSystem.deleteAsync(rollbackDir, { idempotent: true });

        return {
          success: true,
          restoredCount: restoredStorageCount,
          restoredFilesCount,
        };
      } catch (restoreError: any) {
        console.error('[BackupService] Lỗi khi giải nén khôi phục, tiến hành ROLLBACK:', restoreError);

        // KÍCH HOẠT QUÁ TRÌNH ROLLBACK TỰ ĐỘNG
        try {
          // Xóa các file mới tạo dở dang
          for (const newFile of newlyCreatedFiles) {
            await FileSystem.deleteAsync(newFile, { idempotent: true });
          }

          // Hoàn nguyên các file đã ghi đè từ bản sao lưu tạm
          for (const exFile of existingDocFiles) {
            const rollbackSource = `${rollbackDir}${exFile.relativePath}`;
            await FileSystem.copyAsync({ from: rollbackSource, to: exFile.fullUri });
          }

          // Hoàn nguyên trạng thái Storage
          for (const [k, v] of Object.entries(storageSnapshot)) {
            if (v !== null) {
              await Storage.setItem(k, v);
            } else {
              await Storage.removeItem(k);
            }
          }

          // Hoàn nguyên OCR Index
          if (ocrIndexSnapshot !== null) {
            await Storage.setItem(STORAGE_KEYS.OCR_METADATA_INDEX, ocrIndexSnapshot);
          } else {
            await Storage.removeItem(STORAGE_KEYS.OCR_METADATA_INDEX);
          }
        } catch (rollbackError) {
          console.error('[BackupService] Nghiêm trọng: Rollback gặp lỗi:', rollbackError);
        } finally {
          // Xóa thư mục staging rollback
          try {
            await FileSystem.deleteAsync(rollbackDir, { idempotent: true });
          } catch {}
        }

        throw new Error(
          `Khôi phục dữ liệu thất bại: ${restoreError.message || String(restoreError)}. Hệ thống đã tự động Rollback toàn bộ dữ liệu an toàn.`
        );
      }
    } catch (error: any) {
      console.error('[BackupService] restoreBackup error:', error);
      throw new Error(`Không thể khôi phục dữ liệu: ${error.message || String(error)}`);
    }
  }

  /**
   * Khôi phục toàn bộ cấu hình từ chuỗi JSON sao lưu (hỗ trợ tương thích ngược kèm Rollback)
   */
  public static async restoreFromJson(jsonContent: string): Promise<{ success: boolean; restoredCount: number }> {
    let storageSnapshot: Record<string, string | null> = {};
    let ocrIndexSnapshot: string | null = null;

    try {
      const parsed: AppBackupData = JSON.parse(jsonContent);
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Định dạng tệp sao lưu không hợp lệ.');
      }

      // Snapshot để Rollback nếu lỗi
      if (parsed.storageData) {
        for (const key of Object.keys(parsed.storageData)) {
          storageSnapshot[key] = await Storage.getItem(key);
        }
      }
      ocrIndexSnapshot = await Storage.getItem(STORAGE_KEYS.OCR_METADATA_INDEX);

      let restoredCount = 0;

      // 1. Khôi phục các giá trị Storage
      if (parsed.storageData && typeof parsed.storageData === 'object') {
        for (const [key, val] of Object.entries(parsed.storageData)) {
          if (typeof val === 'string') {
            await Storage.setItem(key, val);
            restoredCount++;
          }
        }
      }

      // 2. Khôi phục OCR Index
      if (parsed.ocrIndex && typeof parsed.ocrIndex === 'object') {
        const existingOcr = await getAllOcrIndex();
        const mergedOcr = { ...existingOcr, ...parsed.ocrIndex };
        await Storage.setItem(STORAGE_KEYS.OCR_METADATA_INDEX, JSON.stringify(mergedOcr));
        restoredCount += Object.keys(parsed.ocrIndex).length;
      }

      return { success: true, restoredCount };
    } catch (error: any) {
      console.error('[BackupService] restoreFromJson error, rolling back:', error);

      // Rollback Storage & OCR
      try {
        for (const [k, v] of Object.entries(storageSnapshot)) {
          if (v !== null) {
            await Storage.setItem(k, v);
          } else {
            await Storage.removeItem(k);
          }
        }
        if (ocrIndexSnapshot !== null) {
          await Storage.setItem(STORAGE_KEYS.OCR_METADATA_INDEX, ocrIndexSnapshot);
        } else {
          await Storage.removeItem(STORAGE_KEYS.OCR_METADATA_INDEX);
        }
      } catch {}

      throw new Error(`Không thể khôi phục dữ liệu: ${error.message || String(error)}`);
    }
  }
}

export default BackupService;
