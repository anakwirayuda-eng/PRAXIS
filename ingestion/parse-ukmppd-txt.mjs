/**
 * Parse UKMPPD TXT files from Scribd downloads
 * Handles two formats:
 *   1. Simple MCQ: numbered questions with A-E options
 *   2. OPTIMA Tryout: soal + "Analisis Soal" pembahasan blocks
 * 
 * Usage: node ingestion/parse-ukmppd-txt.mjs
 */
import { readFileSync, writeFileSync, readdirSync, copyFileSync } from 'fs';
import { join, basename } from 'path';

const TXT_DIR = join(import.meta.dirname, '..', 'TXT referensi');
const OUTPUT_DIR = join(import.meta.dirname, 'output');
const COMPILED = join(OUTPUT_DIR, 'compiled_cases.json');
const PUBLIC_COMPILED = join(import.meta.dirname, '..', 'public', 'data', 'compiled_cases.json');

console.log('══════════════════════════════════════════════════');
console.log(' UKMPPD TXT Parser');
console.log('══════════════════════════════════════════════════\n');

const files = readdirSync(TXT_DIR).filter(f => f.endsWith('.txt'));
console.log(`📂 Found ${files.length} TXT files\n`);

// Load existing cases for dedup
let cases = JSON.parse(readFileSync(COMPILED, 'utf-8'));
const existingHashes = new Set(cases.map(c => c.hash_id).filter(Boolean));
console.log(`📦 Existing cases: ${cases.length.toLocaleString()} (${existingHashes.size} hash IDs)\n`);

const allParsed = [];
let nextId = 950000 + cases.filter(c => c.meta?.source?.startsWith('ukmppd-')).length;

