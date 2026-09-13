#!/usr/bin/env python3
# Generic builder for these pages: inlines the subset brush font and escapes
# every non-ASCII character as an HTML entity. See build-logo.py for why the
# escaping is not optional (no charset meta; CJK renders as mojibake locally).
import sys
b64 = open("mz.b64").read().strip()
src = open(sys.argv[1], encoding="utf-8").read()
esc = "".join(c if ord(c) < 128 else "&#x%X;" % ord(c) for c in src)
out = esc.replace("__FONT_B64__", b64)
open(sys.argv[2], "w", encoding="ascii").write(out)
print("%s -> %s (%d bytes)" % (sys.argv[1], sys.argv[2], len(out)))
