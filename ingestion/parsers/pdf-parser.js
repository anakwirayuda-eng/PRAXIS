/**
 * MedCase Pro — PDF/DOCX MCQ Extractor v2
 * Extracts structured MCQ questions from Indonesian medical exam documents
 * 
 * Handles TWO distinct formats:
 *  Format A: Numbered + lettered (1. Question... A. Option B. Option... Jawaban: A)
 *  Format B: Vignette paragraphs followed by plain-text option lines (no A/B/C/D)
 * 
 * Usage:
 *   node ingestion/parsers/pdf-parser.js                  # batch all from PDF referensi
 *   node ingestion/parsers/pdf-parser.js <file> [output]  # single file
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
import { join, basename, extname } from 'path';
import process from 'node:process';

const PDF_DIR = join(import.meta.dirname, '..', '..', 'PDF referensi');
const OUTPUT_DIR = join(import.meta.dirname, '..', 'sources', 'ukmppd-pdf');
const DEBUG_DIR = join(import.meta.dirname, '..', 'output', 'pdf-debug');

// ═══════════════════════════════════════
// FORMAT A: Numbered+lettered Indonesian MCQ
// ═══════════════════════════════════════
const ANSWER_PATTERNS = [
  /Jawaban\s*[:=]\s*([A-E])/i,
  /Kunci\s*(?:Jawaban)?\s*[:=]\s*([A-E])/i,
  /Jawaban\s*(?:yang\s+)?(?:benar|tepat)\s*[:=]?\s*([A-E])/i,
  /(?:ANSWER|Correct)\s*[:=]\s*([A-E])/i,
  /(?:^|\n)\s*Jawaban\s*:\s*([A-E])\b/im,
];

const EXPLANATION_PATTERNS = [
  /(?:Pembahasan|Penjelasan|Explanation|Rationale)\s*[:=]?\s*([\s\S]+?)(?=\n\s*\d{1,4}\s*[.)]\s|\n\s*(?:Soal|Pertanyaan)\s+\d|$)/i,
];

function extractFormatA(text, sourceName) {
  const questions = [];
  const parts = text.split(/(?=(?:^|\n)\s*(?:Soal\s+)?\d{1,4}\s*[.)]\s)/m);
  
  for (const part of parts) {
    if (part.trim().length < 40) continue;
    
    const numMatch = part.match(/^\s*(?:Soal\s+)?(\d{1,4})\s*[.)]\s*/);
    if (!numMatch) continue;
    const qNum = parseInt(numMatch[1]);
    
    // Try lettered options first
    const optRegex = /(?:^|\n)\s*([A-E])\s*[.)]\s*(.+?)(?=\n\s*[A-E]\s*[.)]\s|\n\s*(?:Jawaban|Kunci|Pembahasan|Penjelasan|Referensi|Sumber)\b|\n\s*(?:Soal\s+)?\d{1,4}\s*[.)]\s|$)/gis;
    const optionMatches = [...part.matchAll(optRegex)];
    if (optionMatches.length < 2) continue;
    
    let questionText = part;
    const firstOptIdx = part.indexOf(optionMatches[0][0]);
    if (firstOptIdx > 0) questionText = part.substring(0, firstOptIdx);
    questionText = questionText
      .replace(/^\s*(?:Soal\s+)?\d{1,4}\s*[.)]\s*/, '')
      .replace(/Jawaban[\s\S]*/i, '')
      .replace(/Pembahasan[\s\S]*/i, '')
      .trim();
    if (questionText.length < 15) continue;
    
    let correctAnswer = '';
    for (const pattern of ANSWER_PATTERNS) {
      const m = part.match(pattern);
      if (m) { correctAnswer = m[1].toUpperCase(); break; }
    }
    
    let explanation = '';
    for (const pattern of EXPLANATION_PATTERNS) {
      const m = part.match(pattern);
      if (m) { explanation = m[1].trim().replace(/\n\s*\d{1,4}\s*[.)]\s[\s\S]*$/, '').trim(); break; }
    }
    
    const seen = new Set();
    const options = optionMatches
      .map(m => ({ id: m[1].toUpperCase(), text: m[2].trim().replace(/\n/g, ' ').replace(/\s+/g, ' '), is_correct: m[1].toUpperCase() === correctAnswer }))
      .filter(o => { if (seen.has(o.id)) return false; seen.add(o.id); return true; });
    
    questions.push({
      source: sourceName, questionNumber: qNum,
      question: questionText.replace(/\n/g, ' ').replace(/\s+/g, ' '),
      options, correct_answer: correctAnswer,
      explanation: explanation.replace(/\n/g, ' ').replace(/\s+/g, ' '),
      format: 'UKMPPD MCQ', extracted: new Date().toISOString().split('T')[0],
    });
  }
  return questions;
}

