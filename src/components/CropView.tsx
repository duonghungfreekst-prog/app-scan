import React, { useRef, useState } from 'react';
import { View, StyleSheet, PanResponder, Image, Dimensions, TouchableOpacity, Text } from 'react-native';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const HEADER_H = 80;
const MAX_IMG_W = SCREEN_W - 40;
const MAX_IMG_H = SCREEN_H - HEADER_H - 120;

export type Point = { x: number; y: number };

export interface CropViewProps {
  imageUri: string;
  initialCorners?: [Point, Point, Point, Point]; // TL, TR, BL, BR
  onCropSave: (corners: [Point, Point, Point, Point], imgDisplaySize: { w: number, h: number }) => void;
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

export default function CropView({ imageUri, initialCorners, onCropSave, onCancel }: CropViewProps) {
  const [displaySize, setDisplaySize] = useState({ w: MAX_IMG_W, h: MAX_IMG_H });
  
  // 0: TL, 1: TR, 2: BL, 3: BR
  const [corners, setCorners] = useState<[Point, Point, Point, Point]>(
    initialCorners || [
      { x: 40, y: 40 },
      { x: MAX_IMG_W - 40, y: 40 },
      { x: 40, y: MAX_IMG_H - 40 },
      { x: MAX_IMG_W - 40, y: MAX_IMG_H - 40 },
    ]
  );

  React.useEffect(() => {
    Image.getSize(imageUri, (w, h) => {
      const ratio = Math.min(MAX_IMG_W / w, MAX_IMG_H / h);
      const dispW = w * ratio;
      const dispH = h * ratio;
      setDisplaySize({ w: dispW, h: dispH });
      
      if (!initialCorners) {
        setCorners([
          { x: dispW * 0.05, y: dispH * 0.05 },
          { x: dispW * 0.95, y: dispH * 0.05 },
          { x: dispW * 0.05, y: dispH * 0.95 },
          { x: dispW * 0.95, y: dispH * 0.95 },
        ]);
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
          const newCorners = [...prev] as [Point, Point, Point, Point];
          let nx = startX + gesture.dx;
          let ny = startY + gesture.dy;
          
          nx = Math.max(0, Math.min(nx, displaySize.w));
          ny = Math.max(0, Math.min(ny, displaySize.h));

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

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.btn} onPress={onCancel}>
          <Text style={styles.btnText}>Hủy</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Căn chỉnh viền</Text>
        <TouchableOpacity style={styles.btn} onPress={() => onCropSave(corners, displaySize)}>
          <Text style={[styles.btnText, { color: '#00bfa5', fontWeight: 'bold' }]}>Xong</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.workspace}>
        <View style={{ width: displaySize.w, height: displaySize.h, position: 'relative' }}>
          <Image source={{ uri: imageUri }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
          
          <View style={{ ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.3)' }} />
          
          {/* Lines */}
          <Line p1={corners[0]} p2={corners[1]} />
          <Line p1={corners[1]} p2={corners[3]} />
          <Line p1={corners[3]} p2={corners[2]} />
          <Line p1={corners[2]} p2={corners[0]} />

          {/* Knobs */}
          {corners.map((p, i) => (
            <View
              key={i}
              {...pans[i].panHandlers}
              style={[
                styles.knob,
                { left: p.x - KNOB_SIZE / 2, top: p.y - KNOB_SIZE / 2 }
              ]}
            >
              <View style={styles.knobInner} />
            </View>
          ))}
        </View>
      </View>
      <Text style={styles.hint}>Kéo thả 4 góc để chọn phần giấy</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 100,
  },
  header: {
    height: HEADER_H,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingBottom: 16,
    backgroundColor: '#111',
  },
  title: { color: '#fff', fontSize: 17, fontWeight: 'bold' },
  btn: { padding: 8 },
  btnText: { color: '#fff', fontSize: 16 },
  workspace: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  knob: {
    position: 'absolute',
    width: KNOB_SIZE,
    height: KNOB_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 191, 165, 0.3)',
    borderRadius: KNOB_SIZE / 2,
    zIndex: 10,
  },
  knobInner: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#00bfa5',
    borderWidth: 2,
    borderColor: '#fff',
  },
  hint: {
    color: '#ccc',
    textAlign: 'center',
    marginBottom: 40,
    fontSize: 14
  }
});
