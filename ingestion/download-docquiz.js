/**
 * MedCase Pro — DocQuiz Scraper  
 * Scrapes medical MCQs from various online medical quiz platforms
 * Targets free, publicly accessible quiz databases
 * 
 * Usage: node ingestion/download-docquiz.js
 */
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import process from 'node:process';

const SOURCES_DIR = join(import.meta.dirname, 'sources', 'docquiz');
const OUT_FILE = join(SOURCES_DIR, 'docquiz_raw.json');

// Alternative free medical quiz sources since docquiz.com may require auth
const QUIZ_SOURCES = [
  {
    name: 'OpenMedEd',
    baseUrl: 'https://www.openmed.com',
    indexPaths: ['/quiz/', '/quizzes/'],
  },
  {
    name: 'MedScape Quiz',
    baseUrl: 'https://reference.medscape.com',
    indexPaths: ['/quiz'],
  },
];

// Alternatively: use the free MedMCQA validation/test splits as "quiz" content
// These are distinct from the train split we already downloaded

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function stripHTML(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#\d+;/g, '')
    .replace(/&[a-z]+;/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Strategy: Instead of relying on a single docquiz source that may not be 
 * scrapeable, we download additional HuggingFace medical QA datasets
 * that provide broad topic coverage:
 * 
 * 1. MedMCQA test split (separate from train we already have)
 * 2. USMLE Self-Assessment datasets
 * 3. AnatQuiz / PhysioQuiz style datasets if available
 */
async function downloadHFDataset(dataset, config, split, maxRows = 5000) {
  const allRows = [];
  const BATCH = 100;
  const DELAY = 2000;

  for (let offset = 0; offset < maxRows; offset += BATCH) {
    try {
      const url = `https://datasets-server.huggingface.co/rows?dataset=${dataset}&config=${config}&split=${split}&offset=${offset}&length=${BATCH}`;
      const res = await fetch(url);
      if (res.status === 429) {
        console.log(`  ⏳ Rate limited. Waiting...`);
        await sleep(DELAY * 4);
        offset -= BATCH; // retry
        continue;
      }
      if (!res.ok) {
        console.log(`  ⚠️ HTTP ${res.status} at offset ${offset}`);
        break;
      }
      const data = await res.json();
      const rows = data.rows?.map(r => r.row) || [];
      if (rows.length === 0) break;
      allRows.push(...rows);
      if ((offset / BATCH) % 10 === 0) console.log(`    ✅ ${allRows.length} rows...`);
      await sleep(DELAY);
    } catch (err) {
      console.log(`  ⚠️ Error: ${err.message}`);
      break;
    }
  }
  return allRows;
}

/**
 * Attempt to scrape a generic quiz website
 */
async function scrapeQuizSite(baseUrl, indexPath) {
  const questions = [];
  try {
    const url = baseUrl + indexPath;
    console.log(`  🔍 Probing ${url}...`);
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MedCasePro/1.0' },
      redirect: 'follow',
    });
    if (!resp.ok) {
      console.log(`    ⚠️ HTTP ${resp.status}`);
      return questions;
    }
    const html = await resp.text();

    // Try to find quiz links
    const quizPattern = /href="([^"]*(?:quiz|question|mcq)[^"]*)"/gi;
    const urls = new Set();
    let match;
    while ((match = quizPattern.exec(html)) !== null) {
      let u = match[1];
      if (!u.startsWith('http')) u = baseUrl + (u.startsWith('/') ? '' : '/') + u;
      urls.add(u);
    }
    console.log(`    Found ${urls.size} quiz URLs`);

    // Scrape each quiz page (limit to 50 to be respectful)
    let count = 0;
    for (const quizUrl of urls) {
      if (count >= 50) break;
      try {
        const r = await fetch(quizUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MedCasePro/1.0' }
        });
        if (!r.ok) continue;
        const qhtml = await r.text();
        const text = stripHTML(qhtml);

        // Try to extract MCQ patterns
        const parts = text.split(/(?=\n\s*\d{1,3}\s*[.)]\s)/);
        for (const part of parts) {
          const numMatch = part.match(/^\s*(\d{1,3})\s*[.)]\s*/);
          if (!numMatch) continue;

          const optMatches = [...part.matchAll(/\b([A-E])\s*[.)]\s*(.+?)(?=\n\s*[A-E]\s*[.)]|\nAnswer|\n\d{1,3}\s*[.)]|$)/gis)];
          if (optMatches.length < 2) continue;

          let qText = part;
          if (optMatches.length > 0) {
            const idx = part.indexOf(optMatches[0][0]);
            if (idx > 0) qText = part.substring(0, idx);
          }
          qText = qText.replace(/^\s*\d{1,3}\s*[.)]\s*/, '').replace(/Answer[\s\S]*/i, '').trim();
          if (qText.length < 15) continue;

          const ansMatch = part.match(/Answer\s*[:=]\s*([A-E])/i);
          const explMatch = part.match(/(?:Explanation|Rationale)\s*[:=]?\s*([\s\S]+?)(?=\n\d|$)/i);

          questions.push({
            source: baseUrl,
            url: quizUrl,
            question: qText,
            options: optMatches.map(m => ({
              id: m[1].toUpperCase(),
              text: m[2].trim(),
              is_correct: ansMatch ? m[1].toUpperCase() === ansMatch[1].toUpperCase() : false,
            })),
            correct_answer: ansMatch ? ansMatch[1].toUpperCase() : '',
            explanation: explMatch ? explMatch[1].trim() : '',
            format: 'MCQ',
            scraped: new Date().toISOString().split('T')[0],
          });
        }

        count++;
        await sleep(1500);
      } catch { continue; }
    }
  } catch (err) {
    console.log(`    ⚠️ ${err.message}`);
  }
  return questions;
}

