import React, { useRef, useState, useMemo } from 'react';
import { View, StyleSheet, PanResponder, Image, Dimensions, TouchableOpacity, Text, Alert } from 'react-native';
import { CropPoint, PolygonCorners } from '../types/domain';

export type Point = CropPoint;

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const HEADER_H = 80;
const MAX_IMG_W = SCREEN_W - 40;
const MAX_IMG_H = SCREEN_H - HEADER_H - 120;

const KNOB_SIZE = 48;
const LOUPE_SIZE = 104;
const LOUPE_INNER = LOUPE_SIZE - 6;
const LOUPE_CENTER = LOUPE_INNER / 2;
const ZOOM = 2;

export interface CropViewProps {
  imageUri: string;
  initialCorners?: PolygonCorners; // TL (0), TR (1), BL (2), BR (3)
  onCropSave: (corners: PolygonCorners, imgDisplaySize: { w: number, h: number }) => void;
  onCancel: () => void;
}

const Line = ({ p1, p2, color = '#00bfa5' }: { p1: Point; p2: Point; color?: string }) => {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
  const centerX = (p1.x + p2.x) / 2;
  const centerY = (p1.y + p2.y) / 2;

  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: centerX - length / 2,
        top: centerY - 1,
        width: length,
        height: 2,
        backgroundColor: color,
        transform: [{ rotate: `${angle}deg` }],
        zIndex: 1,
      }}
    />
  );
};

/**
 * Kiểm tra đa giác lồi (Convex Polygon) và không tự cắt theo thời gian thực:
 * - 4 đỉnh theo chu vi khép kín: TL (0) -> TR (1) -> BR (3) -> BL (2)
 * - Sử dụng tích có hướng (cross products) giữa các cặp cạnh liên tiếp.
 * - Một đa giác là lồi khi và chỉ khi tất cả các góc rẽ đều cùng chiều (cùng dương hoặc cùng âm).
 * - Trả về true nếu lồi hợp lệ, false nếu bị lõm hoặc tự cắt (self-intersecting).
 */
export function isConvexPolygon(corners: PolygonCorners): boolean {
  if (!corners || corners.length !== 4) return false;
  // Thứ tự chu vi tứ giác: 0 (TL) -> 1 (TR) -> 3 (BR) -> 2 (BL)
  const p = [corners[0], corners[1], corners[3], corners[2]];

  let prevSign = 0;
  for (let i = 0; i < 4; i++) {
    const p1 = p[i];
    const p2 = p[(i + 1) % 4];
    const p3 = p[(i + 2) % 4];

    const dx1 = p2.x - p1.x;
    const dy1 = p2.y - p1.y;
    const dx2 = p3.x - p2.x;
    const dy2 = p3.y - p2.y;

    // Cross product của 2 vector liên tiếp (p1->p2 và p2->p3)
    const cross = dx1 * dy2 - dy1 * dx2;

    // Nếu 3 điểm thẳng hàng hoặc quá sát nhau thì không phải đa giác lồi hợp lệ
    if (Math.abs(cross) < 1e-3) {
      return false;
    }

    const currentSign = cross > 0 ? 1 : -1;
    if (prevSign === 0) {
      prevSign = currentSign;
    } else if (currentSign !== prevSign) {
      // Đổi chiều rẽ: tứ giác bị lõm hoặc tự cắt nhau
      return false;
    }
  }

  // Đảm bảo diện tích Shoelace > 0
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    area += p[i].x * p[j].y - p[j].x * p[i].y;
  }
  if (Math.abs(area) < 10) {
    return false;
  }

  return true;
}

/**
 * Kiểm tra tính hợp lệ của tứ giác cắt viền:
 * 1. Chiều dài mỗi cạnh tối thiểu 30px
 * 2. Không tự cắt nhau và phải là đa giác lồi (Convex Polygon)
 * 3. Diện tích tối thiểu >= 5% khung hình hiển thị
 */
