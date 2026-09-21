/**
 * domain.ts — Các kiểu dữ liệu nghiệp vụ chuẩn (Domain Types)
 */

export type ScanQuality = 'high' | 'medium' | 'low';
export type ColorMode = 'color' | 'grayscale' | 'bw';
export type FilterMode = 'magic' | 'bw' | 'grayscale' | 'original';

export interface DocumentItem {
  id: string;
  name: string;
  uri: string;
  isDirectory: boolean;
  size: number;
  modificationTime: number;
  extension: string;
  ocrText?: string;
  fileSize?: number;
  pageCount?: number;
  checksum?: string;
}


export interface CropPoint {
  x: number;
  y: number;
}

export type PolygonCorners = [CropPoint, CropPoint, CropPoint, CropPoint]; // [TL, TR, BL, BR]

export interface ImageProcessingOptions {
  filterMode: FilterMode;
  brightness?: number;
  contrast?: number;
  trimMarginPercent?: number;
  customCornersRatio?: PolygonCorners;
  bookMode?: boolean; // CHỈ kích hoạt thuật toán uốn gáy sách khi bookMode === true
}

export interface OCRResult {
  text: string;
  source: 'gemini' | 'local';
  timestamp: number;
  rawResponse?: any;
}

// Cấu trúc dữ liệu chi tiết mặt hàng Hóa đơn VAT
export interface VATInvoiceItem {
  name: string;      // Tên hàng hóa, dịch vụ
  unit?: string;     // Đơn vị tính
  quantity?: number; // Số lượng
  unitPrice?: number;// Đơn giá
  total?: number;    // Thành tiền
}

// Cấu trúc dữ liệu bóc tách Hóa đơn VAT
export interface VATInvoiceData {
  invoiceNumber: string;    // Số HĐ
  invoiceDate: string;      // Ngày lập
  sellerName: string;       // Đơn vị bán
  taxCode: string;          // MST (Mã số thuế)
  items: VATInvoiceItem[];  // Chi tiết mặt hàng
  subTotal?: number;        // Tổng tiền trước thuế
  vatRate?: string;         // Thuế suất VAT
  vatAmount: number;        // Thuế VAT
  totalAmount: number;      // Tổng tiền
}

// Cấu trúc dữ liệu bóc tách CCCD gắn chip
export interface CitizenCardData {
  idNumber: string;         // Số CCCD (12 số)
  fullName: string;         // Họ và tên
  dateOfBirth: string;      // Ngày sinh
  gender: string;           // Giới tính
  placeOfOrigin: string;    // Quê quán
  placeOfResidence: string; // Nơi thường trú
}

// Cấu trúc dữ liệu bóc tách Danh thiếp (Business Card)
export interface BusinessCardData {
  name: string;             // Họ tên
  title: string;            // Chức danh
  company: string;          // Công ty
  phone: string;            // Số điện thoại
  email: string;            // Email
  website: string;          // Website
  address: string;          // Địa chỉ
}

export type StructuredOcrType = 'vat_invoice' | 'citizen_card' | 'business_card';

export interface VATInvoiceResult {
  type: 'vat_invoice';
  data: VATInvoiceData;
  rawText?: string;
  timestamp?: number;
  confidence?: number;
}

export interface CitizenCardResult {
  type: 'citizen_card';
  data: CitizenCardData;
  rawText?: string;
  timestamp?: number;
  confidence?: number;
}

export interface BusinessCardResult {
  type: 'business_card';
  data: BusinessCardData;
  rawText?: string;
  timestamp?: number;
  confidence?: number;
}

export type StructuredOcrResult =
  | VATInvoiceResult
  | CitizenCardResult
  | BusinessCardResult;

export interface MathSolution {
  equation: string;
  result: string;
  isCasSuccess: boolean;
  isAiSolved: boolean;
  source: 'CAS' | 'Gemini' | 'Combined';
  timestamp: number;
}

export interface MathFormulaResult {
  rawFormula: string;
  latex: string;
  solution?: MathSolution | string;
  steps?: string[];
  isSolvable?: boolean;
  timestamp: number;
  confidence?: number;
}

export interface TranslationHistoryItem {
  id: string;
  sourceText: string;
  translatedText: string;
  sourceLang: string;
  targetLang: string;
  timestamp: number;
  provider?: 'gemini' | 'basic' | 'fallback' | string;
}

export interface StorageSchema {
  version: number;
  lastUpdated: number;
  data: Record<string, string>;
}

export interface BackupArchiveMetadata {
  version: string;
  createdAt: number;
  documentCount: number;
  totalBytes: number;
  checksum: string;
  encrypted: boolean;
}

export interface PDFSplitOptions {
  splitRanges: string[];
}

export interface PDFCompressOptions {
  quality: 'low' | 'medium' | 'high';
}

export interface PDFWatermarkOptions {
  text?: string;
  imageUri?: string;
  opacity?: number;
}
