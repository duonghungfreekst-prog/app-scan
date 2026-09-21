/**
 * config.ts — Cấu hình trung tâm cho CamScanner Expo
 * Tập trung toàn bộ hằng số, Storage Keys, Endpoints, Tham số Image Processing và Capability Matrix.
 */

// Storage Keys
export const STORAGE_KEYS = {
  GEMINI_API_KEY: '@camscanner_gemini_api_key',
  SCAN_QUALITY: '@camscanner_scan_quality',
  COLOR_MODE: '@camscanner_color_mode',
  SAVE_ORIGINAL: '@camscanner_save_original',
  CAM_PERM: '@camscanner_cam_perm',
  DRAFT_SCAN_SESSION: '@camscanner_draft_session_v1',
  APP_THEME: '@camscanner_theme_mode',
  THEME_MODE: '@camscanner_theme_mode',
  GOOGLE_CLIENT_ID_ANDROID: '@camscanner_google_client_id_android',
  GOOGLE_CLIENT_ID_WEB: '@camscanner_google_client_id_web',
  OCR_METADATA_INDEX: '@camscanner_ocr_metadata_index_v1',
} as const;

// Giới hạn & Timeouts hệ thống
export const MAX_UPLOAD_SIZE_MB = 50;
export const PDF_PROCESS_TIMEOUT_MS = 60000;
export const AI_TIMEOUT_MS = 30000;

// Cấu hình thử lại chuẩn (Retry Policy)
export const RETRY_CONFIG = {
  MAX_RETRIES: 3,
  INITIAL_DELAY_MS: 500,
  MAX_DELAY_MS: 5000,
  BACKOFF_FACTOR: 2,
  JITTER: true,
  RETRYABLE_STATUS_CODES: [408, 429, 500, 502, 503, 504],
} as const;

