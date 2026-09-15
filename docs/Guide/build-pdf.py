#!/usr/bin/env python3
# ─────────────────────────────────────────────────────────────────────────────
# FEATURES GUIDE PDF: rebuild the downloadable PDF from FEATURES GUIDE.md
#
# Run from anywhere:
#   python3 "docs/Guide/build-pdf.py"                 writes ~/Downloads/StockSense Features Guide.pdf
#   python3 "docs/Guide/build-pdf.py" /some/out.pdf   writes there instead
#
# The Markdown file is the one source; the PDF is a copy for sharing and is never
# committed. Rebuild it after editing the guide or recapturing a screenshot.
#
# Needs: Python's `markdown` package (pip install markdown) and Google Chrome,
# which prints the page. Handheld screenshots (the ones with width="320" in the
# Markdown) are laid out beside their text in a block that never splits across
# pages; every section starts a new page.
# ─────────────────────────────────────────────────────────────────────────────

import os
import re
import subprocess
import sys

import markdown

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCE = os.path.join(HERE, "FEATURES GUIDE.md")
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/Downloads/StockSense Features Guide.pdf")
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

CSS = """
@page { size: A4; margin: 15mm 15mm 16mm; }
body { font-family: -apple-system, "Helvetica Neue", Arial, sans-serif; color:#1f2430; font-size:10.5pt; line-height:1.5; }
h1 { font-size:24pt; margin:0 0 6pt; color:#111827; }
h2 { font-size:16pt; margin:0 0 6pt; padding-top:4pt; color:#111827; break-before:page; break-after:avoid; }
h3 { font-size:12pt; margin:10pt 0 4pt; color:#1f2937; break-after:avoid; }
p, li { margin: 4pt 0; }
blockquote { margin:8pt 0; padding:6pt 10pt; background:#f3f4f6; border-left:3px solid #9ca3af; color:#374151; }
img { max-width:100%; max-height:105mm; display:block; margin:6pt auto; border:1px solid #e5e7eb; border-radius:6px; break-inside:avoid; }
.step { display:flex; gap:14pt; align-items:flex-start; break-inside:avoid; margin:8pt 0 10pt; }
.step .txt { flex:1; } .step .txt h3 { margin-top:0; }
.step .shot { width:42mm; flex:none; } .step .shot img { width:100%; max-height:none; margin:0; }
table { border-collapse:collapse; width:100%; margin:8pt 0; font-size:9.5pt; break-inside:avoid; }
th, td { border:1px solid #e5e7eb; padding:4pt 6pt; text-align:left; vertical-align:top; }
th { background:#f9fafb; }
pre { background:#f3f4f6; padding:8pt; border-radius:6px; font-size:8.5pt; white-space:pre; overflow:hidden; break-inside:avoid; }
code { font-family: Menlo, monospace; font-size:9pt; }
hr { display:none; }
a { color:#1d4ed8; text-decoration:none; }
"""

# A handheld step: heading, a width="320" screenshot, then its paragraphs.
STEP = re.compile(
    r'(<h3[^>]*>.*?</h3>)\s*<p>(<img [^>]*width="320"[^>]*>)</p>\s*((?:<p>.*?</p>\s*)+?)(?=<h3|<hr|<h2|$)',
    re.S,
)


def main():
    if not os.path.exists(CHROME):
        sys.exit("Google Chrome was not found at " + CHROME)
    with open(SOURCE, encoding="utf-8") as f:
        body = markdown.markdown(f.read(), extensions=["tables", "fenced_code", "toc"])
    body = STEP.sub(
        lambda m: f'<div class="step"><div class="txt">{m.group(1)}{m.group(3)}</div>'
        f'<div class="shot">{m.group(2)}</div></div>',
        body,
    )
    # Written beside the guide so the relative image paths resolve.
    page = os.path.join(HERE, ".guide-print.html")
    with open(page, "w", encoding="utf-8") as f:
        f.write(f"<!doctype html><html><head><meta charset='utf-8'><title>StockSense features guide</title>"
                f"<style>{CSS}</style></head><body>{body}</body></html>")
    try:
        subprocess.run(
            [CHROME, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
             "--allow-file-access-from-files", f"--print-to-pdf={OUT}", "file://" + page],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
    finally:
        os.remove(page)
    print(f"Written: {OUT} ({os.path.getsize(OUT) // 1024} KB)")


if __name__ == "__main__":
    main()
