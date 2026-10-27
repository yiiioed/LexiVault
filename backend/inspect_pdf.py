"""Validate untrusted PDF structure in a separately terminable process."""
import json
import sys

from pypdf import PdfReader


def inspect(path):
    try:
        reader = PdfReader(path, strict=False)
        if reader.is_encrypted:
            return {"error": "暂不支持加密 PDF，请先解密后导入。"}
        count = len(reader.pages)
        if count < 1 or count > 3000:
            return {"error": "PDF 页数需在 1 至 3000 页之间。"}
        return {"pages": count}
    except Exception:
        return {"error": "无法读取这份 PDF，可能已损坏；文件未入库。"}


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(inspect(sys.argv[1]), ensure_ascii=False))
