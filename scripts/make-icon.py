#!/usr/bin/env python3
"""Generates Resources/AppIcon.icns and AppIcon.png (requires Pillow)."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parent.parent
resources = root / 'Resources'
image = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
mask = Image.new('L', image.size, 0)
ImageDraw.Draw(mask).rounded_rectangle((54, 54, 970, 970), radius=205, fill=255)
gradient = Image.new('RGBA', image.size)
pixels = gradient.load()
for y in range(1024):
    t = y / 1023
    color = (round(64 - 27*t), round(119 - 39*t), round(233 - 28*t), 255)
    for x in range(1024): pixels[x, y] = color
image.paste(gradient, (0, 0), mask)
draw = ImageDraw.Draw(image)
font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Times New Roman Italic.ttf', 580)
draw.text((492, 524), 'x', font=font, anchor='mm', fill='white')
superscript = ImageFont.truetype('/System/Library/Fonts/Supplemental/Times New Roman.ttf', 240)
draw.text((712, 348), '2', font=superscript, anchor='mm', fill='white')
image.save(resources / 'AppIcon.png')
image.save(resources / 'AppIcon.icns')
