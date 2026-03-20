/**
 * MedCase Pro — Rationale Enrichment Engine
 * 
 * Pipeline step AFTER Frankenstein Merge, BEFORE output.
 * 
 * Hack 1: Reverse-Lookup Distractors (zero-cost, uses own dataset as knowledge graph)
 * Hack 2: Regex Wall-of-Text Cleaver (extract structured distractors from paragraphs)
 * Hack 3: Expanded Kemenkes Pearls (inject into rationale.pearl field)
 * Hack 4: Extended LLM Queue (empty explanations → batch processing)
 * 
 * Note: Hack 5 (Auto-Bold) is at RENDER level in CasePlayer.jsx, NOT here.
 */
import { writeFileSync } from 'fs';
import { join } from 'path';

const OUTPUT_DIR = join(import.meta.dirname, '..', 'output');

// ═══════════════════════════════════════
// HACK 3: Expanded Kemenkes Clinical Pearls (appended to rationale.pearl)
// ═══════════════════════════════════════
const KEMENKES_PEARLS = [
  { keywords: /\b(dengue|dbd|dss|dengue hemorrhagic)\b/i, pearl: '🇮🇩 UKMPPD: Resusitasi cairan DBD menggunakan Ringer Laktat (Kristaloid). Transfusi trombosit HANYA jika perdarahan masif — Kemenkes RI.' },
  { keywords: /\b(typhoid|salmonella typhi|enteric fever)\b/i, pearl: '🇮🇩 UKMPPD: Lini pertama Tifoid di Faskes Primer adalah Kloramfenikol/Tiamfenikol (PPK IDI). Awasi Anemia Aplastik.' },
  { keywords: /\b(malaria|plasmodium)\b/i, pearl: '🇮🇩 UKMPPD: Lini pertama malaria falciparum: DHP (Dihydroartemisinin-Piperaquine), BUKAN Chloroquine — Kemenkes RI.' },
  { keywords: /\b(tubercul|tbc|tb pulmon)\b/i, pearl: '🇮🇩 UKMPPD: Kategori 1 TB Paru: 2RHZE/4RH (Rifampicin-Isoniazid-Pyrazinamide-Ethambutol). Kategori 2: 2RHZES/RHZE/5RHE.' },
  { keywords: /\b(leptospir)/i, pearl: '🇮🇩 UKMPPD: Leptospirosis endemis di Indonesia musim banjir. Lini pertama: Doxycycline (ringan) atau Penicillin G (berat).' },
  { keywords: /\b(filaria|elephantiasis|bancrofti)\b/i, pearl: '🇮🇩 UKMPPD: Filariasis ditangani dengan DEC (Diethylcarbamazine) + Albendazole. Indonesia = program BELKAGA (Bulan Eliminasi Kaki Gajah).' },
  { keywords: /\b(tetanus|clostridium tetani)\b/i, pearl: '🇮🇩 UKMPPD: Tetanus = SKDI Level 3B. Terapi: Metronidazole + ATS/HTIG + debridement. Imunisasi TT pada ibu hamil.' },
  { keywords: /\b(diphtheri|corynebacterium)\b/i, pearl: '🇮🇩 UKMPPD: Difteri = KLB endemis. Terapi: ADS (Anti-Difteri Serum) + Eritromisin/Penisilin Prokain. Trace kontak + profilaksis.' },
  { keywords: /\b(leprosy|kusta|hansen|mycobacterium leprae)\b/i, pearl: '🇮🇩 UKMPPD: Kusta PB: Rifampicin + Dapsone (6 bln). MB: + Clofazimine (12 bln). Indonesia = eliminasi target.' },
  { keywords: /\b(rabies|lyssa)\b/i, pearl: '🇮🇩 UKMPPD: Post-exposure rabies: Cuci luka + VAR (Vaksin Anti-Rabies) + SAR (jika luka berat). Indonesia = negara endemis Rabies.' },
  { keywords: /\b(schistosom|snail fever)\b/i, pearl: '🇮🇩 UKMPPD: Schistosomiasis japonicum endemis di Sulawesi Tengah (Lindu/Napu). Terapi: Praziquantel.' },
  { keywords: /\b(stunting|wasting|undernutrition)\b/i, pearl: '🇮🇩 UKMPPD: Stunting = tinggi badan < -2 SD. Intervensi: ASI eksklusif 6 bln + MPASI + sanitasi (STBM). Bukan hanya PMT.' },
];

