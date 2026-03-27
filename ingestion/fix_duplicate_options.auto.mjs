import fs from 'fs';
import path from 'path';

const COMPILED_CASES_PATH = path.join(process.cwd(), 'public/data/compiled_cases.json');
const OLLAMA_URL = 'http://localhost:11434/api/generate';
const MODEL = 'qwen2.5-coder:3b'; 

// 1. Load Dataset
console.log('📦 Loading compiled_cases.json...');
let cases;
try {
  cases = JSON.parse(fs.readFileSync(COMPILED_CASES_PATH, 'utf8'));
} catch (e) {
  console.error('❌ Gagal membaca compiled cases', e.message);
  process.exit(1);
}

// 2. Scan & Detect "Duplicate Options"
console.log('🔍 Menyapu dataset untuk mendeteksi opsi yang terduplikasi (kembar sebagian)...');
let targetCases = [];

for (let i = 0; i < cases.length; i++) {
  const c = cases[i];
  if (c.q_type === 'sct' || !c.options || c.options.length < 2) continue;

  const seen = new Set();
  let hasDuplicate = false;
  
  for (const opt of c.options) {
    const textNormalized = opt.text.trim().toLowerCase();
    if (seen.has(textNormalized)) {
      hasDuplicate = true;
      break;
    }
    seen.add(textNormalized);
  }

  // Jika semua sama, itu T2 (sudah beres). Jika hanya sebagian yang kembar, itu T3.
  if (hasDuplicate && seen.size > 1) {
    targetCases.push(c);
  }
}

console.log(`🚨 Ditemukan ${targetCases.length} kasus kotor ("Duplicate Options").`);
if (targetCases.length === 0) {
  console.log('✅ Semua kasus aman. Process exited.');
  process.exit(0);
}

// 3. Panggil Ollama untuk menambal 1 opsi yang hilang
async function generateSingleDistractor(question, correctAnswer, existingDistractors) {
  const prompt = `You are a medical professor. 
Question snippet: "${question}"
Correct answer: "${correctAnswer}"
Existing incorrect options: ${JSON.stringify(existingDistractors)}

YOUR TASK:
Provide exactly 1 new, plausible, and incorrect alternative medical option that is completely different from the existing ones.
Return ONLY a strictly valid JSON array containing exactly 1 string. No markdown, no explanations, no text before or after.

Example output:
["New Distinct Option"]`;

  const response = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      prompt: prompt,
      stream: false,
      options: {
        temperature: 0.3
      }
    })
  });

  if (!response.ok) {
    throw new Error(`Ollama HTTP Error: ${response.status}`);
  }

  const result = await response.json();
  const rawText = result.response.trim();

  try {
    const cleanJson = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
    const arr = JSON.parse(cleanJson);
    if (!Array.isArray(arr) || arr.length < 1) throw new Error('Ollama tidak mengembalikan array.');
    return arr[0];
  } catch (e) {
    console.error('❌ JSON parse failed from Ollama output:', rawText);
    return null; 
  }
}

async function fixCases() {
  let fixedCount = 0;
  for (let c of targetCases) {
    console.log(`\n🏥 Menambal Kasus: ${c.case_code || c._id}`);
    
    // Identifikasi opsi yang ganda vs yang unik
    const uniqueOptions = [];
    const seenText = new Set();
    
    let correctAnswer = null;

    for (const opt of c.options) {
      const txt = opt.text.trim();
      const txtLower = txt.toLowerCase();
      if (!seenText.has(txtLower)) {
        seenText.add(txtLower);
        uniqueOptions.push(opt);
        if (opt.is_correct) correctAnswer = opt.text;
      }
    }

    // Kalau somehow kunci jawaban hilang atau aneh, skip
    if (!correctAnswer && uniqueOptions.length > 0) correctAnswer = uniqueOptions[0].text;
    
    const amountToGenerate = c.options.length - uniqueOptions.length;
    console.log(`   Opsi unik: ${uniqueOptions.length} (Butuh ${amountToGenerate} opsi baru)`);

    const existingDistractors = uniqueOptions.filter(o => !o.is_correct).map(o => o.text);

    let successfullyHealed = true;
    for(let i=0; i<amountToGenerate; i++) {
      console.log(`   🤖 Meminta Ollama meracik 1 distractor tambahan...`);
      const newDistractorText = await generateSingleDistractor(c.question, correctAnswer, existingDistractors);
      
      if (newDistractorText) {
        console.log(`   ✅ Distractor gen: "${newDistractorText}"`);
        existingDistractors.push(newDistractorText); // agar regenerasi berikutnya tahu
        
        // Buat ID generik
        uniqueOptions.push({
          id: `opt_healed_${i}_${Date.now()}`,
          text: newDistractorText,
          is_correct: false
        });
      } else {
        console.log(`   ⚠️ Gagal generate distractor.`);
        successfullyHealed = false;
        break;
      }
    }

    if (successfullyHealed) {
      c.options = uniqueOptions.sort(() => Math.random() - 0.5);
      fixedCount++;
    }
  }

  if (fixedCount > 0) {
    console.log(`\n💾 Menyimpan ${fixedCount} kasus yang telah pulih ke compiled_cases.json...`);
    fs.writeFileSync(COMPILED_CASES_PATH, JSON.stringify(cases, null, 2));
    console.log('✅ Selesai!');
  }
}

// Eksekusi
fixCases();
