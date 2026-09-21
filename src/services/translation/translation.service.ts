/**
 * translation.service.ts — Quản lý dịch thuật đa nguồn (Gemini Translation / Google Translate Fallback)
 * - Bộ đệm bản dịch (Translation Cache) lưu trong bộ nhớ theo hash(text + sourceLang + targetLang)
 * - Bộ đệm bền vững (Persistent Storage Cache): lưu cache các bản dịch gần nhất vào Storage chống mất dữ liệu khi tắt app
 * - Cơ chế Chunking: tự động chia nhỏ văn bản dài thành các đoạn 1500 ký tự theo dấu chấm câu và dịch song song
 * - Tự động ưu tiên Gemini Translation thông minh nếu người dùng đã cấu hình API Key
 * - Fallback endpoint Google Translate khi chưa có API Key hoặc lỗi
 * - Có timeout rõ ràng và parse kết quả an toàn
 */

import GeminiService from '../ai/gemini.service';
import { TRANSLATE_CONFIG } from '../../constants/config';
import Storage from '../../utils/storage';

export class TranslationService {
  // Giới hạn kích thước chunk (ký tự) để không vượt token limit của Gemini
  public static readonly CHUNK_SIZE = 1500;

  // Key lưu trữ bộ đệm bản dịch bền vững trong Storage
  public static readonly STORAGE_CACHE_KEY = '@camscanner_translation_cache_v1';

  // Số lượng bản ghi lưu trữ tối đa trong bộ nhớ và trên ổ đĩa bền vững
  private static readonly MAX_CACHE_ENTRIES = 500;
  public static readonly MAX_PERSISTENT_ENTRIES = 200;

  // Bộ đệm bản dịch lưu trong bộ nhớ theo key hash(text + sourceLang + targetLang)
  private static readonly cache: Map<string, string> = new Map();

  // Trạng thái đồng bộ bộ đệm bền vững từ Storage
  private static isPersistentLoaded = false;
  private static loadPromise: Promise<void> | null = null;
  private static saveTimeoutId: ReturnType<typeof setTimeout> | null = null;

  /**
   * Tạo mã băm chuỗi (FNV-1a / 64-bit composite hash) cho cache key
   */
  public static hash(input: string): string {
    let h1 = 2166136261;
    let h2 = 5381;
    for (let i = 0; i < input.length; i++) {
      const code = input.charCodeAt(i);
      h1 ^= code;
      h1 = Math.imul(h1, 16777619);
      h2 = ((h2 << 5) + h2) ^ code;
    }
    return `${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}_${input.length}`;
  }

  /**
   * Tạo key cache theo định dạng hash(text + sourceLang + targetLang)
   */
  public static getCacheKey(text: string, sourceLang: string, targetLang: string): string {
    return TranslationService.hash(`${text}_${sourceLang}_${targetLang}`);
  }

