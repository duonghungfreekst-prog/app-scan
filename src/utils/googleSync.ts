import * as FileSystem from 'expo-file-system/legacy';
import Storage from './storage';
import SecureStorage from '../core/security/secureStorage';
import { STORAGE_KEYS } from '../constants/config';

// Client IDs mặc định — người dùng có thể cấu hình Client ID riêng trong màn hình Cài đặt
export const GOOGLE_CLIENT_ID_ANDROID = 'YOUR_ANDROID_CLIENT_ID.apps.googleusercontent.com';
export const GOOGLE_CLIENT_ID_WEB = 'YOUR_WEB_CLIENT_ID.apps.googleusercontent.com';

// Khóa lưu trữ bảo mật cho OAuth Token trong SecureStore
export const SECURE_TOKEN_KEYS = {
  REFRESH_TOKEN: '@camscanner_google_refresh_token',
  ACCESS_TOKEN: '@camscanner_google_access_token',
  TOKEN_EXPIRES_AT: '@camscanner_google_token_expires_at',
} as const;

/**
 * Lấy Client ID hiện tại (ưu tiên Client ID người dùng đã lưu trong Storage)
 */
export const getGoogleClientId = async (): Promise<{ android: string; web: string }> => {
  try {
    const savedAndroid = await Storage.getItem(STORAGE_KEYS.GOOGLE_CLIENT_ID_ANDROID);
    const savedWeb = await Storage.getItem(STORAGE_KEYS.GOOGLE_CLIENT_ID_WEB);
    return {
      android: (savedAndroid && savedAndroid.trim()) || GOOGLE_CLIENT_ID_ANDROID,
      web: (savedWeb && savedWeb.trim()) || GOOGLE_CLIENT_ID_WEB,
    };
  } catch {
    return { android: GOOGLE_CLIENT_ID_ANDROID, web: GOOGLE_CLIENT_ID_WEB };
  }
};

/**
 * Lưu Client ID cấu hình bởi người dùng
 */
export const saveGoogleClientId = async (android: string, web: string): Promise<void> => {
  if (android && android.trim()) {
    await Storage.setItem(STORAGE_KEYS.GOOGLE_CLIENT_ID_ANDROID, android.trim());
  } else {
    await Storage.removeItem(STORAGE_KEYS.GOOGLE_CLIENT_ID_ANDROID);
  }

  if (web && web.trim()) {
    await Storage.setItem(STORAGE_KEYS.GOOGLE_CLIENT_ID_WEB, web.trim());
  } else {
    await Storage.removeItem(STORAGE_KEYS.GOOGLE_CLIENT_ID_WEB);
  }
};

/**
 * Kiểm tra xem Google Client ID đã được cấu hình hợp lệ hay chưa
 */
export const checkGoogleConfigured = async (): Promise<boolean> => {
  const { android } = await getGoogleClientId();
  return !android.includes('YOUR_') && android.trim().length > 0;
};

export const isGoogleConfigured =
  !GOOGLE_CLIENT_ID_ANDROID.includes('YOUR_') &&
  !GOOGLE_CLIENT_ID_WEB.includes('YOUR_');

/**
 * Scope truy cập:
 * - drive.appdata: Lưu trữ riêng tư trong thư mục ứng dụng (appDataFolder), không làm rác Drive cá nhân
 * - drive.file: Thao tác tệp do ứng dụng tạo
 * - photoslibrary.appendonly: Tải ảnh vào Google Photos
 */
const SCOPES = [
  'https://www.googleapis.com/auth/drive.appdata',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/photoslibrary.appendonly',
].join(' ');

/**
 * Tự động gia hạn Access Token bằng Refresh Token đã lưu trong SecureStore
 */
