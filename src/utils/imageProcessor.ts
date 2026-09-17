/**
 * Document Image Processing Engine Pro
 * - Gradient-based edge detection để tìm chính xác 4 góc tờ giấy
 * - Perspective Warp thực (homography / projective transform) để nắn thẳng hình thang méo
 * - Book Spine Polynomial Dewarp cho tờ giấy cong gáy sách
 * - Magic Paper enhancement: làm trắng nền, làm đậm chữ, giữ màu con dấu/chữ ký
 */

export type FilterMode = 'magic' | 'bw' | 'grayscale' | 'original';

export interface ImageProcessingOptions {
  filterMode: FilterMode;
  brightness?: number;
  contrast?: number;
  trimMarginPercent?: number;
  enablePerspectiveWarp?: boolean;
}

/**
 * Trả về đoạn code JavaScript xử lý ảnh trên HTML5 Canvas
 * Chạy trực tiếp trong WebView / HTML PDF exporter
 */
export const getCanvasProcessingScript = (): string => {
  return `
    /* =====================================================================
       STEP 1: GRADIENT-BASED EDGE DETECTION (Sobel) + CORNER FINDER
       ===================================================================== */

    function buildSobelEdgeMap(data, W, H) {
      // Xây dựng grayscale luminance map
      const gray = new Float32Array(W * H);
      for (let i = 0; i < W * H; i++) {
        const idx = i * 4;
        gray[i] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      }

      // Gaussian blur nhẹ 3x3 để giảm noise
      const blurred = new Float32Array(W * H);
      const kernel = [1,2,1, 2,4,2, 1,2,1];
      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          let sum = 0;
          let k = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              sum += gray[(y + dy) * W + (x + dx)] * kernel[k++];
            }
          }
          blurred[y * W + x] = sum / 16;
        }
      }

      // Sobel gradient magnitude
      const edge = new Float32Array(W * H);
      let maxEdge = 0;
      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          const gx =
            -blurred[(y-1)*W+(x-1)] - 2*blurred[y*W+(x-1)] - blurred[(y+1)*W+(x-1)]
            +blurred[(y-1)*W+(x+1)] + 2*blurred[y*W+(x+1)] + blurred[(y+1)*W+(x+1)];
          const gy =
            -blurred[(y-1)*W+(x-1)] - 2*blurred[(y-1)*W+x] - blurred[(y-1)*W+(x+1)]
            +blurred[(y+1)*W+(x-1)] + 2*blurred[(y+1)*W+x] + blurred[(y+1)*W+(x+1)];
          const mag = Math.sqrt(gx*gx + gy*gy);
          edge[y * W + x] = mag;
          if (mag > maxEdge) maxEdge = mag;
        }
      }

      // Normalize 0-255
      const threshold = maxEdge * 0.18;
      const result = new Uint8Array(W * H);
      for (let i = 0; i < W * H; i++) {
        result[i] = edge[i] > threshold ? 255 : 0;
      }
      return result;
    }

    /* =====================================================================
       STEP 2: TÌM 4 GÓC TỜ GIẤY (Hough-like line accumulator + corner candidates)
       ===================================================================== */

    function findDocumentCorners(data, W, H) {
      const edgeMap = buildSobelEdgeMap(data, W, H);

      // Chia ảnh thành 4 vùng (quadrants) và tìm điểm edge xa nhất từ tâm trong mỗi vùng
      const cx = W / 2;
      const cy = H / 2;

      // Mỗi góc: tìm điểm edge trong quadrant có khoảng cách tối đa từ tâm
      // TL = x < cx, y < cy | TR = x > cx, y < cy
      // BL = x < cx, y > cy | BR = x > cx, y > cy

      let corners = [
        { x: W * 0.05, y: H * 0.05 },   // TL
        { x: W * 0.95, y: H * 0.05 },   // TR
        { x: W * 0.05, y: H * 0.95 },   // BL
        { x: W * 0.95, y: H * 0.95 },   // BR
      ];

      // Margin để tránh detect border ảnh chính nó
      const mx = Math.floor(W * 0.03);
      const my = Math.floor(H * 0.03);

      // Tìm điểm edge tốt nhất trong mỗi quadrant theo scoring (gần góc + là edge mạnh)
      let bestScores = [0, 0, 0, 0];

      // Chỉ sample thưa để nhanh
      const stepX = Math.max(1, Math.floor(W / 120));
      const stepY = Math.max(1, Math.floor(H / 120));

      for (let y = my; y < H - my; y += stepY) {
        for (let x = mx; x < W - mx; x += stepX) {
          if (edgeMap[y * W + x] === 0) continue;

          const isLeft = x < cx;
          const isTop = y < cy;
          const qi = isTop ? (isLeft ? 0 : 1) : (isLeft ? 2 : 3);

          // Score = khoảng cách từ tâm (chuẩn hóa)
          const dx = (x - cx) / cx;
          const dy = (y - cy) / cy;
          const score = dx * dx + dy * dy;

          if (score > bestScores[qi]) {
            bestScores[qi] = score;
            corners[qi] = { x, y };
          }
        }
      }

      // Sanity check: nếu 4 góc tạo thành vùng quá nhỏ thì dùng bounding full
      const minW = (Math.min(corners[1].x, corners[3].x) - Math.max(corners[0].x, corners[2].x));
      const minH = (Math.min(corners[2].y, corners[3].y) - Math.max(corners[0].y, corners[1].y));

      if (minW < W * 0.3 || minH < H * 0.3) {
        // Fallback: dùng luminance-based boundary (phương án cũ bảo thủ hơn)
        corners = detectPaperBoundaryFallback(data, W, H);
      }

      return corners; // [TL, TR, BL, BR]
    }

    function detectPaperBoundaryFallback(data, W, H) {
      let minX = 0, maxX = W - 1, minY = 0, maxY = H - 1;

      // Scan từng cạnh: tìm hàng đầu tiên có > 25% pixel sáng
      for (let y = 0; y < Math.floor(H * 0.45); y++) {
        let light = 0, total = 0;
        for (let x = Math.floor(W * 0.1); x < Math.floor(W * 0.9); x += 3) {
          const idx = (y * W + x) * 4;
          if (0.299 * data[idx] + 0.587 * data[idx+1] + 0.114 * data[idx+2] > 90) light++;
          total++;
        }
        if (total > 0 && light / total > 0.25) { minY = y; break; }
      }

      for (let y = H - 1; y > Math.floor(H * 0.55); y--) {
        let light = 0, total = 0;
        for (let x = Math.floor(W * 0.1); x < Math.floor(W * 0.9); x += 3) {
          const idx = (y * W + x) * 4;
          if (0.299 * data[idx] + 0.587 * data[idx+1] + 0.114 * data[idx+2] > 90) light++;
          total++;
        }
        if (total > 0 && light / total > 0.25) { maxY = y; break; }
      }

      for (let x = 0; x < Math.floor(W * 0.4); x++) {
        let light = 0, total = 0;
        for (let y = Math.floor(H * 0.1); y < Math.floor(H * 0.9); y += 3) {
          const idx = (y * W + x) * 4;
          if (0.299 * data[idx] + 0.587 * data[idx+1] + 0.114 * data[idx+2] > 90) light++;
          total++;
        }
        if (total > 0 && light / total > 0.25) { minX = x; break; }
      }

      for (let x = W - 1; x > Math.floor(W * 0.6); x--) {
        let light = 0, total = 0;
        for (let y = Math.floor(H * 0.1); y < Math.floor(H * 0.9); y += 3) {
          const idx = (y * W + x) * 4;
          if (0.299 * data[idx] + 0.587 * data[idx+1] + 0.114 * data[idx+2] > 90) light++;
          total++;
        }
        if (total > 0 && light / total > 0.25) { maxX = x; break; }
      }

      // Nới lề 1.5%
      const px = Math.round(W * 0.015), py = Math.round(H * 0.015);
      minX = Math.max(0, minX - px);
      maxX = Math.min(W - 1, maxX + px);
      minY = Math.max(0, minY - py);
      maxY = Math.min(H - 1, maxY + py);

      return [
        { x: minX, y: minY },
        { x: maxX, y: minY },
        { x: minX, y: maxY },
        { x: maxX, y: maxY },
      ];
    }

    /* =====================================================================
       STEP 3: PERSPECTIVE WARP (Projective Transform / Homography)
       Nắn 4 góc méo bất kỳ → hình chữ nhật chuẩn A4
       Dùng bilinear inverse sampling để tránh aliasing
       ===================================================================== */

    /**
     * Giải hệ phương trình tìm homography matrix H (3x3) từ 4 cặp điểm src→dst
     * Dùng phương pháp Direct Linear Transform (DLT)
     */
    function computeHomography(srcPts, dstPts) {
      // srcPts, dstPts: mảng 4 phần tử, mỗi phần tử {x, y}
      // Xây dựng ma trận A (8x8) để giải Ah = 0
      const A = [];
      for (let i = 0; i < 4; i++) {
        const { x: sx, y: sy } = srcPts[i];
        const { x: dx, y: dy } = dstPts[i];
        A.push([-sx, -sy, -1, 0, 0, 0, dx * sx, dx * sy, dx]);
        A.push([0, 0, 0, -sx, -sy, -1, dy * sx, dy * sy, dy]);
      }

      // Giải bằng Gaussian elimination để tìm h (vector 9 phần tử)
      // Rút gọn: gán h[8] = 1 và giải 8 ẩn
      // Xây dựng hệ 8x8 từ 8 dòng đầu sau khi trừ h8
      const M = [];
      const b = [];
      for (let i = 0; i < 8; i++) {
        const row = A[i].slice(0, 8);
        M.push(row);
        b.push(-A[i][8]); // vế phải = -a[8]*1
      }

      // Gaussian elimination với partial pivoting
      for (let col = 0; col < 8; col++) {
        // Tìm pivot
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

      const h = [...b, 1]; // h[0..7] = b, h[8] = 1
      // Ma trận H 3x3
      return [
        [h[0], h[1], h[2]],
        [h[3], h[4], h[5]],
        [h[6], h[7], h[8]],
      ];
    }

    /**
     * Áp dụng perspective warp: warp srcCanvas theo 4 góc → canvas kích thước dstW x dstH
     * Dùng inverse mapping + bilinear interpolation
     */
    function applyPerspectiveWarp(srcCanvas, corners, dstW, dstH) {
      // corners: [TL, TR, BL, BR]
      const [tl, tr, bl, br] = corners;

      const dstCanvas = document.createElement('canvas');
      dstCanvas.width = dstW;
      dstCanvas.height = dstH;
      const dstCtx = dstCanvas.getContext('2d');

      const srcCtx = srcCanvas.getContext('2d');
      const srcW = srcCanvas.width;
      const srcH = srcCanvas.height;
      const srcData = srcCtx.getImageData(0, 0, srcW, srcH).data;

      // dst points: 4 góc của output rectangle
      const dstPts = [
        { x: 0,    y: 0 },
        { x: dstW, y: 0 },
        { x: 0,    y: dstH },
        { x: dstW, y: dstH },
      ];

      // src points: 4 góc tờ giấy trong ảnh gốc
      const srcPts = [tl, tr, bl, br];

      // Tính inverse homography: dst → src (để inverse mapping)
      const H = computeHomography(dstPts, srcPts);

      const dstImgData = dstCtx.createImageData(dstW, dstH);
      const dstData = dstImgData.data;

      for (let dy = 0; dy < dstH; dy++) {
        for (let dx = 0; dx < dstW; dx++) {
          // Áp dụng H để map điểm dst → src
          const wx = H[0][0]*dx + H[0][1]*dy + H[0][2];
          const wy = H[1][0]*dx + H[1][1]*dy + H[1][2];
          const wz = H[2][0]*dx + H[2][1]*dy + H[2][2];

          const sx = wx / wz;
          const sy = wy / wz;

          if (sx < 0 || sx >= srcW - 1 || sy < 0 || sy >= srcH - 1) {
            // Ngoài biên: pixel trắng
            const oi = (dy * dstW + dx) * 4;
            dstData[oi] = 255; dstData[oi+1] = 255; dstData[oi+2] = 255; dstData[oi+3] = 255;
            continue;
          }

          // Bilinear interpolation
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
       STEP 4: BOOK SPINE POLYNOMIAL DEWARP
       Xử lý tờ giấy cong gáy sách bằng polynomial correction
       ===================================================================== */

    function dewarpBookSpine(srcCanvas) {
      const W = srcCanvas.width;
      const H = srcCanvas.height;
      const srcCtx = srcCanvas.getContext('2d');
      const srcData = srcCtx.getImageData(0, 0, W, H).data;

      // Phát hiện có cong gáy sách không: so sánh luminance 2 nửa trái/phải
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

      // Tính gradient luminance theo chiều dọc ở 2 viền để phát hiện cong
      let leftGrad = 0, rightGrad = 0;
      for (let i = 1; i < leftLum.length - 1; i++) {
        leftGrad += Math.abs(leftLum[i] - leftLum[i-1]);
        rightGrad += Math.abs(rightLum[i] - rightLum[i-1]);
      }

      // Nếu không phát hiện cong đáng kể → bỏ qua bước này
      const avgGrad = (leftGrad + rightGrad) / 2;
      if (avgGrad < 3.5) return srcCanvas;

      // Áp dụng polynomial horizontal shift correction (barrel distortion style)
      // Mô hình: tại mỗi hàng y, dịch ngang x theo f(y) = A * (y/H - 0.5)^2
      // Tham số A được ước lượng từ luminance gradient
      const A = Math.min(0.06, avgGrad / 200) * W;

      const dstCanvas = document.createElement('canvas');
      dstCanvas.width = W;
      dstCanvas.height = H;
      const dstCtx = dstCanvas.getContext('2d');
      const dstData = dstCtx.createImageData(W, H);
      const dstPx = dstData.data;

      for (let dy = 0; dy < H; dy++) {
        const t = dy / H - 0.5; // -0.5 đến 0.5
        const shift = A * t * t; // shift tối đa ở 2 đầu, 0 ở giữa

        for (let dx = 0; dx < W; dx++) {
          // Tọa độ nguồn: dịch vào trong (nắn cong → thẳng)
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
       STEP 5: MAGIC PAPER COLOR ENHANCEMENT
       Làm trắng nền, đậm chữ, giữ màu con dấu/chữ ký
       ===================================================================== */

    function applyMagicEnhancement(canvas, filterMode, contrastFactor) {
      const W = canvas.width;
      const H = canvas.height;
      const ctx = canvas.getContext('2d');
      const imgData = ctx.getImageData(0, 0, W, H);
      const data = imgData.data;

      // Bước 1: Tạo background map (shadow/obstacle estimation) bằng cách downsample
      // Downsample rất nhỏ (ví dụ 64x64) để tính toán nhanh, bỏ qua nhiễu chữ
      const bgW = 64, bgH = Math.max(1, Math.floor(64 * (H / W)));
      const bgCanvas = document.createElement('canvas');
      bgCanvas.width = bgW; bgCanvas.height = bgH;
      const bgCtx = bgCanvas.getContext('2d');
      bgCtx.drawImage(canvas, 0, 0, bgW, bgH);
      const bgImgData = bgCtx.getImageData(0, 0, bgW, bgH);
      const bgData = bgImgData.data;

      // Dilation (Max filter) trên bg map để xóa sạch chữ, giữ lại màu nền & bóng (shadows)
      const dilated = new Uint8Array(bgW * bgH);
      for(let y = 0; y < bgH; y++) {
        for(let x = 0; x < bgW; x++) {
           let maxLum = 0;
           // Quét vùng 5x5 quanh pixel để bung rộng vùng trắng, lấp chữ đen
           for(let dy = -2; dy <= 2; dy++) {
             for(let dx = -2; dx <= 2; dx++) {
                const nx = Math.max(0, Math.min(bgW - 1, x + dx));
                const ny = Math.max(0, Math.min(bgH - 1, y + dy));
                const idx = (ny * bgW + nx) * 4;
                const lum = 0.299 * bgData[idx] + 0.587 * bgData[idx+1] + 0.114 * bgData[idx+2];
                if(lum > maxLum) maxLum = lum;
             }
           }
           dilated[y * bgW + x] = maxLum;
        }
      }

      // Blur nhẹ map đã dilated để background estimate mượt mà
      const smoothedBg = new Uint8Array(bgW * bgH);
      for(let y = 0; y < bgH; y++) {
        for(let x = 0; x < bgW; x++) {
           let sumLum = 0, count = 0;
           for(let dy = -1; dy <= 1; dy++) {
             for(let dx = -1; dx <= 1; dx++) {
                const nx = Math.max(0, Math.min(bgW - 1, x + dx));
                const ny = Math.max(0, Math.min(bgH - 1, y + dy));
                sumLum += dilated[ny * bgW + nx];
                count++;
             }
           }
           smoothedBg[y * bgW + x] = sumLum / count;
        }
      }

      // Bước 2: Duyệt từng pixel ảnh gốc, chuẩn hóa (trừ bóng) và làm nét chữ
      // Cắt rìa 3% xung quanh để loại bỏ chướng ngại vật ngoài mép giấy
      const bufX = Math.round(W * 0.03);
      const bufY = Math.round(H * 0.03);

      for (let y = 0; y < H; y++) {
        const bgY = Math.floor((y / H) * bgH);
        const isYEdge = y < bufY || y > H - bufY;
        
        for (let x = 0; x < W; x++) {
          const bgX = Math.floor((x / W) * bgW);
          const bgLum = Math.max(10, smoothedBg[bgY * bgW + bgX]); // Tránh chia 0
          
          const idx = (y * W + x) * 4;
          let r = data[idx], g = data[idx+1], b = data[idx+2];
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          
          // Phát hiện mực màu (con dấu đỏ, mực xanh dương, chữ ký)
          const isRedStamp = r > 90 && r > g + 35 && r > b + 35;
          const isBlueInk  = b > 80 && b > r + 25 && b > g + 25;
          
          // Chuẩn hóa loại bỏ shadow (Adaptive Background Normalization)
          // Ảnh / Background * 255. Bất chấp bóng ngón tay hay đèn, giấy sẽ luôn là ~255.
          let normLum = (lum / bgLum) * 255;
          
          const isEdge = isYEdge || x < bufX || x > W - bufX;

          // Xóa chướng ngại vật ở rìa (ngón tay, cạnh viền thừa) nếu nó không phải chữ ký
          if (isEdge && !isRedStamp && !isBlueInk && normLum < 190) {
             data[idx] = 255; data[idx+1] = 255; data[idx+2] = 255;
             continue;
          }

          if (filterMode === 'magic') {
            if (isRedStamp) {
              r = Math.min(255, Math.round(r * 1.5));
              g = Math.max(0, Math.round(g * 0.3));
              b = Math.max(0, Math.round(b * 0.3));
            } else if (isBlueInk) {
              b = Math.min(255, Math.round(b * 1.5));
              r = Math.max(0, Math.round(r * 0.3));
              g = Math.max(0, Math.round(g * 0.5));
            } else {
              // Thuật toán Soft Binarization / Sigmoid contrast mạnh
              // Giúp giấy trắng bóc và chữ siêu đen, cực kỳ sắc nét
              if (normLum > 195) { 
                 r = 255; g = 255; b = 255; // White paper
              } else {
                 let blackFactor = normLum / 195; // Tỉ lệ 0..1
                 blackFactor = Math.pow(blackFactor, 3.5); // Ép đường cong gamma dốc mạnh xuống
                 let finalVal = Math.round(blackFactor * 210); 
                 r = finalVal; g = finalVal; b = finalVal;
              }
            }
          } else if (filterMode === 'bw') {
            r = g = b = (normLum > 185 && !isRedStamp && !isBlueInk) ? 255 : 0;
          } else if (filterMode === 'grayscale') {
            let gray = normLum;
            if (gray > 220) gray = 255; // Trắng hóa nền nhẹ
            r = g = b = Math.min(255, gray);
          }
          
          data[idx] = r; data[idx+1] = g; data[idx+2] = b;
        }
      }

      ctx.putImageData(imgData, 0, 0);
      return canvas;
    }

    /* =====================================================================
       MAIN: processImageCanvas — Tích hợp toàn bộ pipeline
       ===================================================================== */

    function processImageCanvas(imgElement, filterMode, options) {
      options = options || {};
      const trimPercent = options.trimMarginPercent || 0;
      const contrastFactor = options.contrast || 1.45;

      const origWidth  = imgElement.naturalWidth  || imgElement.width;
      const origHeight = imgElement.naturalHeight || imgElement.height;
      if (!origWidth || !origHeight) return imgElement.src;

      // --- 1. Load ảnh vào canvas gốc ---
      const srcCanvas = document.createElement('canvas');
      srcCanvas.width  = origWidth;
      srcCanvas.height = origHeight;
      const srcCtx = srcCanvas.getContext('2d');
      srcCtx.drawImage(imgElement, 0, 0, origWidth, origHeight);

      if (filterMode === 'original' && trimPercent === 0 && !options.customCornersRatio) {
        return srcCanvas.toDataURL('image/jpeg', 0.95);
      }

      // --- 2. Crop tỉa lề ban đầu ---
      let workCanvas = srcCanvas;
      if (trimPercent > 0 && !options.customCornersRatio) {
        const cropX = Math.round(origWidth  * (trimPercent / 100));
        const cropY = Math.round(origHeight * (trimPercent / 100));
        const cropW = origWidth  - cropX * 2;
        const cropH = origHeight - cropY * 2;
        const trimCanvas = document.createElement('canvas');
        trimCanvas.width = cropW;
        trimCanvas.height = cropH;
        trimCanvas.getContext('2d').drawImage(srcCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
        workCanvas = trimCanvas;
      }

      // --- 3. Bỏ qua Tự động tìm góc (Native Scanner đã xử lý), nhưng GỌT VIỀN ĐEN thừa ---
      if (!options.customCornersRatio) {
        try {
          const wW = workCanvas.width, wH = workCanvas.height;
          const wCtx = workCanvas.getContext('2d');
          const wData = wCtx.getImageData(0, 0, wW, wH).data;
          
          let minX = 0, maxX = wW - 1, minY = 0, maxY = wH - 1;

          for (let y = 0; y < Math.floor(wH * 0.25); y++) {
            let light = 0;
            for (let x = 0; x < wW; x += 4) {
              const idx = (y * wW + x) * 4;
              if (0.299*wData[idx] + 0.587*wData[idx+1] + 0.114*wData[idx+2] > 110) light++;
            }
            if (light / (wW / 4) > 0.3) { minY = y; break; }
          }
          for (let y = wH - 1; y > Math.floor(wH * 0.75); y--) {
            let light = 0;
            for (let x = 0; x < wW; x += 4) {
              const idx = (y * wW + x) * 4;
              if (0.299*wData[idx] + 0.587*wData[idx+1] + 0.114*wData[idx+2] > 110) light++;
            }
            if (light / (wW / 4) > 0.3) { maxY = y; break; }
          }
          for (let x = 0; x < Math.floor(wW * 0.25); x++) {
            let light = 0;
            for (let y = minY; y <= maxY; y += 4) {
              const idx = (y * wW + x) * 4;
              if (0.299*wData[idx] + 0.587*wData[idx+1] + 0.114*wData[idx+2] > 110) light++;
            }
            if (light / ((maxY - minY) / 4) > 0.3) { minX = x; break; }
          }
          for (let x = wW - 1; x > Math.floor(wW * 0.75); x--) {
            let light = 0;
            for (let y = minY; y <= maxY; y += 4) {
              const idx = (y * wW + x) * 4;
              if (0.299*wData[idx] + 0.587*wData[idx+1] + 0.114*wData[idx+2] > 110) light++;
            }
            if (light / ((maxY - minY) / 4) > 0.3) { maxX = x; break; }
          }

          // Cắt lẹm thêm 1.5% để xóa triệt để viền bóng mờ
          const trimX = Math.floor(wW * 0.015);
          const trimY = Math.floor(wH * 0.015);
          minX = Math.min(wW/2, minX + trimX);
          maxX = Math.max(wW/2, maxX - trimX);
          minY = Math.min(wH/2, minY + trimY);
          maxY = Math.max(wH/2, maxY - trimY);

          const cropW = maxX - minX;
          const cropH = maxY - minY;
          if (cropW > wW * 0.4 && cropH > wH * 0.4) {
            const trimCanvas2 = document.createElement('canvas');
            trimCanvas2.width = cropW;
            trimCanvas2.height = cropH;
            trimCanvas2.getContext('2d').drawImage(workCanvas, minX, minY, cropW, cropH, 0, 0, cropW, cropH);
            workCanvas = trimCanvas2;
          }
        } catch(e) {}
      }

      const W = workCanvas.width, H = workCanvas.height;
      let corners = null;
      if (options.customCornersRatio) {
        corners = options.customCornersRatio.map(r => ({ x: r.x * W, y: r.y * H }));
      }

      // --- 4. Perspective Warp (Chỉ thực hiện nếu user có sửa góc) ---
      let warpedCanvas = workCanvas;
      
      if (corners) {
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
        } catch(e) {
          // Bỏ qua nếu lỗi warp
        }
      }

      // --- 7. Book Spine Dewarp ---
      let dewarpedCanvas;
      try {
        dewarpedCanvas = dewarpBookSpine(warpedCanvas);
      } catch(e) {
        dewarpedCanvas = warpedCanvas;
      }

      // --- 8. Magic Enhancement (color processing) ---
      if (filterMode !== 'original') {
        try {
          applyMagicEnhancement(dewarpedCanvas, filterMode, contrastFactor);
        } catch(e) { /* giữ nguyên nếu lỗi */ }
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
