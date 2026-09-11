#!/usr/bin/env python3
"""生成 Veil 应用图标 (.icns)：盾牌 + 面具/指纹意象，紫蓝渐变。"""
import os, subprocess, sys, math, tempfile
from PIL import Image, ImageDraw, ImageFilter

OUT = sys.argv[1] if len(sys.argv) > 1 else "AppIcon.icns"
S = 1024
PAD = 92                       # macOS 图标留白

def rounded_mask(size, radius):
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m

def base_icon(size=S):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # 渐变背景（squircle）
    grad = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grad)
    top = (36, 44, 74, 255)
    bot = (14, 16, 26, 255)
    for y in range(size):
        t = y / size
        c = tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)) + (255,)
        gd.line([(0, y), (size, y)], fill=c)
    rad = int(size * 0.2237)
    grad.putalpha(rounded_mask(size, rad))
    img.alpha_composite(grad)

    # 右上高光
    hl = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    hd = ImageDraw.Draw(hl)
    hd.ellipse([size * 0.34, -size * 0.42, size * 1.34, size * 0.62], fill=(126, 152, 255, 62))
    hl = hl.filter(ImageFilter.GaussianBlur(size * 0.09))
    hl.putalpha(Image.composite(hl.split()[3], Image.new("L", (size, size), 0), rounded_mask(size, rad)))
    img.alpha_composite(hl)

    cx = size / 2.0
    top_y = size * 0.215
    bot_y = size * 0.80
    half_w = size * 0.288

    def shield(scale=1.0, dy=0.0):
        w = half_w * scale
        t = top_y * 1.0 + dy
        b = bot_y * scale + (bot_y - bot_y * scale) + dy
        pts = [
            (cx, t),
            (cx + w, t + (b - t) * 0.10),
            (cx + w, t + (b - t) * 0.52),
            (cx + w * 0.62, t + (b - t) * 0.86),
            (cx, b),
            (cx - w * 0.62, t + (b - t) * 0.86),
            (cx - w, t + (b - t) * 0.52),
            (cx - w, t + (b - t) * 0.10),
        ]
        return pts

    # 盾牌外发光
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gld = ImageDraw.Draw(glow)
    gld.polygon(shield(1.06), fill=(124, 156, 255, 120))
    glow = glow.filter(ImageFilter.GaussianBlur(size * 0.035))
    img.alpha_composite(glow)

    # 盾牌主体渐变
    body = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    bd = ImageDraw.Draw(body)
    sg = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    sgd = ImageDraw.Draw(sg)
    c1 = (126, 158, 255, 255)
    c2 = (176, 108, 255, 255)
    y0, y1 = int(top_y), int(bot_y)
    for y in range(y0, y1 + 1):
        t = (y - y0) / max(1, (y1 - y0))
        c = tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3)) + (255,)
        sgd.line([(0, y), (size, y)], fill=c)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).polygon(shield(1.0), fill=255)
    body.paste(sg, (0, 0), mask)
    img.alpha_composite(body)

    # 内部暗色（形成描边效果）
    inner = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    im = Image.new("L", (size, size), 0)
    ImageDraw.Draw(im).polygon(shield(0.905), fill=255)
    iid = ImageDraw.Draw(inner)
    ig = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    igd = ImageDraw.Draw(ig)
    for y in range(y0, y1 + 1):
        t = (y - y0) / max(1, (y1 - y0))
        col = (int(24 + 12 * t), int(28 + 10 * t), int(46 + 16 * t), 255)
        igd.line([(0, y), (size, y)], fill=col)
    inner.paste(ig, (0, 0), im)
    img.alpha_composite(inner)

    # 指纹弧线（在盾牌内部）
    fp = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    fd = ImageDraw.Draw(fp)
    fc = (150, 176, 255, 235)
    ctr_y = size * 0.50
    for i, rr in enumerate([0.052, 0.090, 0.128, 0.166]):
        w = int(size * 0.0125)
        r = size * rr
        a0, a1 = 200 - i * 9, 340 + i * 9
        fd.arc([cx - r, ctr_y - r * 1.06, cx + r, ctr_y + r * 1.06], start=a0, end=a1, fill=fc, width=w)
    fp = fp.filter(ImageFilter.GaussianBlur(size * 0.0018))
    img.alpha_composite(fp)

    # 对勾
    chk = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    cd = ImageDraw.Draw(chk)
    w = int(size * 0.052)
    p1 = (cx - size * 0.115, ctr_y + size * 0.012)
    p2 = (cx - size * 0.028, ctr_y + size * 0.100)
    p3 = (cx + size * 0.135, ctr_y - size * 0.090)
    cd.line([p1, p2], fill=(255, 255, 255, 255), width=w)
    cd.line([p2, p3], fill=(255, 255, 255, 255), width=w)
    for p, r in ((p1, w / 2), (p2, w / 2), (p3, w / 2)):
        cd.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=(255, 255, 255, 255))
    img.alpha_composite(chk)

    # 顶部高光条
    sh = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(sh).polygon(shield(0.905), fill=(255, 255, 255, 26))
    shm = Image.new("L", (size, size), 0)
    ImageDraw.Draw(shm).rectangle([0, int(size * 0.5), size, size], fill=255)
    sh.putalpha(Image.composite(sh.split()[3], Image.new("L", (size, size), 0), shm))
    img.alpha_composite(sh)
    return img

def main():
    icon = base_icon()
    tmp = tempfile.mkdtemp(prefix="veilicon-")
    iconset = os.path.join(tmp, "AppIcon.iconset")
    os.makedirs(iconset, exist_ok=True)
    # 绘制在画布中央并留出 macOS 标准边距
    specs = [(16, "icon_16x16"), (32, "icon_16x16@2x"), (32, "icon_32x32"), (64, "icon_32x32@2x"),
             (128, "icon_128x128"), (256, "icon_128x128@2x"), (256, "icon_256x256"),
             (512, "icon_256x256@2x"), (512, "icon_512x512"), (1024, "icon_512x512@2x")]
    for px, name in specs:
        canvas = Image.new("RGBA", (px, px), (0, 0, 0, 0))
        inner = int(px * (1 - 2 * PAD / S))
        scaled = icon.resize((inner, inner), Image.LANCZOS)
        canvas.paste(scaled, ((px - inner) // 2, (px - inner) // 2), scaled)
        canvas.save(os.path.join(iconset, name + ".png"))
    os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
    r = subprocess.run(["iconutil", "-c", "icns", iconset, "-o", OUT], capture_output=True, text=True)
    if r.returncode != 0:
        print("iconutil 失败:", r.stderr.strip(), file=sys.stderr)
        # 回退：保留 512 png
        icon.resize((512, 512), Image.LANCZOS).save(os.path.join(os.path.dirname(os.path.abspath(OUT)), "AppIcon.png"))
        sys.exit(1)
    print("已生成", OUT, os.path.getsize(OUT), "bytes")

if __name__ == "__main__":
    main()
