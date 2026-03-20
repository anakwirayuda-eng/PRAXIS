import fitz
import os
import glob

base_dir = r"D:\AMBOSS Qbanks Step 2 CK - 2019"
pdf_files = glob.glob(os.path.join(base_dir, "**", "*.pdf"), recursive=True)

total_pages = 0
for pdf in pdf_files:
    try:
        doc = fitz.open(pdf)
        print(f"{os.path.basename(pdf)}: {len(doc)} pages")
        total_pages += len(doc)
    except Exception as e:
        print(f"Error reading {pdf}: {e}")

print(f"\nTotal PDF files: {len(pdf_files)}")
print(f"Total pages: {total_pages}")
