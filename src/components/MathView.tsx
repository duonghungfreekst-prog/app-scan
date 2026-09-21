import React, { useMemo, memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Platform,
  StyleProp,
  ViewStyle,
  TextStyle,
} from 'react-native';
import { useTheme } from '../theme';

// ==========================================
// 1. DICTIONARIES & CONSTANTS
// ==========================================

/** Bảng tra cứu ký tự Hy Lạp KaTeX/LaTeX */
const GREEK_MAP: Record<string, string> = {
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  epsilon: 'ε',
  varepsilon: 'ε',
  zeta: 'ζ',
  eta: 'η',
  theta: 'θ',
  vartheta: 'ϑ',
  iota: 'ι',
  kappa: 'κ',
  lambda: 'λ',
  mu: 'μ',
  nu: 'ν',
  xi: 'ξ',
  pi: 'π',
  varpi: 'ϖ',
  rho: 'ρ',
  varrho: 'ϱ',
  sigma: 'σ',
  varsigma: 'ς',
  tau: 'τ',
  upsilon: 'υ',
  phi: 'φ',
  varphi: 'ϕ',
  chi: 'χ',
  psi: 'ψ',
  omega: 'ω',
  Gamma: 'Γ',
  Delta: 'Δ',
  Theta: 'Θ',
  Lambda: 'Λ',
  Xi: 'Ξ',
  Pi: 'Π',
  Sigma: 'Σ',
  Upsilon: 'Υ',
  Phi: 'Φ',
  Psi: 'Ψ',
  Omega: 'Ω',
};

/** Bảng tra cứu toán tử & ký hiệu toán học đặc biệt */
const OPERATOR_MAP: Record<string, string> = {
  pm: '±',
  mp: '∓',
  times: '×',
  cdot: '·',
  div: '÷',
  ast: '∗',
  star: '★',
  circ: '∘',
  bullet: '•',
  leq: '≤',
  le: '≤',
  geq: '≥',
  ge: '≥',
  neq: '≠',
  ne: '≠',
  approx: '≈',
  equiv: '≡',
  sim: '∼',
  simeq: '≃',
  cong: '≅',
  propto: '∝',
  infty: '∞',
  inf: '∞',
  partial: '∂',
  nabla: '∇',
  int: '∫',
  iint: '∬',
  iiint: '∭',
  oint: '∮',
  sum: '∑',
  prod: '∏',
  in: '∈',
  notin: '∉',
  subset: '⊂',
  subseteq: '⊆',
  supset: '⊃',
  supseteq: '⊇',
  cup: '∪',
  cap: '∩',
  setminus: '∖',
  emptyset: '∅',
  forall: '∀',
  exists: '∃',
  neg: '¬',
  land: '∧',
  lor: '∨',
  to: '→',
  rightarrow: '→',
  leftarrow: '←',
  Leftarrow: '⇐',
  Rightarrow: '⇒',
  leftrightarrow: '↔',
  Leftrightarrow: '⇔',
  uparrow: '↑',
  downarrow: '↓',
  deg: '°',
  degree: '°',
};

/** Danh sách tên hàm toán học cần hiển thị upright (font thẳng) */
const MATH_FUNCTIONS = new Set([
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc',
  'sinh', 'cosh', 'tanh', 'coth',
  'asin', 'acos', 'atan', 'arcsin', 'arccos', 'arctan',
  'ln', 'log', 'lg', 'exp',
  'lim', 'max', 'min', 'det', 'abs', 'gcd', 'lcm',
]);

// ==========================================
// 2. AST NODE TYPES
// ==========================================

export type MathNodeType =
  | 'text'
  | 'symbol'
  | 'function'
  | 'fraction'
  | 'sqrt'
  | 'power'
  | 'group'
  | 'newline';

export interface BaseMathNode {
  type: MathNodeType;
}

export interface TextNode extends BaseMathNode {
  type: 'text';
  value: string;
  isVariable?: boolean;
}

export interface SymbolNode extends BaseMathNode {
  type: 'symbol';
  value: string;
  isBinaryOp?: boolean;
}

export interface FunctionNode extends BaseMathNode {
  type: 'function';
  name: string;
}

export interface FractionNode extends BaseMathNode {
  type: 'fraction';
  numerator: MathNode;
  denominator: MathNode;
}

export interface SqrtNode extends BaseMathNode {
  type: 'sqrt';
  radicand: MathNode;
  degree?: MathNode;
}

