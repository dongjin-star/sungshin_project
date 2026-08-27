#!/usr/bin/env python3
"""
캐릭터 포즈 6장을 화면용 자산으로 정규화한다.

    python scripts/build-poses.py

image/pose-*.png (원본) → public/poses/*.webp (정규화)

── 왜 이 단계가 필요한가 ────────────────────────────────────────────

포즈 전환은 두 이미지를 같은 자리에 겹쳐 크로스페이드하는 방식이다.
그러려면 여섯 장이 **같은 좌표계**에 있어야 한다. 원본은 그렇지 않다.

    pose-foot / pose-knee   1086 x 1448
    pose-waist / pose-head   366 x 490~535
    pose-chest               320 x 530
    pose-shoulder            325 x 535

캔버스도 다르고, 그 안에서 캐릭터가 차지하는 비율과 위치도 제각각이다.
`object-fit: contain` 만 걸면 전환할 때마다 캐릭터가 커졌다 작아졌다
좌우로 튄다 — 포즈가 바뀌는 게 아니라 화면이 흔들리는 것으로 보인다.

── 정렬 기준 ────────────────────────────────────────────────────────

서 있는 캐릭터를 겹칠 때 맞춰야 할 것은 셋이다.

  1. 크기 — **머리 너비**를 기준으로 맞춘다. 실루엣 전체 높이는 포즈마다
     달라진다(팔을 들면 커진다). 머리는 여섯 장 모두에 온전히 보이고
     포즈와 무관하므로 가장 안정적인 기준이다.
  2. 바닥 — 발끝을 같은 높이에 놓는다. 서 있는 캐릭터는 지면이 고정이다.
  3. 좌우 — **발 중심**을 캔버스 중앙에 놓는다. 몸 전체의 중심을 쓰면
     팔을 든 포즈에서 축이 밀린다.
"""

import os
import sys

import numpy as np
from PIL import Image

ZONES = ["foot", "knee", "waist", "chest", "shoulder", "head"]

# 표시 폭 최대 200 CSS px. 3x DPR 기준 600px 이면 충분하다.
CANVAS_W, CANVAS_H = 600, 760
BOTTOM_MARGIN = 20
# 머리 너비 목표. 가장 키가 커지는 포즈(shoulder)가 캔버스에 들어가는 값이다.
TARGET_HEAD_W = 380

ALPHA_THRESHOLD = 24


def measure(im: Image.Image) -> dict:
    """실루엣에서 정렬에 필요한 값을 뽑는다."""
    alpha = np.array(im)[:, :, 3]
    opaque = alpha > ALPHA_THRESHOLD

    rows = np.where(opaque.any(axis=1))[0]
    cols = np.where(opaque.any(axis=0))[0]
    top, bottom = int(rows[0]), int(rows[-1])
    left, right = int(cols[0]), int(cols[-1])
    height = bottom - top + 1

    widths = opaque.sum(axis=1)
    # 머리 너비 — 실루엣 위쪽 55% 안에서 가장 넓은 행
    head_band = range(top, top + max(1, int(height * 0.55)))
    head_w = int(max(widths[y] for y in head_band))

    # 발 중심 — 실루엣 아래쪽 8%
    foot_band = opaque[bottom - max(1, int(height * 0.08)) : bottom + 1]
    foot_cols = np.where(foot_band.any(axis=0))[0]
    foot_cx = (int(foot_cols[0]) + int(foot_cols[-1])) / 2

    return {
        "bbox": (left, top, right + 1, bottom + 1),
        "head_w": head_w,
        "foot_cx": foot_cx,
        "sil_h": height,
    }


def normalize(path: str) -> tuple[Image.Image, dict]:
    im = Image.open(path).convert("RGBA")
    m = measure(im)

    scale = TARGET_HEAD_W / m["head_w"]
    left, top, right, bottom = m["bbox"]

    cropped = im.crop((left, top, right, bottom))
    new_w = max(1, round(cropped.width * scale))
    new_h = max(1, round(cropped.height * scale))
    scaled = cropped.resize((new_w, new_h), Image.LANCZOS)

    canvas = Image.new("RGBA", (CANVAS_W, CANVAS_H), (0, 0, 0, 0))
    # 발끝을 바닥선에, 발 중심을 캔버스 중앙에
    y = CANVAS_H - BOTTOM_MARGIN - new_h
    x = round(CANVAS_W / 2 - (m["foot_cx"] - left) * scale)
    canvas.alpha_composite(scaled, (x, y))

    return canvas, {**m, "scale": scale, "norm_h": new_h, "norm_w": new_w, "paste": (x, y)}


def main() -> int:
    os.makedirs("public/poses", exist_ok=True)

    missing = [z for z in ZONES if not os.path.exists(f"image/pose-{z}.png")]
    if missing:
        print(f"🔴 원본을 찾지 못했다: {', '.join('pose-' + z for z in missing)}")
        return 1

    print(f"캔버스 {CANVAS_W}x{CANVAS_H} · 머리 너비 {TARGET_HEAD_W}px 기준 정렬\n")
    print(f"{'포즈':12} {'스케일':>7} {'정규화 크기':>14} {'상단여백':>8} {'용량':>9}")
    print("-" * 58)

    heights = {}
    for zone in ZONES:
        src = f"image/pose-{zone}.png"
        canvas, info = normalize(src)
        dst = f"public/poses/{zone}.webp"
        canvas.save(dst, "WEBP", quality=88, method=6)

        heights[zone] = info["norm_h"]
        size_kb = os.path.getsize(dst) / 1024
        print(
            f"{zone:12} {info['scale']:7.3f} "
            f"{info['norm_w']:5}x{info['norm_h']:<8} {info['paste'][1]:8} {size_kb:8.0f}KB"
        )

    # 정규화하고도 키가 크게 다르면 원본이 서로 다른 비율로 그려진 것이다.
    lo, hi = min(heights.values()), max(heights.values())
    spread = (hi - lo) / hi
    print(f"\n정규화 후 키 편차: {lo}~{hi}px ({spread * 100:.1f}%)")
    if spread > 0.08:
        worst = sorted(heights, key=heights.get)
        print(
            f"⚠️  편차가 크다. 머리 대비 몸 비율이 포즈마다 다르다는 뜻이며,\n"
            f"    크로스페이드할 때 캐릭터가 커졌다 작아졌다 하는 것으로 보인다.\n"
            f"    가장 작은 쪽: {worst[0]}({heights[worst[0]]}px) / "
            f"가장 큰 쪽: {worst[-1]}({heights[worst[-1]]}px)"
        )

    return 0


if __name__ == "__main__":
    sys.exit(main())
