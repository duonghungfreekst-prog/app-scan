/**
 * gemini.service.ts — Service kết nối Google Gemini Multimodal Vision API
 * - Truyền API Key qua Header x-goog-api-key (Bảo mật, không lộ trên URL)
 * - Tự động tiền xử lý nén/resize ảnh tối đa 1024px trước khi gửi để tiết kiệm token & RAM
 * - Tự động thử lại (Retry with Exponential Backoff & Random Jitter) đặc biệt cho mã lỗi HTTP 429
 * - Bóc tách dữ liệu có cấu trúc (Structured JSON Output): Hóa đơn VAT, CCCD gắn chip, Danh thiếp
 * - Phân loại chi tiết lỗi: Quota Exceeded (429), Invalid Key (400/403), Network Timeout
 */

import { Image } from 'react-native';
import SecureStorage from '../../core/security/secureStorage';
import { STORAGE_KEYS, AI_CONFIG } from '../../constants/config';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';

export interface GeminiConfig {
  model: string;
  timeoutMs: number;
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

export interface GenerateOptions {
  responseMimeType?: string;
  temperature?: number;
  maxOutputTokens?: number;
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
   * Tiền xử lý: resize và nén ảnh về kích thước tối đa 1024px trước khi gửi base64 lên Gemini API.
   * Giúp tiết kiệm token đầu vào và tăng tốc độ phản hồi.
   */
  public static async prepareOptimizedBase64(imageUriOrBase64: string): Promise<string> {
    let tempFilePath: string | null = null;
    try {
      let sourceUri = imageUriOrBase64;

      // 1. Chuẩn hóa nguồn ảnh: nếu là data URI hoặc raw base64 -> lưu tạm vào file cache để thao tác ImageManipulator
      if (imageUriOrBase64.startsWith('data:')) {
        const base64Data = imageUriOrBase64.split(',')[1];
        tempFilePath = `${FileSystem.cacheDirectory}gemini_opt_${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;
        await FileSystem.writeAsStringAsync(tempFilePath, base64Data, {
          encoding: FileSystem.EncodingType.Base64,
        });
        sourceUri = tempFilePath;
      } else if (!imageUriOrBase64.startsWith('file://') && !imageUriOrBase64.startsWith('/') && !imageUriOrBase64.startsWith('content://')) {
        tempFilePath = `${FileSystem.cacheDirectory}gemini_opt_${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;
        await FileSystem.writeAsStringAsync(tempFilePath, imageUriOrBase64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        sourceUri = tempFilePath;
      }

      // 2. Tính toán kích thước để resize chiều lớn nhất về tối đa MAX_IMAGE_DIMENSION (1024px)
      const maxDim = AI_CONFIG.MAX_IMAGE_DIMENSION || 1024;
      const actions: ImageManipulator.Action[] = [];

      try {
        const dimensions = await new Promise<{ width: number; height: number }>((resolve) => {
          Image.getSize(
            sourceUri,
            (width, height) => resolve({ width, height }),
            () => resolve({ width: 0, height: 0 })
          );
        });

        if (dimensions.width > 0 && dimensions.height > 0) {
          if (dimensions.width > maxDim || dimensions.height > maxDim) {
            if (dimensions.width >= dimensions.height) {
              actions.push({ resize: { width: maxDim } });
            } else {
              actions.push({ resize: { height: maxDim } });
            }
          }
        } else {
          actions.push({ resize: { width: maxDim } });
        }
      } catch {
        actions.push({ resize: { width: maxDim } });
      }

      // 3. Thực hiện resize và nén JPEG chất lượng 0.75
      const manipResult = await ImageManipulator.manipulateAsync(
        sourceUri,
        actions,
        { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );

      if (manipResult.base64) {
        return manipResult.base64;
      }

      return await FileSystem.readAsStringAsync(manipResult.uri || sourceUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
    } catch (e) {
      console.warn('[GeminiService] Could not optimize image, falling back to direct read:', e);
      if (imageUriOrBase64.startsWith('data:')) {
        return imageUriOrBase64.split(',')[1];
      }
      if (imageUriOrBase64.startsWith('file://') || imageUriOrBase64.startsWith('/') || imageUriOrBase64.startsWith('content://')) {
        return await FileSystem.readAsStringAsync(imageUriOrBase64, {
          encoding: FileSystem.EncodingType.Base64,
        });
      }
      return imageUriOrBase64;
    } finally {
      if (tempFilePath) {
        try {
          await FileSystem.deleteAsync(tempFilePath, { idempotent: true });
        } catch {
          // Bỏ qua lỗi dọn file tạm
        }
      }
    }
  }

  /**
   * Gọi Gemini Multimodal API kèm cơ chế Retry với Exponential Backoff & Random Jitter
   */
  public static async generateContentWithImage(
    prompt: string,
    imageInput: string,
    mimeType: string = 'image/jpeg',
    options?: GenerateOptions
  ): Promise<string> {
    const apiKey = await this.getApiKey();
    if (!apiKey) {
      throw new Error('Chưa cấu hình API Key. Vui lòng nhập Gemini API Key cá nhân trong Cài đặt.');
    }

    const base64Data = await this.prepareOptimizedBase64(imageInput);
    const endpoint = `${AI_CONFIG.GEMINI_ENDPOINT}/models/${this.config.model}:generateContent`;

    let attempt = 0;
    const baseInitialDelay = AI_CONFIG.RETRY_INITIAL_DELAY_MS || 1000;

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
              temperature: options?.temperature ?? AI_CONFIG.TEMPERATURE,
              maxOutputTokens: options?.maxOutputTokens ?? AI_CONFIG.MAX_OUTPUT_TOKENS,
              ...(options?.responseMimeType ? { responseMimeType: options.responseMimeType } : {}),
            },
          }),
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const status = response.status;
          const errBody = await response.text();

          // Phân loại mã lỗi Quota (429) / Auth / Server
          if (status === 429) {
            if (attempt <= AI_CONFIG.MAX_RETRIES) {
              // Cải tiến: Exponential Backoff kết hợp Random Jitter (Equal Jitter)
              const exponentialBackoff = baseInitialDelay * Math.pow(2, attempt - 1);
              const halfBackoff = Math.floor(exponentialBackoff / 2);
              const jitter = Math.floor(Math.random() * halfBackoff);
              let waitTime = Math.min(halfBackoff + jitter, 16000);

              // Tôn trọng header Retry-After nếu có từ máy chủ
              const retryAfterHeader = response.headers?.get?.('retry-after');
              if (retryAfterHeader) {
                const parsedSec = parseInt(retryAfterHeader, 10);
                if (!isNaN(parsedSec) && parsedSec > 0) {
                  waitTime = parsedSec * 1000 + Math.floor(Math.random() * 500);
                }
              }

              console.warn(
                `[GeminiService] Gặp mã lỗi 429 (Rate Limit / Quota Exceeded). ` +
                `Thử lại lần ${attempt}/${AI_CONFIG.MAX_RETRIES} sau ${waitTime}ms (Exponential Backoff + Random Jitter)...`
              );

              await new Promise(res => setTimeout(res, waitTime));
              continue;
            }
            throw new Error('Đã vượt quá hạn mức truy vấn Gemini (HTTP 429 - Quota Limit). Vui lòng thử lại sau vài giây hoặc kiểm tra hạn mức API Key.');
          }

          if (status === 400 || status === 403) {
            throw new Error('Gemini API Key không hợp lệ hoặc không có quyền truy cập mô hình này.');
          }

          if (status >= 500 && attempt <= AI_CONFIG.MAX_RETRIES) {
            const exponentialBackoff = baseInitialDelay * Math.pow(2, attempt - 1);
            const jitter = Math.floor(Math.random() * (exponentialBackoff * 0.5));
            const waitTime = Math.min(exponentialBackoff + jitter, 10000);
            console.warn(`[GeminiService] Lỗi máy chủ HTTP ${status}. Thử lại lần ${attempt}/${AI_CONFIG.MAX_RETRIES} sau ${waitTime}ms...`);
            await new Promise(res => setTimeout(res, waitTime));
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

        const msg: string = typeof error?.message === 'string' ? error.message : String(error);
        if (attempt >= AI_CONFIG.MAX_RETRIES || msg.includes('API Key') || msg.includes('Quota') || msg.includes('429')) {
          throw error instanceof Error ? error : new Error(msg);
        }

        // Áp dụng Exponential Backoff + Random Jitter cho các lỗi mạng tạm thời
        const exponentialBackoff = baseInitialDelay * Math.pow(2, attempt - 1);
        const jitter = Math.floor(Math.random() * (exponentialBackoff * 0.5));
        const waitTime = Math.min(exponentialBackoff + jitter, 10000);
        console.warn(`[GeminiService] Lỗi kết nối (${msg}). Thử lại lần ${attempt}/${AI_CONFIG.MAX_RETRIES} sau ${waitTime}ms...`);
        await new Promise(res => setTimeout(res, waitTime));
      }
    }
  }