export interface PowerNode extends BaseMathNode {
  type: 'power';
  base: MathNode;
  sup?: MathNode;
  sub?: MathNode;
}

export interface GroupNode extends BaseMathNode {
  type: 'group';
  children: MathNode[];
}

export interface NewlineNode extends BaseMathNode {
  type: 'newline';
}

export type MathNode =
  | TextNode
  | SymbolNode
  | FunctionNode
  | FractionNode
  | SqrtNode
  | PowerNode
  | GroupNode
  | NewlineNode;

// ==========================================
// 3. PARSER ENGINE
// ==========================================

/**
 * Trích xuất nội dung trong cặp ngoặc nhọn hoặc vuông cân bằng
 */
function extractGroup(
  str: string,
  startIndex: number,
  openChar = '{',
  closeChar = '}'
): { content: string; endIndex: number } | null {
  if (str[startIndex] !== openChar) return null;
  let depth = 0;
  let content = '';
  for (let i = startIndex; i < str.length; i++) {
    const ch = str[i];
    if (ch === openChar) {
      if (depth > 0) content += ch;
      depth++;
    } else if (ch === closeChar) {
      depth--;
      if (depth === 0) {
        return { content, endIndex: i + 1 };
      }
      content += ch;
    } else {
      if (depth > 0) content += ch;
    }
  }
  return { content, endIndex: str.length };
}

/**
 * Phân tích chuỗi KaTeX/LaTeX thành cây AST các node toán học
 */