export const refreshGoogleAccessToken = async (): Promise<string | null> => {
  try {
    const refreshToken = await SecureStorage.getItem(SECURE_TOKEN_KEYS.REFRESH_TOKEN);
    if (!refreshToken) return null;

    const { android: clientIdAndroid } = await getGoogleClientId();

    const bodyParams = new URLSearchParams({
      client_id: clientIdAndroid,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString();

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: bodyParams,
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      console.warn('[SYNC] Gia hạn token thất bại:', err);
      // Nếu refresh token không hợp lệ hoặc bị thu hồi (400, 401), dọn dẹp SecureStore
      if (response.status === 400 || response.status === 401) {
        await clearGoogleAuth();
      }
      return null;
    }

    const data = await response.json();
    const newAccessToken = data.access_token;
    const expiresIn = data.expires_in || 3600;
    // Giảm 5 phút (300 giây) để tránh race condition khi token cận giờ hết hạn
    const expiresAt = Date.now() + (expiresIn - 300) * 1000;

    await SecureStorage.setItem(SECURE_TOKEN_KEYS.ACCESS_TOKEN, newAccessToken);
    await SecureStorage.setItem(SECURE_TOKEN_KEYS.TOKEN_EXPIRES_AT, expiresAt.toString());

    if (data.refresh_token) {
      await SecureStorage.setItem(SECURE_TOKEN_KEYS.REFRESH_TOKEN, data.refresh_token);
    }

    return newAccessToken;
  } catch (e) {
    console.error('[SYNC] Lỗi khi tự động làm mới access token:', e);
    return null;
  }
};

/**
 * Xóa thông tin đăng nhập và tokens Google đã lưu trong SecureStore
 */
export const clearGoogleAuth = async (): Promise<void> => {
  try {
    await SecureStorage.removeItem(SECURE_TOKEN_KEYS.ACCESS_TOKEN);
    await SecureStorage.removeItem(SECURE_TOKEN_KEYS.REFRESH_TOKEN);
    await SecureStorage.removeItem(SECURE_TOKEN_KEYS.TOKEN_EXPIRES_AT);
  } catch (e) {
    console.warn('[SYNC] Không thể xóa token trong SecureStore:', e);
  }
};

/**
 * Mở OAuth2 Google hoặc tự động lấy lại Access Token từ SecureStore
 * Quản lý Refresh Token an toàn, tự động gia hạn khi Access Token hết hạn 1 giờ
 */
export const signInWithGoogle = async (forcePrompt: boolean = false): Promise<string | null> => {
  const isConfigured = await checkGoogleConfigured();
  const { android: clientIdAndroid } = await getGoogleClientId();

  if (!isConfigured) {
    const { Alert } = require('react-native');
    Alert.alert(
      '⚙️ Chưa cấu hình Google Cloud',
      'Tính năng đồng bộ Google Drive & Photos yêu cầu Google OAuth Client ID.\n\nBạn có thể tự thêm Client ID của dự án Google Cloud cá nhân trong màn hình "Cài đặt (Tôi)" để sử dụng ngay.'
    );
    return null;
  }

  // Bước 1: Kiểm tra Access Token hiện có trong SecureStore
  if (!forcePrompt) {
    try {
      const storedAccessToken = await SecureStorage.getItem(SECURE_TOKEN_KEYS.ACCESS_TOKEN);
      const storedExpiresAt = await SecureStorage.getItem(SECURE_TOKEN_KEYS.TOKEN_EXPIRES_AT);

      if (storedAccessToken && storedExpiresAt) {
        const expiresAtNum = Number(storedExpiresAt);
        // Nếu Access Token còn hạn sử dụng
        if (!isNaN(expiresAtNum) && Date.now() < expiresAtNum) {
          return storedAccessToken;
        }
      }

      // Bước 2: Access Token hết hạn -> Tự động dùng Refresh Token gia hạn
      const refreshedToken = await refreshGoogleAccessToken();
      if (refreshedToken) {
        return refreshedToken;
      }
    } catch (e) {
      console.warn('[SYNC] Lỗi kiểm tra token từ SecureStore, chuyển sang đăng nhập tương tác:', e);
    }
  }

  // Bước 3: Đăng nhập tương tác qua WebBrowser (Authorization Code Flow có Refresh Token)
  try {
    const AuthSession = require('expo-auth-session');
    const WebBrowser = require('expo-web-browser');

    const redirectUri = AuthSession.makeRedirectUri({ scheme: 'camscanner' });
    const authUrl =
      `https://accounts.google.com/o/oauth2/v2/auth` +
      `?client_id=${encodeURIComponent(clientIdAndroid)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&response_type=code` +
      `&access_type=offline` +
      `&prompt=consent` +
      `&scope=${encodeURIComponent(SCOPES)}`;

    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri);

    if (result.type === 'success' && result.url) {
      // 1. Trích xuất Authorization Code từ kết quả callback
      const codeMatch = result.url.match(/[?&]code=([^&]+)/);
      if (codeMatch) {
        const code = decodeURIComponent(codeMatch[1]);
        // Trao đổi code lấy access_token và refresh_token
        const tokenParams = new URLSearchParams({
          code,
          client_id: clientIdAndroid,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }).toString();

        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: tokenParams,
        });

        if (tokenRes.ok) {
          const tokenData = await tokenRes.json();
          const accessToken = tokenData.access_token;
          const expiresIn = tokenData.expires_in || 3600;
          const expiresAt = Date.now() + (expiresIn - 300) * 1000;

          await SecureStorage.setItem(SECURE_TOKEN_KEYS.ACCESS_TOKEN, accessToken);
          await SecureStorage.setItem(SECURE_TOKEN_KEYS.TOKEN_EXPIRES_AT, expiresAt.toString());

          if (tokenData.refresh_token) {
            await SecureStorage.setItem(SECURE_TOKEN_KEYS.REFRESH_TOKEN, tokenData.refresh_token);
          }

          return accessToken;
        } else {
          const errData = await tokenRes.json().catch(() => ({}));
          console.error('[SYNC] Lỗi đổi mã code lấy token:', errData);
        }
      }

      // Fallback: Nếu Google trả về access_token trực tiếp
      const tokenMatch = result.url.match(/access_token=([^&]+)/);
      if (tokenMatch) {
        const directToken = decodeURIComponent(tokenMatch[1]);
        const expiresAt = Date.now() + 3300 * 1000;
        await SecureStorage.setItem(SECURE_TOKEN_KEYS.ACCESS_TOKEN, directToken);
        await SecureStorage.setItem(SECURE_TOKEN_KEYS.TOKEN_EXPIRES_AT, expiresAt.toString());
        return directToken;
      }
    }
    return null;
  } catch (e) {
    console.error('[SYNC] signInWithGoogle error:', e);
    return null;
  }
};

