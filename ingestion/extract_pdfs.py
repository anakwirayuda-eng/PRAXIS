"""
HACK 3: Python PDF Bridge for UKMPPD PDF extraction
Extracts text from all PDFs in 'PDF referensi/' folder using PyMuPDF
Outputs extracted text as JSON for Node.js consumption

Usage: python ingestion/extract_pdfs.py
"""
import fitz  # PyMuPDF
import json
import os
import sys

# Fix Windows console encoding
sys.stdout.reconfigure(encoding='utf-8')

PDF_DIR = os.path.join(os.path.dirname(__file__), '..', 'PDF referensi')
TXT_DIR = os.path.join(os.path.dirname(__file__), '..', 'TXT referensi')
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), 'output')

print('=== HACK 3: Python PDF Bridge ===\n')

results = []

# Scan both directories for PDFs
pdf_files = []
for d in [PDF_DIR, TXT_DIR]:
    if os.path.exists(d):
        for f in os.listdir(d):
            if f.lower().endswith('.pdf'):
                pdf_files.append(os.path.join(d, f))

print(f'📂 Found {len(pdf_files)} PDF files\n')

for pdf_path in pdf_files:
    fname = os.path.basename(pdf_path)
    print(f'━━━ {fname} ━━━')
    
    try:
        doc = fitz.open(pdf_path)
        pages_text = []
        for page in doc:
            pages_text.append(page.get_text())
        
        full_text = '\n'.join(pages_text)
        print(f'  Pages: {len(doc)}, Text: {len(full_text) // 1024} KB')
        
        # Save extracted text
        txt_file = os.path.join(OUTPUT_DIR, f'pdf_{fname.replace(".pdf", ".txt")}')
        with open(txt_file, 'w', encoding='utf-8') as f:
            f.write(full_text)
        print(f'  ✅ Saved to {os.path.basename(txt_file)}')
        
        results.append({
            'filename': fname,
            'pages': len(doc),
            'text_length': len(full_text),
            'txt_file': txt_file,
        })
        
        doc.close()
    except Exception as e:
        print(f'  ❌ Error: {e}')

# Save manifest
manifest_file = os.path.join(OUTPUT_DIR, 'pdf_extraction_manifest.json')
with open(manifest_file, 'w') as f:
    json.dump(results, f, indent=2)

print(f'\n📊 Extracted {len(results)} PDFs')
total_kb = sum(r['text_length'] for r in results) // 1024
print(f'  Total text: {total_kb} KB')
print(f'  Manifest: {manifest_file}')
print('✅ Done! Run parse-ukmppd-txt.mjs on extracted TXT files next.\n')