// ═══════════════════════════════════════
// FORMAT B: Vignette + unlabeled short-line options (common in UKMPPD PDFs/DOCX)
// Pattern: Long paragraph (vignette) → question ending in "?" → 5 short lines (options)
// ═══════════════════════════════════════
function extractFormatB(text, sourceName) {
  const questions = [];
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  
  let i = 0;
  let qNum = 0;
  
  while (i < lines.length - 4) {
    // Look for a question line ending with "?"
    const questionEndIdx = findQuestionEnd(lines, i);
    if (questionEndIdx < 0) { i++; continue; }
    
    // Collect the vignette (lines before the "?" line that form the clinical scenario)
    let vignetteStart = questionEndIdx;
    // Walk backwards to find the start of this vignette block
    for (let j = questionEndIdx - 1; j >= Math.max(0, questionEndIdx - 15); j--) {
      if (lines[j].length > 30) {
        vignetteStart = j;
      } else {
        break; // Short line = end of previous question's options
      }
    }
    
    const vignette = lines.slice(vignetteStart, questionEndIdx + 1).join(' ').replace(/\s+/g, ' ');
    if (vignette.length < 30) { i = questionEndIdx + 1; continue; }
    
    // Expect 3-5 short option lines immediately after the "?" line
    const optionLines = [];
    let j = questionEndIdx + 1;
    while (j < lines.length && optionLines.length < 5) {
      const line = lines[j];
      // Option lines: typically short (< 80 chars), not a question, not a long paragraph
      if (line.length < 80 && line.length > 2 && !line.endsWith('?') && !isVignetteLine(line)) {
        // Strip leading A. B. etc if present
        const stripped = line.replace(/^\s*[A-E]\s*[.)]\s*/, '').trim();
        if (stripped.length > 1) optionLines.push(stripped);
        j++;
      } else {
        break;
      }
    }
    
    if (optionLines.length < 3) { i = questionEndIdx + 1; continue; }
    
    qNum++;
    const letters = ['A', 'B', 'C', 'D', 'E'];
    const options = optionLines.map((text, idx) => ({
      id: letters[idx] || `${idx + 1}`,
      text,
      is_correct: false, // No answer key in this format
    }));
    
    questions.push({
      source: sourceName, questionNumber: qNum,
      question: vignette,
      options, correct_answer: '',
      explanation: '',
      format: 'UKMPPD MCQ (unlabeled)',
      extracted: new Date().toISOString().split('T')[0],
    });
    
    i = j; // Skip past the options
  }
  
  return questions;
}

function findQuestionEnd(lines, startIdx) {
  for (let i = startIdx; i < lines.length; i++) {
    if (lines[i].endsWith('?') && lines[i].length > 15) return i;
  }
  return -1;
}

function isVignetteLine(line) {
  return line.length > 80 || /^Seorang|^Pasien|^Laki-laki|^Perempuan|^Anak|^Wanita|^Pria/i.test(line);
}

/**
 * Process text: try Format A first, fall back to Format B
 */
function extractQuestionsFromText(text, sourceName) {
  // Normalize
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  
  // Try Format A (numbered + lettered)
  const formatA = extractFormatA(text, sourceName);
  if (formatA.length > 5) return formatA; // Format A worked well
  
  // Try Format B (unlabeled vignette + options)
  const formatB = extractFormatB(text, sourceName);
  
  // Return whichever found more
  return formatA.length >= formatB.length ? formatA : formatB;
}

// ═══════════════════════════════════════
// PDF PROCESSING
// ═══════════════════════════════════════
async function processPDF(inputPath, sourceName) {
  console.log(`\n📄 Processing: ${basename(inputPath)}`);
  
  const { PDFParse } = await import('pdf-parse');
  const buffer = readFileSync(inputPath);
  const uint8 = new Uint8Array(buffer);
  const parser = new PDFParse(uint8, {});
  await parser.load();
  const result = await parser.getText();
  
  // getText() returns { pages: [{ text: "..." }, ...] }
  const text = result.pages.map(p => p.text).join('\n');
  const numpages = result.pages.length;
  
  console.log(`   Pages: ${numpages}, Text: ${(text.length / 1024).toFixed(0)}KB`);
  
  // Save debug text
  if (!existsSync(DEBUG_DIR)) mkdirSync(DEBUG_DIR, { recursive: true });
  writeFileSync(join(DEBUG_DIR, basename(inputPath, '.pdf') + '_text.txt'), text.substring(0, 5000), 'utf-8');
  
  const questions = extractQuestionsFromText(text, sourceName);
  
  // Add image flags (PDFs don't have extractable images via this API)
  for (const q of questions) {
    q.images = [];
    q.needs_image = IMAGE_REF_REGEX.test(q.question);
  }
  
  const withAnswers = questions.filter(q => q.correct_answer).length;
  const withExplanations = questions.filter(q => q.explanation.length > 10).length;
  const needsImage = questions.filter(q => q.needs_image).length;
  
  console.log(`   ✅ ${questions.length} questions (${withAnswers} answers, ${withExplanations} explanations, ${needsImage} need images)`);
  return questions;
}

