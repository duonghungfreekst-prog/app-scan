/**
 * gemini.service.ts — Service kết nối Google Gemini Multimodal Vision API
 * - Truyền API Key qua Header x-goog-api-key (Bảo mật, không lộ trên URL)
 * - Tự động nén/resize ảnh tối đa 1024px trước khi gửi để tối ưu RAM & băng thông
 * - Tự động thử lại (Retry with Exponential Backoff & Jitter) cho lỗi tạm thời
 * - Phân loại chi tiết lỗi: Quota Exceeded (429), Invalid Key (400/403), Network Timeout
 */

import SecureStorage from '../../core/security/secureStorage';
import { STORAGE_KEYS, AI_CONFIG } from '../../constants/config';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';

export interface GeminiConfig {
  model: string;
  timeoutMs: number;
}

const DEFAULT_CONFIG: GeminiConfig = {
  model: AI_CONFIG.DEFAULT_MODEL,
  timeoutMs: AI_CONFIG.REQUEST_TIMEOUT_MS,
};

export class GeminiService {
  private static config: GeminiConfig = { ...DEFAULT_CONFIG };

  public static setConfig(customConfig: Partial<GeminiConfig>) {
    this.config = { ...this.config, ...customConfig };
  }

  /**
   * Lấy API Key an toàn từ Keystore / Keychain
   */
  public static async getApiKey(): Promise<string | null> {
    const key = await SecureStorage.getItem(STORAGE_KEYS.GEMINI_API_KEY);
    return key && key.trim() ? key.trim() : null;
  }

  /**
   * Nén và thu nhỏ ảnh về kích thước tối đa 1024px trước khi gửi lên API
   */
  public static async prepareOptimizedBase64(imageUriOrBase64: string): Promise<string> {
    if (imageUriOrBase64.startsWith('data:')) {
      return imageUriOrBase64.split(',')[1];
    }

    if (imageUriOrBase64.startsWith('file://') || imageUriOrBase64.startsWith('/')) {
      try {
        const manipResult = await ImageManipulator.manipulateAsync(
          imageUriOrBase64,
          [{ resize: { width: AI_CONFIG.MAX_IMAGE_DIMENSION } }],
          { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG, base64: true }
        );
        if (manipResult.base64) {
          return manipResult.base64;
        }
      } catch (e) {
        console.warn('[GeminiService] Could not resize image, falling back to direct read');
      }

      return await FileSystem.readAsStringAsync(imageUriOrBase64, {
        encoding: FileSystem.EncodingType.Base64,
      });
    }

    return imageUriOrBase64;
  }

