/**
 * MedCase Pro — Geeky Medics MCQ Scraper
 * Scrapes medical MCQs from geekymedics.com quiz pages
 * Covers: anatomy, physiology, pathology, pharmacology, clinical
 *
 * Usage: node ingestion/download-geekymedics.js
 */
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import process from 'node:process';

const SOURCES_DIR = join(import.meta.dirname, 'sources', 'geekymedics');
const OUT_FILE = join(SOURCES_DIR, 'geekymedics_raw.json');
const BASE_URL = 'https://geekymedics.com';

// Category URLs covering broad specialty areas
const QUIZ_INDEX_URLS = [
  '/quiz/',
  '/category/quizzes/anatomy-quizzes/',
  '/category/quizzes/clinical-examination-quizzes/',
  '/category/quizzes/data-interpretation/',
  '/category/quizzes/history-taking-quizzes/',
  '/category/quizzes/osce-quizzes/',
];

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function stripHTML(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, '')
    .replace(/&[a-z]+;/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Discover all quiz page URLs from category index pages */
async function discoverQuizURLs() {
  console.log('📄 Discovering Geeky Medics quiz URLs...');
  const allUrls = new Set();

  for (const indexPath of QUIZ_INDEX_URLS) {
    try {
      const url = indexPath.startsWith('http') ? indexPath : BASE_URL + indexPath;
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MedCasePro/1.0 (Educational Research)' }
      });
      if (!resp.ok) { console.log(`  ⚠️ ${indexPath}: HTTP ${resp.status}`); continue; }
      const html = await resp.text();

      // Find quiz links
      const linkPattern = /href="(https?:\/\/geekymedics\.com\/[a-z0-9\-\/]*quiz[a-z0-9\-\/]*)"/gi;
      let match;
      while ((match = linkPattern.exec(html)) !== null) {
        const u = match[1].replace(/\/$/, '');
        if (!u.includes('/category/') && !u.includes('/tag/') && !u.includes('/page/')) {
          allUrls.add(u);
        }
      }

      // Also find links to individual question/quiz posts
      const postPattern = /href="(https?:\/\/geekymedics\.com\/[a-z0-9\-]+\/)"/gi;
      while ((match = postPattern.exec(html)) !== null) {
        const u = match[1].replace(/\/$/, '');
        if (u.includes('quiz') || u.includes('question') || u.includes('mcq')) {
          if (!u.includes('/category/') && !u.includes('/tag/') && !u.includes('/page/')) {
            allUrls.add(u);
          }
        }
      }

      await sleep(1500);
    } catch (err) {
      console.log(`  ⚠️ Error on ${indexPath}: ${err.message}`);
    }
  }

  // Also try paginating the main quiz page
  for (let page = 2; page <= 10; page++) {
    try {
      const url = `${BASE_URL}/quiz/page/${page}/`;
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MedCasePro/1.0' }
      });
      if (!resp.ok) break;
      const html = await resp.text();
      const linkPattern = /href="(https?:\/\/geekymedics\.com\/[a-z0-9\-]+\/)"/gi;
      let match;
      while ((match = linkPattern.exec(html)) !== null) {
        const u = match[1].replace(/\/$/, '');
        if (!u.includes('/category/') && !u.includes('/tag/') && !u.includes('/page/') && !u.includes('/quiz/')) {
          allUrls.add(u);
        }
      }
      await sleep(1500);
    } catch { break; }
  }

  console.log(`  Found ${allUrls.size} unique quiz/post URLs`);
  return [...allUrls];
}

/** Scrape a single quiz/post page for MCQs */
async function scrapePage(url) {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MedCasePro/1.0' }
    });
    if (!resp.ok) return [];
    const html = await resp.text();

    // Extract title
    const titleMatch = html.match(/<h1[^>]*>(.*?)<\/h1>/is);
    const pageTitle = titleMatch ? stripHTML(titleMatch[1]).trim() : '';

    // Infer category from title and content
    const category = inferCategory(url + ' ' + pageTitle + ' ' + html.substring(0, 3000));

    const questions = [];

    // Pattern 1: WordPress quiz plugin (wp-quiz, quiz-cat, etc.)
    const wpQuizBlocks = html.match(/<div[^>]*class="[^"]*quiz[^"]*"[^>]*>[\s\S]*?<\/div>\s*<\/div>/gi) || [];

    // Pattern 2: Structured list with Q&A
    // Many Geeky Medics pages have numbered questions with lettered options
    const contentMatch = html.match(/<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<div class="(?:post-tags|entry-footer|yarpp|addtoany|sharedaddy)|<\/article)/i);
    if (contentMatch) {
      const contentText = stripHTML(contentMatch[1]);

      // Split by numbered questions
      const qParts = contentText.split(/(?=\n\s*\d{1,3}\s*[.)]\s)/);

      for (const part of qParts) {
        if (part.trim().length < 30) continue;

        const numMatch = part.match(/^\s*(\d{1,3})\s*[.)]\s*/);
        if (!numMatch) continue;

        // Extract options (A-E)
        const optionMatches = [...part.matchAll(/\b([A-E])\s*[.)]\s*(.+?)(?=\n\s*[A-E]\s*[.)]|\nAnswer|\nExplanation|$)/gis)];
        if (optionMatches.length < 2) continue;

        // Get question text
        let questionText = part;
        if (optionMatches.length > 0) {
          const firstOptIdx = part.indexOf(optionMatches[0][0]);
          if (firstOptIdx > 0) questionText = part.substring(0, firstOptIdx);
        }
        questionText = questionText.replace(/^\s*\d{1,3}\s*[.)]\s*/, '').trim();
        questionText = questionText.replace(/\s*Answer\s*[:=][\s\S]*/i, '').replace(/\s*Explanation[\s\S]*/i, '').trim();

        if (questionText.length < 10) continue;

        // Extract answer
        const answerMatch = part.match(/Answer\s*[:=]\s*([A-E])/i)
          || part.match(/Correct\s*(?:answer)?\s*[:=]\s*([A-E])/i);
        const correctAnswer = answerMatch ? answerMatch[1].toUpperCase() : '';

        // Extract explanation
        const explMatch = part.match(/(?:Explanation|Rationale)\s*[:=]?\s*([\s\S]+?)(?=\n\s*\d{1,3}\s*[.)]|$)/i);

        const options = optionMatches.map(m => ({
          id: m[1].toUpperCase(),
          text: m[2].trim(),
          is_correct: m[1].toUpperCase() === correctAnswer,
        }));

        questions.push({
          source: 'geekymedics.com',
          url,
          pageTitle,
          category,
          question: questionText,
          options,
          correct_answer: correctAnswer,
          explanation: explMatch ? explMatch[1].trim() : '',
          format: 'MCQ',
          scraped: new Date().toISOString().split('T')[0],
        });
      }
    }

    return questions;
  } catch {
    return [];
  }
}