// Bảng mã lỗi chuẩn hệ thống (Standard Error Codes)
export const ERROR_CODES = {
  // Lỗi mạng & Kết nối
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT: 'TIMEOUT',
  SERVER_ERROR: 'SERVER_ERROR',

  // Xác thực & Quota
  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_API_KEY: 'INVALID_API_KEY',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',

  // Quyền truy cập thiết bị
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  CAMERA_PERMISSION_DENIED: 'CAMERA_PERMISSION_DENIED',
  STORAGE_PERMISSION_DENIED: 'STORAGE_PERMISSION_DENIED',

  // Tệp tin & Dữ liệu
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  FILE_CORRUPTED: 'FILE_CORRUPTED',
  INVALID_FILE_TYPE: 'INVALID_FILE_TYPE',

  // Xử lý ảnh & OCR & AI
  IMAGE_PROCESSING_FAILED: 'IMAGE_PROCESSING_FAILED',
  OCR_FAILED: 'OCR_FAILED',
  AI_PROCESSING_ERROR: 'AI_PROCESSING_ERROR',

  // Xử lý PDF
  PDF_PROCESS_FAILED: 'PDF_PROCESS_FAILED',
  PDF_PASSWORD_REQUIRED: 'PDF_PASSWORD_REQUIRED',
  PDF_TOO_LARGE: 'PDF_TOO_LARGE',

  // Hoạt động & Hệ thống chung
  CANCELLED: 'CANCELLED',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

// Endpoints & Models
export const AI_CONFIG = {
  GEMINI_ENDPOINT: 'https://generativelanguage.googleapis.com/v1beta',
  DEFAULT_MODEL: 'gemini-1.5-flash',
  REQUEST_TIMEOUT_MS: 30000,
  MAX_RETRIES: 3,
  RETRY_INITIAL_DELAY_MS: 500,
  MAX_IMAGE_DIMENSION: 1024, // Giới hạn kích thước ảnh trước khi gửi AI để tiết kiệm RAM & băng thông
  TEMPERATURE: 0.2,
  MAX_OUTPUT_TOKENS: 2048,
} as const;

export const TRANSLATE_CONFIG = {
  DEFAULT_TIMEOUT_MS: 15000,
  FALLBACK_ENDPOINT: 'https://translate.googleapis.com/translate_a/single',
} as const;

export const GITHUB_CONFIG = {
  USERNAME: 'duonghungfreekst-prog',
  REPO: 'app-scan',
  API_TIMEOUT_MS: 8000,
} as const;

// Tham số Image Processing trung tâm (thay thế các magic numbers rải rác)
export const IMAGE_PROCESSING_CONFIG = {
  // Lề tỉa viền
  DEFAULT_TRIM_MARGIN_PERCENT: 0,
  EDGE_CLEANUP_TRIM_PERCENT: 1.5,
  MAX_MARGIN_PERCENT: 4.0,

  // Độ tương phản và binarization
  DEFAULT_CONTRAST: 1.45,
  CONTRAST_MIN: 0.6,
  CONTRAST_MAX: 2.2,
  MAGIC_CONTRAST_POWER: 2.6, // Chuẩn hóa về 2.6 cho soft-gamma
  MAGIC_WHITE_THRESHOLD: 195,
  MAGIC_INK_CEILING: 215,
  GRAYSCALE_WHITE_THRESHOLD: 220,
  SHADOW_EDGE_THRESHOLD: 190,
  BW_THRESHOLD_BASE_RATIO: 0.76,
  BW_LOCAL_THRESHOLD_OFFSET: 15,
  
  // Phát hiện con dấu & chữ ký
  STAMP_RED_MIN: 90,
  STAMP_RED_DOMINANCE: 35,
  INK_BLUE_MIN: 80,
  INK_BLUE_DOMINANCE: 25,
  COLOR_BOOST: {
    STAMP_RED_FACTOR: 1.4,
    STAMP_RED_SUPPRESS: 0.4,
    INK_BLUE_FACTOR: 1.4,
    INK_BLUE_RED_SUPPRESS: 0.4,
    INK_BLUE_GREEN_SUPPRESS: 0.5,
  },

  // Làm nét (Unsharp Mask)
  UNSHARP_MASK_AMOUNT: 0.55,

  // Book Dewarp
  BOOK_DEWARP_MIN_GRADIENT: 4.0, // Ngưỡng tối thiểu để xác nhận có gáy sách cong
  BOOK_DEWARP_MAX_SHIFT_RATIO: 0.06,
  BOOK_DEWARP_GRADIENT_DIVISOR: 200,

  // Chất lượng xuất bản
  QUALITY: {
    high: { width: 1600, compress: 0.90 },
    medium: { width: 1200, compress: 0.75 },
    low: { width: 900, compress: 0.60 },
  },
} as const;

/**
 * Ma trận Năng lực Hệ thống (Capability Matrix)
 * Phân định rõ ràng tính năng nào Offline (Không cần mạng / API key) và tính năng nào cần Gemini API.
 */
export interface FeatureCapability {
  id: string;
  name: string;
  isOffline: boolean;
  requiresInternet: boolean;
  requiresApiKey: boolean;
  privacyNotice?: string;
  provider: 'Local Device' | 'Google Gemini' | 'Google Translate';
}

export const CAPABILITY_MATRIX: FeatureCapability[] = [
  {
    id: 'scan',
    name: 'Quét tài liệu & Căn lề',
    isOffline: true,
    requiresInternet: false,
    requiresApiKey: false,
    provider: 'Local Device',
  },
  {
    id: 'pdf_export',
    name: 'Xuất & Gộp PDF',
    isOffline: true,
    requiresInternet: false,
    requiresApiKey: false,
    provider: 'Local Device',
  },
  {
    id: 'id_card',
    name: 'Bố cục Thẻ ID 2 mặt',
    isOffline: true,
    requiresInternet: false,
    requiresApiKey: false,
    provider: 'Local Device',
  },
  {
    id: 'book_split',
    name: 'Tách trang sách đôi',
    isOffline: true,
    requiresInternet: false,
    requiresApiKey: false,
    provider: 'Local Device',
  },
  {
    id: 'qr_tools',
    name: 'Đọc & Tạo mã QR',
    isOffline: true,
    requiresInternet: false,
    requiresApiKey: false,
    provider: 'Local Device',
  },
  {
    id: 'cas_solver',
    name: 'Giải toán đại số CAS (Nerdamer)',
    isOffline: true,
    requiresInternet: false,
    requiresApiKey: false,
    provider: 'Local Device',
  },
  {
    id: 'ocr_gemini',
    name: 'Nhận dạng chữ viết (OCR AI)',
    isOffline: false,
    requiresInternet: true,
    requiresApiKey: true,
    privacyNotice: 'Hình ảnh văn bản sẽ được gửi tới Google Gemini API để nhận dạng.',
    provider: 'Google Gemini',
  },
  {
    id: 'ai_solver',
    name: 'Giải bài tập qua ảnh (Gemini AI Vision)',
    isOffline: false,
    requiresInternet: true,
    requiresApiKey: true,
    privacyNotice: 'Ảnh bài tập kèm sơ đồ sẽ được phân tích qua mô hình Gemini Vision.',
    provider: 'Google Gemini',
  },
  {
    id: 'translate',
    name: 'Dịch thuật văn bản đa ngôn ngữ',
    isOffline: false,
    requiresInternet: true,
    requiresApiKey: false,
    provider: 'Google Translate',
  },
  {
    id: 'office_export',
    name: 'Xuất văn bản sang Word / Excel',
    isOffline: true,
    requiresInternet: false,
    requiresApiKey: false,
    provider: 'Local Device',
  },
];
