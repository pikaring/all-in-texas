# -*- coding: utf-8 -*-
"""紹介ページ用のアイコンを生成する。

テキサスの夕焼け空にサボテン（サワロ）のシルエット、手前に A♠ A♥ の 2 枚
（ポケットエース＝オールインする手）。外部の画像素材は使わず、ここで描く。

    py make_icon.py
"""
import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, 'assets')
S = 1024

SKY_TOP = (58, 32, 74)         # 空の上（紫がかった夕暮れ）
SKY_MID = (214, 92, 52)        # 夕焼けの赤橙
SKY_LOW = (247, 176, 74)       # 地平線近くの琥珀
SUN = (255, 224, 140)          # 太陽
GROUND = (74, 40, 34)          # 砂漠の地面（暗い赤茶）
CACTUS = (38, 92, 56)          # サボテン
CACTUS_DARK = (26, 64, 40)     # サボテンの縁
CARD = (253, 251, 245)         # カードの面
CARD_EDGE = (200, 192, 176)
INK = (31, 34, 38)             # ♠
RED = (200, 38, 43)            # ♥


def font(size):
    for name in ('arialbd.ttf', 'BIZ-UDGothicB.ttc', 'msgothic.ttc'):
        p = os.path.join(r'C:\Windows\Fonts', name)
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def suit_font(size):
    # 記号は Segoe UI Symbol が確実
    for name in ('seguisym.ttf', 'arial.ttf', 'msgothic.ttc'):
        p = os.path.join(r'C:\Windows\Fonts', name)
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def lerp(a, b, t):
    return tuple(int(x + (y - x) * t) for x, y in zip(a, b))


def draw_sky(img):
    """上から紫→赤橙→琥珀のグラデーション。地平線は 0.72 の高さ。"""
    d = ImageDraw.Draw(img)
    horizon = int(S * 0.72)
    for y in range(horizon):
        t = y / horizon
        c = lerp(SKY_TOP, SKY_MID, t / 0.55) if t < 0.55 else lerp(SKY_MID, SKY_LOW, (t - 0.55) / 0.45)
        d.line([(0, y), (S, y)], fill=c)
    # 太陽：地平線に半分沈む
    r = int(S * 0.20)
    cx, cy = int(S * 0.20), horizon - int(S * 0.02)
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=SUN)
    # 地面
    d.rectangle((0, horizon, S, S), fill=GROUND)
    # 地面のうねり（少し明るい帯）
    d.ellipse((-S * 0.2, horizon - S * 0.03, S * 0.9, horizon + S * 0.12), fill=(96, 52, 42))
    d.rectangle((0, horizon + int(S * 0.06), S, S), fill=GROUND)


