#!/usr/bin/env python3
"""Находит лицо и создаёт мягкую маску только для него (без причёски)."""
import sys
from pathlib import Path

import cv2
from PIL import Image, ImageDraw, ImageFilter


def fail(message: str) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    if len(sys.argv) != 3:
        fail("Использование: python3 segment_face.py <фото> <маска.png>")
    source_path, output_path = map(Path, sys.argv[1:])
    if not source_path.is_file():
        fail(f"Файл фото не найден: {source_path}")

    image = cv2.imread(str(source_path))
    if image is None:
        fail("Не удалось прочитать фото")
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    faces = cv2.CascadeClassifier(cascade_path).detectMultiScale(
        gray, scaleFactor=1.08, minNeighbors=5, minSize=(48, 48)
    )
    if len(faces) != 1:
        if len(faces) == 0:
            fail("Лицо не найдено автоматически; не буду менять фото без защиты лица")
        fail("Найдено несколько лиц; не буду менять фото без защиты каждого лица")

    x, y, width, height = map(int, faces[0])
    # Овал закрывает лицо до линии волос, но оставляет волосы редактируемыми.
    cx, cy = x + width / 2, y + height / 2
    rx, ry = width * 0.54, height * 0.60
    with Image.open(source_path) as source:
        mask = Image.new("L", source.size, 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(max(2, round(min(width, height) * 0.035))))
    mask.save(output_path, "PNG", optimize=True)
    print(output_path)


if __name__ == "__main__":
    main()
