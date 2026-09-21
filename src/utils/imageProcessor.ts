/**
 * imageProcessor.ts — Document Image Processing Engine
 * - Perspective Warp (Projective Transform / Homography) nắn góc
 * - Tách bạch rõ ràng: Scan thường (Flat scan) vs Scan sách (Book mode)
 * - Khắc phục hoàn toàn lỗi Dewarp sách làm méo scan tài liệu thông thường
 * - Khử bóng mờ thích ứng (Adaptive Background Normalization)
 * - Tinh chỉnh Magic Paper & B&W adaptive bảo vệ nét chữ chì, chữ xám và con dấu
 * - Tối ưu hóa bộ nhớ: Chunking Queue xử lý tuần tự (1-2 ảnh/lần) chống OOM (Phần 7.1)
 * - Tự động giải phóng TypedArray và Canvas GPU framebuffer
 */

import * as ImageManipulator from 'expo-image-manipulator';
import { FilterMode, ImageProcessingOptions } from '../types/domain';
import { IMAGE_PROCESSING_CONFIG } from '../constants/config';

export { FilterMode, ImageProcessingOptions };

export interface BatchProcessOptions extends Partial<ImageProcessingOptions> {
  batchSize?: number;
  targetWidth?: number;
  compress?: number;
  processor?: (uri: string, index: number) => Promise<string>;
}

/**
 * Xử lý tuần tự mảng ảnh tối đa 1-2 ảnh/lần (Chunking Queue)
 * Chống tràn bộ nhớ OOM (Out-Of-Memory) - Tuân thủ Phần 7.1
 * Tuyệt đối không nạp đồng thời toàn bộ mảng ảnh vào JS RAM
 *
 * @param images Mảng đường dẫn ảnh (file URI hoặc data URI)
 * @param options Tùy chọn xử lý ảnh (batchSize tối đa 2, targetWidth, compress, processor...)
 * @param onProgress Callback báo cáo tiến độ (processed: number, total: number)
 * @returns Mảng đường dẫn ảnh sau khi xử lý
 */
export const processImageBatchSequential = async (
  images: string[],
  options?: BatchProcessOptions,
  onProgress?: (processed: number, total: number) => void
): Promise<string[]> => {
  if (!images || images.length === 0) return [];

  // Giới hạn Chunking Queue: Tối đa 1-2 ảnh mỗi lượt để ngăn chặn OOM (Phần 7.1)
  const requestedBatch = options?.batchSize ?? 2;
  const chunkSize = Math.max(1, Math.min(requestedBatch, 2));

  const targetWidth = options?.targetWidth ?? IMAGE_PROCESSING_CONFIG.QUALITY.medium.width;
  const targetCompress = options?.compress ?? IMAGE_PROCESSING_CONFIG.QUALITY.medium.compress;

  const results: string[] = [];

  for (let i = 0; i < images.length; i += chunkSize) {
    const chunk = images.slice(i, i + chunkSize);
    const chunkResults = await Promise.all(
      chunk.map(async (imgUri, batchIdx) => {
        const actualIndex = i + batchIdx;

        // Cho phép truyền custom processor nếu cần can thiệp từng ảnh
        if (options?.processor) {
          try {
            return await options.processor(imgUri, actualIndex);
          } catch (err) {
            console.warn(`[ImageProcessor] Custom processor failed at index ${actualIndex}:`, err);
            return imgUri;
          }
        }

        // Mặc định: Nén và điều chỉnh kích thước ảnh nếu là file URI
        if (!imgUri.startsWith('data:')) {
          try {
            const manipResult = await ImageManipulator.manipulateAsync(
              imgUri,
              [{ resize: { width: targetWidth } }],
              {
                compress: targetCompress,
                format: ImageManipulator.SaveFormat.JPEG,
                base64: false, // Tuyệt đối không giữ Base64 trong JS RAM để chống OOM
              }
            );
            return manipResult.uri;
          } catch (e) {
            console.warn(`[ImageProcessor] manipulateAsync error at index ${actualIndex}:`, e);
            return imgUri;
          }
        }

        return imgUri;
      })
    );

    results.push(...chunkResults);

    if (onProgress) {
      onProgress(results.length, images.length);
    }
  }

  return results;
};

