import React, { useRef, useState } from 'react';
import { View, StyleSheet, PanResponder, Image, Dimensions, TouchableOpacity, Text, Alert } from 'react-native';
import { CropPoint, PolygonCorners } from '../types/domain';

export type Point = CropPoint;

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const HEADER_H = 80;
const MAX_IMG_W = SCREEN_W - 40;
const MAX_IMG_H = SCREEN_H - HEADER_H - 120;

export interface CropViewProps {
  imageUri: string;
  initialCorners?: PolygonCorners; // TL (0), TR (1), BL (2), BR (3)
  onCropSave: (corners: PolygonCorners, imgDisplaySize: { w: number, h: number }) => void;
  onCancel: () => void;
}

const KNOB_SIZE = 48;

const Line = ({ p1, p2 }: { p1: Point, p2: Point }) => {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
  const centerX = (p1.x + p2.x) / 2;
  const centerY = (p1.y + p2.y) / 2;

  return (
    <View style={{
      position: 'absolute',
      left: centerX - length / 2,
      top: centerY - 1,
      width: length,
      height: 2,
      backgroundColor: '#00bfa5',
      transform: [{ rotate: `${angle}deg` }],
      zIndex: 1
    }} />
  );
};

/**
 * Kiểm tra tính hợp lệ của tứ giác cắt viền:
 * 1. Không tự cắt nhau và phải là đa giác lồi (Convex Polygon)
 * 2. Chiều dài mỗi cạnh tối thiểu 30px
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

  // 2. Kiểm tra tính lồi và không tự cắt qua tích có hướng (Cross Products)
  let prevSign = 0;
  for (let i = 0; i < 4; i++) {
    const p1 = p[i];
    const p2 = p[(i + 1) % 4];
    const p3 = p[(i + 2) % 4];

    const dx1 = p2.x - p1.x;
    const dy1 = p2.y - p1.y;
    const dx2 = p3.x - p2.x;
    const dy2 = p3.y - p2.y;

    const crossProduct = dx1 * dy2 - dy1 * dx2;
    if (Math.abs(crossProduct) < 1e-4) {
      return { valid: false, message: 'Các điểm nằm trên cùng một đường thẳng. Vui lòng kéo rộng các góc.' };
    }

    const currentSign = crossProduct > 0 ? 1 : -1;
    if (prevSign === 0) {
      prevSign = currentSign;
    } else if (currentSign !== prevSign) {
      return { valid: false, message: 'Vùng chọn bị xoắn hoặc tự cắt nhau. Vui lòng chỉnh lại 4 góc thành tứ giác lồi.' };
    }
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

  const autoDetectCorners = (dispW: number, dispH: number): PolygonCorners => {
    // Thuật toán dò biên mô phỏng: tính toán lề an toàn thông minh loại bỏ mép bàn chụp
    const marginX = dispW * 0.055;
    const marginY = dispH * 0.045;
    return [
      { x: marginX, y: marginY },
      { x: dispW - marginX, y: marginY },
      { x: marginX, y: dispH - marginY },
      { x: dispW - marginX, y: dispH - marginY },
    ];
  };

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
      onPanResponderGrant: () => {
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
    });
  };

  const pan0 = useRef(createPanResponder(0)).current;
  const pan1 = useRef(createPanResponder(1)).current;
  const pan2 = useRef(createPanResponder(2)).current;
  const pan3 = useRef(createPanResponder(3)).current;
  const pans = [pan0, pan1, pan2, pan3];

  const handleSaveCorners = () => {
    const check = validateCropPolygon(corners, displaySize.w, displaySize.h);
    if (!check.valid) {
      Alert.alert('Căn lề không hợp lệ', check.message || 'Vui lòng kiểm tra lại 4 góc.');
      return;
    }
    onCropSave(corners, displaySize);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.btn} onPress={onCancel}>
          <Text style={styles.btnText}>Hủy</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Căn chỉnh viền</Text>
        <TouchableOpacity style={styles.btn} onPress={handleSaveCorners}>
          <Text style={[styles.btnText, { color: '#00bfa5', fontWeight: 'bold' }]}>Xong</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.workspace}>
        <View style={{ width: displaySize.w, height: displaySize.h, position: 'relative' }}>
          <Image
            source={{ uri: imageUri }}
            style={{ width: displaySize.w, height: displaySize.h }}
            resizeMode="contain"
          />

          {/* 4 lines connecting corners */}
          <Line p1={corners[0]} p2={corners[1]} />
          <Line p1={corners[1]} p2={corners[3]} />
          <Line p1={corners[3]} p2={corners[2]} />
          <Line p1={corners[2]} p2={corners[0]} />

          {/* 4 Draggable Corner Knobs */}
          {corners.map((c, i) => (
            <View
              key={i}
              {...pans[i].panHandlers}
              style={[
                styles.knob,
                {
                  left: c.x - KNOB_SIZE / 2,
                  top: c.y - KNOB_SIZE / 2,
                },
              ]}
            >
              <View style={styles.innerDot} />
            </View>
          ))}
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
        <Text style={styles.tipText}>💡 Kéo 4 chấm tròn màu xanh để căn sát viền mép tài liệu</Text>
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
    backgroundColor: 'rgba(0, 191, 165, 0.35)',
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
    borderColor: '#00bfa5',
  },
  footerTip: {
    paddingBottom: 24,
    alignItems: 'center',
  },
  tipText: {
    color: '#aaaaaa',
    fontSize: 13,
  },
});