// ═══════════════════════════════════════
// DOCX PROCESSING (with image extraction)
// ═══════════════════════════════════════
const IMAGES_DIR = join(import.meta.dirname, '..', '..', 'public', 'images', 'cases');

async function processDOCX(inputPath, sourceName) {
  console.log(`\n📄 Processing DOCX: ${basename(inputPath)}`);
  
  const AdmZip = (await import('adm-zip')).default;
  let text = '';
  let imageMap = new Map(); // questionIndex → [imageFilenames]
  const fileSlug = basename(inputPath, '.docx').replace(/[^a-z0-9]/gi, '_').substring(0, 30);
  
  try {
    const zip = new AdmZip(inputPath);
    
    // Step 1: Build rId → media filename mapping from relationships
    const rIdToFile = new Map();
    const relsEntry = zip.getEntry('word/_rels/document.xml.rels');
    if (relsEntry) {
      const relsXml = relsEntry.getData().toString('utf8');
      const rels = [...relsXml.matchAll(/Id="(rId\d+)"[^>]*Target="(media\/[^"]+)"/g)];
      for (const m of rels) rIdToFile.set(m[1], m[2]);
    }
    
    // Step 2: Parse document.xml — track paragraphs and image references
    const docEntry = zip.getEntry('word/document.xml');
    if (docEntry) {
      const xml = docEntry.getData().toString('utf8');
      
      // Split into paragraphs (<w:p>...</w:p>)
      const paragraphs = xml.split(/<w:p[\s>]/);
      let currentQIdx = -1;
      const textParts = [];
      const qImageRefs = []; // array of { qIdx, rId }
      
      for (const para of paragraphs) {
        // Extract text from this paragraph
        const paraText = para
          .replace(/<w:br[^>]*>/g, '\n')
          .replace(/<w:tab[^>]*>/g, '\t')
          .replace(/<[^>]+>/g, '')
          .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/&apos;/g, "'").replace(/&quot;/g, '"')
          .trim();
        
        if (paraText.length > 0) textParts.push(paraText);
        
        // Detect if this paragraph starts a new question (ends with ?)
        if (paraText.endsWith('?') && paraText.length > 15) {
          currentQIdx++;
        }
        
        // Find image references in this paragraph
        const blips = [...para.matchAll(/r:embed="(rId\d+)"/g)];
        for (const blip of blips) {
          if (rIdToFile.has(blip[1]) && currentQIdx >= 0) {
            qImageRefs.push({ qIdx: currentQIdx, rId: blip[1] });
          } else if (rIdToFile.has(blip[1])) {
            // Image before first question — assign to question 0 when it appears
            qImageRefs.push({ qIdx: 0, rId: blip[1] });
          }
        }
      }
      
      text = textParts.join('\n');
      
      // Step 3: Extract images and build question→images map
      if (qImageRefs.length > 0 && !existsSync(IMAGES_DIR)) {
        mkdirSync(IMAGES_DIR, { recursive: true });
      }
      
      let imgCount = 0;
      for (const ref of qImageRefs) {
        const mediaPath = rIdToFile.get(ref.rId);
        if (!mediaPath) continue;
        
        const mediaEntry = zip.getEntry(`word/${mediaPath}`);
        if (!mediaEntry || mediaEntry.header.size < 100) continue;
        
        // Determine extension
        const ext = mediaPath.match(/\.(jpe?g|png|gif|bmp|webp|wdp|tiff?)$/i)?.[1] || 'png';
        // Skip WDP (HD Photo) format — not web-compatible
        if (ext === 'wdp') continue;
        
        const imgFilename = `${fileSlug}_q${ref.qIdx}_${imgCount}.${ext}`;
        const imgPath = join(IMAGES_DIR, imgFilename);
        
        // Extract to public/images/cases/
        writeFileSync(imgPath, mediaEntry.getData());
        
        if (!imageMap.has(ref.qIdx)) imageMap.set(ref.qIdx, []);
        imageMap.get(ref.qIdx).push(`/images/cases/${imgFilename}`);
        imgCount++;
      }
      
      if (imgCount > 0) {
        console.log(`   🖼️  Extracted ${imgCount} images paired to ${imageMap.size} questions`);
      }
    }
  } catch (err) {
    console.log(`   ⚠️ DOCX error: ${err.message}`);
    return [];
  }
  
  console.log(`   Text: ${(text.length / 1024).toFixed(0)}KB`);
  
  if (!existsSync(DEBUG_DIR)) mkdirSync(DEBUG_DIR, { recursive: true });
  writeFileSync(join(DEBUG_DIR, basename(inputPath, '.docx') + '_text.txt'), text.substring(0, 5000), 'utf-8');
  
  const questions = extractQuestionsFromText(text, sourceName);
  
  // Pair images to questions
  for (let i = 0; i < questions.length; i++) {
    const imgs = imageMap.get(i) || [];
    questions[i].images = imgs;
    // Flag questions that reference images (gambar, EKG, foto, etc.) but have none
    questions[i].needs_image = imgs.length === 0 && IMAGE_REF_REGEX.test(questions[i].question);
  }
  
  const withAnswers = questions.filter(q => q.correct_answer).length;
  const withExplanations = questions.filter(q => q.explanation.length > 10).length;
  const withImages = questions.filter(q => q.images && q.images.length > 0).length;
  
  console.log(`   ✅ ${questions.length} questions (${withAnswers} answers, ${withExplanations} explanations, ${withImages} with images)`);
  return questions;
}

