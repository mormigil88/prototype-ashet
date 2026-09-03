#!/usr/bin/env python3
"""Возвращает исходное лицо поверх результата Runway, оставляя тело изменяемым."""
import sys
from pathlib import Path

from PIL import Image


def fail(message: str) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    if len(sys.argv) != 5:
        fail("Использование: python3 preserve_face.py <оригинал> <результат> <маска> <выход.png>")
    source_path, generated_path, mask_path, output_path = map(Path, sys.argv[1:])
    if not all(path.is_file() for path in (source_path, generated_path, mask_path)):
        fail("Не найден оригинал, результат или маска")
    try:
        source = Image.open(source_path).convert("RGBA")
        generated = Image.open(generated_path).convert("RGBA")
        mask = Image.open(mask_path).convert("L")
        if generated.size != source.size:
            generated = generated.resize(source.size, Image.Resampling.LANCZOS)
        if mask.size != source.size:
            mask = mask.resize(source.size, Image.Resampling.LANCZOS)
        face = source.copy()
        face.putalpha(mask)
        Image.alpha_composite(generated, face).convert("RGB").save(output_path, "PNG", optimize=True)
    except Exception as error:
        fail("Не удалось вернуть лицо из оригинального фото: " + str(error))
    print(output_path)


if __name__ == "__main__":
    main()
