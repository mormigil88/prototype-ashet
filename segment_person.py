#!/usr/bin/env python3
"""Создаёт мягкую маску человека для сохранения его исходных пикселей."""
import os
import sys
from pathlib import Path

os.environ.setdefault("NUMBA_DISABLE_JIT", "1")

from PIL import Image, ImageFilter
from rembg import new_session, remove


def fail(message: str) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    if len(sys.argv) != 3:
        fail("Использование: python3 segment_person.py <фото> <маска.png>")
    source_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    if not source_path.is_file():
        fail(f"Файл фото не найден: {source_path}")
    if output_path.suffix.lower() != ".png":
        fail("Маска должна быть PNG")

    try:
        with Image.open(source_path) as image:
            source = image.convert("RGBA")
        alpha = remove(source, session=new_session("u2net_human_seg"), only_mask=True).convert("L")
        # Захватываем край волос и одежды, чтобы генерация не прорезала человека по контуру.
        alpha = alpha.filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.GaussianBlur(0.7))
        alpha.save(output_path, "PNG", optimize=True)
    except Exception as error:
        fail("Не удалось автоматически выделить человека: " + str(error))

    print(output_path)


if __name__ == "__main__":
    main()
