import * as FileSystem from 'expo-file-system/legacy';
import Storage from './storage';
import { STORAGE_KEYS } from '../constants/config';

// Client IDs mặc định — người dùng có thể cấu hình Client ID riêng trong màn hình Cài đặt
export const GOOGLE_CLIENT_ID_ANDROID = 'YOUR_ANDROID_CLIENT_ID.apps.googleusercontent.com';
export const GOOGLE_CLIENT_ID_WEB = 'YOUR_WEB_CLIENT_ID.apps.googleusercontent.com';

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

const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/photoslibrary.appendonly',
].join(' ');

/**
 * Mở OAuth2 Google bằng WebBrowser thuần (không dùng hook)
 * Trả về accessToken nếu thành công, null nếu thất bại/bị huỷ
 */
export const signInWithGoogle = async (): Promise<string | null> => {
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

  try {
    const AuthSession = require('expo-auth-session');
    const WebBrowser = require('expo-web-browser');

    const redirectUri = AuthSession.makeRedirectUri({ scheme: 'camscanner' });
    const authUrl =
      `https://accounts.google.com/o/oauth2/v2/auth` +
      `?client_id=${clientIdAndroid}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&response_type=token` +
      `&scope=${encodeURIComponent(SCOPES)}`;

    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri);

    if (result.type === 'success' && result.url) {
      const match = result.url.match(/access_token=([^&]+)/);
      if (match) return match[1];
    }
    return null;
  } catch (e) {
    console.error('[SYNC] signInWithGoogle error:', e);
    return null;
  }
};

/**
 * Upload file lên Google Drive bằng Resumable Upload (Stream trực tiếp từ đĩa)
 * Không nạp Base64 vào RAM, chống OOM crash với tài liệu nhiều trang
 */
export const uploadToGoogleDrive = async (
  accessToken: string,
  fileUri: string,
  mimeType: string,
  fileName: string,
  isDoc: boolean = false
) => {
  const fileInfo = await FileSystem.getInfoAsync(fileUri);
  if (!fileInfo.exists) throw new Error('File không tồn tại');

  const metadata = {
    name: fileName,
    mimeType: isDoc ? 'application/vnd.google-apps.document' : mimeType,
  };

  // Bước 1: Khởi tạo Resumable Upload Session
  const sessionRes = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mimeType,
      },
      body: JSON.stringify(metadata),
    }
  );

  if (!sessionRes.ok) {
    const errData = await sessionRes.json().catch(() => ({}));
    throw new Error(errData.error?.message || `Lỗi tạo session Google Drive: HTTP ${sessionRes.status}`);
  }

  const uploadLocationUrl = sessionRes.headers.get('location') || sessionRes.headers.get('Location');
  if (!uploadLocationUrl) {
    throw new Error('Google Drive không trả về URL tải lên (Location header)');
  }

  // Bước 2: Stream nhị phân trực tiếp từ file đĩa lên Google Drive (Zero JS RAM overhead)
  const uploadResult = await FileSystem.uploadAsync(uploadLocationUrl, fileUri, {
    httpMethod: 'PUT',
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: {
      'Content-Type': mimeType,
    },
  });

  if (uploadResult.status < 200 || uploadResult.status >= 300) {
    throw new Error(`Upload lên Google Drive thất bại: HTTP ${uploadResult.status}`);
  }

  try {
    return JSON.parse(uploadResult.body);
  } catch {
    return { success: true, status: uploadResult.status };
  }
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
