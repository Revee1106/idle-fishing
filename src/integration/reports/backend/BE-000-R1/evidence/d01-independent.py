import hashlib
import json

# Independent recomputation of the two local D01 vectors used by
# tests/backend/be-000/d01-encoding.test.ts.
# Uses only the Python standard library; no code from packages/game-core.

BACKSLASH = chr(92)
LF = chr(10)
TAB = chr(9)


def canonical(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def show(name, payload):
    outer = canonical(["IDLE_FISHING", 1, "7", "epoch.audit", payload])
    raw = outer.encode("utf-8")
    print(name)
    print("  payload_repr =", ascii(payload))
    print("  payload_utf8_bytes =", len(payload.encode("utf-8")))
    print("  outer_utf8_bytes =", len(raw))
    print("  sha256 =", hashlib.sha256(raw).hexdigest())
    print()


vector_a = canonical({"name": "Alice"})
vector_b = canonical(
    {
        "name": 'He said "hi"',
        "note": "line1" + LF + "line2" + TAB + "end",
        "path": "C:" + BACKSLASH + "tmp" + BACKSLASH + "f.txt",
        "tail": "\u9c7c\U0001f41f",
    }
)

show("BE-D01 local vector A", vector_a)
show("BE-D01 local vector B", vector_b)