function parseMathFormula(input: string): MathNode[] {
  if (!input || !input.trim()) return [];

  const raw = input.trim();
  const nodes: MathNode[] = [];
  let i = 0;
  const len = raw.length;

  const skipWhitespace = () => {
    while (i < len && (raw[i] === ' ' || raw[i] === '\t')) {
      i++;
    }
  };

  /** Đọc một đối số đơn: có thể là {group}, command hoặc 1 ký tự */
  const readSingleArgument = (): string => {
    skipWhitespace();
    if (i >= len) return '';
    if (raw[i] === '{') {
      const g = extractGroup(raw, i, '{', '}');
      if (g) {
        i = g.endIndex;
        return g.content;
      }
    }
    if (raw[i] === '\\') {
      const m = raw.slice(i).match(/^\\[a-zA-Z]+/);
      if (m) {
        i += m[0].length;
        return m[0];
      }
    }
    const single = raw[i];
    i++;
    return single;
  };

  /** Gắn số mũ vào node liền trước */
  const attachSup = (supNode: MathNode) => {
    const prev = nodes.pop();
    if (!prev) {
      nodes.push({ type: 'power', base: { type: 'text', value: '' }, sup: supNode });
      return;
    }
    if (prev.type === 'power' && !prev.sup) {
      prev.sup = supNode;
      nodes.push(prev);
    } else {
      nodes.push({ type: 'power', base: prev, sup: supNode });
    }
  };

  /** Gắn chỉ số dưới vào node liền trước */
  const attachSub = (subNode: MathNode) => {
    const prev = nodes.pop();
    if (!prev) {
      nodes.push({ type: 'power', base: { type: 'text', value: '' }, sub: subNode });
      return;
    }
    if (prev.type === 'power' && !prev.sub) {
      prev.sub = subNode;
      nodes.push(prev);
    } else {
      nodes.push({ type: 'power', base: prev, sub: subNode });
    }
  };

  while (i < len) {
    const ch = raw[i];

    // Khoảng trắng đơn giản
    if (ch === ' ' || ch === '\t') {
      i++;
      continue;
    }

    // Xuống dòng (dấu \n hoặc KaTeX \\)
    if (ch === '\n' || (ch === '\\' && raw.slice(i, i + 2) === '\\\\')) {
      nodes.push({ type: 'newline' });
      i += ch === '\n' ? 1 : 2;
      continue;
    }

    // Nhóm ngoặc nhọn { ... }
    if (ch === '{') {
      const g = extractGroup(raw, i, '{', '}');
      if (g) {
        i = g.endIndex;
        nodes.push({ type: 'group', children: parseMathFormula(g.content) });
      } else {
        i++;
      }
      continue;
    }

    // Số mũ ^
    if (ch === '^') {
      i++;
      const arg = readSingleArgument();
      const supNode: MathNode = { type: 'group', children: parseMathFormula(arg) };
      attachSup(supNode);
      continue;
    }

    // Chỉ số dưới _
    if (ch === '_') {
      i++;
      const arg = readSingleArgument();
      const subNode: MathNode = { type: 'group', children: parseMathFormula(arg) };
      attachSub(subNode);
      continue;
    }

    // Ký tự căn Unicode sẵn có: √ hoặc ∛
    if (ch === '√') {
      i++;
      const arg = readSingleArgument();
      nodes.push({
        type: 'sqrt',
        radicand: { type: 'group', children: parseMathFormula(arg) },
      });
      continue;
    }

    if (ch === '∛') {
      i++;
      const arg = readSingleArgument();
      nodes.push({
        type: 'sqrt',
        radicand: { type: 'group', children: parseMathFormula(arg) },
        degree: { type: 'text', value: '3' },
      });
      continue;
    }

    // LaTeX Command bắt đầu bằng \
    if (ch === '\\') {
      const match = raw.slice(i).match(/^\\[a-zA-Z]+/);
      if (match) {
        const cmd = match[0].slice(1);
        i += match[0].length;

        // Phân số \frac{numerator}{denominator}
        if (cmd === 'frac') {
          const numStr = readSingleArgument();
          const denStr = readSingleArgument();
          nodes.push({
            type: 'fraction',
            numerator: { type: 'group', children: parseMathFormula(numStr) },
            denominator: { type: 'group', children: parseMathFormula(denStr) },
          });
          continue;
        }

        // Căn bậc hai hoặc căn bậc n: \sqrt[n]{radicand} hoặc \sqrt{radicand}
        if (cmd === 'sqrt') {
          skipWhitespace();
          let degreeStr: string | null = null;
          if (raw[i] === '[') {
            const b = extractGroup(raw, i, '[', ']');
            if (b) {
              degreeStr = b.content;
              i = b.endIndex;
            }
          }
          const radStr = readSingleArgument();
          nodes.push({
            type: 'sqrt',
            radicand: { type: 'group', children: parseMathFormula(radStr) },
            degree: degreeStr ? { type: 'group', children: parseMathFormula(degreeStr) } : undefined,
          });
          continue;
        }

        // Text thường: \text{...} hoặc \mathrm{...}
        if (cmd === 'text' || cmd === 'mathrm' || cmd === 'mathbf' || cmd === 'mathit') {
          const txt = readSingleArgument();
          nodes.push({ type: 'text', value: txt, isVariable: false });
          continue;
        }

        // Ký tự Hy Lạp (\alpha, \beta, \theta, \pi, \Delta, \Sigma...)
        if (GREEK_MAP[cmd]) {
          nodes.push({ type: 'symbol', value: GREEK_MAP[cmd] });
          continue;
        }

        // Toán tử & Ký hiệu toán học (\pm, \times, \cdot, \le, \ge, \ne, \infty...)
        if (OPERATOR_MAP[cmd]) {
          const isBin = ['pm', 'mp', 'times', 'cdot', 'div', 'leq', 'le', 'geq', 'ge', 'neq', 'ne', 'approx', 'equiv'].includes(cmd);
          nodes.push({ type: 'symbol', value: OPERATOR_MAP[cmd], isBinaryOp: isBin });
          continue;
        }

        // Hàm toán học (\sin, \cos, \tan, \ln, \log, \lim...)
        if (MATH_FUNCTIONS.has(cmd)) {
          nodes.push({ type: 'function', name: cmd });
          continue;
        }

        // Dấu ngoặc mở rộng \left( hoặc \right)
        if (cmd === 'left' || cmd === 'right') {
          skipWhitespace();
          if (i < len) {
            nodes.push({ type: 'text', value: raw[i] });
            i++;
          }
          continue;
        }

        // Khoảng cách KaTeX: \quad, \qquad
        if (cmd === 'quad' || cmd === 'qquad') {
          nodes.push({ type: 'text', value: '   ' });
          continue;
        }

        // Fallback hiển thị command
        nodes.push({ type: 'text', value: cmd });
        continue;
      } else {
        // Ký tự thoát như \{, \}, \%, \$, \&
        i++;
        if (i < len) {
          nodes.push({ type: 'text', value: raw[i] });
          i++;
        }
        continue;
      }
    }

    // Nhóm chữ số liên tiếp
    if (/[0-9]/.test(ch)) {
      let num = '';
      while (i < len && /[0-9.,]/.test(raw[i])) {
        num += raw[i];
        i++;
      }
      nodes.push({ type: 'text', value: num, isVariable: false });
      continue;
    }

    // Biến số đơn lẻ (x, y, z, a, b, c...)
    if (/[a-zA-Z]/.test(ch)) {
      nodes.push({ type: 'text', value: ch, isVariable: true });
      i++;
      continue;
    }

    // Toán tử hai ngôi (+, -, =, <, >)
    if (['+', '-', '=', '<', '>'].includes(ch)) {
      nodes.push({ type: 'symbol', value: ch, isBinaryOp: true });
      i++;
      continue;
    }

    // Các ký tự ngoặc và dấu câu thông thường
    nodes.push({ type: 'text', value: ch, isVariable: false });
    i++;
  }

  return nodes;
}