// Regex to detect questions that reference visual media
const IMAGE_REF_REGEX = /gambar(?:an)?|foto|radiologi|rontgen|x-ray|ekg|elektrokardiog|ct.scan|mri|usg|ultrason|dermatos|lesi kulit|hasil pemeriksaan|berikut ini|tampak gambaran|gambaran (?:sebagai )?berikut/i;

// ═══════════════════════════════════════
// MAIN
// ═══════════════════════════════════════
async function main() {
  const args = process.argv.slice(2);
  
  console.log('══════════════════════════════════════════════════');
  console.log(' MedCase Pro — PDF/DOCX MCQ Extractor v2');
  console.log('══════════════════════════════════════════════════');
  
  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
  
  let allQuestions = [];
  
  if (args.length > 0) {
    const ext = extname(args[0]).toLowerCase();
    const qs = ext === '.docx'
      ? await processDOCX(args[0], 'UKMPPD PDF')
      : await processPDF(args[0], 'UKMPPD PDF');
    allQuestions.push(...qs);
  } else {
    if (!existsSync(PDF_DIR)) {
      console.log(`\n❌ PDF directory not found: ${PDF_DIR}`);
      process.exit(1);
    }
    
    const files = readdirSync(PDF_DIR).filter(f => /\.(pdf|docx)$/i.test(f)).sort();
    console.log(`\n📂 Found ${files.length} files in: ${PDF_DIR}\n`);
    
    for (const file of files) {
      const filePath = join(PDF_DIR, file);
      const ext = extname(file).toLowerCase();
      
      let sourceName = 'ukmppd-pdf';
      if (/aipki/i.test(file)) sourceName = 'aipki';
      else if (/1001/i.test(file)) sourceName = '1001-soal-ukmppd';
      else if (/rekap/i.test(file)) sourceName = 'ukmppd-rekap';
      else if (/pembekalan/i.test(file)) sourceName = 'ukmppd-pembekalan';
      else if (/e-modul/i.test(file)) sourceName = 'ukmppd-emodul';
      else if (/bank.soal/i.test(file)) sourceName = 'ukmppd-bank';
      
      try {
        const qs = ext === '.docx'
          ? await processDOCX(filePath, sourceName)
          : await processPDF(filePath, sourceName);
        allQuestions.push(...qs);
      } catch (err) {
        console.log(`   ❌ Error: ${err.message}`);
      }
    }
  }
  
  // Save combined output
  const outputPath = join(OUTPUT_DIR, 'ukmppd_pdf_raw.json');
  writeFileSync(outputPath, JSON.stringify(allQuestions, null, 2), 'utf-8');
  
  const withAnswers = allQuestions.filter(q => q.correct_answer).length;
  const withExplanations = allQuestions.filter(q => q.explanation.length > 10).length;
  const bySrc = {};
  for (const q of allQuestions) bySrc[q.source] = (bySrc[q.source] || 0) + 1;
  
  console.log('\n══════════════════════════════════════════════════');
  console.log(` EXTRACTION COMPLETE`);
  console.log(`   Total: ${allQuestions.length} questions`);
  console.log(`   With answers: ${withAnswers} (${allQuestions.length ? Math.round(withAnswers / allQuestions.length * 100) : 0}%)`);
  console.log(`   With explanations: ${withExplanations} (${allQuestions.length ? Math.round(withExplanations / allQuestions.length * 100) : 0}%)`);
  console.log(`   By source:`);
  for (const [src, count] of Object.entries(bySrc).sort((a, b) => b[1] - a[1]))
    console.log(`     ${src}: ${count}`);
  console.log(`   Output: ${outputPath}`);
  console.log('══════════════════════════════════════════════════');
}

main().catch(err => { console.error('❌ Fatal:', err); process.exit(1); });
