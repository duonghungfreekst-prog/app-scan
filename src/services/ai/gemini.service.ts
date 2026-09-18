/**
 * gemini.service.ts — Service kết nối Gemini Multimodal Vision API
 * - Quản lý cấu hình model, timeout
 * - Lấy API Key an toàn từ SecureStorage
 * - Không để lộ API Key trong log
 */

import SecureStorage from '../../core/security/secureStorage';

export const GEMINI_API_KEY_NAME = '@camscanner_gemini_api_key';

export interface GeminiConfig {
  model: string;
  timeoutMs: number;
}

const DEFAULT_CONFIG: GeminiConfig = {
  model: 'gemini-1.5-flash',
  timeoutMs: 30000,
};

export class GeminiService {
  private static config: GeminiConfig = { ...DEFAULT_CONFIG };

  public static setConfig(customConfig: Partial<GeminiConfig>) {
    this.config = { ...this.config, ...customConfig };
  }

  /**
   * Lấy API Key hiện tại từ SecureStorage
   */
  public static async getApiKey(): Promise<string | null> {
    const key = await SecureStorage.getItem(GEMINI_API_KEY_NAME);
    return key && key.trim() ? key.trim() : null;
  }

  /**
   * Gọi Gemini Vision với ảnh Base64
   */
  public static async generateContentWithImage(
    prompt: string,
    imageBase64: string,
    mimeType: string = 'image/jpeg'
  ): Promise<string> {
    const apiKey = await this.getApiKey();
    if (!apiKey) {
      throw new Error('Chưa cấu hình API Key. Vui lòng nhập Gemini API Key trong Cài đặt.');
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.config.model}:generateContent?key=${apiKey}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: imageBase64,
                },
              },
            ],
          }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 2048,
          },
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Gemini API Error: ${response.status}`);
      }

      const data = await response.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new Error('Gemini không phản hồi văn bản nào.');
      }
      return text.trim();
    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new Error('Yêu cầu tới Gemini bị quá thời gian chờ (30 giây). Vui lòng thử lại.');
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Nhận dạng chữ viết (OCR) qua Gemini Vision
   */
  public static async ocrImage(imageBase64: string): Promise<string> {
    const prompt = 'Hãy trích xuất toàn bộ văn bản có trong ảnh này một cách chính xác nhất. Chỉ trả về nội dung văn bản, không thêm lời bình hay giải thích.';
    return await this.generateContentWithImage(prompt, imageBase64);
  }
}

export default GeminiService;
