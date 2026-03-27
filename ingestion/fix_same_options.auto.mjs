import fs from 'fs';
import path from 'path';

const COMPILED_CASES_PATH = path.join(process.cwd(), 'public/data/compiled_cases.json');
const OLLAMA_URL = 'http://localhost:11434/api/generate';
const MODEL = 'qwen2.5-coder:3b'; // Model super cepat milik kita

// 1. Load Dataset
console.log('📦 Loading compiled_cases.json...');
let cases;
try {
  cases = JSON.parse(fs.readFileSync(COMPILED_CASES_PATH, 'utf8'));
} catch (e) {
  console.error('❌ Gagal membaca compiled cases', e.message);
  process.exit(1);
}

// 2. Scan & Detect "All Options Same Text"
console.log('🔍 Menyapu dataset untuk mendeteksi distractor yang redundan (kembar massal)...');
let targetCases = [];

for (let i = 0; i < cases.length; i++) {
  const c = cases[i];
  // Pengecualian SCT karena SCT memang memakai Skala Likert (Sangat Tidak Setuju, dsb)
  if (c.q_type === 'sct' || !c.options || c.options.length < 2) continue;

  const firstOption = c.options[0].text.trim().toLowerCase();
  
  // Periksa apakah SEMUA opsi selain yang pertama sama teksnya dengan teks opsi pertama
  const isDuplicate = c.options.every(opt => opt.text.trim().toLowerCase() === firstOption);
  
  if (isDuplicate) {
    targetCases.push(c);
  }
}

console.log(`🚨 Ditemukan ${targetCases.length} kasus rusak ("All Same Options").`);
if (targetCases.length === 0) {
  console.log('✅ Semua kasus aman. Process exited.');
  process.exit(0);
}

// 3. Panggil Ollama untuk meregenerasi distractor (Heal/Cure Process)
async function generateDistractors(question, correctAnswer) {
  const prompt = `You are a medical professor writing multiple-choice questions. 
Question snippet: "${question}"
The correct answer is: "${correctAnswer}"

YOUR TASK:
Provide exactly 4 plausible, distinct, and incorrect alternative medical options (distractors). 
Return ONLY a strictly valid JSON array containing exactly 4 strings. No markdown formatting, no explanations, no other text.

Example output:
["Option 1", "Option 2", "Option 3", "Option 4"]`;

  const response = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      prompt: prompt,
      stream: false,
      options: {
        temperature: 0.3 // Jangan terlalu imajinatif
      }
    })
  });

  if (!response.ok) {
    throw new Error(`Ollama HTTP Error: ${response.status}`);
  }

  const result = await response.json();
  const rawText = result.response.trim();

  try {
    // Strip markdown JSON block if Ollama stubbornly writes it
    const cleanJson = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
    const arr = JSON.parse(cleanJson);
    if (!Array.isArray(arr) || arr.length !== 4) throw new Error('Ollama tidak mengembalikan array berisi 4 elemen.');
    return arr;
  } catch (e) {
    console.error('❌ JSON parse failed from Ollama output:', rawText);
    return null; // Fallback jika gagal generate
  }
}

async function fixCases() {
  let fixedCount = 0;
  for (let c of targetCases) {
    console.log(`\n🏥 Memulihkan Kasus: ${c.case_code || c._id}`);
    console.log(`   Q: ${c.question.substring(0, 100)}...`);
    
    // Temukan kunci aslinya
    const theRealAnswer = c.options.find(o => o.is_correct) || c.options[0];
    console.log(`   Kunci Asli: ${theRealAnswer.text}`);

    console.log(`   🤖 Memanggil Ollama (${MODEL}) untuk regenerasi 4 distractors...`);
    const newDistractors = await generateDistractors(c.question, theRealAnswer.text);

    if (newDistractors) {
      console.log('   ✅ Distractors berhasil digenerate:', newDistractors);
      // Construct fixed options
      const healedOptions = [
        { id: 'opt_A', text: theRealAnswer.text, is_correct: true },
        { id: 'opt_B', text: JSON.stringify(newDistractors[0]).replace(/"/g, ''), is_correct: false },
        { id: 'opt_C', text: JSON.stringify(newDistractors[1]).replace(/"/g, ''), is_correct: false },
        { id: 'opt_D', text: JSON.stringify(newDistractors[2]).replace(/"/g, ''), is_correct: false },
        { id: 'opt_E', text: JSON.stringify(newDistractors[3]).replace(/"/g, ''), is_correct: false },
      ];
      // Acak urutan
      c.options = healedOptions.sort(() => Math.random() - 0.5);
      fixedCount++;
    } else {
      console.log('   ⚠️ Gagal memulihkan distractors dari AI.');
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