function inferCategory(text) {
  const t = text.toLowerCase();
  if (/anatomy|muscle|nerve|bone|joint|ligament/i.test(t)) return 'anatomy';
  if (/physiology|homeosta|electrolyte|acid.base/i.test(t)) return 'physiology';
  if (/pharmacol|drug|mechanism|receptor|agonist|antagonist/i.test(t)) return 'pharmacology';
  if (/pathology|histolog|microscop|biopsy/i.test(t)) return 'pathology';
  if (/cardiol|ecg|heart|murmur|chest.pain/i.test(t)) return 'cardiology';
  if (/respiratory|lung|pneumonia|asthma/i.test(t)) return 'respiratory';
  if (/gastro|abdom|liver|bowel/i.test(t)) return 'gastroenterology';
  if (/neuro|stroke|seizure|headache/i.test(t)) return 'neurology';
  if (/orthop|fracture|joint|msk/i.test(t)) return 'orthopedics';
  if (/dermat|skin|rash/i.test(t)) return 'dermatology';
  if (/ent|ear|nose|throat|sinus/i.test(t)) return 'ent';
  if (/ophthal|eye|vision/i.test(t)) return 'ophthalmology';
  if (/obstet|gynae|pregnan|antenatal/i.test(t)) return 'obgyn';
  if (/paediatr|child|neonat/i.test(t)) return 'pediatrics';
  if (/psych|depress|schizo|anxiety/i.test(t)) return 'psychiatry';
  if (/surge|operat|wound/i.test(t)) return 'surgery';
  if (/public.health|epidemiol|statist|screen|prevent/i.test(t)) return 'public-health';
  return 'clinical';
}

async function main() {
  if (!existsSync(SOURCES_DIR)) mkdirSync(SOURCES_DIR, { recursive: true });

  console.log('══════════════════════════════════════════════════');
  console.log(' MedCase Pro — Geeky Medics Scraper');
  console.log(' Target: Clinical MCQs across all specialties');
  console.log('══════════════════════════════════════════════════\n');

  const urls = await discoverQuizURLs();
  const allQuestions = [];
  let errors = 0;

  for (let i = 0; i < urls.length; i++) {
    if (i % 10 === 0) console.log(`  📊 Progress: ${i}/${urls.length} (${allQuestions.length} Qs scraped)`);
    const qs = await scrapePage(urls[i]);
    if (qs.length > 0) {
      allQuestions.push(...qs);
    } else {
      errors++;
    }
    await sleep(1500);
  }

  console.log(`\n💾 Saving ${allQuestions.length} questions to ${OUT_FILE}`);
  writeFileSync(OUT_FILE, JSON.stringify(allQuestions, null, 0), 'utf-8');

  // Stats by category
  const cats = {};
  allQuestions.forEach(q => { cats[q.category] = (cats[q.category] || 0) + 1; });
  const withAnswers = allQuestions.filter(q => q.correct_answer).length;

  console.log(`\n══════════════════════════════════════════════════`);
  console.log(` GEEKY MEDICS SCRAPE COMPLETE`);
  console.log(`  Total questions: ${allQuestions.length}`);
  console.log(`  With answers: ${withAnswers}`);
  console.log(`  Pages without Qs: ${errors}`);
  console.log(`\n  By Category:`);
  Object.entries(cats).sort((a, b) => b[1] - a[1]).forEach(([cat, count]) => {
    console.log(`    ${cat}: ${count}`);
  });
  console.log('══════════════════════════════════════════════════');
}

main().catch(err => { console.error('❌ Fatal:', err); process.exit(1); });