// ==========================================
// 4. COMPONENT PROPS & RENDERERS
// ==========================================

export interface MathViewProps {
  /** Công thức toán học (KaTeX/LaTeX format) hoặc chuỗi hỗn hợp văn bản + công thức */
  formula: string;
  /** Tùy biến kiểu dáng container bao ngoài */
  style?: StyleProp<ViewStyle>;
  /** Tùy biến kiểu chữ của văn bản toán */
  textStyle?: StyleProp<TextStyle>;
  /** Cỡ chữ cơ sở (mặc định: 18) */
  fontSize?: number;
  /** Màu chữ chính (mặc định lấy theo theme.text) */
  color?: string;
  /** Cho phép chọn văn bản (mặc định: true) */
  selectable?: boolean;
  /** Bật thanh cuộn ngang khi công thức dài vượt khung (mặc định: true) */
  scrollable?: boolean;
  /** Ép hiển thị dạng inline (không bọc trong thẻ block) */
  inline?: boolean;
}

/**
 * Renderer đệ quy cho từng Node trong cây AST
 */
const MathNodeRenderer: React.FC<{
  node: MathNode;
  fontSize: number;
  textColor: string;
  lineColor: string;
  depth: number;
  selectable?: boolean;
}> = memo(({ node, fontSize, textColor, lineColor, depth, selectable }) => {
  switch (node.type) {
    case 'text':
      return (
        <Text
          selectable={selectable}
          style={[
            styles.baseText,
            {
              fontSize,
              color: textColor,
              fontStyle: node.isVariable ? 'italic' : 'normal',
              fontFamily: node.isVariable
                ? Platform.OS === 'ios' ? 'Times New Roman' : 'serif'
                : Platform.OS === 'ios' ? 'System' : 'sans-serif',
            },
          ]}
        >
          {node.value}
        </Text>
      );

    case 'symbol':
      return (
        <Text
          selectable={selectable}
          style={[
            styles.baseText,
            {
              fontSize,
              color: textColor,
              marginHorizontal: node.isBinaryOp ? 4 : 1,
            },
          ]}
        >
          {node.value}
        </Text>
      );

    case 'function':
      return (
        <Text
          selectable={selectable}
          style={[
            styles.baseText,
            {
              fontSize,
              color: textColor,
              fontWeight: '500',
              marginRight: 3,
            },
          ]}
        >
          {node.name}
        </Text>
      );

    case 'fraction': {
      // Giảm nhẹ cỡ chữ khi lồng phân số ở các tầng sâu
      const childFontSize = Math.max(10, fontSize * 0.88);
      return (
        <View style={styles.fractionBox}>
          {/* Tử số (Numerator) */}
          <View style={styles.fractionNumerator}>
            <MathNodeRenderer
              node={node.numerator}
              fontSize={childFontSize}
              textColor={textColor}
              lineColor={lineColor}
              depth={depth + 1}
              selectable={selectable}
            />
          </View>
          {/* Đường gạch ngang phân số (Fraction Line) */}
          <View style={[styles.fractionLine, { backgroundColor: lineColor }]} />
          {/* Mẫu số (Denominator) */}
          <View style={styles.fractionDenominator}>
            <MathNodeRenderer
              node={node.denominator}
              fontSize={childFontSize}
              textColor={textColor}
              lineColor={lineColor}
              depth={depth + 1}
              selectable={selectable}
            />
          </View>
        </View>
      );
    }

    case 'sqrt': {
      const childFontSize = Math.max(10, fontSize * 0.92);
      const degreeFontSize = Math.max(8, fontSize * 0.6);
      return (
        <View style={styles.sqrtBox}>
          {/* Chỉ số bậc n (nếu có) */}
          {node.degree && (
            <View style={styles.sqrtDegreeWrap}>
              <MathNodeRenderer
                node={node.degree}
                fontSize={degreeFontSize}
                textColor={textColor}
                lineColor={lineColor}
                depth={depth + 1}
                selectable={selectable}
              />
            </View>
          )}
          {/* Ký hiệu căn √ */}
          <Text
            selectable={selectable}
            style={[
              styles.sqrtGlyph,
              {
                fontSize: fontSize * 1.25,
                color: textColor,
                lineHeight: fontSize * 1.3,
              },
            ]}
          >
            √
          </Text>
          {/* Biểu thức dưới căn (Radicand) kèm đường vinculum kẻ ngang trên đầu */}
          <View style={[styles.sqrtRadicand, { borderTopColor: lineColor }]}>
            <MathNodeRenderer
              node={node.radicand}
              fontSize={childFontSize}
              textColor={textColor}
              lineColor={lineColor}
              depth={depth}
              selectable={selectable}
            />
          </View>
        </View>
      );
    }

    case 'power': {
      const scriptFontSize = Math.max(9, fontSize * 0.72);
      return (
        <View style={styles.powerBox}>
          {/* Cơ số (Base) */}
          <MathNodeRenderer
            node={node.base}
            fontSize={fontSize}
            textColor={textColor}
            lineColor={lineColor}
            depth={depth}
            selectable={selectable}
          />
          {/* Cột hiển thị số mũ (sup) và chỉ số dưới (sub) */}
          {(node.sup || node.sub) && (
            <View style={styles.scriptColumn}>
              {node.sup && (
                <View style={styles.supItem}>
                  <MathNodeRenderer
                    node={node.sup}
                    fontSize={scriptFontSize}
                    textColor={textColor}
                    lineColor={lineColor}
                    depth={depth + 1}
                    selectable={selectable}
                  />
                </View>
              )}
              {node.sub && (
                <View style={[styles.subItem, !node.sup && styles.subOnlyOffset]}>
                  <MathNodeRenderer
                    node={node.sub}
                    fontSize={scriptFontSize}
                    textColor={textColor}
                    lineColor={lineColor}
                    depth={depth + 1}
                    selectable={selectable}
                  />
                </View>
              )}
            </View>
          )}
        </View>
      );
    }

    case 'group':
      return (
        <View style={styles.inlineRow}>
          {node.children.map((child, idx) => (
            <MathNodeRenderer
              key={idx}
              node={child}
              fontSize={fontSize}
              textColor={textColor}
              lineColor={lineColor}
              depth={depth}
              selectable={selectable}
            />
          ))}
        </View>
      );

    case 'newline':
      return <View style={styles.newlineBreak} />;

    default:
      return null;
  }
});