for (const file of files) {
  const filePath = join(TXT_DIR, file);
  const raw = readFileSync(filePath, 'utf-8');
  const lines = raw.split('\n');
  console.log(`━━━ ${file} ━━━`);
  console.log(`  Lines: ${lines.length}, Size: ${(raw.length / 1024).toFixed(0)} KB`);

  // Detect format
  const hasAnalisis = raw.includes('Analisis Soal');
  const hasOptima = raw.toLowerCase().includes('optima');
  console.log(`  Format: ${hasAnalisis ? 'OPTIMA (soal + pembahasan)' : 'Simple MCQ'}`);

  // Parse questions
  const questions = [];
  let currentQ = null;
  let currentAnalisis = '';
  let inAnalisis = false;
  let questionNumber = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    // Skip page breaks, headers, footers
    if (trimmed === '' || /^\f/.test(trimmed) || /^\d+$/.test(trimmed) || 
        trimmed.match(/^(Jakarta|Medan|w w w|Jl\.|WA\.|Tlp)/)) continue;

    // Skip presentation-style headers (all caps short lines, bullet slides)
    if (trimmed.length < 5 && !trimmed.match(/^[A-E]\./)) continue;

    // Detect new question (numbered: "196.", "1.", "10.", etc)
    const qMatch = trimmed.match(/^(\d{1,3})\.\s*$/);
    const qInlineMatch = trimmed.match(/^(\d{1,3})\.\s+(.+)/);
    
    if (qMatch || qInlineMatch) {
      const num = parseInt((qMatch || qInlineMatch)[1], 10);
      
      // Save previous question
      if (currentQ && currentQ.text.length > 20) {
        if (inAnalisis) currentQ.explanation = currentAnalisis.trim();
        questions.push(currentQ);
      }

      questionNumber = num;
      currentQ = {
        number: num,
        text: qInlineMatch ? qInlineMatch[2] : '',
        options: [],
        explanation: '',
      };
      currentAnalisis = '';
      inAnalisis = false;
      continue;
    }

    // Detect "Analisis Soal" section
    if (trimmed.includes('Analisis Soal') || trimmed === 'Analisis Soal') {
      inAnalisis = true;
      continue;
    }

    // Detect option (A. through E. or a. through e.)
    const optMatch = trimmed.match(/^([A-Ea-e])[\.\)]\s+(.+)/);
    if (optMatch && currentQ && !inAnalisis) {
      const letter = optMatch[1].toUpperCase();
      let optText = optMatch[2].trim();
      // Strip annotation noise from 2025 tryout (e.g., "- dx: tension pneumothorax")
      optText = optText.replace(/\s*-\s*$/, '').replace(/\s+dx\s*:.*/i, '').trim();
      if (optText.length > 1) {
        currentQ.options.push({ letter, text: optText });
      }
      continue;
    }

    // Accumulate text
    if (currentQ) {
      if (inAnalisis) {
        // Skip slide-style content (tables, references, short headers)
        if (trimmed.startsWith('•') || trimmed.startsWith('http') || 
            trimmed.match(/^\|/) || trimmed.match(/^(DSM|PPDGJ|Kaplan)/)) {
          currentAnalisis += trimmed + ' ';
        } else if (trimmed.length > 30) {
          currentAnalisis += trimmed + ' ';
        }
      } else {
        // Still in question text — skip section headers and noise
        if (trimmed.length > 3 && 
            !trimmed.match(/^(PSIKIATRI|ILMU|BEDAH|OBSTETRI|FARMAKOLOGI|RADIOLOGI|FORENSIK|Emergency|Summary|Terapi|Prinsip|Penyebab|Definisi|Karakteristik|Jenis|BTKV|INTEGUMEN|RHEUMATOLOGI|BEDAH PLASTIK|BEDAH DIGESTIF|BEDAH ONKOLOGI|BEDAH ORTHOPEDI)/i) &&
            !trimmed.match(/^(dx\s*:|Tx\s*:|Potepst|Tawal|tipel|goop|lasifikasi|Rumus|bolch|coment|Anatomi)/i) &&
            !trimmed.match(/^[①②③④⑤]/) &&
            !trimmed.match(/^(\*|\-\s*$|\>|←|↓|↑|S\s|r\/|D\s+Bar)/) &&
            !trimmed.match(/^(WWW|#Solusi)/i)) {
          // Clean annotation noise
          let clean = trimmed
            .replace(/\s*dx\s*:.*/gi, '')
            .replace(/\s*Tx\s*:.*/gi, '')
            .replace(/[①②③④⑤⑥⑦⑧⑨⑩]/g, '')
            .replace(/\s*-\s*$/g, '')
            .trim();
          if (clean.length > 3) currentQ.text += ' ' + clean;
        }
      }
    }
  }
  
  // Save last question
  if (currentQ && currentQ.text.length > 20) {
    if (inAnalisis) currentQ.explanation = currentAnalisis.trim();
    questions.push(currentQ);
  }

  console.log(`  Parsed: ${questions.length} questions`);
  
  // Filter valid questions (must have ≥2 options and text)
  const valid = questions.filter(q => 
    q.options.length >= 2 && q.text.trim().length > 20
  );
  console.log(`  Valid: ${valid.length} questions\n`);

  // Convert to compiled_cases format
  const sourceTag = file.toLowerCase().includes('optima') ? 'ukmppd-optima' : 
    file.toLowerCase().includes('corner') || file.toLowerCase().includes('prediksi') ? 'ukmppd-ukdicorner' : 'ukmppd-scribd';
  
  let skippedDedup = 0;
  for (const q of valid) {
    const hashId = `${sourceTag}_${basename(file, '.txt')}_q${q.number}`;
    if (existingHashes.has(hashId)) { skippedDedup++; continue; }
    
    // Try to extract answer from explanation (OPTIMA format often states it)
    let detectedAnswer = null;
    if (q.explanation) {
      const ansMatch = q.explanation.match(/jawaban(?:nya)?\s+(?:adalah|yang\s+(?:paling\s+)?tepat)\s+([A-E])/i);
      if (ansMatch) detectedAnswer = ansMatch[1];
    }

    // Detect category from text keywords
    let category = 'General Medicine';
    const text = q.text.toLowerCase();
    if (text.match(/\b(anak|pediatr|neonat|bayi|balita)\b/)) category = 'Pediatrics';
    else if (text.match(/\b(hamil|obstetri|partus|kehamilan|persalinan|nifas|post.*partum)\b/)) category = 'Obstetrics & Gynecology';
    else if (text.match(/\b(bedah|operasi|fraktur|laparoto|appendik|hernia)\b/)) category = 'Surgery';
    else if (text.match(/\b(mata|visus|retina|katarak|glaukom|konjungtiv|oftalmol)\b/)) category = 'Ophthalmology';
    else if (text.match(/\b(telinga|hidung|tht|tonsil|sinusit|rinit|otitis)\b/)) category = 'ENT';
    else if (text.match(/\b(kulit|dermat|urtikaria|eksim|psoriasis|skabies|eritema|bula|plak|papul|pustul)\b/)) category = 'Dermatology';
    else if (text.match(/\b(jiwa|psikiat|halusinasi|waham|depresi|cemas|skizofrenia)\b/)) category = 'Psychiatry';
    else if (text.match(/\b(saraf|neurol|stroke|epilepsi|kejang|meningit)\b/)) category = 'Neurology';
    else if (text.match(/\b(jantung|kardio|hipertensi|EKG|koroner|aritmia)\b/)) category = 'Cardiology';
    else if (text.match(/\b(paru|pneumonia|tb|tuberkulosis|asma|ppok|bronk|sesak.*napas)\b/)) category = 'Pulmonology';
    else if (text.match(/\b(ginjal|urol|batu.*ginjal|nefr|dialisis|hemodialisis)\b/)) category = 'Nephrology';
    else if (text.match(/\b(diabetes|dm|tiroid|hormon|endokrin|insulin)\b/)) category = 'Endocrinology';
    else if (text.match(/\b(forensik|visum|mayat|tanatolog|toksikolog)\b/)) category = 'Forensic Medicine';
    else if (text.match(/\b(masyarakat|epidemiol|surveilans|puskesmas|promosi.*kesehatan)\b/)) category = 'Public Health';
    else if (text.match(/\b(farmako|obat|dosis|efek.*samping|interaksi)\b/)) category = 'Pharmacology';
    else if (text.match(/\b(radiolog|rontgen|ct.*scan|mri|usg)\b/)) category = 'Radiology';
    else if (text.match(/\b(anatomi|fisiolog|histolog|embriolog|biokimia)\b/)) category = 'Basic Sciences';
    else if (text.match(/\b(anemia|hb|hemoglobin|leukosit|trombosit|transfusi|hemofilia|talasemia|leukemia|limfoma)\b/)) category = 'Hematology';
    else if (text.match(/\b(luka.*bakar|tendon|achilles|klavikula|spondilo|kompartemen)\b/)) category = 'Surgery';

    const caseObj = {
      _id: nextId++,
      hash_id: hashId,
      q_type: 'MCQ',
      confidence: detectedAnswer ? 3.5 : 2.0,
      category,
      title: q.text.trim().substring(0, 80) + (q.text.length > 80 ? '...' : ''),
      vignette: {
        demographics: { age: null, sex: null },
        narrative: q.text.trim(),
      },
      prompt: '',
      options: q.options.map((o, idx) => ({
        id: o.letter,
        text: o.text,
        is_correct: detectedAnswer ? o.letter === detectedAnswer : (idx === 0),
      })),
      rationale: {
        correct: q.explanation || '',
        distractors: {},
      },
      meta: {
        source: sourceTag,
        examType: 'UKMPPD',
        difficulty: 3,
        filename: file,
        originalNumber: q.number,
        hasVerifiedAnswer: !!detectedAnswer,
      },
      validation: {
        overallScore: detectedAnswer ? 3.5 : 2.0,
        layers: { 
          content: 4, answer: detectedAnswer ? 4 : 1, format: 3, 
          image: 5, explanation: q.explanation ? 4 : 1, source: 3 
        },
        standard: 'scribd-txt-parse',
        warnings: detectedAnswer ? [] : ['answer_key_unverified'],
      },
    };

    // Extract demographics
    const ageMatch = q.text.match(/(\d{1,3})\s*(tahun|bulan|hari)/i);
    if (ageMatch) caseObj.vignette.demographics.age = parseInt(ageMatch[1], 10);
    const sexMatch = q.text.match(/(laki-?laki|perempuan|pria|wanita|Tn\.|Ny\.|Nn\.|An\.|By\.)/i);
    if (sexMatch) {
      const s = sexMatch[1].toLowerCase();
      caseObj.vignette.demographics.sex = s.match(/(laki|pria|tn)/i) ? 'M' : 'F';
    }

    allParsed.push(caseObj);
  }
  if (skippedDedup > 0) console.log(`  ⏭️ Skipped ${skippedDedup} (already in dataset)`);
}

console.log(`\n📊 Total NEW parsed: ${allParsed.length} UKMPPD cases`);
console.log(`  With verified answer: ${allParsed.filter(c => c.meta.hasVerifiedAnswer).length}`);
console.log(`  Without answer key: ${allParsed.filter(c => !c.meta.hasVerifiedAnswer).length}`);

// Category breakdown
const cats = {};
for (const c of allParsed) cats[c.category] = (cats[c.category] || 0) + 1;
console.log('\n  Category breakdown:');
for (const [cat, count] of Object.entries(cats).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${cat}: ${count}`);
}

if (allParsed.length === 0) {
  console.log('\n⚠️ No new cases to inject (all already in dataset)');
} else {
  cases.push(...allParsed);
  writeFileSync(COMPILED, JSON.stringify(cases), 'utf-8');
  copyFileSync(COMPILED, PUBLIC_COMPILED);
  console.log(`\n📦 Total cases now: ${cases.length.toLocaleString()}`);
}
console.log(`  UKMPPD total: ${(cases.filter(c => c.meta?.examType === 'UKMPPD').length + allParsed.length)}`);
console.log(`✅ Done!\n`);
