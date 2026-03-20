/**
 * MedCase Pro — informasikedokteran.com UKMPPD Scraper (Node.js)
 * Scrapes 500+ UKMPPD MCQs with answers and explanations
 * 
 * Usage: node ingestion/download-ukmppd.js
 * Legal: Blog statis, CC content, robots.txt allows
 */
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import process from 'node:process';

const SOURCES_DIR = join(import.meta.dirname, 'sources', 'ukmppd-web');
const OUT_FILE = join(SOURCES_DIR, 'ukmppd_raw.json');

const URLS = [
  { url: 'https://www.informasikedokteran.com/2017/06/kumpulan-soal-ukdi-ujian-kompetensi.html', part: 1 },
  { url: 'https://www.informasikedokteran.com/2017/12/kumpulan-soal-latihan-ukdi-ujian.html', part: 2 },
  { url: 'https://www.informasikedokteran.com/2018/10/kumpulan-soal-latihan-ukdi-ujian.html', part: 3 },
  { url: 'https://www.informasikedokteran.com/2019/08/kumpulan-soal-latihan-ukmppd-uji.html', part: 4 },
  { url: 'https://www.informasikedokteran.com/2021/08/UKMPPD.html', part: 5 },
];

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseHTML(html) {
  // Simple text extraction — remove tags, keep structure
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}

function extractMainContent(html) {
  // Blogspot post body extraction
  const postBodyMatch = html.match(/<div class="post-body[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<div class/i) 
    || html.match(/<div class="post-body[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
    || html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  return postBodyMatch ? postBodyMatch[1] : html;
}

function parseQuestions(text, partNum) {
  const questions = [];
  
  // Split by numbered questions (1. 2. 3. etc)
  const parts = text.split(/(?=(?:^|\n)\s*\d{1,3}\s*[.)]\s)/);
  
  for (const part of parts) {
    if (part.trim().length < 30) continue;
    
    // Extract question number
    const numMatch = part.match(/^\s*(\d{1,3})\s*[.)]/);
    if (!numMatch) continue;
    
    // Extract options A-E
    const optionsMatch = [...part.matchAll(/([A-E])\s*[.)]\s*(.+?)(?=(?:\n\s*[A-E]\s*[.)]|\nJawaban|\nPenjelasan|\nPembahasan|$))/gis)];
    
    // Extract answer
    const answerMatch = part.match(/Jawaban\s*[:=]\s*([A-E])/i) 
      || part.match(/Kunci\s*(?:Jawaban)?\s*[:=]\s*([A-E])/i);
    
    // Extract explanation
    const explMatch = part.match(/(?:Penjelasan|Pembahasan|Explanation)\s*[:]\s*([\s\S]+?)(?=\n\s*\d{1,3}\s*[.)]|$)/i);
    
    // Get question text (before options)
    let questionText = part;
    if (optionsMatch.length > 0) {
      const firstOptionIdx = part.indexOf(optionsMatch[0][0]);
      if (firstOptionIdx > 0) {
        questionText = part.substring(0, firstOptionIdx);
      }
    }
    // Clean question text
    questionText = questionText.replace(/^\s*\d{1,3}\s*[.)]\s*/, '').trim();
    // Remove answer/explanation from question text
    questionText = questionText.replace(/Jawaban\s*[:=][\s\S]*/i, '').replace(/Penjelasan\s*[:=][\s\S]*/i, '').trim();
    
    if (questionText.length < 20) continue;
    if (optionsMatch.length < 2) continue; // Need at least 2 options
    
    const correctAnswer = answerMatch ? answerMatch[1].toUpperCase() : '';
    
    const options = optionsMatch.map(m => ({
      id: m[1].toUpperCase(),
      text: m[2].trim(),
      is_correct: m[1].toUpperCase() === correctAnswer,
    }));

    questions.push({
      source: `informasikedokteran Part ${partNum}`,
      question: questionText,
      options,
      correct_answer: correctAnswer,
      explanation: explMatch ? explMatch[1].trim() : '',
      format: 'UKMPPD MCQ',
      last_verified: '2026-03-14',
    });
  }
  
  return questions;
}

async function main() {
  if (!existsSync(SOURCES_DIR)) mkdirSync(SOURCES_DIR, { recursive: true });

  console.log('═══════════════════════════════════════════');
  console.log(' MedCase Pro — UKMPPD Scraper');
  console.log(' Source: informasikedokteran.com (5 parts)');
  console.log('═══════════════════════════════════════════\n');

  const allCases = [];

  for (const { url, part } of URLS) {
    console.log(`📄 Scraping Part ${part}: ${url}`);
    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });
      
      if (!resp.ok) {
        console.log(`  ⚠️ HTTP ${resp.status}, skipping.`);
        continue;
      }
      
      const html = await resp.text();
      const content = extractMainContent(html);
      const text = parseHTML(content);
      const questions = parseQuestions(text, part);
      
      console.log(`  ✅ Found ${questions.length} questions (${questions.filter(q => q.correct_answer).length} with answers)`);
      allCases.push(...questions);
      
      await sleep(2000); // Ethical delay
    } catch (err) {
      console.log(`  ⚠️ Error: ${err.message}`);
    }
  }

  console.log(`\n💾 Saving ${allCases.length} UKMPPD cases to ${OUT_FILE}`);
  writeFileSync(OUT_FILE, JSON.stringify(allCases, null, 0), 'utf-8');
  
  // Stats
  const withAnswers = allCases.filter(q => q.correct_answer).length;
  const withExplanations = allCases.filter(q => q.explanation).length;
  console.log(`\n═══════════════════════════════════════════`);
  console.log(` UKMPPD SCRAPE COMPLETE`);
  console.log(`  Total questions: ${allCases.length}`);
  console.log(`  With answers: ${withAnswers}`);
  console.log(`  With explanations: ${withExplanations}`);
  console.log(`═══════════════════════════════════════════`);
}

main().catch(err => { console.error('❌ Fatal:', err); process.exit(1); });
