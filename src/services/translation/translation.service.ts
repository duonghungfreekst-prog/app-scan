/**
 * translation.service.ts — Quản lý dịch thuật đa nguồn (Gemini Translation / Google Translate Fallback)
 * - Tự động ưu tiên Gemini Translation thông minh nếu người dùng đã cấu hình API Key
 * - Fallback endpoint Google Translate khi chưa có API Key
 * - Có timeout rõ ràng và parse kết quả an toàn
 */

import GeminiService from '../ai/gemini.service';
import { TRANSLATE_CONFIG } from '../../constants/config';

export class TranslationService {
  /**
   * Dịch văn bản sang tiếng Việt (hoặc ngôn ngữ mục tiêu)
   */
  public static async translate(
    text: string,
    targetLang: string = 'vi',
    sourceLang: string = 'auto'
  ): Promise<string> {
    if (!text || !text.trim()) return '';

    // 1. Nếu có Gemini API Key, ưu tiên dịch bằng Gemini Vision / LLM để văn phong tự nhiên nhất
    const apiKey = await GeminiService.getApiKey();
    if (apiKey) {
      try {
        const prompt = `Bạn là chuyên gia dịch thuật chuyên nghiệp. Hãy dịch toàn bộ đoạn văn bản sau đây sang tiếng Việt một cách tự nhiên, chuẩn văn phong tiếng Việt, giữ nguyên các thuật ngữ chuyên ngành và định dạng nếu có. Chỉ trả về nội dung đã dịch:\n\n${text}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), TRANSLATE_CONFIG.DEFAULT_TIMEOUT_MS);

        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': apiKey,
            },
            signal: controller.signal,
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
            }),
          }
        );
        clearTimeout(timeoutId);

        if (response.ok) {
          const data = await response.json();
          const translatedText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (translatedText && translatedText.trim()) {
            return `🌐 Dịch bởi Gemini AI:\n\n${translatedText.trim()}`;
          }
        }
      } catch (geminiErr) {
        console.warn('[Translation] Gemini translation failed, falling back to basic provider:', geminiErr);
      }
    }

    // 2. Fallback provider
    const url = `${TRANSLATE_CONFIG.FALLBACK_ENDPOINT}?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TRANSLATE_CONFIG.DEFAULT_TIMEOUT_MS);

    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`Translation HTTP Error ${response.status}`);
      }
      const json = await response.json();

      let translated = '';
      if (json && Array.isArray(json[0])) {
        for (const item of json[0]) {
          if (item && item[0]) {
            translated += item[0];
          }
        }
      }

      return translated ? `🌐 Dịch nhanh:\n\n${translated}` : 'Không có kết quả dịch phù hợp.';
    } catch (e: any) {
      if (e.name === 'AbortError') {
        throw new Error('Yêu cầu dịch thuật quá thời gian chờ (15 giây). Vui lòng thử lại.');
      }
      throw new Error(`Lỗi dịch thuật: ${e.message || String(e)}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

export default TranslationService;
