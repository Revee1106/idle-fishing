/**
 * FE-000 Code First UI Factory (Cocos Creator 3.8.8).
 * Dynamically builds nodes, sprites/panels, labels, buttons, horizontal & vertical layouts,
 * scrollable lists, and animated modals strictly from TypeScript without editor dragging.
 */
import {
  Button,
  Color,
  Label,
  Layers,
  Layout,
  Mask,
  Node,
  ScrollView,
  Size,
  Sprite,
  SpriteFrame,
  tween,
  UIOpacity,
  UITransform,
  Vec3,
  Widget,
} from 'cc';

export interface ThemePalette {
  bg: Color;
  card: Color;
  cardAlt: Color;
  accent: Color;
  accentDark: Color;
  success: Color;
  warn: Color;
  danger: Color;
  text: Color;
  muted: Color;
  border: Color;
}

export const SPIKE_PALETTE: ThemePalette = {
  bg: new Color(18, 31, 46, 255),
  card: new Color(28, 46, 66, 255),
  cardAlt: new Color(36, 58, 82, 255),
  accent: new Color(56, 189, 248, 255),
  accentDark: new Color(20, 112, 160, 255),
  success: new Color(52, 211, 153, 255),
  warn: new Color(251, 191, 36, 255),
  danger: new Color(248, 113, 113, 255),
  text: new Color(241, 245, 249, 255),
  muted: new Color(148, 163, 184, 255),
  border: new Color(51, 80, 110, 255),
};

export interface UiAssets {
  whiteFrame: SpriteFrame;
  badgeFrame: SpriteFrame | null;
}

export function createUiNode(name: string, width: number, height: number): Node {
  const node = new Node(name);
  node.layer = Layers.Enum.UI_2D;
  const tf = node.addComponent(UITransform);
  tf.setContentSize(new Size(width, height));
  return node;
}

export function addFullStretchWidget(node: Node, pad = 0): Widget {
  const w = node.addComponent(Widget);
  w.isAlignTop = true;
  w.isAlignBottom = true;
  w.isAlignLeft = true;
  w.isAlignRight = true;
  w.top = pad;
  w.bottom = pad;
  w.left = pad;
  w.right = pad;
  w.alignMode = Widget.AlignMode.ON_WINDOW_RESIZE;
  return w;
}

export function createPanel(
  name: string,
  width: number,
  height: number,
  color: Color,
  whiteFrame: SpriteFrame
): Node {
  const node = createUiNode(name, width, height);
  const sp = node.addComponent(Sprite);
  sp.type = Sprite.Type.SIMPLE;
  sp.sizeMode = Sprite.SizeMode.CUSTOM;
  sp.spriteFrame = whiteFrame;
  sp.color = color.clone();
  return node;
}

export function createImageNode(
  name: string,
  width: number,
  height: number,
  frame: SpriteFrame | null,
  fallbackFrame: SpriteFrame
): { node: Node; sprite: Sprite } {
  const node = createUiNode(name, width, height);
  const sp = node.addComponent(Sprite);
  sp.type = Sprite.Type.SIMPLE;
  sp.sizeMode = Sprite.SizeMode.CUSTOM;
  sp.spriteFrame = frame ?? fallbackFrame;
  sp.color = frame ? Color.WHITE.clone() : SPIKE_PALETTE.accent.clone();
  return { node, sprite: sp };
}

export interface LabelOptions {
  fontSize?: number;
  lineHeight?: number;
  color?: Color;
  width?: number;
  height?: number;
  hAlign?: Label.HorizontalAlign;
  overflow?: Label.Overflow;
  isBold?: boolean;
}

export function createLabel(name: string, text: string, opts: LabelOptions = {}): { node: Node; label: Label } {
  const fontSize = opts.fontSize ?? 22;
  const lineHeight = opts.lineHeight ?? Math.round(fontSize * 1.35);
  const node = createUiNode(name, opts.width ?? 600, opts.height ?? lineHeight + 6);
  const label = node.addComponent(Label);
  label.string = text;
  label.fontSize = fontSize;
  label.lineHeight = lineHeight;
  label.color = (opts.color ?? SPIKE_PALETTE.text).clone();
  label.horizontalAlign = opts.hAlign ?? Label.HorizontalAlign.LEFT;
  label.verticalAlign = Label.VerticalAlign.CENTER;
  label.overflow = opts.overflow ?? Label.Overflow.CLAMP;
  label.isBold = Boolean(opts.isBold);
  return { node, label };
}

