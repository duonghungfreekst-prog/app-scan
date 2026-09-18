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

export interface MathSolution {
  equation: string;
  result: string;
  isCasSuccess: boolean;
  isAiSolved: boolean;
  source: 'CAS' | 'Gemini' | 'Combined';
  timestamp: number;
}

export interface StorageSchema {
  version: number;
  lastUpdated: number;
  data: Record<string, string>;
}
