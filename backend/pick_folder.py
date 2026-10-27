"""Run in a separate process so Tk owns its main thread."""
import json
import sys
import tkinter as tk
from tkinter import filedialog

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    selected = filedialog.askdirectory(title="选择 LexiVault 工作空间目录（新目录或已有工作空间）", mustexist=True)
    root.destroy()
    print(json.dumps(selected, ensure_ascii=False))
