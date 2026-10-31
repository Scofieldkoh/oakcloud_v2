# E-signing PDF fonts

Fonts embedded in signed e-signing PDFs and certificates so names and field text in Latin,
Vietnamese and Chinese (and Greek, Cyrillic, Japanese kana, currency symbols such as the rupee sign)
can be drawn. Both files are subsets of Google's Noto fonts, licensed under the SIL Open Font
License 1.1 (full texts next to the fonts: `OFL-NotoSans.txt`, `OFL-NotoSansSC.txt`).

| File | Source | Covers | Size |
| --- | --- | --- | --- |
| `NotoSans-Regular-Subset.ttf` | Noto Sans (`google/fonts` `ofl/notosans`, variable font) | Basic Latin, Latin-1, Latin Extended-A/B, Latin Extended Additional (Vietnamese), Greek, Cyrillic, general punctuation, currency symbols (incl. U+20B9), letterlike symbols, combining marks | ~173 KB |
| `NotoSansSC-Regular-Subset.ttf` | Noto Sans SC (`google/fonts` `ofl/notosanssc`, variable font) | CJK Unified Ideographs U+4E00-9FEF, hiragana, katakana, CJK symbols and punctuation, full-width forms | ~7.1 MB |

Both are static instances at weight 400 (width 100), hinting removed. Layout features: `kern`,
`liga`, `ccmp`, `locl`, `mark`, `mkmk` for Latin and none for CJK. The files are TrueType-outline
(`glyf`) on purpose: pdf-lib embeds fonts as CIDFontType2, which CFF/OpenType outlines do not suit,
and fontkit cannot subset WOFF2.

**How they are used.** `src/services/esigning-pdf-fonts.ts` embeds each file with
`pdf.embedFont(bytes, { subset: true })` (via `@pdf-lib/fontkit`), so a PDF only carries the glyphs it
draws (a PDF with one CJK name grows by a few KB, not 7 MB).

**What the app accepts.** `src/lib/esigning-pdf-text.ts` holds the character ranges the two fonts
cover (the union of their character maps, minus control and format characters). Zod schemas, the
signing page and the PDF service use it, and `__tests__/services/esigning-pdf-text.test.ts` fails if it
drifts from the font files. Not covered, so rejected with a message: emoji, Hangul, Arabic, Hebrew,
Thai, Indic scripts (Tamil, Devanagari ... need shaping that pdf-lib does not do), CJK Extension A and
later, and other symbols.

## Regenerating the fonts

Needs Python with `fonttools` and `brotli` (`pip install fonttools brotli`) and the two variable fonts
from `https://github.com/google/fonts` (`ofl/notosans/NotoSans[wdth,wght].ttf`,
`ofl/notosanssc/NotoSansSC[wght].ttf`).

```bash
LATIN="U+0020-007E,U+00A0-024F,U+0300-036F,U+0370-03FF,U+0400-04FF,U+1E00-1EFF,U+2000-206F,U+20A0-20CF,U+2100-214F,U+2150-218F,U+2190-21FF,U+2212,U+25A0-25FF,U+2713"
CJK="U+3000-303F,U+3040-309F,U+30A0-30FF,U+4E00-9FFF,U+FF00-FFEF"
pyftsubset "NotoSans[wdth,wght].ttf" --unicodes="$LATIN" --no-hinting --name-IDs='*' --name-languages='*' \
  --notdef-outline --layout-features='kern,liga,ccmp,locl,mark,mkmk' --output-file=ns-var.ttf
fonttools varLib.instancer ns-var.ttf wght=400 wdth=100 --update-name-table -o ns-static.ttf
pyftsubset "NotoSansSC[wght].ttf" --unicodes="$CJK" --no-hinting --name-IDs='*' --name-languages='*' \
  --notdef-outline --layout-features='' --output-file=sc-var.ttf
fonttools varLib.instancer sc-var.ttf wght=400 --update-name-table -o sc-static.ttf

# Pad glyph data to 4 bytes. fontkit's subsetter writes a short `loca` table whenever it can and
# breaks (silently, glyphs draw as .notdef or blank) when glyph lengths are odd, which fonttools
# produces by default. The unit tests check this alignment.
python - <<'PY'
from fontTools.ttLib import TTFont
for src, dst in [("ns-static.ttf", "NotoSans-Regular-Subset.ttf"), ("sc-static.ttf", "NotoSansSC-Regular-Subset.ttf")]:
    font = TTFont(src)
    font["glyf"].padding = 4
    font.save(dst)
PY
```

After changing a font file, update `ESIGNING_PDF_SUPPORTED_RANGES` in `src/lib/esigning-pdf-text.ts`
(the test prints the ranges it expects) and keep the licence files. The OFL requires the copyright
notices to stay in the font files' `name` table (they do) and the licence text to ship with them.