  /**
   * Nạp bộ đệm bản dịch bền vững từ Storage vào bộ nhớ khi khởi tạo
   */
  public static async initPersistentCache(): Promise<void> {
    if (TranslationService.isPersistentLoaded) return;
    if (TranslationService.loadPromise) return TranslationService.loadPromise;

    TranslationService.loadPromise = (async () => {
      try {
        const raw = await Storage.getItem(TranslationService.STORAGE_CACHE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              if (item && typeof item.key === 'string' && typeof item.value === 'string') {
                if (!TranslationService.cache.has(item.key)) {
                  TranslationService.cache.set(item.key, item.value);
                }
              } else if (Array.isArray(item) && typeof item[0] === 'string' && typeof item[1] === 'string') {
                if (!TranslationService.cache.has(item[0])) {
                  TranslationService.cache.set(item[0], item[1]);
                }
              }
            }
          } else if (parsed && typeof parsed === 'object') {
            for (const [key, value] of Object.entries(parsed)) {
              if (typeof value === 'string') {
                if (!TranslationService.cache.has(key)) {
                  TranslationService.cache.set(key, value);
                }
              } else if (value && typeof (value as any).value === 'string') {
                if (!TranslationService.cache.has(key)) {
                  TranslationService.cache.set(key, (value as any).value);
                }
              }
            }
          }
        }
      } catch (err) {
        console.warn('[TranslationService] Lỗi nạp persistent translation cache từ Storage:', err);
      } finally {
        TranslationService.isPersistentLoaded = true;
        TranslationService.loadPromise = null;
      }
    })();

    return TranslationService.loadPromise;
  }

  /**
   * Lưu các bản dịch gần nhất vào Storage theo cơ chế bền vững (LRU)
   */
  public static async savePersistentCache(): Promise<void> {
    try {
      await TranslationService.initPersistentCache();

      const allEntries = Array.from(TranslationService.cache.entries());
      // Lấy tối đa MAX_PERSISTENT_ENTRIES bản dịch gần nhất (ở cuối map)
      const recentEntries = allEntries.slice(-TranslationService.MAX_PERSISTENT_ENTRIES);

      const payload = recentEntries.map(([key, value]) => ({
        key,
        value,
        updatedAt: Date.now(),
      }));

      await Storage.setItem(TranslationService.STORAGE_CACHE_KEY, JSON.stringify(payload));
    } catch (err) {
      console.warn('[TranslationService] Lỗi lưu persistent translation cache vào Storage:', err);
    }
  }

  /**
   * Lên lịch lưu cache bền vững (debounced) để tối ưu I/O ghi đĩa
   */
  private static schedulePersistentSave(): void {
    if (TranslationService.saveTimeoutId) {
      clearTimeout(TranslationService.saveTimeoutId);
    }
    TranslationService.saveTimeoutId = setTimeout(() => {
      TranslationService.saveTimeoutId = null;
      TranslationService.savePersistentCache().catch(() => {});
    }, 1000);
  }

  /**
   * Lưu kết quả vào bộ đệm (hỗ trợ LRU và tự động lên lịch lưu bền vững)
   */
  private static setCache(key: string, value: string): void {
    if (TranslationService.cache.has(key)) {
      TranslationService.cache.delete(key);
    } else if (TranslationService.cache.size >= TranslationService.MAX_CACHE_ENTRIES) {
      const oldestKey = TranslationService.cache.keys().next().value;
      if (oldestKey) {
        TranslationService.cache.delete(oldestKey);
      }
    }
    TranslationService.cache.set(key, value);
    TranslationService.schedulePersistentSave();
  }

  /**
   * Xóa toàn bộ bộ đệm bản dịch trong bộ nhớ
   */
  public static clearCache(): void {
    if (TranslationService.saveTimeoutId) {
      clearTimeout(TranslationService.saveTimeoutId);
      TranslationService.saveTimeoutId = null;
    }
    TranslationService.cache.clear();
  }

  /**
   * Xóa toàn bộ bộ đệm bản dịch bền vững trong Storage và giải phóng bộ nhớ
   */
  public static async clearPersistentCache(): Promise<void> {
    TranslationService.clearCache();
    try {
      await Storage.removeItem(TranslationService.STORAGE_CACHE_KEY);
    } catch (err) {
      console.warn('[TranslationService] Lỗi xóa persistent translation cache:', err);
    }
    TranslationService.isPersistentLoaded = true;
  }

  /**
   * Lấy số lượng bản ghi hiện có trong bộ đệm (in-memory)
   */
  public static getCacheSize(): number {
    return TranslationService.cache.size;
  }

  /**
   * Lấy số lượng bản ghi hiện có trong bộ đệm bền vững (đã nạp từ Storage)
   */
  public static async getPersistentCacheSize(): Promise<number> {
    await TranslationService.initPersistentCache();
    return TranslationService.cache.size;
  }

  /**
   * Tự động chia nhỏ văn bản dài thành các đoạn ~1500 ký tự theo dấu chấm câu
   */
  public static splitIntoChunks(
    text: string,
    maxChunkSize: number = TranslationService.CHUNK_SIZE
  ): string[] {
    if (!text || text.length <= maxChunkSize) {
      return [text];
    }

    const chunks: string[] = [];
    let remaining = text.trim();

    while (remaining.length > maxChunkSize) {
      const slice = remaining.slice(0, maxChunkSize);

      // Tìm vị trí ngắt theo dấu chấm câu hoặc xuống dòng gần cuối đoạn slice nhất
      let splitIndex = -1;
      const punctuations = [
        '. ', '.\n', '.\r\n',
        '! ', '!\n', '!\r\n',
        '? ', '?\n', '?\r\n',
        '; ', ';\n',
        '\n\n', '\n',
        '.', '!', '?', ';'
      ];

      for (const p of punctuations) {
        const idx = slice.lastIndexOf(p);
        if (idx !== -1) {
          const candidate = idx + p.length;
          // Chỉ chọn nếu dấu ngắt nằm ở vị trí hợp lý (ít nhất 30% độ dài chunk để tránh đoạn quá vụn)
          if (candidate > splitIndex && candidate >= maxChunkSize * 0.3) {
            splitIndex = candidate;
          }
        }
      }

      // Nếu không tìm thấy dấu câu phù hợp, ngắt theo khoảng trắng
      if (splitIndex === -1) {
        const spaceIdx = slice.lastIndexOf(' ');
        if (spaceIdx > maxChunkSize * 0.3) {
          splitIndex = spaceIdx + 1;
        } else {
          // Trường hợp câu quá dài không dấu: cắt đúng maxChunkSize
          splitIndex = maxChunkSize;
        }
      }

      const chunk = remaining.slice(0, splitIndex).trim();
      if (chunk) {
        chunks.push(chunk);
      }
      remaining = remaining.slice(splitIndex).trim();
    }

    if (remaining.length > 0) {
      chunks.push(remaining);
    }

    return chunks.length > 0 ? chunks : [text];
  }

  /**
   * Dịch một chunk cụ thể bằng Gemini API
   */
  private static async translateWithGemini(
    text: string,
    targetLang: string,
    apiKey: string
  ): Promise<string | null> {
    const targetLabel = targetLang === 'vi' ? 'tiếng Việt' : targetLang;
    const prompt = `Bạn là chuyên gia dịch thuật chuyên nghiệp. Hãy dịch toàn bộ đoạn văn bản sau đây sang ${targetLabel} một cách tự nhiên, chuẩn văn phong, giữ nguyên các thuật ngữ chuyên ngành và định dạng nếu có. Chỉ trả về nội dung đã dịch:\n\n${text}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TRANSLATE_CONFIG.DEFAULT_TIMEOUT_MS);

    try {
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

      if (response.ok) {
        const data = await response.json();
        const translatedText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (translatedText && translatedText.trim()) {
          return translatedText.trim();
        }
      }
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Dịch một chunk cụ thể qua Google Translate Fallback
   */
  private static async translateWithFallback(
    text: string,
    targetLang: string,
    sourceLang: string
  ): Promise<string> {
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

      return translated.trim();
    } catch (e: any) {
      if (e.name === 'AbortError') {
        throw new Error('Yêu cầu dịch thuật quá thời gian chờ (15 giây). Vui lòng thử lại.');
      }
      throw new Error(`Lỗi dịch thuật: ${e.message || String(e)}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Dịch từng chunk đơn lẻ, kiểm tra cache của chunk và tự động fallback
   */
  private static async translateChunk(
    chunk: string,
    targetLang: string,
    sourceLang: string,
    apiKey: string | null
  ): Promise<{ text: string; provider: 'gemini' | 'fallback' }> {
    const trimmed = chunk.trim();
    if (!trimmed) {
      return { text: '', provider: apiKey ? 'gemini' : 'fallback' };
    }

    const chunkCacheKey = `chunk_${TranslationService.getCacheKey(trimmed, sourceLang, targetLang)}`;
    if (TranslationService.cache.has(chunkCacheKey)) {
      return {
        text: TranslationService.cache.get(chunkCacheKey)!,
        provider: apiKey ? 'gemini' : 'fallback',
      };
    }

    // 1. Thử dịch bằng Gemini nếu có API Key
    if (apiKey) {
      try {
        const geminiResult = await TranslationService.translateWithGemini(trimmed, targetLang, apiKey);
        if (geminiResult) {
          TranslationService.setCache(chunkCacheKey, geminiResult);
          return { text: geminiResult, provider: 'gemini' };
        }
      } catch (geminiErr) {
        console.warn('[Translation] Gemini chunk translation failed, falling back to basic provider:', geminiErr);
      }
    }

    // 2. Dịch qua Fallback Endpoint
    const fallbackResult = await TranslationService.translateWithFallback(trimmed, targetLang, sourceLang);
    TranslationService.setCache(chunkCacheKey, fallbackResult);
    return { text: fallbackResult, provider: 'fallback' };
  }

  /**
   * Dịch văn bản sang tiếng Việt (hoặc ngôn ngữ mục tiêu)
   * - Tự động nạp bộ đệm bền vững từ Storage khi mở app
   * - Hỗ trợ cache in-memory & persistent theo key hash(text + sourceLang + targetLang)
   * - Tự động chunking và dịch song song khi văn bản vượt quá CHUNK_SIZE
   */
  public static async translate(
    text: string,
    targetLang: string = 'vi',
    sourceLang: string = 'auto'
  ): Promise<string> {
    if (!text || !text.trim()) return '';

    // Đảm bảo cache bền vững từ Storage đã được nạp trước khi tra cứu
    await TranslationService.initPersistentCache();

    const trimmedText = text.trim();

    // 1. Kiểm tra bộ đệm (Translation Cache)
    const overallKey = `full_${TranslationService.getCacheKey(trimmedText, sourceLang, targetLang)}`;
    if (TranslationService.cache.has(overallKey)) {
      return TranslationService.cache.get(overallKey)!;
    }

    // 2. Chia nhỏ văn bản thành các đoạn <= 1500 ký tự theo dấu chấm câu
    const chunks = TranslationService.splitIntoChunks(trimmedText, TranslationService.CHUNK_SIZE);

    // 3. Lấy API Key Gemini (nếu người dùng đã cài đặt)
    const apiKey = await GeminiService.getApiKey();

    // 4. Dịch song song các đoạn (Parallel execution)
    const translatedChunks = await Promise.all(
      chunks.map((chunk) => TranslationService.translateChunk(chunk, targetLang, sourceLang, apiKey))
    );

    const isGemini = translatedChunks.some((c) => c.provider === 'gemini');
    const combined = translatedChunks
      .map((c) => c.text)
      .filter(Boolean)
      .join('\n\n');

    const result = combined
      ? (isGemini
          ? `🌐 Dịch bởi Gemini AI:\n\n${combined}`
          : `🌐 Dịch nhanh:\n\n${combined}`)
      : 'Không có kết quả dịch phù hợp.';

    // 5. Lưu vào bộ đệm bộ nhớ và ghi nhận ngay vào Storage bền vững
    TranslationService.setCache(overallKey, result);
    if (TranslationService.saveTimeoutId) {
      clearTimeout(TranslationService.saveTimeoutId);
      TranslationService.saveTimeoutId = null;
    }
    await TranslationService.savePersistentCache();

    return result;
  }
}

// Nạp trước bộ đệm bất đồng bộ khi khởi động module để tăng tốc độ phản hồi
TranslationService.initPersistentCache().catch(() => {});

export default TranslationService;
