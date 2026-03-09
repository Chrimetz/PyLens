import json
import sys
from radon.complexity import cc_visit


if len(sys.argv) < 2:
    sys.exit(1)

file_path = sys.argv[1]
with open(file_path, "r", encoding="utf-8") as f:
    code = f.read()

blocks = cc_visit(code)
results = [{"name": b.name, "line": b.lineno, "complexity": b.complexity} for b in blocks]
print(json.dumps(results))
