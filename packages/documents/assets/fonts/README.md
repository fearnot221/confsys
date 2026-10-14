# Confsys Sans TC (Noto Sans TC static derivative)

Source: official Google Fonts `NotoSansTC[wght].ttf`:
https://github.com/google/fonts/tree/main/ofl/notosanstc
Downloaded 2026-10-15 (Asia/Taipei). Upstream SHA-256:
`864727d210d54f2537bbe23b3a839436c3992af72de9322af5270897246bd44f`.

SIL Open Font License 1.1 is preserved in OFL.txt. This derivative instantiates weight
400 using fontTools 4.60.1 and changes family/full/PostScript names to Confsys Sans TC /
ConfsysSansTC-Regular. Original copyright remains. No proprietary system fonts used.
Regenerate with `scripts/build-document-font.py` and an upstream font path; the artifact
is already bundled, so production and normal build require no Python/fontTools.

The supported pdf-lib/fontkit versions lose composite glyph outlines when subsetting
this CJK font (caught by actual Poppler rendering, despite successful text extraction).
The renderer therefore embeds the complete static TrueType font. A single receipt or
badge batch is approximately 4.2 MiB; the font is embedded once per batch. Do not turn
subsetting back on without rendered CJK regression evidence. The initial variable/OTF
experiments were rejected and are not shipped.

Docker runtime must copy `packages/documents/assets` beside src/dist.