/**
 * Tìm file theo tên trong thư mục riêng biệt của ứng dụng (spaces: 'appDataFolder')
 */
export const findFileInAppData = async (
  accessToken: string,
  fileName: string
): Promise<{ id: string; name: string; modifiedTime: string; size?: string; mimeType?: string } | null> => {
  const safeName = fileName.replace(/'/g, "\\'");
  const query = encodeURIComponent(`name = '${safeName}' and trashed = false`);
  const url = `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${query}&fields=files(id,name,modifiedTime,size,mimeType)`;

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    const err: any = new Error(errData.error?.message || `Lỗi tìm kiếm file trên Drive: HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  if (data.files && data.files.length > 0) {
    return data.files[0];
  }
  return null;
};

/**
 * Kết quả kiểm tra xung đột giữa tệp cục bộ và tệp trên Google Drive
 */
export interface ConflictCheckResult {
  hasConflict: boolean;
  status: 'not_found' | 'local_newer' | 'drive_newer' | 'identical';
  localModifiedTime: number;
  driveModifiedTime?: number;
  driveFile?: { id: string; name: string; modifiedTime: string; size?: string; mimeType?: string };
}

/**
 * Cơ chế giải quyết xung đột (Conflict Resolution):
 * So sánh thời gian sửa đổi (lastModified) giữa file local và file trên Google Drive (appDataFolder).
 */
export const checkGoogleDriveConflict = async (
  accessToken: string,
  fileUri: string,
  fileName: string
): Promise<ConflictCheckResult> => {
  const fileInfo = await FileSystem.getInfoAsync(fileUri);
  if (!fileInfo.exists) {
    throw new Error('Tệp cục bộ không tồn tại');
  }

  // modificationTime của expo-file-system có thể ở dạng giây (epoch seconds)
  const rawModTime = (fileInfo as any).modificationTime;
  const localModTimeMs = typeof rawModTime === 'number'
    ? (rawModTime > 1e11 ? rawModTime : rawModTime * 1000)
    : Date.now();

  const driveFile = await findFileInAppData(accessToken, fileName);
  if (!driveFile) {
    return {
      hasConflict: false,
      status: 'not_found',
      localModifiedTime: localModTimeMs,
    };
  }

  const driveModTimeMs = new Date(driveFile.modifiedTime).getTime();
  // Ngưỡng chênh lệch 2000ms để tránh sai số đồng hồ giữa hệ thống tập tin
  const TIME_DIFF_TOLERANCE_MS = 2000;

  if (driveModTimeMs - localModTimeMs > TIME_DIFF_TOLERANCE_MS) {
    // Tệp trên Google Drive mới hơn tệp cục bộ -> Xung đột!
    return {
      hasConflict: true,
      status: 'drive_newer',
      localModifiedTime: localModTimeMs,
      driveModifiedTime: driveModTimeMs,
      driveFile,
    };
  } else if (localModTimeMs - driveModTimeMs > TIME_DIFF_TOLERANCE_MS) {
    // Tệp cục bộ mới hơn tệp trên Google Drive
    return {
      hasConflict: false,
      status: 'local_newer',
      localModifiedTime: localModTimeMs,
      driveModifiedTime: driveModTimeMs,
      driveFile,
    };
  } else {
    // Hai tệp có cùng thời gian sửa đổi
    return {
      hasConflict: false,
      status: 'identical',
      localModifiedTime: localModTimeMs,
      driveModifiedTime: driveModTimeMs,
      driveFile,
    };
  }
};

/**
 * Cấu hình cho cơ chế thử lại (Exponential Backoff)
 */
export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  operationName?: string;
}

/**
 * Kiểm tra xem lỗi có phải là lỗi tạm thời (Transient error) cần thử lại hay không:
 * - Lỗi gián đoạn kết nối mạng (Network error, socket closed, timeout, offline)
 * - Lỗi máy chủ Google Drive: HTTP 500 (Internal Server Error), HTTP 503 (Service Unavailable), HTTP 502, 504, 429
 */
export const isRetryableError = (error: any): boolean => {
  if (!error) return false;

  // Lỗi mạng được đánh dấu
  if (error.isNetworkError) return true;

  // Kiểm tra mã trạng thái HTTP nếu có
  const status = error.status || error.statusCode;
  if (typeof status === 'number') {
    // 500 (Internal Server Error), 503 (Service Unavailable), 502 (Bad Gateway), 504 (Gateway Timeout), 429 (Rate Limit)
    if (status === 500 || status === 503 || status === 502 || status === 504 || status === 429) {
      return true;
    }
    // Các mã lỗi 4xx client thông thường (400 Bad Request, 401 Unauthorized, 403 Forbidden, 404 Not Found) không thử lại
    if (status >= 400 && status < 500) {
      return false;
    }
  }

  // Kiểm tra chuỗi thông báo lỗi
  const message = (error.message || error.toString() || '').toLowerCase();
  return (
    message.includes('500') ||
    message.includes('503') ||
    message.includes('502') ||
    message.includes('504') ||
    message.includes('429') ||
    message.includes('network') ||
    message.includes('failed to fetch') ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('connection') ||
    message.includes('econnreset') ||
    message.includes('econnrefused') ||
    message.includes('socket') ||
    message.includes('offline') ||
    message.includes('gián đoạn')
  );
};

/**
 * Thực thi một tác vụ bất đồng bộ với thuật toán Retry Exponential Backoff kết hợp Full Jitter
 */
export async function executeWithRetry<T>(
  operation: () => Promise<T>,
  options?: RetryOptions
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 3;
  const initialDelayMs = options?.initialDelayMs ?? 1000;
  const maxDelayMs = options?.maxDelayMs ?? 30000;
  const factor = options?.factor ?? 2;
  const opName = options?.operationName ?? 'Tác vụ đám mây';

  let lastError: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;

      // Nếu đã hết lượt thử lại hoặc lỗi không thể phục hồi (không phải lỗi mạng / 500 / 503)
      if (attempt >= maxRetries || !isRetryableError(error)) {
        throw error;
      }

      // Công thức Exponential Backoff với Jitter ngẫu nhiên để chống nghẽn thundering herd
      const baseDelay = initialDelayMs * Math.pow(factor, attempt);
      const jitter = Math.random() * 500;
      const delay = Math.min(maxDelayMs, Math.round(baseDelay + jitter));

      console.warn(
        `[SYNC] ${opName} gặp sự cố (lần thử ${attempt + 1}/${maxRetries}), tự động thử lại sau ${delay}ms do lỗi:`,
        error.message || error
      );

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Dữ liệu báo cáo tiến trình tải lên (upload progress)
 */
export interface UploadProgressInfo {
  loaded: number;
  total: number;
  percent: number;
}

export interface UploadOptions {
  forceUpload?: boolean;
  strategy?: 'newer_only' | 'force_overwrite' | 'skip_if_conflict';
  onProgress?: (progress: UploadProgressInfo) => void;
  maxRetries?: number;
  initialRetryDelayMs?: number;
}

/**
 * Upload hoặc cập nhật file lên Google Drive trong thư mục riêng biệt "spaces: 'appDataFolder'"
 * Sử dụng Resumable Upload (Stream trực tiếp từ đĩa nhị phân)
 * - Tự động thử lại (Retry with Exponential Backoff) khi gặp lỗi mạng hoặc HTTP 500/503
 * - Hỗ trợ báo cáo tiến trình (upload progress callback) cho các file PDF dung lượng lớn
 * - Tích hợp Conflict Resolution: So sánh lastModified trước khi tải lên
 */
export const uploadToGoogleDrive = async (
  accessToken: string,
  fileUri: string,
  mimeType: string,
  fileName: string,
  isDoc: boolean = false,
  options?: UploadOptions,
  onProgressCallback?: (progress: UploadProgressInfo) => void
) => {
  const fileInfo = await FileSystem.getInfoAsync(fileUri);
  if (!fileInfo.exists) throw new Error('File không tồn tại');

  // Kiểm tra xung đột trước khi đồng bộ (với cơ chế Retry nếu mạng bị chập chờn)
  const conflict = await executeWithRetry(
    () => checkGoogleDriveConflict(accessToken, fileUri, fileName),
    {
      maxRetries: options?.maxRetries ?? 3,
      initialDelayMs: options?.initialRetryDelayMs ?? 1000,
      operationName: `Kiểm tra xung đột file "${fileName}"`,
    }
  );

  if (conflict.hasConflict && conflict.status === 'drive_newer' && !options?.forceUpload && options?.strategy !== 'force_overwrite') {
    if (options?.strategy === 'skip_if_conflict') {
      return {
        skipped: true,
        reason: 'drive_newer',
        message: `Tệp "${fileName}" trên Google Drive mới hơn, đã bỏ qua để tránh mất dữ liệu.`,
      };
    }

    const driveDateStr = conflict.driveModifiedTime ? new Date(conflict.driveModifiedTime).toLocaleString() : 'Drive';
    const localDateStr = new Date(conflict.localModifiedTime).toLocaleString();
    throw new Error(
      `Xung đột đồng bộ: Bản trên Google Drive (${driveDateStr}) mới hơn bản trên thiết bị (${localDateStr}). Quá trình tải lên bị tạm dừng để tránh ghi đè dữ liệu mới hơn.`
    );
  }

  const existingDriveFile = conflict.driveFile;
  const isUpdating = !!existingDriveFile;
  const progressCallback = options?.onProgress || onProgressCallback;

  // Thực hiện toàn bộ quy trình Resumable Upload với cơ chế Retry Exponential Backoff
  return await executeWithRetry(
    async () => {
      // Bước 1: Khởi tạo Resumable Upload Session
      // Nếu đã tồn tại file trên Drive: Cập nhật nội dung (PATCH) thay vì tạo file rác trùng tên
      // Nếu chưa có: Tạo mới (POST) và đặt parents: ['appDataFolder'] để cách ly an toàn
      const targetUrl = isUpdating
        ? `https://www.googleapis.com/upload/drive/v3/files/${existingDriveFile.id}?uploadType=resumable`
        : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable';

      const metadata: any = {
        name: fileName,
        mimeType: isDoc ? 'application/vnd.google-apps.document' : mimeType,
      };

      if (!isUpdating) {
        metadata.parents = ['appDataFolder'];
      }

      let sessionRes: Response;
      try {
        sessionRes = await fetch(targetUrl, {
          method: isUpdating ? 'PATCH' : 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json; charset=UTF-8',
            'X-Upload-Content-Type': mimeType,
          },
          body: JSON.stringify(metadata),
        });
      } catch (fetchErr: any) {
        const netErr: any = new Error(
          `Lỗi kết nối mạng khi tạo session tải lên Google Drive: ${fetchErr.message || fetchErr}`
        );
        netErr.isNetworkError = true;
        throw netErr;
      }

      if (!sessionRes.ok) {
        const errData = await sessionRes.json().catch(() => ({}));
        const errorMsg = errData.error?.message || `Lỗi tạo session Google Drive: HTTP ${sessionRes.status}`;
        const serverErr: any = new Error(errorMsg);
        serverErr.status = sessionRes.status;
        throw serverErr;
      }

      const uploadLocationUrl = sessionRes.headers.get('location') || sessionRes.headers.get('Location');
      if (!uploadLocationUrl) {
        throw new Error('Google Drive không trả về URL tải lên (Location header)');
      }

      // Bước 2: Stream nhị phân trực tiếp từ file đĩa lên Google Drive (Resumable Upload)
      // Tích hợp báo cáo tiến trình (upload progress) cho các file PDF dung lượng lớn
      let uploadResult: FileSystem.FileSystemUploadResult | null | undefined;

      try {
        if (progressCallback) {
          // Báo cáo tiến trình tải lên cho các file dung lượng lớn bằng FileSystem.createUploadTask
          const uploadTask = FileSystem.createUploadTask(
            uploadLocationUrl,
            fileUri,
            {
              httpMethod: 'PUT',
              uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
              headers: {
                'Content-Type': mimeType,
              },
            },
            (data) => {
              const total = data.totalBytesExpectedToSend;
              const loaded = data.totalBytesSent;
              const percent = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
              progressCallback({
                loaded,
                total,
                percent,
              });
            }
          );

          uploadResult = await uploadTask.uploadAsync();
        } else {
          uploadResult = await FileSystem.uploadAsync(uploadLocationUrl, fileUri, {
            httpMethod: 'PUT',
            uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
            headers: {
              'Content-Type': mimeType,
            },
          });
        }
      } catch (uploadErr: any) {
        const netErr: any = new Error(
          `Lỗi đường truyền mạng khi tải dữ liệu lên Google Drive: ${uploadErr.message || uploadErr}`
        );
        netErr.isNetworkError = true;
        throw netErr;
      }

      if (!uploadResult) {
        const cancelledErr: any = new Error('Upload lên Google Drive bị gián đoạn hoặc hủy');
        cancelledErr.isNetworkError = true;
        throw cancelledErr;
      }

      if (uploadResult.status < 200 || uploadResult.status >= 300) {
        const httpErr: any = new Error(`Upload lên Google Drive thất bại: HTTP ${uploadResult.status}`);
        httpErr.status = uploadResult.status;
        throw httpErr;
      }

      try {
        return JSON.parse(uploadResult.body);
      } catch {
        return { success: true, status: uploadResult.status };
      }
    },
    {
      maxRetries: options?.maxRetries ?? 3,
      initialDelayMs: options?.initialRetryDelayMs ?? 1000,
      operationName: `Tải lên "${fileName}"`,
    }
  );
};

