import * as FileSystem from 'expo-file-system/legacy';

// Client IDs — thay bằng ID thật từ Google Cloud Console để dùng tính năng đồng bộ
export const GOOGLE_CLIENT_ID_ANDROID = 'YOUR_ANDROID_CLIENT_ID.apps.googleusercontent.com';
export const GOOGLE_CLIENT_ID_WEB = 'YOUR_WEB_CLIENT_ID.apps.googleusercontent.com';

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
  if (!isGoogleConfigured) {
    const { Alert } = require('react-native');
    Alert.alert(
      '⚙️ Chưa cấu hình Google',
      'Tính năng đồng bộ Google chưa được kích hoạt.\nVui lòng liên hệ nhà phát triển để cấu hình Google Client ID.'
    );
    return null;
  }

  try {
    const AuthSession = require('expo-auth-session');
    const WebBrowser = require('expo-web-browser');

    const redirectUri = AuthSession.makeRedirectUri({ scheme: 'camscanner' });
    const authUrl =
      `https://accounts.google.com/o/oauth2/v2/auth` +
      `?client_id=${GOOGLE_CLIENT_ID_ANDROID}` +
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
