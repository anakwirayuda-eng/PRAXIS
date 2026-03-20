/**
 * FDI Parser v3 — Page-aware extraction with proper answer keys
 * 
 * FDI format (per question):
 *   Page N: SOAL header + Question text + A. B. C. D. E. options
 *   Page N+1: "D. ANSWER TOPIC" (correct letter) + Keyword + explanation
 *   Pages N+2...: more explanation
 *   Page N+k: "Jawaban lainnya" = explains why OTHER options are wrong
 * 
 * Answer key = first "[A-E]." on the pembahasan page (right after SOAL page)
 */
const fs = require('fs');
const path = require('path');

const OUTPUT = path.join(__dirname, 'output');

(async () => {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  
  console.log('═══ FDI Parser v3 (Page-Aware) ═══\n');
  
  const FDI_DIR = path.join('PDF referensi', 'FDI');
  const files = fs.readdirSync(FDI_DIR).filter(f => f.toLowerCase().endsWith('.pdf'));
  console.log(`Found ${files.length} PDFs\n`);
  
  const allQuestions = [];
  
  for (const file of files) {
    const filePath = path.join(FDI_DIR, file);
    process.stdout.write(`📄 ${file.substring(0, 55).padEnd(55)} `);
    
    let doc;
    try {
      const buf = new Uint8Array(fs.readFileSync(filePath));
      doc = await getDocument({ data: buf, useSystemFonts: true }).promise;
    } catch {
      console.log('❌ error');
      continue;
    }
    
    // Parse all pages with type classification
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items.map(item => item.str).join(' ');
      
      const hasSoal = /SOAL/i.test(text);
      const hasSeorang = /Seorang|seorang/i.test(text);
      const hasJawaban = /Jawaban\s+lainnya/i.test(text);
      
      let type = 'EXPLAIN'; // default = explanation/pembahasan
      if (hasSoal && hasSeorang) type = 'SOAL';
      else if (hasSoal && !hasSeorang) type = 'SOAL_NOTEXT'; // SOAL header but no question text
      else if (hasJawaban) type = 'JAWABAN_LAINNYA';
      
      pages.push({ num: i, type, text });
    }
    
    // Group: find each SOAL page, then collect subsequent non-SOAL pages until next SOAL
    const questions = [];
    
    for (let i = 0; i < pages.length; i++) {
      if (pages[i].type !== 'SOAL') continue;
      
      const soalPage = pages[i];
      
      // Collect explanation pages until next SOAL
      const explainPages = [];
      for (let j = i + 1; j < pages.length; j++) {
        if (pages[j].type === 'SOAL') break;
        explainPages.push(pages[j]);
      }
      
      // Parse question from SOAL page
      let clean = soalPage.text
        .replace(/F\s*U\s*T\s*U\s*R\s*E\s*D\s*O\s*C\s*T\s*O\s*R.+?\.C\s*O\s*M/gi, '')
        .replace(/©\s*FDI\d{4}/gi, '')
        .replace(/SOAL/gi, '')
        .trim();
      
      // Split on option markers
      const parts = clean.split(/\s+([A-E])\.\s+/);
      if (parts.length < 7) continue; // Need at least vignette + 3 options
      
      const vignette = parts[0].replace(/\s+/g, ' ').trim();
      if (vignette.length < 20) continue;
      
      const options = [];
      for (let j = 1; j < parts.length - 1; j += 2) {
        const letter = parts[j];
        if (!/^[A-E]$/.test(letter)) continue;
        let optText = parts[j + 1].replace(/\s+/g, ' ')
          .replace(/\s*(?:Jawaban|Keyword|Pembahasan|Sumber).*$/i, '').trim();
        // Truncate at next option if leaking  
        optText = optText.split(/\s+[A-E]\.\s+/)[0].trim();
        if (optText.length > 0 && !options.find(o => o.id === letter)) {
          options.push({ id: letter, text: optText, is_correct: false });
        }
      }
      
      if (options.length < 3) continue;
      
      // Extract answer key from first explanation page
      // Pattern: first page after SOAL starts with "[A-E]. ANSWER_TEXT"
      let correctAnswer = null;
      if (explainPages.length > 0) {
        const firstExplain = explainPages[0].text
          .replace(/F\s*U\s*T\s*U\s*R\s*E\s*D\s*O\s*C\s*T\s*O\s*R.+?\.C\s*O\s*M/gi, '')
          .replace(/©\s*FDI\d{4}/gi, '')
          .trim();
        
        // First capital letter A-E followed by period at start
        const ansMatch = firstExplain.match(/^\s*([A-E])\.\s/);
        if (ansMatch) {
          correctAnswer = ansMatch[1];
        } else {
          // Try finding first "[A-E]." anywhere in first explain page
          const anyMatch = firstExplain.match(/\b([A-E])\.\s+[A-Z]/);
          if (anyMatch) {
            correctAnswer = anyMatch[1];
          }
        }
      }
      
      // Also try extracting from Jawaban lainnya page (it lists WRONG options)
      // The correct answer is the one NOT listed there
      if (!correctAnswer) {
        const jawabanPage = explainPages.find(p => p.type === 'JAWABAN_LAINNYA');
        if (jawabanPage) {
          const wrongLetters = new Set();
          for (const m of jawabanPage.text.matchAll(/\b([A-E])\.\s/g)) {
            wrongLetters.add(m[1]);
          }
          // Find the option letter NOT in the wrong list
          const allLetters = options.map(o => o.id);
          const candidates = allLetters.filter(l => !wrongLetters.has(l));
          if (candidates.length === 1) {
            correctAnswer = candidates[0];
          }
        }
      }
      
      if (correctAnswer) {
        for (const opt of options) opt.is_correct = opt.id === correctAnswer;
      }
      
      // Extract rationale from explain pages
      let rationale = '';
      if (explainPages.length > 0) {
        rationale = explainPages.map(p => p.text).join(' ')
          .replace(/F\s*U\s*T\s*U\s*R\s*E\s*D\s*O\s*C\s*T\s*O\s*R.+?\.C\s*O\s*M/gi, '')
          .replace(/©\s*FDI\d{4}/gi, '')
          .replace(/\s+/g, ' ')
          .trim()
          .substring(0, 500);
      }
      
      questions.push({
        page: soalPage.num,
        vignette,
        options,
        rationale,
        source: 'fdi-tryout',
      });
    }
    
    const keyed = questions.filter(q => q.options.some(o => o.is_correct)).length;
    console.log(`${questions.length} Qs, ${keyed} keyed (${doc.numPages} pages)`);
    allQuestions.push(...questions);
  }
  
  // Dedup — use 200 chars (60 was too short, all FDI vignettes start with "Seorang ... berusia XX tahun datang ke...")
  const seen = new Set();
  const deduped = [];
  for (const q of allQuestions) {
    const key = q.vignette.substring(0, 200).toLowerCase().replace(/\s+/g, ' ');
    if (!seen.has(key)) { seen.add(key); deduped.push(q); }
  }
  
  const withKeys = deduped.filter(q => q.options.some(o => o.is_correct)).length;
  
  console.log('\n═══ RESULTS ═══');
  console.log(`Raw: ${allQuestions.length} | Deduped: ${deduped.length}`);
  console.log(`With keys: ${withKeys} (${Math.round(withKeys / deduped.length * 100)}%)`);
  console.log(`Without keys: ${deduped.length - withKeys}`);
  
  fs.writeFileSync(path.join(OUTPUT, 'fdi_parsed_v3.json'), JSON.stringify(deduped, null, 2));
  
  // Sample
  if (deduped.length > 0) {
    const keySamples = deduped.filter(q => q.options.some(o => o.is_correct));
    for (let sample = 0; sample < Math.min(3, keySamples.length); sample++) {
      const s = keySamples[Math.floor(sample * keySamples.length / 3)];
      console.log(`\n═══ SAMPLE ${sample + 1} ═══`);
      console.log(`Q: ${s.vignette.substring(0, 180)}...`);
      for (const o of s.options) console.log(`  ${o.id}. ${o.text.substring(0, 70)} ${o.is_correct ? '★' : ''}`);
      console.log(`  Rationale: ${s.rationale.substring(0, 120)}...`);
    }
  }
})();