// ═══════════════════════════════════════
// HACK 2: Regex patterns for wall-of-text cleaving
// ═══════════════════════════════════════
const DISTRACTOR_PATTERNS = [
  // "Option A is incorrect because..."
  /(?:option|choice)\s*([A-E])\s*(?:is\s+)?(?:incorrect|wrong|false|not correct)(?:\s*because\s*|\s*[:.]\s*)(.*?)(?=(?:option|choice)\s*[A-E]\s*(?:is\s+)?(?:incorrect|wrong|false|not correct)|$)/gi,
  // "A. Ceftriaxone - This is incorrect because..."
  /([A-E])\.\s*[^.]+?\s*[-–—]\s*(?:this is\s+)?(?:incorrect|wrong|not the answer)(?:\s*because\s*|\s*[:.]\s*)(.*?)(?=[A-E]\.\s*[^.]+?\s*[-–—]|$)/gi,
  // "A is wrong because..." (simpler)
  /\b([A-E])\s+is\s+(?:wrong|incorrect|not correct)\s*(?:because\s*|\s*[:.]\s*)(.*?)(?=\b[A-E]\s+is\s+(?:wrong|incorrect|not correct)|$)/gi,
];

/**
 * HACK 1: Build reverse-lookup index for distractor generation
 * Maps treatment/diagnosis keywords → categories where they're correct
 */
function buildReverseLookupIndex(cases) {
  const index = new Map();

  for (const c of cases) {
    const correctOpt = c.options?.find((o) => o.is_correct);
    if (!correctOpt || correctOpt.text.length < 5) continue;

    // Extract meaningful keywords from correct answer (skip stopwords)
    const words = correctOpt.text.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .split(/\s+/)
      .filter((w) => w.length >= 5 && !STOP_SET.has(w));

    if (words.length === 0) continue;
    // Use first meaningful word as key
    const keyword = words[0];
    const category = c.category || 'medicine';
    const title = c.title || c.prompt || '';

    if (!index.has(keyword)) index.set(keyword, []);
    index.get(keyword).push({
      category: category.replace(/-/g, ' '),
      condition: title.substring(0, 60),
    });
  }

  return index;
}

const STOP_SET = new Set([
  'which', 'following', 'would', 'could', 'should', 'about', 'there',
  'these', 'those', 'their', 'other', 'after', 'before', 'during',
  'might', 'being', 'where', 'while', 'under', 'above', 'below',
  'increase', 'decrease', 'normal', 'associated', 'treatment',
  'diagnosis', 'management', 'likely', 'common', 'cause', 'caused',
]);

/**
 * Main enrichment function — runs after Frankenstein Merge
 * @param {Array} cases — merged golden records
 * @returns {Array} — enriched cases (mutated in-place for speed)
 */