export function validateCropPolygon(
  corners: PolygonCorners,
  displayWidth: number,
  displayHeight: number
): { valid: boolean; message?: string } {
  // Thứ tự theo chiều kim đồng hồ: 0 (TL) -> 1 (TR) -> 3 (BR) -> 2 (BL)
  const p = [corners[0], corners[1], corners[3], corners[2]];

  // 1. Kiểm tra độ dài cạnh
  const minEdge = 30;
  for (let i = 0; i < 4; i++) {
    const next = (i + 1) % 4;
    const dist = Math.hypot(p[next].x - p[i].x, p[next].y - p[i].y);
    if (dist < minEdge) {
      return { valid: false, message: 'Cạnh của vùng chọn quá ngắn. Vui lòng mở rộng 4 góc.' };
    }
  }

  // 2. Kiểm tra tính lồi và không tự cắt
  if (!isConvexPolygon(corners)) {
    return { valid: false, message: 'Vùng chọn bị xoắn, lõm hoặc tự cắt nhau. Vui lòng chỉnh lại 4 góc thành tứ giác lồi.' };
  }

  // 3. Kiểm tra diện tích tối thiểu (Shoelace formula)
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    area += p[i].x * p[j].y - p[j].x * p[i].y;
  }
  area = Math.abs(area) / 2;

  const minArea = displayWidth * displayHeight * 0.05;
  if (area < minArea) {
    return { valid: false, message: 'Diện tích vùng chọn quá nhỏ (dưới 5% tài liệu).' };
  }

  return { valid: true };
}

/**
 * Tính toán hộp bao biên thực tế của tài liệu dựa trên tỷ lệ và kích thước ảnh.
 * Xóa bỏ thuật toán giả lập tĩnh (inset 5.5% x 4.5%), thay thế bằng thuật toán thích ứng thực tế:
 * 1. Xác định tỷ lệ khung hình thực tế của ảnh (aspect ratio = dispW / dispH).
 * 2. Phân loại theo hướng chụp (dọc / ngang) và ước lượng tỷ lệ chuẩn của tài liệu:
 *    - A4 / ISO 216: tỷ lệ 1 : √2 (dọc ~0.7071, ngang ~1.4142)
 *    - CCCD / Thẻ căn cước / Danh thiếp: tỷ lệ ~1.5858 (dọc ~0.6306)
 *    - US Letter: tỷ lệ 8.5 : 11 (dọc ~0.7727, ngang ~1.2941)
 *    - Hóa đơn nhiệt / Receipt: tỷ lệ dài (~0.45 - 0.55)
 * 3. Tính toán kích thước hộp bao tài liệu tối ưu (chiếm ~88% vùng khả dụng để loại trừ phông nền bàn chụp).
 * 4. Căn giữa hộp bao chuẩn xác vào khung ảnh.
 */
export const autoDetectCorners = (dispW: number, dispH: number): PolygonCorners => {
  if (dispW <= 0 || dispH <= 0) {
    return [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
      { x: 100, y: 100 },
    ];
  }

  const imageAspect = dispW / dispH;
  const isPortrait = dispH >= dispW;

  let targetAspect: number;

  if (isPortrait) {
    if (imageAspect < 0.56) {
      // Hóa đơn siêu thị / bill nhiệt dài
      targetAspect = Math.max(0.42, imageAspect * 0.94);
    } else if (imageAspect < 0.67) {
      // Thẻ ID, danh thiếp, thẻ CCCD dạng dọc (53.98 / 85.6)
      targetAspect = 53.98 / 85.6; // ~0.6306
    } else if (imageAspect < 0.74) {
      // Tài liệu A4 / A-series chuẩn dọc (1 / √2)
      targetAspect = 1 / Math.SQRT2; // ~0.7071
    } else if (imageAspect < 0.84) {
      // Tài liệu khổ US Letter dọc (8.5 / 11)
      targetAspect = 8.5 / 11; // ~0.7727
    } else {
      // Ảnh gần vuông hoặc tự do
      targetAspect = imageAspect * 0.92;
    }
  } else {
    if (imageAspect >= 1.50) {
      // Thẻ CCCD, bằng lái xe, thẻ ngân hàng nằm ngang (85.6 / 53.98)
      targetAspect = 85.6 / 53.98; // ~1.5858
    } else if (imageAspect >= 1.35) {
      // Khổ A4 / A-series nằm ngang (√2)
      targetAspect = Math.SQRT2; // ~1.4142
    } else if (imageAspect >= 1.20) {
      // Khổ US Letter nằm ngang (11 / 8.5)
      targetAspect = 11 / 8.5; // ~1.2941
    } else {
      // Ảnh gần vuông
      targetAspect = imageAspect * 0.92;
    }
  }

  // Tài liệu thực tế chụp thường chiếm khoảng 88% diện tích khả dụng trong khung
  const coverage = 0.88;
  const maxW = dispW * coverage;
  const maxH = dispH * coverage;

  let boxW: number;
  let boxH: number;

  if (maxW / maxH > targetAspect) {
    boxH = maxH;
    boxW = boxH * targetAspect;
  } else {
    boxW = maxW;
    boxH = boxW / targetAspect;
  }

  // Giới hạn an toàn trong khung hình (tối đa 96% kích thước ảnh)
  boxW = Math.min(boxW, dispW * 0.96);
  boxH = Math.min(boxH, dispH * 0.96);

  const offsetX = (dispW - boxW) / 2;
  const offsetY = (dispH - boxH) / 2;

  return [
    { x: Math.round(offsetX), y: Math.round(offsetY) },                       // 0: TL
    { x: Math.round(offsetX + boxW), y: Math.round(offsetY) },                // 1: TR
    { x: Math.round(offsetX), y: Math.round(offsetY + boxH) },               // 2: BL
    { x: Math.round(offsetX + boxW), y: Math.round(offsetY + boxH) },        // 3: BR
  ];
};