  /**
   * Gọi Gemini Multimodal API kèm cơ chế Retry với Exponential Backoff & Jitter
   */
  public static async generateContentWithImage(
    prompt: string,
    imageInput: string,
    mimeType: string = 'image/jpeg'
  ): Promise<string> {
    const apiKey = await this.getApiKey();
    if (!apiKey) {
      throw new Error('Chưa cấu hình API Key. Vui lòng nhập Gemini API Key cá nhân trong Cài đặt.');
    }

    const base64Data = await this.prepareOptimizedBase64(imageInput);
    const endpoint = `${AI_CONFIG.GEMINI_ENDPOINT}/models/${this.config.model}:generateContent`;

    let attempt = 0;
    let delay = AI_CONFIG.RETRY_INITIAL_DELAY_MS;

    while (true) {
      attempt++;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey, // Header bảo mật
          },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: prompt },
                {
                  inline_data: {
                    mime_type: mimeType,
                    data: base64Data,
                  },
                },
              ],
            }],
            generationConfig: {
              temperature: AI_CONFIG.TEMPERATURE,
              maxOutputTokens: AI_CONFIG.MAX_OUTPUT_TOKENS,
            },
          }),
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const status = response.status;
          const errBody = await response.text();

          // Phân loại mã lỗi Quota / Auth / Server
          if (status === 429) {
            if (attempt <= AI_CONFIG.MAX_RETRIES) {
              const jitter = Math.random() * 200;
              await new Promise(res => setTimeout(res, delay + jitter));
              delay *= 2;
              continue;
            }
            throw new Error('Đã vượt quá hạn mức truy vấn Gemini (Quota Limit / 429). Vui lòng thử lại sau vài giây.');
          }

          if (status === 400 || status === 403) {
            throw new Error('Gemini API Key không hợp lệ hoặc không có quyền truy cập mô hình này.');
          }

          if (status >= 500 && attempt <= AI_CONFIG.MAX_RETRIES) {
            const jitter = Math.random() * 200;
            await new Promise(res => setTimeout(res, delay + jitter));
            delay *= 2;
            continue;
          }

          throw new Error(`Lỗi máy chủ AI (HTTP ${status}): Vui lòng kiểm tra lại yêu cầu.`);
        }

        const data = await response.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
          throw new Error('Gemini không phản hồi văn bản nào.');
        }

        return text.trim();
      } catch (error: any) {
        clearTimeout(timeoutId);
        if (error?.name === 'AbortError') {
          throw new Error('Yêu cầu tới Gemini bị quá thời gian chờ (30s). Kiểm tra kết nối mạng.');
        }
        // FIX: error.message could be undefined (e.g. a raw string/network error was
        // thrown), which previously crashed this catch block with a TypeError instead
        // of surfacing the real error.
        const msg: string = typeof error?.message === 'string' ? error.message : String(error);
        if (attempt >= AI_CONFIG.MAX_RETRIES || msg.includes('API Key') || msg.includes('Quota')) {
          throw error instanceof Error ? error : new Error(msg);
        }
        // FIX: generic/network errors (e.g. "Network request failed" while offline)
        // used to fall through and immediately retry with no delay at all — a tight
        // loop that hammered the network instead of backing off. Now they honor the
        // same exponential backoff + jitter as the 429/5xx paths above.
        const jitter = Math.random() * 200;
        await new Promise(res => setTimeout(res, delay + jitter));
        delay *= 2;
      }
    }
  }

  /**
   * Nhận dạng chữ viết (OCR) tài liệu qua Gemini Vision
   */
  public static async ocrImage(imageInput: string): Promise<string> {
    const prompt = 'Hãy trích xuất toàn bộ chữ viết, con số và bảng biểu trong hình ảnh này một cách chính xác nhất. Giữ nguyên cấu trúc dòng và bảng. Chỉ trả về nội dung trích xuất, không thêm lời chào hay giải thích.';
    return await this.generateContentWithImage(prompt, imageInput);
  }

  /**
   * Dịch văn bản thông qua Gemini
   */
  public static async translateText(text: string, targetLang: string = 'tiếng Việt'): Promise<string> {
    const apiKey = await this.getApiKey();
    if (!apiKey) throw new Error('Chưa cấu hình API Key.');

    const endpoint = `${AI_CONFIG.GEMINI_ENDPOINT}/models/${this.config.model}:generateContent`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `Bạn là dịch giả tài liệu chuyên nghiệp. Hãy dịch toàn bộ văn bản sau sang ${targetLang}. Giữ nguyên cấu trúc dòng và định dạng gốc. Chỉ trả về kết quả dịch:\n\n${text}`
          }]
        }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 2048,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Gemini Translation HTTP ${response.status}`);
    }

    const data = await response.json();
    const result = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!result) throw new Error('Gemini không phản hồi bản dịch.');
    return result.trim();
  }

  /**
   * Phân tích và giải toán chi tiết từ ảnh qua Gemini Vision
   */
  public static async solveMathProblem(imageInput: string): Promise<string> {
    const prompt = 'Bạn là chuyên gia giải toán và phân tích tài liệu khoa học. Hãy đọc kỹ đề bài toán hoặc biểu thức trong ảnh (bao gồm cả hình vẽ hình học, bảng số liệu, phương trình nếu có). Hãy giải chi tiết từng bước (Step-by-step) bằng tiếng Việt rõ ràng, kèm công thức toán Unicode/LaTeX và kết luận nghiệm/đáp án cuối cùng.';
    return await this.generateContentWithImage(prompt, imageInput);
  }

  /**
   * Trích xuất bảng biểu từ ảnh thành mảng 2 chiều cho Excel
   */
  public static async extractTableData(imageInput: string): Promise<string[][]> {
    const prompt = 'Hãy phát hiện và trích xuất dữ liệu bảng có trong ảnh. Trả về định dạng JSON thuần túy là một mảng 2 chiều (ví dụ: [["Tiêu đề 1", "Tiêu đề 2"], ["Dòng 1", "Giá trị 1"]]). Chỉ trả về mảng JSON, tuyệt đối không thêm markdown backticks, không giải thích gì khác.';
    const raw = await this.generateContentWithImage(prompt, imageInput);
    try {
      const cleanJson = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleanJson);
      if (Array.isArray(parsed) && parsed.every(row => Array.isArray(row))) {
        return parsed;
      }
    } catch {
      // Fallback
    }
    return raw.split('\n').map(line => line.split(/\t+|\s{2,}/).map(c => c.trim()).filter(Boolean)).filter(r => r.length > 0);
  }
}

export default GeminiService;
