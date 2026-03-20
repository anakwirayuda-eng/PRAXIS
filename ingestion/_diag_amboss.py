import fitz
import sys

PDF_PATH = 'D:/AMBOSS Qbanks Step 2 CK - 2019/1. General Principles of Foundationla Science – 27 Question/General Principles of Foundationla Science – 27 Question [MedicalBooksVN.com].pdf'

try:
    doc = fitz.open(PDF_PATH)
    text = ""
    for i in range(min(5, len(doc))):
        page = doc[i]
        # Get blocks to maintain reading order better than raw text
        blocks = page.get_text("blocks")
        blocks.sort(key=lambda b: (b[1], b[0])) # sort by y, then x
        
        text += f"\n--- PAGE {i+1} ---\n"
        for b in blocks:
            text += b[4] + "\n"
            
    with open('D:/Dev/MedCase/ingestion/amboss_diag_py.txt', 'w', encoding='utf-8') as f:
        f.write(text)
        
    print(f"Extraction successful. First 1500 chars:\n{text[:1500]}")
    
except Exception as e:
    print(f"Error: {e}")
