/**
 * MedCase Pro — LITFL Clinical Case Scraper
 * Scrapes 250+ clinical cases from Life in the Fast Lane
 * License: CC-BY-NC-SA 4.0 (attribution required)
 * 
 * Usage: node ingestion/download-litfl.js
 */
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import process from 'node:process';

const SOURCES_DIR = join(import.meta.dirname, 'sources', 'litfl');
const OUT_FILE = join(SOURCES_DIR, 'litfl_raw.json');
const INDEX_URL = 'https://litfl.com/clinical-cases/';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Extract all case URLs from index page
async function getCaseURLs() {
  console.log('📄 Fetching LITFL case index...');
  const resp = await fetch(INDEX_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MedCasePro/1.0 (Educational Research)' }
  });
  const html = await resp.text();
  
  // Extract all litfl.com case URLs (excluding index, compendium, top-100, author)
  const urlPattern = /href="(https:\/\/litfl\.com\/[a-z0-9-]+\/)"/gi;
  const allUrls = new Set();
  let match;
  while ((match = urlPattern.exec(html)) !== null) {
    const url = match[1];
    // Skip non-case pages
    if (url.includes('/clinical-cases/') || url.includes('/author/') || 
        url.includes('/top-100/') || url.includes('/on-call') ||
        url === INDEX_URL) continue;
    allUrls.add(url);
  }
  
  console.log(`  Found ${allUrls.size} unique case URLs`);
  return [...allUrls];
}

// Strip HTML tags, keep text
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
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&rdquo;/g, '"')
    .replace(/&ldquo;/g, '"')
    .replace(/&hellip;/g, '...')
    .replace(/&#\d+;/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Scrape individual case page
async function scrapeCase(url) {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MedCasePro/1.0' }
    });
    if (!resp.ok) return null;
    
    const html = await resp.text();
    
    // Extract title
    const titleMatch = html.match(/<h1[^>]*class="[^"]*entry-title[^"]*"[^>]*>(.*?)<\/h1>/is)
      || html.match(/<title>(.*?)\s*[•–|]/i);
    const title = titleMatch ? stripHTML(titleMatch[1]).trim() : '';
    
    // Extract entry content
    const contentMatch = html.match(/<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<div class="(?:post-tags|entry-footer|yarpp|addtoany)|<\/article)/i);
    if (!contentMatch) return null;
    
    const contentHTML = contentMatch[1];
    const contentText = stripHTML(contentHTML);
    
    if (contentText.length < 100) return null;
    
    // Try to extract Q&A structure
    // LITFL cases typically have "Q1", "Answer", "Reveal" patterns
    const sections = contentText.split(/\n{2,}/);
    
    // Extract questions and answers
    let vignette = '';
    let questions = [];
    let currentQ = '';
    let inQuestion = false;
    let answerText = '';
    
    for (const section of sections) {
      const trimmed = section.trim();
      if (!trimmed) continue;
      
      // Detect question markers
      if (/^(Q\d|Question|Clinical[\s]*Question|What|Which|How|Why|Describe|Name|List|Identify)/i.test(trimmed)) {
        if (currentQ) questions.push({ q: currentQ, a: answerText.trim() });
        currentQ = trimmed;
        answerText = '';
        inQuestion = true;
      } else if (/^(A\d|Answer|Reveal|Key[\s]*points?|Discussion|Explanation)/i.test(trimmed)) {
        answerText += trimmed + '\n';
        inQuestion = false;
      } else if (inQuestion) {
        currentQ += '\n' + trimmed;
      } else if (answerText || questions.length > 0) {
        answerText += trimmed + '\n';
      } else {
        vignette += trimmed + '\n';
      }
    }
    if (currentQ) questions.push({ q: currentQ, a: answerText.trim() });
    
    // If no Q&A structure found, use the whole content as a case
    if (questions.length === 0) {
      vignette = contentText;
    }
    
    // Detect specialty from URL and content
    const specialty = inferLITFLSpecialty(url, contentText);
    
    return {
      url,
      title,
      vignette: vignette.trim().substring(0, 3000),
      questions,
      fullText: contentText.substring(0, 5000),
      specialty,
      source: 'LITFL (Life in the Fast Lane)',
      license: 'CC-BY-NC-SA 4.0',
      scraped: new Date().toISOString().split('T')[0],
    };
  } catch {
    return null;
  }
}

function inferLITFLSpecialty(url, text) {
  const u = url.toLowerCase();
  const t = text.toLowerCase();
  
  if (/overdose|poison|toxic|envenoming|antidote/i.test(u + ' ' + t)) return 'toxicology';
  if (/eye|optic|retina|pupil|vision|blind|glaucoma|cornea/i.test(u + ' ' + t)) return 'ophthalmology';
  if (/trauma|fracture|injury|pelvic|spinal/i.test(u + ' ' + t)) return 'trauma';
  if (/ecg|cardiac|heart|arrhyth|vt|af|stemi|pacemaker/i.test(u + ' ' + t)) return 'cardiology';
  if (/pneumonia|pulmonary|lung|bronch|asthma|ventilat/i.test(u + ' ' + t)) return 'pulmonary';
  if (/infant|child|neonate|pediatr|baby/i.test(u + ' ' + t)) return 'pediatrics';
  if (/hiv|tb|malaria|sepsis|pneumococcal|infection/i.test(u + ' ' + t)) return 'infectious';
  if (/brain|neuro|seizure|coma|stroke/i.test(u + ' ' + t)) return 'neurology';
  if (/resus|airway|intubat|arrest/i.test(u + ' ' + t)) return 'emergency';
  if (/pregnan|obstetric/i.test(u + ' ' + t)) return 'obstetrics';
  return 'emergency'; // LITFL default
}

async function main() {
  if (!existsSync(SOURCES_DIR)) mkdirSync(SOURCES_DIR, { recursive: true });

  console.log('═══════════════════════════════════════════');
  console.log(' MedCase Pro — LITFL Scraper');
  console.log(' 250+ Emergency/Tox/Ophth/Trauma cases');
  console.log(' License: CC-BY-NC-SA 4.0');
  console.log('═══════════════════════════════════════════\n');

  const urls = await getCaseURLs();
  const allCases = [];
  let errors = 0;

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    if (i % 20 === 0) console.log(`  📊 Progress: ${i}/${urls.length} (${allCases.length} cases scraped)`);
    
    const caseData = await scrapeCase(url);
    if (caseData) {
      allCases.push(caseData);
    } else {
      errors++;
    }
    
    // Ethical delay: 1.5s between requests
    await sleep(1500);
  }

  console.log(`\n💾 Saving ${allCases.length} LITFL cases to ${OUT_FILE}`);
  writeFileSync(OUT_FILE, JSON.stringify(allCases, null, 0), 'utf-8');
  
  // Stats by specialty
  const specialties = {};
  allCases.forEach(c => { specialties[c.specialty] = (specialties[c.specialty] || 0) + 1; });
  
  const withQuestions = allCases.filter(c => c.questions.length > 0).length;
  
  console.log(`\n═══════════════════════════════════════════`);
  console.log(` LITFL SCRAPE COMPLETE`);
  console.log(`  Total cases: ${allCases.length}`);
  console.log(`  With Q&A structure: ${withQuestions}`);
  console.log(`  Errors/skipped: ${errors}`);
  console.log(`\n  By Specialty:`);
  Object.entries(specialties).sort((a,b) => b[1]-a[1]).forEach(([spec, count]) => {
    console.log(`    ${spec}: ${count}`);
  });
  console.log(`═══════════════════════════════════════════`);
}

main().catch(err => { console.error('❌ Fatal:', err); process.exit(1); });