  /**
   * Helper an toàn bóc tách JSON từ raw output của Gemini (hỗ trợ cả trường hợp markdown backticks)
   */
  private static parseStructuredJson<T>(rawText: string, fallbackValue: T): T {
    try {
      const cleaned = rawText
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
      return JSON.parse(cleaned) as T;
    } catch (e) {
      console.warn('[GeminiService] Không thể parse JSON trực tiếp, đang thử trích xuất bằng regex:', e);
      const match = rawText.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          return JSON.parse(match[0]) as T;
        } catch {
          // Bỏ qua nếu vẫn không parse được
        }
      }
      return fallbackValue;
    }
  }

  /**
   * Bóc tách thông tin Hóa đơn VAT (Số HĐ, Ngày lập, Đơn vị bán, MST, Chi tiết mặt hàng, Tổng tiền, Thuế VAT)
   * Yêu cầu Structured JSON Output từ Gemini.
   */
  public static async extractVATInvoice(imageInput: string): Promise<VATInvoiceData> {
    const prompt = `Bạn là chuyên gia OCR và phân tích tài liệu tài chính, kế toán Việt Nam.
Hãy trích xuất chính xác thông tin từ hình ảnh Hóa đơn Giá trị gia tăng (VAT / GTGT) này.
Trả về kết quả dưới định dạng JSON thuần túy (Structured JSON Output) theo đúng cấu trúc sau:
{
  "invoiceNumber": "Số HĐ (Số hóa đơn)",
  "invoiceDate": "Ngày lập (định dạng DD/MM/YYYY hoặc chuỗi ngày tháng năm)",
  "sellerName": "Tên Đơn vị bán (Công ty, Doanh nghiệp hoặc Cửa hàng bán)",
  "taxCode": "Mã số thuế (MST) của đơn vị bán",
  "items": [
    {
      "name": "Tên hàng hóa, dịch vụ",
      "unit": "Đơn vị tính",
      "quantity": 1,
      "unitPrice": 100000,
      "total": 100000
    }
  ],
  "subTotal": 100000,
  "vatRate": "Thuế suất VAT (ví dụ: 8%, 10%)",
  "vatAmount": 10000,
  "totalAmount": 110000
}

Yêu cầu bắt buộc:
1. Bóc tách chuẩn xác các trường: Số HĐ (invoiceNumber), Ngày lập (invoiceDate), Đơn vị bán (sellerName), MST (taxCode), Chi tiết mặt hàng (items), Thuế VAT (vatAmount), Tổng tiền (totalAmount).
2. Các trường số tiền và số lượng phải là kiểu number, không chứa dấu phân cách hàng nghìn.
3. Nếu trường thông tin nào không xuất hiện trong ảnh, hãy để giá trị rỗng "" (chuỗi) hoặc 0 (số) hoặc mảng rỗng [].
4. Chỉ trả về chuỗi JSON hợp lệ, tuyệt đối không thêm lời giải thích hay bọc markdown.`;

    const raw = await this.generateContentWithImage(prompt, imageInput, 'image/jpeg', {
      responseMimeType: 'application/json',
      temperature: 0.1,
    });

    const fallback: VATInvoiceData = {
      invoiceNumber: '',
      invoiceDate: '',
      sellerName: '',
      taxCode: '',
      items: [],
      vatAmount: 0,
      totalAmount: 0,
    };

    return this.parseStructuredJson<VATInvoiceData>(raw, fallback);
  }

  /**
   * Bóc tách thông tin CCCD gắn chip (Số CCCD, Họ và tên, Ngày sinh, Giới tính, Quê quán, Nơi thường trú)
   * Yêu cầu Structured JSON Output từ Gemini.
   */
  public static async extractCitizenCard(imageInput: string): Promise<CitizenCardData> {
    const prompt = `Bạn là chuyên gia OCR và nhận diện giấy tờ tùy thân của Việt Nam.
Hãy trích xuất chính xác thông tin từ thẻ Căn cước công dân (CCCD) gắn chip trong hình ảnh này.
Trả về kết quả dưới định dạng JSON thuần túy (Structured JSON Output) theo đúng cấu trúc sau:
{
  "idNumber": "Số CCCD (12 chữ số)",
  "fullName": "Họ và tên (chữ in hoa có dấu tiếng Việt đầy đủ)",
  "dateOfBirth": "Ngày sinh (định dạng DD/MM/YYYY)",
  "gender": "Giới tính (Nam hoặc Nữ)",
  "placeOfOrigin": "Quê quán (xã/phường, quận/huyện, tỉnh/thành phố)",
  "placeOfResidence": "Nơi thường trú (số nhà, đường, xã/phường, quận/huyện, tỉnh/thành phố)"
}

Yêu cầu bắt buộc:
1. Bóc tách chuẩn xác các trường: Số CCCD (idNumber), Họ và tên (fullName), Ngày sinh (dateOfBirth), Giới tính (gender), Quê quán (placeOfOrigin), Nơi thường trú (placeOfResidence).
2. Đọc chuẩn xác các ký tự tiếng Việt có dấu và định dạng ngày tháng DD/MM/YYYY.
3. Nếu trường thông tin nào không tìm thấy hoặc bị mờ, để giá trị rỗng "".
4. Chỉ trả về chuỗi JSON hợp lệ, tuyệt đối không thêm lời giải thích hay bọc markdown.`;

    const raw = await this.generateContentWithImage(prompt, imageInput, 'image/jpeg', {
      responseMimeType: 'application/json',
      temperature: 0.1,
    });

    const fallback: CitizenCardData = {
      idNumber: '',
      fullName: '',
      dateOfBirth: '',
      gender: '',
      placeOfOrigin: '',
      placeOfResidence: '',
    };

    return this.parseStructuredJson<CitizenCardData>(raw, fallback);
  }

  /**
   * Bóc tách thông tin Danh thiếp (Họ tên, Chức danh, Công ty, Số điện thoại, Email, Website, Địa chỉ)
   * Yêu cầu Structured JSON Output từ Gemini.
   */
  public static async extractBusinessCard(imageInput: string): Promise<BusinessCardData> {
    const prompt = `Bạn là chuyên gia OCR và trích xuất danh bạ thông minh từ danh thiếp (Business Card / Name Card).
Hãy phân tích hình ảnh danh thiếp này và trích xuất toàn bộ thông tin liên hệ.
Trả về kết quả dưới định dạng JSON thuần túy (Structured JSON Output) theo đúng cấu trúc sau:
{
  "name": "Họ và tên",
  "title": "Chức danh / Vị trí công tác",
  "company": "Tên công ty / Doanh nghiệp / Tổ chức",
  "phone": "Số điện thoại liên lạc",
  "email": "Địa chỉ email",
  "website": "Trang web / URL",
  "address": "Địa chỉ văn phòng / công ty"
}

Yêu cầu bắt buộc:
1. Bóc tách chuẩn xác các trường: Họ tên (name), Chức danh (title), Công ty (company), Số điện thoại (phone), Email (email), Website (website), Địa chỉ (address).
2. Nếu có nhiều số điện thoại hoặc email, có thể nối bằng dấu phẩy hoặc ưu tiên thông tin chính.
3. Nếu trường thông tin nào không có trên danh thiếp, để giá trị rỗng "".
4. Chỉ trả về chuỗi JSON hợp lệ, tuyệt đối không thêm lời giải thích hay bọc markdown.`;

    const raw = await this.generateContentWithImage(prompt, imageInput, 'image/jpeg', {
      responseMimeType: 'application/json',
      temperature: 0.1,
    });

    const fallback: BusinessCardData = {
      name: '',
      title: '',
      company: '',
      phone: '',
      email: '',
      website: '',
      address: '',
    };

    return this.parseStructuredJson<BusinessCardData>(raw, fallback);
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
    const raw = await this.generateContentWithImage(prompt, imageInput, 'image/jpeg', {
      responseMimeType: 'application/json',
    });
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