/**
 * Trả về đoạn code JavaScript xử lý ảnh trên HTML5 Canvas
 * Chạy trực tiếp trong WebView / HTML PDF exporter
 */
export const getCanvasProcessingScript = (config = IMAGE_PROCESSING_CONFIG): string => {
  return `
    /* =====================================================================
       GLOBAL IMAGE PROCESSING CONFIG (Được tiêm từ config.ts)
       ===================================================================== */
    const CFG = ${JSON.stringify(config)};

    /* =====================================================================
       1. PERSPECTIVE WARP (Projective Transform / Homography)
       ===================================================================== */
    function computeHomography(srcPts, dstPts) {
      const A = [];
      for (let i = 0; i < 4; i++) {
        const sx = srcPts[i].x, sy = srcPts[i].y;
        const dx = dstPts[i].x, dy = dstPts[i].y;
        A.push([-sx, -sy, -1, 0, 0, 0, dx * sx, dx * sy, dx]);
        A.push([0, 0, 0, -sx, -sy, -1, dy * sx, dy * sy, dy]);
      }

      const M = [];
      const b = [];
      for (let i = 0; i < 8; i++) {
        M.push(A[i].slice(0, 8));
        b.push(-A[i][8]);
      }

      for (let col = 0; col < 8; col++) {
        let maxRow = col;
        let maxVal = Math.abs(M[col][col]);
        for (let row = col + 1; row < 8; row++) {
          if (Math.abs(M[row][col]) > maxVal) {
            maxVal = Math.abs(M[row][col]);
            maxRow = row;
          }
        }
        [M[col], M[maxRow]] = [M[maxRow], M[col]];
        [b[col], b[maxRow]] = [b[maxRow], b[col]];

        if (Math.abs(M[col][col]) < 1e-10) continue;

        const pivot = M[col][col];
        for (let j = col; j < 8; j++) M[col][j] /= pivot;
        b[col] /= pivot;

        for (let row = 0; row < 8; row++) {
          if (row === col) continue;
          const factor = M[row][col];
          for (let j = col; j < 8; j++) M[row][j] -= factor * M[col][j];
          b[row] -= factor * b[col];
        }
      }

      const h = [...b, 1];
      return [
        [h[0], h[1], h[2]],
        [h[3], h[4], h[5]],
        [h[6], h[7], h[8]],
      ];
    }

    function applyPerspectiveWarp(srcCanvas, corners, dstW, dstH) {
      const dstCanvas = document.createElement('canvas');
      dstCanvas.width = dstW;
      dstCanvas.height = dstH;
      const dstCtx = dstCanvas.getContext('2d');

      const srcCtx = srcCanvas.getContext('2d');
      const srcW = srcCanvas.width;
      const srcH = srcCanvas.height;
      let srcImgData = srcCtx.getImageData(0, 0, srcW, srcH);
      let srcData = srcImgData.data;

      const dstPts = [
        { x: 0,    y: 0 },
        { x: dstW, y: 0 },
        { x: 0,    y: dstH },
        { x: dstW, y: dstH },
      ];
      const srcPts = corners;

      const H = computeHomography(dstPts, srcPts);
      let dstImgData = dstCtx.createImageData(dstW, dstH);
      let dstData = dstImgData.data;

      for (let dy = 0; dy < dstH; dy++) {
        for (let dx = 0; dx < dstW; dx++) {
          const wx = H[0][0]*dx + H[0][1]*dy + H[0][2];
          const wy = H[1][0]*dx + H[1][1]*dy + H[1][2];
          const wz = H[2][0]*dx + H[2][1]*dy + H[2][2];

          const sx = wx / wz;
          const sy = wy / wz;

          if (sx < 0 || sx >= srcW - 1 || sy < 0 || sy >= srcH - 1) {
            const oi = (dy * dstW + dx) * 4;
            dstData[oi] = 255; dstData[oi+1] = 255; dstData[oi+2] = 255; dstData[oi+3] = 255;
            continue;
          }

          const x0 = Math.floor(sx), y0 = Math.floor(sy);
          const x1 = x0 + 1, y1 = y0 + 1;
          const fx = sx - x0, fy = sy - y0;

          const i00 = (y0 * srcW + x0) * 4;
          const i10 = (y0 * srcW + x1) * 4;
          const i01 = (y1 * srcW + x0) * 4;
          const i11 = (y1 * srcW + x1) * 4;

          const oi = (dy * dstW + dx) * 4;
          for (let c = 0; c < 3; c++) {
            dstData[oi + c] = Math.round(
              srcData[i00+c] * (1-fx) * (1-fy) +
              srcData[i10+c] * fx     * (1-fy) +
              srcData[i01+c] * (1-fx) * fy     +
              srcData[i11+c] * fx     * fy
            );
          }
          dstData[oi + 3] = 255;
        }
      }

      dstCtx.putImageData(dstImgData, 0, 0);

      // Giải phóng mảng đệm Uint8ClampedArray
      srcImgData = null;
      srcData = null;
      dstImgData = null;
      dstData = null;

      return dstCanvas;
    }

    /* =====================================================================
       2. BOOK SPINE DEWARP (CHỈ KÍCH HOẠT KHI bookMode === true)
       ===================================================================== */
    function dewarpBookSpine(srcCanvas) {
      const W = srcCanvas.width;
      const H = srcCanvas.height;
      const srcCtx = srcCanvas.getContext('2d');
      let srcImgData = srcCtx.getImageData(0, 0, W, H);
      let srcData = srcImgData.data;

      let leftLum = [];
      let rightLum = [];
      const sampleStep = Math.max(1, Math.floor(H / 40));
      for (let y = 0; y < H; y += sampleStep) {
        let sumL = 0, sumR = 0, cnt = 0;
        for (let x = 0; x < Math.floor(W * 0.2); x += 2) {
          const idx = (y * W + x) * 4;
          sumL += 0.299 * srcData[idx] + 0.587 * srcData[idx+1] + 0.114 * srcData[idx+2];
          cnt++;
        }
        leftLum.push(sumL / cnt);
        cnt = 0;
        for (let x = Math.floor(W * 0.8); x < W; x += 2) {
          const idx = (y * W + x) * 4;
          sumR += 0.299 * srcData[idx] + 0.587 * srcData[idx+1] + 0.114 * srcData[idx+2];
          cnt++;
        }
        rightLum.push(sumR / cnt);
      }

      let leftGrad = 0, rightGrad = 0;
      for (let i = 1; i < leftLum.length - 1; i++) {
        leftGrad += Math.abs(leftLum[i] - leftLum[i-1]);
        rightGrad += Math.abs(rightLum[i] - rightLum[i-1]);
      }
      leftLum = null;
      rightLum = null;

      const avgGrad = (leftGrad + rightGrad) / 2;
      if (avgGrad < (CFG.BOOK_DEWARP_MIN_GRADIENT || 4.0)) {
        srcImgData = null;
        srcData = null;
        return srcCanvas; // Không cong đáng kể thì giữ nguyên
      }

      const A = Math.min(CFG.BOOK_DEWARP_MAX_SHIFT_RATIO || 0.06, avgGrad / (CFG.BOOK_DEWARP_GRADIENT_DIVISOR || 200)) * W;
      const dstCanvas = document.createElement('canvas');
      dstCanvas.width = W;
      dstCanvas.height = H;
      const dstCtx = dstCanvas.getContext('2d');
      let dstData = dstCtx.createImageData(W, H);
      let dstPx = dstData.data;

      for (let dy = 0; dy < H; dy++) {
        const t = dy / H - 0.5;
        const shift = A * t * t;

        for (let dx = 0; dx < W; dx++) {
          const sx = dx + shift * (dx < W/2 ? -1 : 1);
          const sy = dy;

          if (sx < 0 || sx >= W - 1) {
            const oi = (dy * W + dx) * 4;
            dstPx[oi] = 255; dstPx[oi+1] = 255; dstPx[oi+2] = 255; dstPx[oi+3] = 255;
            continue;
          }

          const x0 = Math.floor(sx);
          const fx = sx - x0;
          const i0 = (Math.floor(sy) * W + x0) * 4;
          const i1 = (Math.floor(sy) * W + (x0+1)) * 4;
          const oi = (dy * W + dx) * 4;

          for (let c = 0; c < 3; c++) {
            dstPx[oi+c] = Math.round(srcData[i0+c] * (1-fx) + srcData[i1+c] * fx);
          }
          dstPx[oi+3] = 255;
        }
      }

      dstCtx.putImageData(dstData, 0, 0);

      // Giải phóng mảng đệm Uint8ClampedArray
      srcImgData = null;
      srcData = null;
      dstData = null;
      dstPx = null;

      return dstCanvas;
    }

    /* =====================================================================
       2b. UNSHARP MASK — làm nét chữ thật sự thay vì chỉ đẩy độ tương phản
       ===================================================================== */
    function applyUnsharpMask(data, W, H, amount) {
      // Box-blur 3x3 trên kênh luminance rồi cộng lại phần chênh lệch (high-pass)
      // vào ảnh gốc. Rẻ hơn Gaussian nhưng đủ để làm nét chữ scan mà không sinh
      // halo quá mức ở tài liệu văn bản thông thường.
      const len = W * H;
      let lum = new Float32Array(len);
      for (let i = 0; i < len; i++) {
        const o = i * 4;
        lum[i] = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
      }
      let blurred = new Float32Array(len);
      for (let y = 0; y < H; y++) {
        const y0 = Math.max(0, y - 1), y1 = Math.min(H - 1, y + 1);
        for (let x = 0; x < W; x++) {
          const x0 = Math.max(0, x - 1), x1 = Math.min(W - 1, x + 1);
          let sum = 0;
          sum += lum[y0 * W + x0] + lum[y0 * W + x] + lum[y0 * W + x1];
          sum += lum[y * W + x0]  + lum[y * W + x]  + lum[y * W + x1];
          sum += lum[y1 * W + x0] + lum[y1 * W + x] + lum[y1 * W + x1];
          blurred[y * W + x] = sum / 9;
        }
      }
      for (let i = 0; i < len; i++) {
        const highPass = lum[i] - blurred[i];
        const gain = 1 + amount * (highPass / 255);
        const o = i * 4;
        for (let c = 0; c < 3; c++) {
          data[o + c] = Math.max(0, Math.min(255, Math.round(data[o + c] * gain + highPass * amount)));
        }
      }

      // GIẢI PHÓNG các Float32Array không dùng đến ngay lập tức
      lum = null;
      blurred = null;
    }

    /* =====================================================================
       3. MAGIC PAPER & ADAPTIVE BINARIZATION ENHANCEMENT
       ===================================================================== */
    function applyMagicEnhancement(canvas, filterMode, contrastFactor) {
      const W = canvas.width;
      const H = canvas.height;
      const ctx = canvas.getContext('2d');
      let imgData = ctx.getImageData(0, 0, W, H);
      let data = imgData.data;

      // FIX: contrastFactor was previously accepted but never used anywhere in this
      // function, so the "Scan quality" contrast setting had zero visible effect on
      // the output. Clamp it to a sane range and derive a gamma exponent + B&W
      // threshold multiplier from it so the slider/quality setting is now real.
      const defaultContrast = CFG.DEFAULT_CONTRAST || 1.45;
      const minContrast = CFG.CONTRAST_MIN || 0.6;
      const maxContrast = CFG.CONTRAST_MAX || 2.2;
      const cf = Math.max(minContrast, Math.min(maxContrast, Number(contrastFactor) || defaultContrast));
      const baseGamma = CFG.MAGIC_CONTRAST_POWER || 2.6;
      const gammaPower = baseGamma * (cf / defaultContrast);
      const baseBwMul = CFG.BW_THRESHOLD_BASE_RATIO || 0.76;
      const bwThresholdMul = baseBwMul * (1 / (cf / defaultContrast));

      // FIX: apply a lightweight unsharp-mask so scanned text edges look genuinely
      // crisper instead of only being pushed through a brightness curve.
      applyUnsharpMask(data, W, H, CFG.UNSHARP_MASK_AMOUNT || 0.55);

      // Ước lượng nền chiếu sáng (Illumination background estimation)
      const bgW = Math.max(16, Math.floor(W / 32));
      const bgH = Math.max(16, Math.floor(H / 32));
      let bgMap = new Float32Array(bgW * bgH);
      let bgCount = new Uint16Array(bgW * bgH);

      const cellW = W / bgW;
      const cellH = H / bgH;

      for (let y = 0; y < H; y += 4) {
        const by = Math.min(bgH - 1, Math.floor(y / cellH));
        for (let x = 0; x < W; x += 4) {
          const bx = Math.min(bgW - 1, Math.floor(x / cellW));
          const idx = (y * W + x) * 4;
          const lum = 0.299 * data[idx] + 0.587 * data[idx+1] + 0.114 * data[idx+2];
          const bIdx = by * bgW + bx;
          bgMap[bIdx] += lum;
          bgCount[bIdx]++;
        }
      }

      let smoothedBg = new Float32Array(bgW * bgH);
      for (let by = 0; by < bgH; by++) {
        for (let bx = 0; bx < bgW; bx++) {
          let sum = 0, count = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const ny = by + dy, nx = bx + dx;
              if (ny >= 0 && ny < bgH && nx >= 0 && nx < bgW) {
                const bIdx = ny * bgW + nx;
                if (bgCount[bIdx] > 0) {
                  sum += bgMap[bIdx] / bgCount[bIdx];
                  count++;
                }
              }
            }
          }
          smoothedBg[by * bgW + bx] = count > 0 ? (sum / count) : 200;
        }
      }

      // GIẢI PHÓNG các mảng đệm không dùng đến ngay sau khi tính xong smoothedBg
      bgMap = null;
      bgCount = null;

      const edgeCleanupRatio = (CFG.EDGE_CLEANUP_TRIM_PERCENT || 1.5) / 100;
      const bufX = Math.floor(W * edgeCleanupRatio);
      const bufY = Math.floor(H * edgeCleanupRatio);

      const stampMinR = CFG.STAMP_RED_MIN || 90;
      const stampDom = CFG.STAMP_RED_DOMINANCE || 35;
      const inkMinB = CFG.INK_BLUE_MIN || 80;
      const inkDom = CFG.INK_BLUE_DOMINANCE || 25;
      const shadowEdgeThresh = CFG.SHADOW_EDGE_THRESHOLD || 190;
      const whiteThresh = CFG.MAGIC_WHITE_THRESHOLD || 195;
      const inkCeiling = CFG.MAGIC_INK_CEILING || 215;
      const grayWhiteThresh = CFG.GRAYSCALE_WHITE_THRESHOLD || 220;

      const redFactor = CFG.COLOR_BOOST?.STAMP_RED_FACTOR || 1.4;
      const redSuppress = CFG.COLOR_BOOST?.STAMP_RED_SUPPRESS || 0.4;
      const blueFactor = CFG.COLOR_BOOST?.INK_BLUE_FACTOR || 1.4;
      const blueRedSuppress = CFG.COLOR_BOOST?.INK_BLUE_RED_SUPPRESS || 0.4;
      const blueGreenSuppress = CFG.COLOR_BOOST?.INK_BLUE_GREEN_SUPPRESS || 0.5;

      for (let y = 0; y < H; y++) {
        const bgY = Math.min(bgH - 1, Math.floor((y / H) * bgH));
        const isYEdge = y < bufY || y > H - bufY;

        for (let x = 0; x < W; x++) {
          const bgX = Math.min(bgW - 1, Math.floor((x / W) * bgW));
          const bgLum = Math.max(15, smoothedBg[bgY * bgW + bgX]);

          const idx = (y * W + x) * 4;
          let r = data[idx], g = data[idx+1], b = data[idx+2];
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;

          // Bảo vệ màu con dấu đỏ và mực xanh dương
          const isRedStamp = r > stampMinR && r > g + stampDom && r > b + stampDom;
          const isBlueInk  = b > inkMinB && b > r + inkDom && b > g + inkDom;

          // Chuẩn hóa tương đối theo nền cục bộ
          let normLum = (lum / bgLum) * 255;
          const isEdge = isYEdge || x < bufX || x > W - bufX;

          // Dọn viền ngoài nếu là shadow đen thừa
          if (isEdge && !isRedStamp && !isBlueInk && normLum < shadowEdgeThresh) {
            data[idx] = 255; data[idx+1] = 255; data[idx+2] = 255;
            continue;
          }

          if (filterMode === 'magic') {
            if (isRedStamp) {
              r = Math.min(255, Math.round(r * redFactor));
              g = Math.max(0, Math.round(g * redSuppress));
              b = Math.max(0, Math.round(b * redSuppress));
            } else if (isBlueInk) {
              b = Math.min(255, Math.round(b * blueFactor));
              r = Math.max(0, Math.round(r * blueRedSuppress));
              g = Math.max(0, Math.round(g * blueGreenSuppress));
            } else {
              // Nâng cấp: Soft Gamma binarization chống mất nét chữ chì
              if (normLum > whiteThresh) {
                r = g = b = 255;
              } else {
                let factor = Math.max(0, normLum / whiteThresh);
                factor = Math.pow(factor, gammaPower); // giờ phản ứng theo contrastFactor thật
                const finalVal = Math.round(factor * inkCeiling);
                r = g = b = finalVal;
              }
            }
          } else if (filterMode === 'bw') {
            // Adaptive local threshold thay vì so sánh tuyệt đối với 185
            const localThreshold = bgLum * bwThresholdMul;
            r = g = b = (lum > localThreshold && !isRedStamp && !isBlueInk) ? 255 : 0;
          } else if (filterMode === 'grayscale') {
            let gray = normLum;
            if (gray > grayWhiteThresh) gray = 255;
            r = g = b = Math.min(255, Math.round(gray));
          }

          data[idx] = r; data[idx+1] = g; data[idx+2] = b;
        }
      }

      ctx.putImageData(imgData, 0, 0);

      // GIẢI PHÓNG smoothedBg và Uint8ClampedArray (imgData/data)
      smoothedBg = null;
      imgData = null;
      data = null;

      return canvas;
    }

    /* =====================================================================
       4. MAIN: processImageCanvas
       ===================================================================== */
    function processImageCanvas(imgElement, filterMode, options) {
      options = options || {};
      const trimPercent = options.trimMarginPercent || 0;
      const contrastFactor = options.contrast || CFG.DEFAULT_CONTRAST || 1.45;

      const origWidth  = imgElement.naturalWidth  || imgElement.width;
      const origHeight = imgElement.naturalHeight || imgElement.height;
      if (!origWidth || !origHeight) return imgElement.src;

      const srcCanvas = document.createElement('canvas');
      srcCanvas.width  = origWidth;
      srcCanvas.height = origHeight;
      const srcCtx = srcCanvas.getContext('2d');
      srcCtx.drawImage(imgElement, 0, 0, origWidth, origHeight);

      if (filterMode === 'original' && trimPercent === 0 && !options.customCornersRatio) {
        const base64 = srcCanvas.toDataURL('image/jpeg', 0.95);
        // GIẢI PHÓNG BỘ NHỚ ĐỒ HỌA: canvas.width = 0; canvas.height = 0; ctx.clearRect(...)
        try {
          srcCtx.clearRect(0, 0, srcCanvas.width, srcCanvas.height);
          srcCanvas.width = 0;
          srcCanvas.height = 0;
        } catch (e) {}
        return base64;
      }

      let trimCanvas = null;
      let workCanvas = srcCanvas;
      if (trimPercent > 0 && !options.customCornersRatio) {
        const cropX = Math.round(origWidth  * (trimPercent / 100));
        const cropY = Math.round(origHeight * (trimPercent / 100));
        const cropW = origWidth  - cropX * 2;
        const cropH = origHeight - cropY * 2;
        if (cropW > 50 && cropH > 50) {
          trimCanvas = document.createElement('canvas');
          trimCanvas.width = cropW;
          trimCanvas.height = cropH;
          trimCanvas.getContext('2d').drawImage(srcCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
          workCanvas = trimCanvas;
        }
      }

      const W = workCanvas.width, H = workCanvas.height;
      let corners = null;
      if (options.customCornersRatio) {
        corners = options.customCornersRatio.map(r => ({ x: r.x * W, y: r.y * H }));
      }

      // Perspective Warp
      let warpedCanvas = workCanvas;
      if (corners && corners.length === 4) {
        const widthTop  = Math.hypot(corners[1].x - corners[0].x, corners[1].y - corners[0].y);
        const widthBot  = Math.hypot(corners[3].x - corners[2].x, corners[3].y - corners[2].y);
        const heightLeft  = Math.hypot(corners[2].x - corners[0].x, corners[2].y - corners[0].y);
        const heightRight = Math.hypot(corners[3].x - corners[1].x, corners[3].y - corners[1].y);

        const dstW = Math.round(Math.max(widthTop, widthBot));
        const dstH = Math.round(Math.max(heightLeft, heightRight));
        const finalW = Math.max(100, Math.min(dstW, W));
        const finalH = Math.max(100, Math.min(dstH, H));

        try {
          warpedCanvas = applyPerspectiveWarp(workCanvas, corners, finalW, finalH);
        } catch(e) {}
      }

      // Book Spine Dewarp — TUYỆT ĐỐI CHỈ CHẠY KHI options.bookMode === true
      let dewarpedCanvas = warpedCanvas;
      if (options.bookMode === true) {
        try {
          dewarpedCanvas = dewarpBookSpine(warpedCanvas);
        } catch(e) {
          dewarpedCanvas = warpedCanvas;
        }
      }

      // Magic / Color Enhancement
      if (filterMode !== 'original') {
        try {
          applyMagicEnhancement(dewarpedCanvas, filterMode, contrastFactor);
        } catch(e) {}
      }

      let base64Result = '';
      try {
        base64Result = dewarpedCanvas.toDataURL('image/jpeg', 0.95);
      } finally {
        // GIẢI PHÓNG BỘ NHỚ ĐỒ HỌA: canvas.width = 0; canvas.height = 0; ctx.clearRect(...)
        const canvasesToRelease = [srcCanvas, trimCanvas, warpedCanvas, dewarpedCanvas];
        for (let i = 0; i < canvasesToRelease.length; i++) {
          const c = canvasesToRelease[i];
          if (c) {
            try {
              const cCtx = c.getContext('2d');
              if (cCtx && c.width > 0 && c.height > 0) {
                cCtx.clearRect(0, 0, c.width, c.height);
              }
              c.width = 0;
              c.height = 0;
            } catch (err) {}
          }
        }
      }

      return base64Result;
    }

    /* =====================================================================
       5. CHUNKING QUEUE: processImageBatchSequential (WebView Canvas)
       Xử lý tuần tự mảng HTMLImageElement tối đa 1-2 ảnh/lần chống OOM
       ===================================================================== */
    async function processImageBatchSequential(images, options, onProgress) {
      options = options || {};
      const batchSize = Math.max(1, Math.min(options.batchSize || 2, 2));
      const filterMode = options.filterMode || 'magic';
      const results = [];
      for (let i = 0; i < images.length; i += batchSize) {
        const chunk = images.slice(i, i + batchSize);
        const chunkPromises = chunk.map(function(imgEl) {
          return new Promise(function(resolve) {
            try {
              const res = processImageCanvas(imgEl, filterMode, options);
              resolve(res);
            } catch (e) {
              resolve(imgEl.src);
            }
          });
        });
        const chunkRes = await Promise.all(chunkPromises);
        for (let j = 0; j < chunkRes.length; j++) {
          results.push(chunkRes[j]);
        }
        if (typeof onProgress === 'function') {
          onProgress(results.length, images.length);
        }
      }
      return results;
    }
  `;
};

/**
 * Trả về CSS filter fallback cho HTML preview hoặc PDF rendering
 */
export const getCssFilterForMode = (mode: FilterMode): string => {
  switch (mode) {
    case 'magic':
      return 'contrast(160%) brightness(115%) saturate(145%)';
    case 'bw':
      return 'grayscale(100%) contrast(230%) brightness(120%)';
    case 'grayscale':
      return 'grayscale(100%) contrast(145%) brightness(108%)';
    case 'original':
    default:
      return 'none';
  }
};