export function executeEnrichment(cases) {
  const t0 = Date.now();
  console.log('══════════════════════════════════════');
  console.log(' ✨ RATIONALE ENRICHMENT ENGINE');
  console.log('══════════════════════════════════════');
  console.log(`  Input: ${cases.length.toLocaleString()} cases\n`);

  // Phase 1: Build reverse-lookup index
  const reverseLookup = buildReverseLookupIndex(cases);
  console.log(`  📚 Reverse-lookup index: ${reverseLookup.size.toLocaleString()} keywords\n`);

  const stats = {
    parsedDistractors: 0,
    reverseLookups: 0,
    kemenkesInjected: 0,
    emptyForLLM: 0,
  };

  const llmQueue = [];

  for (const c of cases) {
    c.rationale = c.rationale || {};
    c.rationale.distractors = c.rationale.distractors || {};
    const expText = c.rationale.correct || '';

    // Track empty explanations for Hack 4 (LLM queue)
    if (expText.length < 20 || isPlaceholder(expText)) {
      const correctOpt = c.options?.find((o) => o.is_correct);
      if (correctOpt) {
        llmQueue.push({
          custom_id: `enrich_${c._id}`,
          method: 'POST',
          url: '/v1/chat/completions',
          body: {
            model: 'gpt-4o-mini',
            response_format: { type: 'json_object' },
            messages: [
              {
                role: 'system',
                content: 'You are a medical education expert. Generate a rationale for the correct answer and explain why each distractor is wrong. Output JSON: { "correct_rationale": "...", "distractors": { "A": "...", "B": "..." }, "clinical_pearl": "..." }',
              },
              {
                role: 'user',
                content: `Question: ${c.prompt || c.vignette?.narrative || ''}\nOptions: ${c.options.map((o) => `${o.id}. ${o.text}`).join(' | ')}\nCorrect: ${correctOpt.id}. ${correctOpt.text}`,
              },
            ],
          },
        });
        stats.emptyForLLM++;
      }
      continue; // Skip enrichment for empty cases
    }

    // ═══════════════════════════════════════
    // HACK 2: Regex Wall-of-Text Cleaver
    // ═══════════════════════════════════════
    if (expText.length > 100 && Object.keys(c.rationale.distractors).length === 0) {
      for (const pattern of DISTRACTOR_PATTERNS) {
        // Reset regex state
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(expText)) !== null) {
          const letter = match[1].toUpperCase();
          const explanation = match[2].trim();
          if (explanation.length > 10 && !c.rationale.distractors[letter]) {
            c.rationale.distractors[letter] = explanation;
            stats.parsedDistractors++;
          }
        }
        if (Object.keys(c.rationale.distractors).length > 0) break; // First pattern that matches wins
      }
    }

    // ═══════════════════════════════════════
    // HACK 1: Reverse-Lookup Distractors
    // ═══════════════════════════════════════
    const wrongOptions = c.options?.filter((o) => !o.is_correct) || [];
    for (const opt of wrongOptions) {
      const letter = opt.id;
      // Skip if already has explanation
      if (c.rationale.distractors[letter]) continue;
      if (!opt.text || opt.text.length < 5) continue;

      // Extract keywords from wrong option
      const words = opt.text.toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .split(/\s+/)
        .filter((w) => w.length >= 5 && !STOP_SET.has(w));

      for (const keyword of words) {
        const matches = reverseLookup.get(keyword);
        if (matches && matches.length > 0) {
          // Pick up to 2 distinct categories where this IS correct
          const categories = [...new Set(matches.map((m) => m.category))].slice(0, 2);
          if (categories.length > 0) {
            c.rationale.distractors[letter] = `[Auto-Analysis] ${opt.text} is more commonly indicated as a primary treatment for ${categories.join(' or ')} cases.`;
            stats.reverseLookups++;
            break; // One keyword match is enough
          }
        }
      }
    }

    // ═══════════════════════════════════════
    // HACK 3: Kemenkes Pearl Injection
    // ═══════════════════════════════════════
    if (!c.rationale.pearl || c.rationale.pearl.length < 10) {
      const fullText = `${c.vignette?.narrative || ''} ${c.prompt || ''} ${expText}`.toLowerCase();
      for (const rule of KEMENKES_PEARLS) {
        if (rule.keywords.test(fullText)) {
          c.rationale.pearl = rule.pearl;
          stats.kemenkesInjected++;
          break;
        }
      }
    }
  }

  // ═══════════════════════════════════════
  // SMART TITLE GENERATION (EMR-Style NLP extractor)
  // ═══════════════════════════════════════
  let titlesGenerated = 0;
  for (const c of cases) {
    const vignette = c.vignette?.narrative || c.prompt || '';
    // Only regenerate if title is missing, truncated, or ugly
    if (!c.title || c.title.length < 15 || c.title.endsWith('(') || /\d+-g\s*\(/.test(c.title)) {
      const smartTitle = generateSmartTitle(vignette);
      if (smartTitle && smartTitle.length > 10) {
        c.title = smartTitle;
        titlesGenerated++;
      }
    }
  }

  // ═══════════════════════════════════════
  // HACK 4: Export extended LLM queue
  // ═══════════════════════════════════════
  if (llmQueue.length > 0) {
    const queuePath = join(OUTPUT_DIR, 'llm_enrichment_queue.jsonl');
    writeFileSync(queuePath, llmQueue.map((q) => JSON.stringify(q)).join('\n'));
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`  ✅ ENRICHMENT COMPLETE in ${elapsed}s`);
  console.log(`  ✂️  Parsed: ${stats.parsedDistractors} distractors from wall-of-text`);
  console.log(`  🧠 Reverse-lookup: ${stats.reverseLookups} distractor explanations generated (zero AI cost)`);
  console.log(`  🇮🇩 Kemenkes pearls: ${stats.kemenkesInjected} injected`);
  console.log(`  📋 Smart titles: ${titlesGenerated} EMR-style titles generated`);
  console.log(`  📥 LLM queue: ${stats.emptyForLLM} empty cases exported to llm_enrichment_queue.jsonl\n`);

  return cases;
}