def draw_cactus(img):
    """腕が 2 本のサワロ。幹は太く、腕は肘を曲げて上へ。"""
    d = ImageDraw.Draw(img)
    horizon = int(S * 0.72)
    cx = int(S * 0.36)
    w = int(S * 0.14)                     # 幹の幅
    top = int(S * 0.14)
    edge = int(S * 0.012)

    def stem(x0, y0, x1, y1):
        # 角丸の縦棒（上端が丸い）
        d.rounded_rectangle((x0, y0, x1, y1), radius=(x1 - x0) // 2, fill=CACTUS, outline=CACTUS_DARK, width=edge)

    def arm(side, y_join, height):
        # 横に出て、肘で曲がって上へ
        aw = int(w * 0.72)
        reach = int(S * 0.15)
        if side < 0:
            hx0, hx1 = cx - w // 2 - reach, cx - w // 2 + aw // 2
            vx0 = hx0
        else:
            hx0, hx1 = cx + w // 2 - aw // 2, cx + w // 2 + reach
            vx0 = hx1 - aw
        # 横棒
        d.rounded_rectangle((hx0, y_join, hx1, y_join + aw), radius=aw // 2, fill=CACTUS, outline=CACTUS_DARK, width=edge)
        # 縦棒（肘から上）
        d.rounded_rectangle((vx0, y_join - height, vx0 + aw, y_join + aw), radius=aw // 2,
                            fill=CACTUS, outline=CACTUS_DARK, width=edge)
        # 継ぎ目の線を消す（内側を塗り直す）
        d.rectangle((hx0 + edge, y_join + edge, hx1 - edge, y_join + aw - edge), fill=CACTUS)
        d.rectangle((vx0 + edge, y_join - height + aw // 2, vx0 + aw - edge, y_join + aw - edge), fill=CACTUS)

    stem(cx - w // 2, top, cx + w // 2, horizon + int(S * 0.04))
    arm(-1, int(S * 0.40), int(S * 0.20))
    arm(+1, int(S * 0.32), int(S * 0.16))
    # 幹の継ぎ目を消す
    d.rectangle((cx - w // 2 + edge, int(S * 0.30), cx + w // 2 - edge, horizon), fill=CACTUS)
    # 幹の筋（縦の薄い線を 2 本。小さいサイズでは消える）
    for k in (-0.22, 0.22):
        x = cx + int(w * k)
        d.line([(x, top + int(S * 0.06)), (x, horizon)], fill=CACTUS_DARK, width=int(S * 0.006))


def card_layer(rank, suit, color):
    """1 枚のカード（透明レイヤー）。角に小さくランク、中央に大きなスート。"""
    w, h = int(S * 0.30), int(S * 0.42)
    pad = int(S * 0.04)
    layer = Image.new('RGBA', (w + pad * 2, h + pad * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle((pad, pad, pad + w, pad + h), radius=int(S * 0.03), fill=CARD,
                        outline=CARD_EDGE, width=int(S * 0.006))
    f = font(int(h * 0.30))
    bb = d.textbbox((0, 0), rank, font=f)
    d.text((pad + int(w * 0.09) - bb[0], pad + int(h * 0.06) - bb[1]), rank, font=f, fill=color)
    sf = suit_font(int(h * 0.50))
    bb = d.textbbox((0, 0), suit, font=sf)
    tw, th = bb[2] - bb[0], bb[3] - bb[1]
    d.text((pad + w * 0.56 - tw / 2 - bb[0], pad + h * 0.62 - th / 2 - bb[1]), suit, font=sf, fill=color)
    return layer


def draw_cards(img):
    """右下に 2 枚を扇に。奥が A♠、手前が A♥。"""
    spade = card_layer('A', '♠', INK).rotate(14, resample=Image.BICUBIC, expand=True)
    heart = card_layer('A', '♥', RED).rotate(-6, resample=Image.BICUBIC, expand=True)
    # 影
    shadow = Image.new('RGBA', img.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle((int(S * 0.44), int(S * 0.48), int(S * 0.96), int(S * 1.02)), radius=int(S * 0.05), fill=(0, 0, 0, 90))
    img.alpha_composite(shadow)
    img.alpha_composite(spade, (int(S * 0.40), int(S * 0.42)))
    img.alpha_composite(heart, (int(S * 0.62), int(S * 0.55)))


def draw(img):
    draw_sky(img)
    draw_cactus(img)
    draw_cards(img)
    # 角丸に切り抜く
    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, S, S), radius=int(S * 0.22), fill=255)
    img.putalpha(mask)


img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
draw(img)

os.makedirs(ASSETS, exist_ok=True)
img.resize((512, 512), Image.LANCZOS).save(os.path.join(ASSETS, 'icon.png'))
img.save(os.path.join(ASSETS, 'favicon.ico'), sizes=[(48, 48), (32, 32), (16, 16)])
print('書き出し:', os.path.join(ASSETS, 'icon.png'))
print('書き出し:', os.path.join(ASSETS, 'favicon.ico'))

sizes = [256, 128, 64, 48, 32, 16]
strip = Image.new('RGBA', (sum(sizes) + 20 * len(sizes), 280), (250, 250, 250, 255))
x = 10
for s in sizes:
    small = img.resize((s, s), Image.LANCZOS)
    strip.paste(small, (x, 10), small)
    x += s + 20
strip.save(os.path.join(HERE, 'icon_preview.png'))
print('確認用:', os.path.join(HERE, 'icon_preview.png'))

# 小さいサイズでも各要素が残っているかを画素で確認する
print('\n--- 小サイズでの見え方（色の占める割合）---')
for s in (48, 32, 16):
    im = img.resize((s, s), Image.LANCZOS).convert('RGB')
    px = list(im.getdata())
    green = sum(1 for c in px if c[1] > c[0] + 20 and c[1] > c[2] + 15)
    card = sum(1 for c in px if min(c) > 200)
    red = sum(1 for c in px if c[0] > 150 and c[1] < 90 and c[2] < 90)
    sun = sum(1 for c in px if c[0] > 230 and c[1] > 190 and c[2] < 180 and c[2] > 90)
    print(f'  {s:>3}px: サボテン(緑) {green / len(px) * 100:4.1f}%  カード(白) {card / len(px) * 100:4.1f}%  '
          f'ハート(赤) {red / len(px) * 100:4.1f}%  太陽 {sun / len(px) * 100:4.1f}%')
