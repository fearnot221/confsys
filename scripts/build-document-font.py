"""Optional reproducible font preparation; requires fonttools==4.60.1.
Usage: python scripts/build-document-font.py /path/to/NotoSansTC-variable.ttf
Production uses the committed artifact and does not execute this script.
"""
import hashlib
import sys
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

source = Path(sys.argv[1])
if hashlib.sha256(source.read_bytes()).hexdigest() != "864727d210d54f2537bbe23b3a839436c3992af72de9322af5270897246bd44f":
    raise ValueError("Unexpected upstream font; review source/license before updating")
font = instantiateVariableFont(TTFont(source), {"wght": 400}, inplace=True)
for record in font["name"].names:
    if record.nameID in [1, 4, 6, 16]:
        value = "ConfsysSansTC-Regular" if record.nameID == 6 else "Confsys Sans TC"
        record.string = value.encode(record.getEncoding())
font.recalcTimestamp = False
font.save("packages/documents/assets/fonts/ConfsysSansTC-Regular.ttf")