/**
 * Upload ảnh lên Google Photos bằng Native Binary Stream
 * Không load Blob vào JS heap, tối ưu bộ nhớ
 */
export const uploadToGooglePhotos = async (
  accessToken: string,
  imageUri: string,
  fileName: string
) => {
  // Bước 1: Upload nhị phân trực tiếp từ đĩa lấy Upload Token
  const uploadResult = await FileSystem.uploadAsync(
    'https://photoslibrary.googleapis.com/v1/uploads',
    imageUri,
    {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/octet-stream',
        'X-Goog-Upload-Content-Type': 'image/jpeg',
        'X-Goog-Upload-Protocol': 'raw',
      },
    }
  );

  if (uploadResult.status < 200 || uploadResult.status >= 300) {
    throw new Error(`Lỗi lấy upload token Google Photos: HTTP ${uploadResult.status}`);
  }

  const uploadToken = uploadResult.body.trim();
  if (!uploadToken) {
    throw new Error('Không nhận được upload token từ Google Photos');
  }

  // Bước 2: Gắn uploadToken vào media item của người dùng
  const createRes = await fetch(
    'https://photoslibrary.googleapis.com/v1/mediaItems:batchCreate',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        newMediaItems: [
          {
            description: fileName,
            simpleMediaItem: { uploadToken },
          },
        ],
      }),
    }
  );

  const createData = await createRes.json();
  if (!createRes.ok) throw new Error(createData.error?.message || 'Lỗi tạo media item Photos');
  return createData;
};