export interface ButtonHandle {
  node: Node;
  label: Label;
  button: Button;
  trigger: () => void;
}

export function createButton(
  name: string,
  text: string,
  width: number,
  height: number,
  bgColor: Color,
  whiteFrame: SpriteFrame,
  onClick: () => void,
  fontSize = 20
): ButtonHandle {
  const node = createPanel(name, width, height, bgColor, whiteFrame);
  const btn = node.addComponent(Button);
  btn.transition = Button.Transition.SCALE;
  btn.zoomScale = 0.96;
  btn.target = node;

  const { node: lblNode, label } = createLabel(`${name}_Label`, text, {
    fontSize,
    width: width - 16,
    height: height - 8,
    hAlign: Label.HorizontalAlign.CENTER,
    color: Color.WHITE,
    overflow: Label.Overflow.SHRINK,
    isBold: true,
  });
  node.addChild(lblNode);
  node.on(Button.EventType.CLICK, onClick);

  return { node, label, button: btn, trigger: onClick };
}

export function createLayoutContainer(
  name: string,
  width: number,
  height: number,
  direction: 'HORIZONTAL' | 'VERTICAL',
  spacing = 10,
  padding = 0,
  resizeContainer = false
): { node: Node; layout: Layout } {
  const node = createUiNode(name, width, height);
  const layout = node.addComponent(Layout);
  layout.type = direction === 'HORIZONTAL' ? Layout.Type.HORIZONTAL : Layout.Type.VERTICAL;
  layout.resizeMode = resizeContainer ? Layout.ResizeMode.CONTAINER : Layout.ResizeMode.NONE;
  if (direction === 'HORIZONTAL') {
    layout.spacingX = spacing;
    layout.paddingLeft = padding;
    layout.paddingRight = padding;
  } else {
    layout.spacingY = spacing;
    layout.paddingTop = padding;
    layout.paddingBottom = padding;
  }
  layout.affectedByScale = false;
  return { node, layout };
}

export interface ScrollListHandle {
  root: Node;
  scrollView: ScrollView;
  content: Node;
  layout: Layout;
  setItems: (items: { title: string; subtitle: string; badge: string; badgeColor: Color }[]) => void;
}

export function createScrollList(
  name: string,
  width: number,
  height: number,
  whiteFrame: SpriteFrame
): ScrollListHandle {
  const root = createPanel(name, width, height, new Color(21, 36, 54, 255), whiteFrame);
  const sv = root.addComponent(ScrollView);
  sv.horizontal = false;
  sv.vertical = true;
  sv.inertia = true;
  sv.brake = 0.75;
  sv.elastic = true;
  sv.bounceDuration = 0.23;

  const viewport = createUiNode(`${name}_Viewport`, width - 12, height - 12);
  const mask = viewport.addComponent(Mask);
  mask.type = Mask.Type.GRAPHICS_RECT;
  root.addChild(viewport);

  const { node: content, layout } = createLayoutContainer(
    `${name}_Content`,
    width - 20,
    height - 20,
    'VERTICAL',
    8,
    8,
    true
  );
  const contentTf = content.getComponent(UITransform)!;
  contentTf.setAnchorPoint(0.5, 1);
  content.setPosition(0, (height - 12) / 2, 0);
  viewport.addChild(content);
  sv.content = content;

  const setItems = (items: { title: string; subtitle: string; badge: string; badgeColor: Color }[]) => {
    content.removeAllChildren();
    const rowWidth = width - 28;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const row = createPanel(`Row_${i}`, rowWidth, 74, SPIKE_PALETTE.cardAlt, whiteFrame);

      const badge = createPanel(`Badge_${i}`, 96, 30, item.badgeColor, whiteFrame);
      badge.setPosition(rowWidth / 2 - 58, 16, 0);
      const { node: badgeLbl } = createLabel(`BadgeLbl_${i}`, item.badge, {
        fontSize: 16,
        width: 90,
        height: 26,
        hAlign: Label.HorizontalAlign.CENTER,
        color: new Color(15, 23, 42, 255),
        overflow: Label.Overflow.SHRINK,
        isBold: true,
      });
      badge.addChild(badgeLbl);
      row.addChild(badge);

      const { node: titleNode } = createLabel(`Title_${i}`, item.title, {
        fontSize: 20,
        width: rowWidth - 130,
        height: 28,
        color: SPIKE_PALETTE.text,
        overflow: Label.Overflow.SHRINK,
        isBold: true,
      });
      titleNode.setPosition(-55, 16, 0);
      row.addChild(titleNode);

      const { node: subNode } = createLabel(`Sub_${i}`, item.subtitle, {
        fontSize: 16,
        width: rowWidth - 24,
        height: 30,
        color: SPIKE_PALETTE.muted,
        overflow: Label.Overflow.SHRINK,
      });
      subNode.setPosition(0, -16, 0);
      row.addChild(subNode);

      content.addChild(row);
    }
    layout.updateLayout();
    sv.scrollToTop(0.1);
  };

  return { root, scrollView: sv, content, layout, setItems };
}

