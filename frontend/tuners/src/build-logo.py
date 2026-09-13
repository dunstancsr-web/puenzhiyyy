# Assembles the logo page.
#
# Two things happen here, both to make the file correct whether it is opened
# from disk or published:
#
#   1. The subset brush font is injected as a data URI, so the page is
#      self-contained: no CDN, no FOUT, and the glyphs cannot silently fall
#      back to a system face that is not calligraphic.
#   2. EVERY non-ASCII character becomes an HTML numeric entity. These pages
#      carry no charset meta of their own (the Artifact wrapper supplies one,
#      a local file has nothing), and this is the third time that has bitten:
#      first a degree sign, then middle dots, and now every Chinese character
#      on the page rendered as mojibake. An entity is charset-independent, so
#      it is right in both places. The source template stays readable UTF-8;
#      only the built file is escaped.
b64 = open("mz.b64").read().strip()
src = open("logo-template.html", encoding="utf-8").read()

def escape_non_ascii(s):
    return "".join(c if ord(c) < 128 else "&#x%X;" % ord(c) for c in s)

html = escape_non_ascii(src).replace("__FONT_B64__", b64)
open("logo.html", "w", encoding="ascii").write(html)
print("written %d bytes, %d entities" % (len(html), html.count("&#x")))