// ==========================================
// 5. MAIN COMPONENT: MathView
// ==========================================

export const MathView: React.FC<MathViewProps> = memo(({
  formula,
  style,
  textStyle,
  fontSize = 18,
  color,
  selectable = true,
  scrollable = true,
  inline = false,
}) => {
  const { theme, isDark } = useTheme();

  // Đồng bộ màu chữ và đường kẻ toán học theo Theme (Dark / Light Mode)
  const textColor = color || theme.text;
  const lineColor = color || (isDark ? 'rgba(224, 224, 255, 0.65)' : 'rgba(44, 62, 80, 0.7)');
  const cardBg = isDark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.02)';

  // Tách nội dung nếu là đoạn văn hỗn hợp có chứa $$block$$ hoặc $inline$
  const segments = useMemo(() => {
    if (!formula || typeof formula !== 'string') return [];

    // Kiểm tra xem có chứa delimiter toán học $$ hoặc $ không
    const hasMathDelimiters = /\$\$[\s\S]*?\$\$|\$[^$\n]+\$/.test(formula);

    if (!hasMathDelimiters) {
      // Toàn bộ chuỗi là công thức toán thuần túy
      return [{ type: 'math' as const, raw: formula, isBlock: !inline }];
    }

    // Tách chuỗi theo delimiters
    const parts: Array<{ type: 'text' | 'math'; raw: string; isBlock?: boolean }> = [];
    const regex = /\$\$([\s\S]*?)\$\$|\$([^$\n]+)\$/g;
    let lastIdx = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(formula)) !== null) {
      if (match.index > lastIdx) {
        const textChunk = formula.slice(lastIdx, match.index);
        if (textChunk.trim()) {
          parts.push({ type: 'text', raw: textChunk });
        }
      }

      if (match[1] !== undefined) {
        // $$display block$$
        parts.push({ type: 'math', raw: match[1], isBlock: true });
      } else if (match[2] !== undefined) {
        // $inline math$
        parts.push({ type: 'math', raw: match[2], isBlock: false });
      }
      lastIdx = regex.lastIndex;
    }

    if (lastIdx < formula.length) {
      const rest = formula.slice(lastIdx);
      if (rest.trim()) {
        parts.push({ type: 'text', raw: rest });
      }
    }

    return parts;
  }, [formula, inline]);

  // Parse từng block công thức sang AST
  const parsedBlocks = useMemo(() => {
    return segments.map(seg => {
      if (seg.type === 'text') return null;
      try {
        return parseMathFormula(seg.raw);
      } catch (err) {
        console.warn('[MathView] Error parsing formula:', seg.raw, err);
        return [{ type: 'text', value: seg.raw }] as MathNode[];
      }
    });
  }, [segments]);

  // Nếu là công thức đơn lẻ và inline
  if (segments.length === 1 && segments[0].type === 'math' && inline) {
    const nodes = parsedBlocks[0] || [];
    return (
      <View style={[styles.inlineRow, style]}>
        {nodes.map((node, idx) => (
          <MathNodeRenderer
            key={idx}
            node={node}
            fontSize={fontSize}
            textColor={textColor}
            lineColor={lineColor}
            depth={0}
            selectable={selectable}
          />
        ))}
      </View>
    );
  }

  // Render danh sách các block
  const content = (
    <View style={styles.blockColumn}>
      {segments.map((seg, idx) => {
        if (seg.type === 'text') {
          return (
            <Text
              key={idx}
              selectable={selectable}
              style={[
                styles.paragraphText,
                { color: textColor, fontSize: fontSize * 0.9 },
                textStyle,
              ]}
            >
              {seg.raw}
            </Text>
          );
        }

        const nodes = parsedBlocks[idx] || [];
        return (
          <View
            key={idx}
            style={[
              styles.displayCard,
              { backgroundColor: seg.isBlock ? cardBg : 'transparent' },
            ]}
          >
            <View style={styles.inlineRow}>
              {nodes.map((node, nIdx) => (
                <MathNodeRenderer
                  key={nIdx}
                  node={node}
                  fontSize={fontSize}
                  textColor={textColor}
                  lineColor={lineColor}
                  depth={0}
                  selectable={selectable}
                />
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );

  if (scrollable) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContainer, style]}
      >
        {content}
      </ScrollView>
    );
  }

  return <View style={[styles.defaultContainer, style]}>{content}</View>;
});

export default MathView;

// ==========================================
// 6. STYLESHEET
// ==========================================

const styles = StyleSheet.create({
  defaultContainer: {
    paddingVertical: 4,
  },
  scrollContainer: {
    flexGrow: 1,
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  blockColumn: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    width: '100%',
  },
  displayCard: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 8,
    marginVertical: 4,
    alignSelf: 'flex-start',
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'nowrap',
  },
  baseText: {
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  paragraphText: {
    lineHeight: 22,
    marginVertical: 3,
  },
  newlineBreak: {
    width: '100%',
    height: 6,
  },

  // --- Phân số (Fraction Layout) ---
  fractionBox: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 3,
    paddingVertical: 1,
  },
  fractionNumerator: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    paddingBottom: 2,
  },
  fractionLine: {
    height: 1.5,
    width: '100%',
    minWidth: 16,
    borderRadius: 1,
  },
  fractionDenominator: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    paddingTop: 2,
  },

  // --- Căn bậc hai & Căn thức (Sqrt Layout) ---
  sqrtBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginHorizontal: 2,
    paddingVertical: 1,
  },
  sqrtDegreeWrap: {
    position: 'absolute',
    left: -2,
    top: -2,
    zIndex: 2,
  },
  sqrtGlyph: {
    fontWeight: '300',
    marginRight: -1,
    includeFontPadding: false,
  },
  sqrtRadicand: {
    borderTopWidth: 1.5,
    paddingTop: 2,
    paddingHorizontal: 3,
    marginLeft: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },

  // --- Số mũ & Chỉ số dưới (Power/Sup/Sub Layout) ---
  powerBox: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  scriptColumn: {
    flexDirection: 'column',
    justifyContent: 'center',
    marginLeft: 1,
  },
  supItem: {
    alignSelf: 'flex-start',
    marginBottom: 2,
  },
  subItem: {
    alignSelf: 'flex-start',
    marginTop: 2,
  },
  subOnlyOffset: {
    marginTop: 6,
  },
});
