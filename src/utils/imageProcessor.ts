/**
 * imageProcessor.ts — Document Image Processing Engine
 * - Perspective Warp (Projective Transform / Homography) nắn góc
 * - Tách bạch rõ ràng: Scan thường (Flat scan) vs Scan sách (Book mode)
 * - Khắc phục hoàn toàn lỗi Dewarp sách làm méo scan tài liệu thông thường
 * - Khử bóng mờ thích ứng (Adaptive Background Normalization)
 * - Tinh chỉnh Magic Paper & B&W adaptive bảo vệ nét chữ chì, chữ xám và con dấu
 */

import { FilterMode, ImageProcessingOptions } from '../types/domain';
import { IMAGE_PROCESSING_CONFIG } from '../constants/config';

export { FilterMode, ImageProcessingOptions };

/**
 * Trả về đoạn code JavaScript xử lý ảnh trên HTML5 Canvas
 * Chạy trực tiếp trong WebView / HTML PDF exporter
 */
export const getCanvasProcessingScript = (): string => {
  return `
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
      const srcData = srcCtx.getImageData(0, 0, srcW, srcH).data;

      const dstPts = [
        { x: 0,    y: 0 },
        { x: dstW, y: 0 },
        { x: 0,    y: dstH },
        { x: dstW, y: dstH },
      ];
      const srcPts = corners;

      const H = computeHomography(dstPts, srcPts);
      const dstImgData = dstCtx.createImageData(dstW, dstH);
      const dstData = dstImgData.data;

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
      return dstCanvas;
    }

    /* =====================================================================
       2. BOOK SPINE DEWARP (CHỈ KÍCH HOẠT KHI bookMode === true)
       ===================================================================== */
    function dewarpBookSpine(srcCanvas) {
      const W = srcCanvas.width;
      const H = srcCanvas.height;
      const srcCtx = srcCanvas.getContext('2d');
      const srcData = srcCtx.getImageData(0, 0, W, H).data;

      const leftLum = [];
      const rightLum = [];
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

      const avgGrad = (leftGrad + rightGrad) / 2;
      if (avgGrad < 4.0) return srcCanvas; // Không cong đáng kể thì giữ nguyên

      const A = Math.min(0.06, avgGrad / 200) * W;
      const dstCanvas = document.createElement('canvas');
      dstCanvas.width = W;
      dstCanvas.height = H;
      const dstCtx = dstCanvas.getContext('2d');
      const dstData = dstCtx.createImageData(W, H);
      const dstPx = dstData.data;

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
      const lum = new Float32Array(len);
      for (let i = 0; i < len; i++) {
        const o = i * 4;
        lum[i] = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
      }
      const blurred = new Float32Array(len);
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
    }

    /* =====================================================================
       3. MAGIC PAPER & ADAPTIVE BINARIZATION ENHANCEMENT
       ===================================================================== */
    function applyMagicEnhancement(canvas, filterMode, contrastFactor) {
      const W = canvas.width;
      const H = canvas.height;
      const ctx = canvas.getContext('2d');
      const imgData = ctx.getImageData(0, 0, W, H);
      const data = imgData.data;

      // FIX: contrastFactor was previously accepted but never used anywhere in this
      // function, so the "Scan quality" contrast setting had zero visible effect on
      // the output. Clamp it to a sane range and derive a gamma exponent + B&W
      // threshold multiplier from it so the slider/quality setting is now real.
      const cf = Math.max(0.6, Math.min(2.2, Number(contrastFactor) || 1.45));
      const gammaPower = 2.6 * (cf / 1.45);        // higher contrast -> steeper curve
      const bwThresholdMul = 0.76 * (1 / (cf / 1.45)); // higher contrast -> stricter B&W cut

      // FIX: apply a lightweight unsharp-mask so scanned text edges look genuinely
      // crisper instead of only being pushed through a brightness curve. This runs on
      // luminance only (cheap 3x3 box blur) before the color/binarization pass below.
      applyUnsharpMask(data, W, H, 0.55);

      // Ước lượng nền chiếu sáng (Illumination background estimation)
      const bgW = Math.max(16, Math.floor(W / 32));
      const bgH = Math.max(16, Math.floor(H / 32));
      const bgMap = new Float32Array(bgW * bgH);
      const bgCount = new Uint16Array(bgW * bgH);

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

      const smoothedBg = new Float32Array(bgW * bgH);
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

      const bufX = Math.floor(W * 0.015);
      const bufY = Math.floor(H * 0.015);

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
          const isRedStamp = r > 90 && r > g + 35 && r > b + 35;
          const isBlueInk  = b > 80 && b > r + 25 && b > g + 25;

          // Chuẩn hóa tương đối theo nền cục bộ
          let normLum = (lum / bgLum) * 255;
          const isEdge = isYEdge || x < bufX || x > W - bufX;

          // Dọn viền ngoài nếu là shadow đen thừa
          if (isEdge && !isRedStamp && !isBlueInk && normLum < 190) {
            data[idx] = 255; data[idx+1] = 255; data[idx+2] = 255;
            continue;
          }

          if (filterMode === 'magic') {
            if (isRedStamp) {
              r = Math.min(255, Math.round(r * 1.4));
              g = Math.max(0, Math.round(g * 0.4));
              b = Math.max(0, Math.round(b * 0.4));
            } else if (isBlueInk) {
              b = Math.min(255, Math.round(b * 1.4));
              r = Math.max(0, Math.round(r * 0.4));
              g = Math.max(0, Math.round(g * 0.5));
            } else {
              // Nâng cấp: Soft Gamma binarization chống mất nét chữ chì
              if (normLum > 195) {
                r = g = b = 255;
              } else {
                let factor = Math.max(0, normLum / 195);
                factor = Math.pow(factor, gammaPower); // giờ phản ứng theo contrastFactor thật
                const finalVal = Math.round(factor * 215);
                r = g = b = finalVal;
              }
            }
          } else if (filterMode === 'bw') {
            // Adaptive local threshold thay vì so sánh tuyệt đối với 185
            const localThreshold = bgLum * bwThresholdMul;
            r = g = b = (lum > localThreshold && !isRedStamp && !isBlueInk) ? 255 : 0;
          } else if (filterMode === 'grayscale') {
            let gray = normLum;
            if (gray > 220) gray = 255;
            r = g = b = Math.min(255, Math.round(gray));
          }

          data[idx] = r; data[idx+1] = g; data[idx+2] = b;
        }
      }

      ctx.putImageData(imgData, 0, 0);
      return canvas;
    }

    /* =====================================================================
       4. MAIN: processImageCanvas
       ===================================================================== */
    function processImageCanvas(imgElement, filterMode, options) {
      options = options || {};
      const trimPercent = options.trimMarginPercent || 0;
      const contrastFactor = options.contrast || 1.45;

      const origWidth  = imgElement.naturalWidth  || imgElement.width;
      const origHeight = imgElement.naturalHeight || imgElement.height;
      if (!origWidth || !origHeight) return imgElement.src;

      const srcCanvas = document.createElement('canvas');
      srcCanvas.width  = origWidth;
      srcCanvas.height = origHeight;
      const srcCtx = srcCanvas.getContext('2d');
      srcCtx.drawImage(imgElement, 0, 0, origWidth, origHeight);

      if (filterMode === 'original' && trimPercent === 0 && !options.customCornersRatio) {
        return srcCanvas.toDataURL('image/jpeg', 0.95);
      }

      let workCanvas = srcCanvas;
      if (trimPercent > 0 && !options.customCornersRatio) {
        const cropX = Math.round(origWidth  * (trimPercent / 100));
        const cropY = Math.round(origHeight * (trimPercent / 100));
        const cropW = origWidth  - cropX * 2;
        const cropH = origHeight - cropY * 2;
        if (cropW > 50 && cropH > 50) {
          const trimCanvas = document.createElement('canvas');
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

      return dewarpedCanvas.toDataURL('image/jpeg', 0.95);
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
