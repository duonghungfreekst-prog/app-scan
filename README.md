# 📱 DocScan Pro (CamScanner Expo)

> **Ứng dụng quét tài liệu đa năng, xử lý hình ảnh thông minh và tích hợp AI Vision mạnh mẽ trên nền tảng React Native & Expo SDK 57.**

---

## 🌟 Tính năng Nổi bật

- 📄 **Quét tài liệu thông minh (Smart Scanner):** Tự động phát hiện góc giấy và nắn thẳng phối cảnh (Perspective Warp) qua Google ML Kit native module trên bản build Android APK, hỗ trợ nắn chỉnh 4 góc thủ công (CropView) và quét tới 20 trang liên tục.
- 🎨 **Bộ lọc hình ảnh chuyên sâu:** 
  - `Magic Paper`: Tự động làm trắng nền giấy, tăng độ sắc nét chữ bằng Unsharp Mask (high-pass filter), giữ nguyên màu mộc đỏ và mực chữ ký.
  - `Grayscale` & `Black & White`: Nhị phân hóa thích ứng theo lưới nền cục bộ (Adaptive Local Threshold) tối ưu dung lượng cho tài liệu văn phòng.
- 📐 **Căn chỉnh viền thủ công (CropView):** Kéo thả 4 góc tự do để tùy biến vùng quét chính xác.
- 📑 **Xuất PDF & Văn phòng:** Tạo tài liệu PDF tiêu chuẩn, chuyển đổi sang Word (`.docx`) và Excel (`.xlsx`).
- 🤖 **Trí tuệ nhân tạo (Gemini AI Vision):**
  - OCR nhận dạng chữ viết tay và văn bản in siêu chính xác.
  - Giải toán thông minh: Kết hợp giải nhanh bằng On-device CAS (`Nerdamer`) và phân tích bài toán hình học/sơ đồ bằng Gemini Vision.
  - Dịch thuật tài liệu đa ngôn ngữ.
- 🏁 **Công cụ Mã QR & Barcode:**
  - Quét mã siêu tốc từ Camera hoặc thư viện ảnh, tự động nhận diện và chặn các URL scheme nguy hiểm (javascript:, data:, file:...).
  - Tạo mã QR đa dạng mẫu (Wi-Fi, Website, Điện thoại, Email, Danh thiếp).
- 📁 **Quản lý Tài liệu Chuyên nghiệp:** Tạo thư mục phân cấp, điều hướng Breadcrumb, tìm kiếm theo thời gian thực và tự động đánh số chống ghi đè file.
- 🌙 **Giao diện Đẳng cấp:** Hỗ trợ Dark Mode và Light Mode mượt mà.
- 🚀 **Tự động Cập nhật:** Kiểm tra và thông báo khi có bản phát hành mới từ GitHub Releases.

---

## 🏗️ Kiến trúc Dự án (Clean Architecture)

```
src/
├── core/                         # Nền tảng cốt lõi
│   ├── config/                   # Cấu hình hệ thống, theme tokens
│   └── security/                 # Lưu trữ an toàn (Android Keystore / iOS Keychain)
│
├── services/                     # Business Logic độc lập
│   ├── ai/                       # GeminiService, MathSolverService
│   ├── file/                     # Quản lý file, DocumentItem metadata
│   ├── pdf/                      # Động cơ xuất và nén PDF
│   └── translation/              # Dịch thuật an toàn có timeout
│
├── screens/                      # Giao diện chính của ứng dụng
│   ├── HomeScreen.tsx            # Trang chủ, công cụ nhanh & file gần đây
│   ├── ScannerScreen.tsx         # Màn hình chụp quét và tiền xử lý ảnh
│   ├── FilesScreen.tsx           # Quản lý thư mục và danh mục tài liệu
│   ├── ToolsScreen.tsx           # Trung tâm công cụ (OCR, AI Solver, Convert)
│   ├── MeScreen.tsx              # Cài đặt, tài khoản và quản lý API Key
│   ├── QRScannerScreen.tsx       # Quét mã QR / Barcode
│   └── QRGeneratorScreen.tsx     # Tạo mã QR và lịch sử
│
├── components/                   # UI components dùng chung (CropView, ErrorBoundary, UpdateChecker)
└── utils/                        # Utilities (imageProcessor, fileHelper, storage)
```

---

## 🔒 Bảo mật & Quyền riêng tư (Security & Privacy)

- **Mô hình BYOK (Bring Your Own Key):** Người dùng sử dụng Gemini API Key cá nhân của mình.
- **Mã hóa phần cứng:** API Key được lưu an toàn trong **Android Keystore** và **iOS Keychain** thông qua `expo-secure-store`. Tuyệt đối không lưu plaintext trên bộ nhớ mở.
- **Xử lý ngoại lệ an toàn:** ErrorBoundary và Global Handler tự động lọc bỏ stack trace kỹ thuật trên bản build production.

---

## 🚀 Cài đặt & Khởi chạy

### 1. Yêu cầu môi trường
- Node.js >= 18.0
- npm hoặc yarn
- Ứng dụng **Expo Go** trên điện thoại (để chạy thử nghiệm)

### 2. Cài đặt thư viện
```bash
git clone https://github.com/duonghungfreekst-prog/app-scan.git
cd app-scan
npm install
```

### 3. Chạy ứng dụng (Development)
```bash
npm run start
```
Dùng ứng dụng Expo Go quét mã QR hiển thị trên màn hình terminal để mở app.

### 4. Kiểm tra mã nguồn & Kiểm thử
```bash
# Kiểm tra lỗi kiểu dữ liệu TypeScript
npm run typecheck

# Chạy bộ Unit Tests
npm test
```

### 5. Phát hành phiên bản mới (Release Automation)
Hệ thống CI/CD tự động tăng `versionCode`, cập nhật cấu hình, tag git và kích hoạt GitHub Actions build file APK:
```bash
npm run release <số_phiên_bản>
# Ví dụ:
npm run release 2.5.1
```

---

## 📄 Bản quyền & Giấy phép
Phát hành theo giấy phép [MIT License](LICENSE).
Phát triển trên nền tảng React Native / Expo với các thuật toán xử lý ảnh Unsharp Mask, Dewarp gáy sách, bộ lọc Magic Paper thích ứng và phép biến đổi Homography nắn phối cảnh được tối ưu độc lập.