export default function CropView({ imageUri, initialCorners, onCropSave, onCancel }: CropViewProps) {
  const [displaySize, setDisplaySize] = useState({ w: MAX_IMG_W, h: MAX_IMG_H });
  const displaySizeRef = useRef(displaySize);
  displaySizeRef.current = displaySize;

  // 0: TL, 1: TR, 2: BL, 3: BR
  const [corners, setCorners] = useState<PolygonCorners>(
    initialCorners || [
      { x: 40, y: 40 },
      { x: MAX_IMG_W - 40, y: 40 },
      { x: 40, y: MAX_IMG_H - 40 },
      { x: MAX_IMG_W - 40, y: MAX_IMG_H - 40 },
    ]
  );

  // Vị trí góc đang được kéo (0, 1, 2, 3 hoặc null khi thả tay)
  const [activeCornerIndex, setActiveCornerIndex] = useState<number | null>(null);

  // Kiểm tra tính lồi của đa giác trong thời gian thực khi kéo
  const isPolygonValid = useMemo(() => isConvexPolygon(corners), [corners]);
  const polygonColor = isPolygonValid ? '#00bfa5' : '#ff5252';

  const a4PresetCorners = (dispW: number, dispH: number): PolygonCorners => {
    // Căn theo tỷ lệ A4 chuẩn 1 : 1.414 ở trung tâm bức ảnh
    const targetAspect = 1 / 1.414;
    const currentAspect = dispW / dispH;
    let targetW = dispW * 0.9;
    let targetH = dispH * 0.9;

    if (currentAspect > targetAspect) {
      targetW = targetH * targetAspect;
    } else {
      targetH = targetW / targetAspect;
    }

    const offsetX = (dispW - targetW) / 2;
    const offsetY = (dispH - targetH) / 2;

    return [
      { x: offsetX, y: offsetY },
      { x: offsetX + targetW, y: offsetY },
      { x: offsetX, y: offsetY + targetH },
      { x: offsetX + targetW, y: offsetY + targetH },
    ];
  };

  const fullFrameCorners = (dispW: number, dispH: number): PolygonCorners => {
    return [
      { x: 0, y: 0 },
      { x: dispW, y: 0 },
      { x: 0, y: dispH },
      { x: dispW, y: dispH },
    ];
  };

  React.useEffect(() => {
    Image.getSize(imageUri, (w, h) => {
      const ratio = Math.min(MAX_IMG_W / w, MAX_IMG_H / h);
      const dispW = w * ratio;
      const dispH = h * ratio;
      const newSize = { w: dispW, h: dispH };
      setDisplaySize(newSize);
      displaySizeRef.current = newSize;
      
      if (!initialCorners) {
        setCorners(autoDetectCorners(dispW, dispH));
      }
    }, () => {});
  }, [imageUri]);

  const createPanResponder = (index: number) => {
    let startX = 0;
    let startY = 0;
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        setActiveCornerIndex(index);
        setCorners(prev => {
          startX = prev[index].x;
          startY = prev[index].y;
          return prev;
        });
      },
      onPanResponderMove: (_, gesture) => {
        setCorners(prev => {
          const newCorners = [...prev] as PolygonCorners;
          let nx = startX + gesture.dx;
          let ny = startY + gesture.dy;
          
          const maxW = displaySizeRef.current.w;
          const maxH = displaySizeRef.current.h;
          nx = Math.max(0, Math.min(nx, maxW));
          ny = Math.max(0, Math.min(ny, maxH));

          newCorners[index] = { x: nx, y: ny };
          return newCorners;
        });
      },
      onPanResponderRelease: () => {
        setActiveCornerIndex(null);
      },
      onPanResponderTerminate: () => {
        setActiveCornerIndex(null);
      },
    });
  };

  const pan0 = useRef(createPanResponder(0)).current;
  const pan1 = useRef(createPanResponder(1)).current;
  const pan2 = useRef(createPanResponder(2)).current;
  const pan3 = useRef(createPanResponder(3)).current;
  const pans = [pan0, pan1, pan2, pan3];

  const handleSaveCorners = () => {
    if (!isPolygonValid) {
      Alert.alert(
        'Đa giác không hợp lệ',
        'Vùng chọn đang bị tự cắt hoặc lõm. Vui lòng kéo 4 góc thành tứ giác lồi hợp lệ để tiếp tục.'
      );
      return;
    }
    const check = validateCropPolygon(corners, displaySize.w, displaySize.h);
    if (!check.valid) {
      Alert.alert('Căn lề không hợp lệ', check.message || 'Vui lòng kiểm tra lại 4 góc.');
      return;
    }
    onCropSave(corners, displaySize);
  };

  const activeCorner = activeCornerIndex !== null ? corners[activeCornerIndex] : null;

  // Tính vị trí hiển thị kính lúp phía trên ngón tay
  const loupeLeft = activeCorner
    ? Math.max(4, Math.min(displaySize.w - LOUPE_SIZE - 4, activeCorner.x - LOUPE_SIZE / 2))
    : 0;
  const loupeTop = activeCorner
    ? activeCorner.y < 50
      ? activeCorner.y + 40 // Nếu sát mép trên thì lật xuống dưới để không bị che
      : activeCorner.y - LOUPE_SIZE - 24 // Hiển thị phía trên ngón tay
    : 0;

  const cornerLabels = ['TL', 'TR', 'BL', 'BR'];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.btn} onPress={onCancel}>
          <Text style={styles.btnText}>Hủy</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Căn chỉnh viền</Text>
        <TouchableOpacity style={styles.btn} onPress={handleSaveCorners}>
          <Text style={[styles.btnText, { color: isPolygonValid ? '#00bfa5' : '#ff5252', fontWeight: 'bold' }]}>
            Xong
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.workspace}>
        <View style={{ width: displaySize.w, height: displaySize.h, position: 'relative' }}>
          <Image
            source={{ uri: imageUri }}
            style={{ width: displaySize.w, height: displaySize.h }}
            resizeMode="contain"
          />

          {/* 4 đường viền nối 4 góc */}
          <Line p1={corners[0]} p2={corners[1]} color={polygonColor} />
          <Line p1={corners[1]} p2={corners[3]} color={polygonColor} />
          <Line p1={corners[3]} p2={corners[2]} color={polygonColor} />
          <Line p1={corners[2]} p2={corners[0]} color={polygonColor} />

          {/* 4 nút góc có thể kéo thả */}
          {corners.map((c, i) => (
            <View
              key={i}
              {...pans[i].panHandlers}
              style={[
                styles.knob,
                {
                  left: c.x - KNOB_SIZE / 2,
                  top: c.y - KNOB_SIZE / 2,
                  backgroundColor: isPolygonValid ? 'rgba(0, 191, 165, 0.35)' : 'rgba(255, 82, 82, 0.35)',
                },
              ]}
            >
              <View style={[styles.innerDot, { borderColor: polygonColor }]} />
            </View>
          ))}

          {/* Kính lúp Magnifier Loupe phóng đại 2x hiển thị phía trên ngón tay khi đang chạm kéo góc */}
          {activeCornerIndex !== null && activeCorner !== null && (
            <View
              pointerEvents="none"
              style={[
                styles.loupeContainer,
                {
                  left: loupeLeft,
                  top: loupeTop,
                  borderColor: polygonColor,
                },
              ]}
            >
              <View style={styles.loupeInner}>
                <Image
                  source={{ uri: imageUri }}
                  style={{
                    width: displaySize.w * ZOOM,
                    height: displaySize.h * ZOOM,
                    position: 'absolute',
                    left: LOUPE_CENTER - activeCorner.x * ZOOM,
                    top: LOUPE_CENTER - activeCorner.y * ZOOM,
                  }}
                  resizeMode="stretch"
                />
                {/* Hồng tâm chữ thập ngắm điểm pixel */}
                <View style={[styles.reticleLineH, { backgroundColor: polygonColor }]} />
                <View style={[styles.reticleLineV, { backgroundColor: polygonColor }]} />
                <View style={[styles.reticleCenterPoint, { borderColor: polygonColor }]} />
              </View>
              {/* Badge góc & độ phóng đại 2x */}
              <View style={[styles.loupeBadge, { backgroundColor: polygonColor }]}>
                <Text style={styles.loupeBadgeText}>
                  {cornerLabels[activeCornerIndex]} (2x)
                </Text>
              </View>
            </View>
          )}
        </View>
      </View>

      <View style={styles.presetsRow}>
        <TouchableOpacity
          style={styles.presetBtn}
          onPress={() => setCorners(autoDetectCorners(displaySize.w, displaySize.h))}
        >
          <Text style={styles.presetBtnText}>⚡ Tự động dò biên</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.presetBtn}
          onPress={() => setCorners(a4PresetCorners(displaySize.w, displaySize.h))}
        >
          <Text style={styles.presetBtnText}>📐 Khung A4</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.presetBtn}
          onPress={() => setCorners(fullFrameCorners(displaySize.w, displaySize.h))}
        >
          <Text style={styles.presetBtnText}>🔲 Toàn khung</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.footerTip}>
        <Text style={[styles.tipText, !isPolygonValid && styles.tipTextError]}>
          {isPolygonValid
            ? '💡 Kéo 4 chấm tròn màu xanh để căn sát viền mép tài liệu'
            : '⚠️ Viền đỏ: Tứ giác đang bị tự cắt hoặc lõm. Vui lòng căn chỉnh lại 4 góc!'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#121212',
    zIndex: 9999,
  },
  header: {
    height: HEADER_H,
    paddingTop: 36,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1e1e1e',
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  title: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  btn: {
    padding: 8,
  },
  btnText: {
    color: '#ffffff',
    fontSize: 16,
  },
  workspace: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  presetsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 10,
    backgroundColor: '#1a1a1a',
  },
  presetBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: '#2a2a2a',
    borderWidth: 1,
    borderColor: '#3a3a3a',
  },
  presetBtnText: {
    color: '#00bfa5',
    fontSize: 12.5,
    fontWeight: '700',
  },
  knob: {
    position: 'absolute',
    width: KNOB_SIZE,
    height: KNOB_SIZE,
    borderRadius: KNOB_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  innerDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#ffffff',
    borderWidth: 3,
  },
  loupeContainer: {
    position: 'absolute',
    width: LOUPE_SIZE,
    height: LOUPE_SIZE,
    borderRadius: LOUPE_SIZE / 2,
    borderWidth: 3,
    backgroundColor: '#000000',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.6,
    shadowRadius: 10,
    elevation: 16,
    zIndex: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loupeInner: {
    width: LOUPE_INNER,
    height: LOUPE_INNER,
    borderRadius: LOUPE_INNER / 2,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#000000',
  },
  reticleLineH: {
    position: 'absolute',
    left: LOUPE_CENTER - 14,
    top: LOUPE_CENTER - 1,
    width: 28,
    height: 2,
  },
  reticleLineV: {
    position: 'absolute',
    left: LOUPE_CENTER - 1,
    top: LOUPE_CENTER - 14,
    width: 2,
    height: 28,
  },
  reticleCenterPoint: {
    position: 'absolute',
    left: LOUPE_CENTER - 3,
    top: LOUPE_CENTER - 3,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#ffffff',
    borderWidth: 1.5,
  },
  loupeBadge: {
    position: 'absolute',
    bottom: -11,
    paddingHorizontal: 7,
    paddingVertical: 1.5,
    borderRadius: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 3,
    elevation: 4,
  },
  loupeBadgeText: {
    color: '#ffffff',
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  footerTip: {
    paddingBottom: 24,
    alignItems: 'center',
  },
  tipText: {
    color: '#aaaaaa',
    fontSize: 13,
  },
  tipTextError: {
    color: '#ff5252',
    fontWeight: 'bold',
  },
});
