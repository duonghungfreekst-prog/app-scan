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
 * Upload file lên Google Drive
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

  const fileContent = await FileSystem.readAsStringAsync(fileUri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const metadata = {
    name: fileName,
    mimeType: isDoc ? 'application/vnd.google-apps.document' : mimeType,
  };

  const boundary = '-------314159265358979323846';
  const delimiter = '\r\n--' + boundary + '\r\n';
  const closeDelim = '\r\n--' + boundary + '--';

  const body =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    'Content-Type: ' + mimeType + '\r\n' +
    'Content-Transfer-Encoding: base64\r\n\r\n' +
    fileContent +
    closeDelim;

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Lỗi upload Drive');
  return data;
};

/**
 * Upload ảnh lên Google Photos
 */
export const uploadToGooglePhotos = async (
  accessToken: string,
  imageUri: string,
  fileName: string
) => {
  const fetchResponse = await fetch(imageUri);
  const blob = await fetchResponse.blob();

  const uploadRes = await fetch('https://photoslibrary.googleapis.com/v1/uploads', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/octet-stream',
      'X-Goog-Upload-Content-Type': 'image/jpeg',
      'X-Goog-Upload-Protocol': 'raw',
    },
    body: blob,
  });

  const uploadToken = await uploadRes.text();
  if (!uploadRes.ok) throw new Error('Lỗi lấy upload token');

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
  if (!createRes.ok) throw new Error('Lỗi tạo media item Photos');
  return createData;
};