/**
 * EMR-Style NLP Title Extractor
 * Transforms "A 24-year-old man presents with fever and..." → "24 Year Old Man • Fever"
 */
function generateSmartTitle(vignette) {
  if (!vignette || vignette.length < 20) return null;

  // 1. Extract demographics
  const demoRegex = /(?:a|an)\s+(\d+(?:\s*[-–]\s*)?(?:year|month|week|day|yo|g(?:ram)?)\s*[-–]?\s*(?:old)?\s*(?:man|woman|boy|girl|male|female|patient|infant|neonate|newborn|child|gentleman|lady))/i;
  const demoMatch = vignette.match(demoRegex);

  // 2. Extract chief complaint
  const complaintRegex = /(?:presents?|complains?|brought|comes?|admitted|evaluated|referred)(?:\s+to\s+\w+)?\s*(?:with|of|for|due\s+to|because\s+of)\s+([^.,;]+)/i;
  const compMatch = vignette.match(complaintRegex);

  if (demoMatch) {
    const demo = demoMatch[1]
      .replace(/[-–]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    // Title case
    const demoTitle = demo.replace(/\b\w/g, (c) => c.toUpperCase());

    if (compMatch) {
      const complaint = compMatch[1].trim().substring(0, 40);
      // Clean complaint: trim at last space before 40 chars
      const cleanComplaint = complaint.includes(' ') && complaint.length >= 40
        ? complaint.substring(0, complaint.lastIndexOf(' '))
        : complaint;
      return `${demoTitle} • ${cleanComplaint.replace(/\b\w/g, (c) => c.toUpperCase())}`;
    }
    return demoTitle;
  }

  // Fallback: first sentence, smart truncation at word boundary
  const firstSentence = vignette.split(/[.?!]/)[0].trim();
  if (firstSentence.length <= 55) return firstSentence;
  const truncated = firstSentence.substring(0, 55);
  const lastSpace = truncated.lastIndexOf(' ');
  return lastSpace > 20 ? truncated.substring(0, lastSpace) + '...' : truncated + '...';
}

function isPlaceholder(text) {
  const lower = text.toLowerCase();
  return lower.includes('see reference for detailed explanation') ||
    lower.includes('explanation unavailable') ||
    lower.includes('no explanation available');
}