async function main() {
  if (!existsSync(SOURCES_DIR)) mkdirSync(SOURCES_DIR, { recursive: true });

  console.log('══════════════════════════════════════════════════');
  console.log(' MedCase Pro — DocQuiz / Multi-Source Scraper');
  console.log(' Strategy: Web scraping + HuggingFace fallback');
  console.log('══════════════════════════════════════════════════\n');

  const allQuestions = [];

  // Strategy 1: Try web scraping known quiz sites
  for (const source of QUIZ_SOURCES) {
    console.log(`\n📂 Trying ${source.name}...`);
    for (const path of source.indexPaths) {
      const qs = await scrapeQuizSite(source.baseUrl, path);
      if (qs.length > 0) {
        console.log(`  ✅ Got ${qs.length} questions from ${source.name}`);
        allQuestions.push(...qs);
      }
    }
  }

  // Strategy 2: Download MedMCQA test split (distinct Q&As from training split)
  console.log('\n📂 Downloading MedMCQA test split (separate from train)...');
  const testRows = await downloadHFDataset('openlifescienceai/medmcqa', 'default', 'test', 5000);
  if (testRows.length > 0) {
    const copMap = { 1: 'A', 2: 'B', 3: 'C', 4: 'D' };
    for (const row of testRows) {
      if (!row.question || !row.opa) continue;
      const correctId = copMap[row.cop] || '';
      allQuestions.push({
        source: 'medmcqa-test',
        question: row.question,
        options: [
          { id: 'A', text: row.opa, is_correct: correctId === 'A' },
          { id: 'B', text: row.opb || '', is_correct: correctId === 'B' },
          { id: 'C', text: row.opc || '', is_correct: correctId === 'C' },
          { id: 'D', text: row.opd || '', is_correct: correctId === 'D' },
        ].filter(o => o.text.length > 0),
        correct_answer: correctId,
        explanation: row.exp || '',
        subject: row.subject_name || '',
        topic: row.topic_name || '',
        format: 'MCQ',
        scraped: new Date().toISOString().split('T')[0],
      });
    }
    console.log(`  ✅ Got ${testRows.length} MedMCQA test questions`);
  }

  // Strategy 3: Try MedQA test split
  console.log('\n📂 Downloading MedQA test split...');
  const medqaTest = await downloadHFDataset('GBaker/MedQA-USMLE-4-options', 'default', 'test', 2000);
  if (medqaTest.length > 0) {
    for (const row of medqaTest) {
      if (!row.question || !row.options) continue;
      const optKeys = ['A', 'B', 'C', 'D', 'E'];
      allQuestions.push({
        source: 'medqa-test',
        question: row.question,
        options: optKeys.filter(k => row.options[k]).map(k => ({
          id: k, text: row.options[k],
          is_correct: k === row.answer_idx || row.options[k] === row.answer,
        })),
        correct_answer: row.answer_idx || '',
        explanation: row.explanation || '',
        format: 'MCQ',
        scraped: new Date().toISOString().split('T')[0],
      });
    }
    console.log(`  ✅ Got ${medqaTest.length} MedQA test questions`);
  }

  console.log(`\n💾 Saving ${allQuestions.length} total questions → ${OUT_FILE}`);
  writeFileSync(OUT_FILE, JSON.stringify(allQuestions, null, 0), 'utf-8');

  // Stats
  const bySrc = {};
  allQuestions.forEach(q => { bySrc[q.source] = (bySrc[q.source] || 0) + 1; });
  const withAnswers = allQuestions.filter(q => q.correct_answer).length;

  console.log(`\n══════════════════════════════════════════════════`);
  console.log(` DOCQUIZ SCRAPE COMPLETE`);
  console.log(`  Total questions: ${allQuestions.length}`);
  console.log(`  With answers: ${withAnswers}`);
  console.log(`  By source:`);
  Object.entries(bySrc).sort((a, b) => b[1] - a[1]).forEach(([src, n]) => {
    console.log(`    ${src}: ${n}`);
  });
  console.log('══════════════════════════════════════════════════');
}

main().catch(err => { console.error('❌ Fatal:', err); process.exit(1); });
