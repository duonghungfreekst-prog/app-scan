/**
 * translation.service.ts — Quản lý dịch thuật đa nguồn (Google Translate / Fallback)
 * Có timeout và parse an toàn
 */

export class TranslationService {
  /**
   * Dịch văn bản sang tiếng Việt (hoặc ngôn ngữ tùy chọn)
   */
  public static async translate(
    text: string,
    targetLang: string = 'vi',
    sourceLang: string = 'auto'
  ): Promise<string> {
    if (!text || !text.trim()) return '';

    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`Translation HTTP ${response.status}`);
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

      return translated || 'Không có kết quả dịch.';
    } catch (e: any) {
      if (e.name === 'AbortError') {
        throw new Error('Yêu cầu dịch thuật quá thời gian chờ (15 giây).');
      }
      throw new Error(`Lỗi dịch thuật: ${e.message || String(e)}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

export default TranslationService;
