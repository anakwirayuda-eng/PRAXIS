"""
HACK 4: PyMuPDF Junk Sniper — Extract clinical images from UKMPPD PDFs
Filters out logos, icons, and line borders using dimension + aspect ratio checks.
Saves relevant clinical images as files.

Usage: python ingestion/extract-pdf-images.py
"""
import fitz  # PyMuPDF
import json
import os
import sys

sys.stdout.reconfigure(encoding='utf-8')

PDF_DIR = os.path.join(os.path.dirname(__file__), '..', 'PDF referensi')
IMAGE_DIR = os.path.join(os.path.dirname(__file__), '..', 'public', 'images', 'cases')
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), 'output')

os.makedirs(IMAGE_DIR, exist_ok=True)

print('=== HACK 4: PyMuPDF Junk Sniper ===\n')

pdf_files = []
if os.path.exists(PDF_DIR):
    for f in os.listdir(PDF_DIR):
        if f.lower().endswith('.pdf'):
            pdf_files.append(os.path.join(PDF_DIR, f))

print(f'Found {len(pdf_files)} PDFs\n')

results = []
total_extracted = 0
total_junked = 0

for pdf_path in pdf_files:
    fname = os.path.basename(pdf_path)
    print(f'--- {fname} ---')
    
    try:
        doc = fitz.open(pdf_path)
        extracted = 0
        junked = 0
        
        for i, page in enumerate(doc):
            for img in page.get_images(full=True):
                xref = img[0]
                try:
                    pix = fitz.Pixmap(doc, xref)
                    
                    # JUNK FILTER: Too small = logo/icon
                    if pix.width < 150 or pix.height < 150:
                        junked += 1
                        continue
                    
                    # JUNK FILTER: Extreme aspect ratio = line/border
                    ratio = pix.width / max(pix.height, 1)
                    if ratio > 4 or ratio < 0.25:
                        junked += 1
                        continue
                    
                    # JUNK FILTER: Too narrow strip
                    if pix.width < 200 and pix.height < 200:
                        junked += 1
                        continue
                    
                    # Convert CMYK to RGB if needed
                    if pix.n > 4:
                        pix = fitz.Pixmap(fitz.csRGB, pix)
                    
                    # Save as PNG (will be converted to WebP by Node.js later)
                    out_name = f'ukmppd_{fname.replace(".pdf","")}_p{i}_{xref}.png'
                    out_path = os.path.join(IMAGE_DIR, out_name)
                    pix.save(out_path)
                    
                    extracted += 1
                    results.append({
                        'pdf': fname,
                        'page': i,
                        'xref': xref,
                        'width': pix.width,
                        'height': pix.height,
                        'file': out_name,
                    })
                    
                except Exception as e:
                    pass  # Skip broken images
        
        doc.close()
        print(f'  Extracted: {extracted}, Junked: {junked}')
        total_extracted += extracted
        total_junked += junked
        
    except Exception as e:
        print(f'  Error: {e}')

# Save manifest
manifest_file = os.path.join(OUTPUT_DIR, 'pdf_image_manifest.json')
with open(manifest_file, 'w') as f:
    json.dump(results, f, indent=2)

print(f'\nTotal extracted: {total_extracted}')
print(f'Total junked: {total_junked}')
print(f'Manifest: {manifest_file}')
print('Done!')