export interface ModalHandle {
  overlay: Node;
  show: (title: string, body: string) => void;
  hide: () => void;
  isVisible: () => boolean;
}

export function createModal(parent: Node, width: number, height: number, whiteFrame: SpriteFrame): ModalHandle {
  const overlay = createPanel('SpikeModalOverlay', width, height, new Color(5, 10, 18, 200), whiteFrame);
  addFullStretchWidget(overlay, 0);
  // Block pointer events through overlay
  overlay.addComponent(Button);
  overlay.active = false;

  const dialogW = Math.min(620, width - 48);
  const dialogH = 440;
  const card = createPanel('SpikeModalCard', dialogW, dialogH, SPIKE_PALETTE.card, whiteFrame);
  overlay.addChild(card);

  const { node: titleNode, label: titleLabel } = createLabel('ModalTitle', 'Modal', {
    fontSize: 26,
    width: dialogW - 40,
    height: 38,
    color: SPIKE_PALETTE.accent,
    overflow: Label.Overflow.SHRINK,
    isBold: true,
  });
  titleNode.setPosition(0, dialogH / 2 - 42, 0);
  card.addChild(titleNode);

  const { node: bodyNode, label: bodyLabel } = createLabel('ModalBody', '', {
    fontSize: 18,
    lineHeight: 26,
    width: dialogW - 44,
    height: dialogH - 150,
    color: SPIKE_PALETTE.text,
    overflow: Label.Overflow.SHRINK,
  });
  bodyLabel.verticalAlign = Label.VerticalAlign.TOP;
  bodyNode.setPosition(0, 6, 0);
  card.addChild(bodyNode);

  const closeBtn = createButton(
    'ModalCloseBtn',
    'Close Modal',
    200,
    48,
    SPIKE_PALETTE.accentDark,
    whiteFrame,
    () => hide(),
    20
  );
  closeBtn.node.setPosition(0, -dialogH / 2 + 44, 0);
  card.addChild(closeBtn.node);

  const show = (title: string, body: string) => {
    titleLabel.string = title;
    bodyLabel.string = body;
    overlay.active = true;
    card.setScale(new Vec3(0.84, 0.84, 1));
    tween(card)
      .stop()
      .to(0.18, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
      .start();
  };

  const hide = () => {
    overlay.active = false;
  };

  parent.addChild(overlay);

  return {
    overlay,
    show,
    hide,
    isVisible: () => overlay.active,
  };
}

export function attachPulseTween(node: Node): void {
  tween(node)
    .repeatForever(
      tween()
        .to(0.75, { scale: new Vec3(1.22, 1.22, 1) }, { easing: 'sineInOut' })
        .to(0.75, { scale: new Vec3(0.86, 0.86, 1) }, { easing: 'sineInOut' })
    )
    .start();
}

export function playPageEnterTween(node: Node): void {
  let op = node.getComponent(UIOpacity);
  if (!op) op = node.addComponent(UIOpacity);
  op.opacity = 40;
  node.setPosition(28, 0, 0);
  tween(op).stop().to(0.18, { opacity: 255 }).start();
  tween(node).stop().to(0.18, { position: new Vec3(0, 0, 0) }, { easing: 'quadOut' }).start();
}
