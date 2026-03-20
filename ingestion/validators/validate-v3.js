/**
 * MedCase Pro — Validation Pipeline v3 (Enterprise Edition)
 * 
 * 5 Genius Hacks:
 *   1. O(N) Medical Jargon Hashing — kills paraphrased duplicates without TF-IDF
 *   2. Cross-Source Auto-Debate — detects conflicting answers across datasets
 *   3. Sniper LLM Batch Queue — exports only conflicts to .jsonl for OpenAI Batch API
 *   4. Proximity Contradiction Scanner — 40-char sliding window for B3
 *   5. Scalable Kemenkes Matrix — extensible localization rules array
 * 
 * Performance: ~3 seconds for 50K cases on single-threaded Node.js
 * 
 * Usage: node ingestion/validators/validate-v3.js
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const OUTPUT_DIR = join(import.meta.dirname, '..', 'output');
const PUBLIC_DIR = join(import.meta.dirname, '..', '..', 'public', 'data');
const COMPILED_FILE = join(OUTPUT_DIR, 'compiled_cases.json');
const REPORT_FILE = join(OUTPUT_DIR, 'validation_report.json');
const LLM_QUEUE_FILE = join(OUTPUT_DIR, 'llm_batch_queue.jsonl');
const QUARANTINE_FILE = join(PUBLIC_DIR, 'quarantine_manifest.json');
const SCT_BATCH_FILE = join(OUTPUT_DIR, 'sct_transmutation.jsonl');

// ═══════════════════════════════════════
// PHANTOM IMAGE RADAR — detect questions referencing visuals
// ═══════════════════════════════════════
const PHANTOM_RADAR = /\b(gambar|radiologi|ekg|ecg|ct scan|mri|x-ray|panah|berikut ini|di bawah ini|menunjukkan gambaran|figure \d|as shown|radiograph|chest x|xray|rontgen|foto thorax|foto polos|USG|ultrasonografi|histopatolog|mikroskop|preparat|sediaan|dermoskop)\b/i;

// ═══════════════════════════════════════
// ENTROPY FILTER — detect OCR garbage
// ═══════════════════════════════════════
const TRAILING_STOP_WORDS = /(?: the| and| of| with| is| a| to| in| or| yang| dan| di| ke| pada| untuk| dari| oleh)$/i;

// ═══════════════════════════════════════
// LAYER A: STRUCTURAL INTEGRITY (from v2)
// ═══════════════════════════════════════
function checkStructural(cases) {
  const issues = [];
  const hashIds = new Set();

  for (const c of cases) {
    const id = c._id ?? '?';

    if (!Array.isArray(c.options) || c.options.length < 2) {
      issues.push({ id, layer: 'A', code: 'A1_FEW_OPTIONS', msg: `Only ${c.options?.length || 0} options`, severity: 'critical' });
    }

    if (c.q_type === 'MCQ' && Array.isArray(c.options)) {
      const correctCount = c.options.filter(o => o.is_correct).length;
      if (correctCount === 0) {
        issues.push({ id, layer: 'A', code: 'A2_NO_CORRECT', msg: 'No correct answer marked', severity: 'critical' });
      } else if (correctCount > 1) {
        issues.push({ id, layer: 'A', code: 'A2_MULTI_CORRECT', msg: `${correctCount} answers marked correct`, severity: 'warning' });
      }
    }

    const narrative = c.vignette?.narrative || '';
    const prompt = c.prompt || '';
    const fullText = `${narrative} ${prompt}`.trim();
    if (narrative.length < 10 && prompt.length < 10) {
      issues.push({ id, layer: 'A', code: 'A3_EMPTY_QUESTION', msg: 'Question text too short', severity: 'critical' });
    }

    // A6: Entropy Filter — OCR garbage detection
    if (fullText.length > 0 && fullText.length < 200) {
      const openParens = (fullText.match(/\(/g) || []).length;
      const closeParens = (fullText.match(/\)/g) || []).length;
      if (openParens !== closeParens) {
        issues.push({ id, layer: 'A', code: 'A6_UNBALANCED_BRACKETS', msg: `Truncated OCR: (=${openParens} )=${closeParens}`, severity: 'warning' });
      }
      if (TRAILING_STOP_WORDS.test(fullText)) {
        issues.push({ id, layer: 'A', code: 'A6_TRAILING_STOP', msg: 'Text ends with stop word — likely truncated', severity: 'warning' });
      }
      if (!/[.?!:"\)]$/.test(fullText) && fullText.length < 80) {
        issues.push({ id, layer: 'A', code: 'A6_NO_TERMINAL', msg: 'No terminal punctuation — possible header/garbage', severity: 'info' });
      }
    }

    // A8: Phantom Image Radar — needs image but has none
    if (PHANTOM_RADAR.test(fullText) && (!c.images || c.images.length === 0)) {
      issues.push({ id, layer: 'A', code: 'A8_PHANTOM_IMAGE', msg: 'References visual but no image attached', severity: 'warning' });
    }

    if (Array.isArray(c.options)) {
      for (const opt of c.options) {
        if (!opt.text || opt.text.trim().length < 1) {
          issues.push({ id, layer: 'A', code: 'A4_EMPTY_OPTION', msg: `Option ${opt.id} empty`, severity: 'warning' });
          break;
        }
      }
    }

    const hid = c.hash_id || '';
    if (hid && hashIds.has(hid)) {
      issues.push({ id, layer: 'A', code: 'A5_DUPE_HASHID', msg: `Duplicate hash_id`, severity: 'warning' });
    }
    hashIds.add(hid);

    const validCats = ['internal-medicine', 'surgery', 'obgyn', 'pediatrics', 'neurology', 'psychiatry', 'emergency', 'public-health'];
    if (!validCats.includes(c.category)) {
      issues.push({ id, layer: 'A', code: 'A7_BAD_CATEGORY', msg: `Unknown: ${c.category}`, severity: 'info' });
    }
  }

  return issues;
}

// ═══════════════════════════════════════
// HACK 4: PROXIMITY CONTRADICTION SCANNER (Layer B)
// ═══════════════════════════════════════
function checkAnswerSanity(cases) {
  const issues = [];

  for (const c of cases) {
    const id = c._id ?? '?';
    if (!Array.isArray(c.options)) continue;

    const correctOpt = c.options.find(o => o.is_correct);

    // B1: Correct answer too short
    if (correctOpt && correctOpt.text.trim().length < 2) {
      issues.push({ id, layer: 'B', code: 'B1_SHORT_ANSWER', msg: `Correct answer: "${correctOpt.text}"`, severity: 'warning' });
    }

    // B2: All options identical
    const uniqueTexts = new Set(c.options.map(o => o.text.trim().toLowerCase()));
    if (uniqueTexts.size === 1 && c.options.length > 1) {
      issues.push({ id, layer: 'B', code: 'B2_IDENTICAL_OPTIONS', msg: 'All options same text', severity: 'critical' });
    }

    // B3: 🔥 Hack 4 — Proximity Contradiction Scanner (TIGHTENED: 15-char window)
    // Original 40-char window caused ~668 false positives. Fixes:
    //   - Window shrunk to 15 chars (must be truly adjacent)
    //   - Only match strict negation patterns ("is not", "is incorrect", "is wrong")
    //   - Require answer keyword ≥ 5 chars to avoid matching common short words
    if (correctOpt && c.rationale?.correct && c.rationale.correct.length > 30) {
      const explanation = c.rationale.correct.toLowerCase();
      const ansWords = correctOpt.text.toLowerCase()
        .replace(/[^a-z0-9 ]/g, ' ').trim().split(/\s+/)
        .filter(w => w.length >= 5); // ≥5 chars to avoid generic words

      if (ansWords.length > 0) {
        const ansKeyword = ansWords[0];
        const escaped = ansKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Tight window: strict negation DIRECTLY adjacent (≤15 chars)
        const windowRegex = new RegExp(
          `\\b${escaped}\\b.{0,15}\\b(?:is incorrect|is wrong|is not correct|is false|is ruled out)\\b` +
          `|(?:incorrect answer is|wrong answer is|not the correct).{0,15}\\b${escaped}\\b`,
          'i'
        );

        if (windowRegex.test(explanation)) {
          issues.push({
            id, layer: 'B', code: 'B3_PROXIMITY_CONTRADICTION',
            msg: `Explanation negates "${ansKeyword}" (tight 15-char proximity)`,
            severity: 'critical',
          });
        }
      }
    }

    // B4: Option text suspiciously long
    for (const opt of c.options) {
      if (opt.text.length > 500) {
        issues.push({ id, layer: 'B', code: 'B4_LONG_OPTION', msg: `Option ${opt.id}: ${opt.text.length} chars`, severity: 'info' });
        break;
      }
    }
  }

  return issues;
}

// ═══════════════════════════════════════
// HACK 1 & 2: O(N) MEDICAL JARGON HASH + CROSS-SOURCE AUTO-DEBATE (Layer C)
// ═══════════════════════════════════════
const STOP_WORDS = new Set([
  'patient', 'presents', 'years', 'year', 'old', 'with', 'history', 'days', 'hours',
  'which', 'following', 'most', 'likely', 'diagnosis', 'treatment', 'management',
  'step', 'best', 'next', 'what', 'should', 'about', 'the', 'and', 'for', 'was',
  'were', 'from', 'that', 'this', 'have', 'been', 'would', 'could', 'does', 'will',
  'more', 'than', 'other', 'each', 'after', 'before', 'during', 'between', 'into',
  'such', 'when', 'where', 'there', 'then', 'also', 'very', 'some', 'show', 'shows',
  'revealed', 'examination', 'physical', 'findings', 'found', 'noted', 'report',
]);

function getMedicalSignature(text) {
  if (!text || text.length < 30) return '';

  const words = text.toLowerCase().replace(/[^a-z]+/g, ' ').split(/\s+/)
    .filter(w => w.length > 4 && !STOP_WORDS.has(w));

  // Take 8 longest words (medical jargon tends to be long), sort alphabetically
  const jargon = [...new Set(words)]
    .sort((a, b) => b.length - a.length)
    .slice(0, 8);

  if (jargon.length < 4) return ''; // Too few meaningful terms
  return jargon.sort().join('_');
}

function checkSemanticDuplicatesAndConflicts(cases) {
  const issues = [];
  const index = new Map(); // signature → [case objects]
  const llmQueue = [];

  // Build index — O(N)
  for (const c of cases) {
    const text = `${c.vignette?.narrative || ''} ${c.prompt || ''}`;
    const sig = getMedicalSignature(text);
    if (!sig) continue;

    if (!index.has(sig)) index.set(sig, []);
    index.get(sig).push(c);
  }

  // Scan for conflicts and dupes — O(groups)
  let dupeGroups = 0;
  let conflictCount = 0;

  for (const [sig, group] of index.entries()) {
    if (group.length < 2) continue;
    dupeGroups++;

    // Extract answer + source for each case in group
    const answers = group.map(c => {
      const correctOpt = c.options?.find(o => o.is_correct);
      const ansText = correctOpt?.text?.toLowerCase()
        .replace(/[^a-z0-9 ]/g, ' ').trim()
        .split(/\s+/).filter(w => w.length > 3)
        .slice(0, 3).join(' ') || '';
      return { id: c._id, src: c.meta?.source || 'unknown', text: ansText, fullText: correctOpt?.text || '' };
    });

    const uniqueAnswers = new Set(answers.map(a => a.text).filter(Boolean));
    const sources = [...new Set(answers.map(a => a.src))];

    if (uniqueAnswers.size > 1 && sources.length > 1) {
      // 🔥 HACK 2: Cross-Source Conflict!
      conflictCount++;
      issues.push({
        id: group[0]._id, layer: 'C', code: 'C2_CROSS_SOURCE_CONFLICT',
        msg: `Answers differ across ${sources.length} sources: ${answers.map(a => `[${a.src}: "${a.fullText.substring(0, 40)}"]`).join(' vs ')}`,
        severity: 'critical',
        relatedIds: group.map(g => g._id),
      });

      // 🔥 HACK 3: Export to JSONL for AI triage
      llmQueue.push({
        custom_id: `conflict_${group[0]._id}`,
        method: 'POST',
        url: '/v1/chat/completions',
        body: {
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: 'You are an expert Indonesian Medical Board (UKMPPD) examiner. Two datasets have conflicting answers. Determine the correct answer based on Harrison\'s Principles + Kemenkes/IDI guidelines. Reply with: CORRECT_ANSWER: [text] | SOURCE: [which source is right] | REASONING: [brief]',
            },
            {
              role: 'user',
              content: `Case: ${(group[0].vignette?.narrative || '').substring(0, 500)}\nQuestion: ${group[0].prompt || ''}\nConflicting answers:\n${answers.map(a => `- ${a.src}: "${a.fullText}"`).join('\n')}`,
            },
          ],
        },
      });
    } else if (dupeGroups <= 200) {
      // Paraphrased duplicate with consensus
      issues.push({
        id: group[0]._id, layer: 'C', code: 'C1_PARAPHRASED_DUPLICATE',
        msg: `${group.length} paraphrased variants (answer consensus ✓)`,
        severity: 'info',
        relatedIds: group.map(g => g._id),
      });
    }
  }

  return { issues, llmQueue, stats: { dupeGroups, conflictCount } };
}

// ═══════════════════════════════════════
// HACK 5: SCALABLE KEMENKES MATRIX (Layer D)
// ═══════════════════════════════════════
const LOCALIZATION_RULES = [
  {
    id: 'MALARIA_TX',
    keywords: /\b(malaria|plasmodium|falciparum)\b/i,
    usmleDrug: /\b(chloroquine|atovaquone|mefloquine|malarone|quinine)\b/i,
    ukmppdDrug: /\b(DHP|dihydroartemisinin|piperaquine|primakuin|primaquine|artemisinin|ACT)\b/i,
    conflict: 'Malaria Tx: USMLE=Chloroquine/Atovaquone, UKMPPD=DHP+Primakuin (Kemenkes)',
  },
  {
    id: 'TYPHOID_TX',
    keywords: /\b(typhoid|salmonella typhi|enteric fever)\b/i,
    usmleDrug: /\b(ceftriaxone|fluoroquinolone|ciprofloxacin)\b/i,
    ukmppdDrug: /\b(chloramphenicol|kloramfenikol)\b/i,
    conflict: 'Typhoid Tx: USMLE=Ceftriaxone/FQ, UKMPPD=Chloramphenicol (PPK IDI)',
  },
  {
    id: 'TB_TX',
    keywords: /\b(tuberculosis|TB|mycobacterium)\b/i,
    usmleDrug: /\b(RIPE|rifampin|isoniazid|pyrazinamide|ethambutol)\b/i,
    ukmppdDrug: /\b(OAT|FDC|kategori\s*[12]|2HRZE|4HR|rifampisin)\b/i,
    conflict: 'TB Tx: USMLE=RIPE, UKMPPD=OAT Kategori 1 (2HRZE/4HR3) FDC (Kemenkes)',
  },
  {
    id: 'DHF_TX',
    keywords: /\b(dengue|DHF|DSS|hemorrhagic fever)\b/i,
    usmleDrug: /\b(supportive|fluid|crystalloid)\b/i,
    ukmppdDrug: /\b(RL|ringer|cairan\s*kristaloid|WHO\s*grade)\b/i,
    conflict: 'DHF Tx: Different grading & fluid protocols (WHO vs Kemenkes)',
  },
  {
    id: 'RABIES_PEP',
    keywords: /\b(rabies|rabid|dog\s*bite)\b/i,
    usmleDrug: /\b(RIG|rabies\s*immunoglobulin|HRIG)\b/i,
    ukmppdDrug: /\b(VAR|SAR|wound\s*washing)\b/i,
    conflict: 'Rabies PEP: USMLE=HRIG+vaccine, UKMPPD=VAR+SAR (Kemenkes protocol)',
  },
  {
    id: 'LEPTOSPIROSIS_TX',
    keywords: /\b(leptospirosis|weil|leptospira|rat\s*urine|sewer)\b/i,
    usmleDrug: /\b(penicillin\s*g|ceftriaxone|iv\s*antibiotics)\b/i,
    ukmppdDrug: /\b(doxycycline|doksisiklin)\b/i,
    conflict: 'Leptospirosis: USMLE=PenG for severe, UKMPPD=Doxycycline 1st line',
  },
  {
    id: 'FILARIASIS_TX',
    keywords: /\b(filariasis|elephantiasis|wuchereria|brugia)\b/i,
    usmleDrug: /\b(ivermectin|diethylcarbamazine\s*only)\b/i,
    ukmppdDrug: /\b(albendazole)\b/i,
    conflict: 'Filariasis: Kemenkes POMP = DEC + Albendazole combination',
  },
  {
    id: 'TETANUS_NEONATORUM',
    keywords: /\b(tetanus neonatorum|umbilical stump|lockjaw.*neonate)\b/i,
    usmleDrug: /\b(metronidazole|penicillin)\b/i,
    ukmppdDrug: /\b(diazepam|ats|htig)\b/i,
    conflict: 'Tetanus: UKMPPD focuses on Diazepam (seizure) & ATS before antibiotics',
  },
  {
    id: 'DIPHTHERIA_TX',
    keywords: /\b(diphtheria|corynebacterium|bull\s*neck)\b/i,
    usmleDrug: /\b(penicillin|erythromycin)\b/i,
    ukmppdDrug: /\b(ADS|anti\s*difteri\s*serum)\b/i,
    conflict: 'Diphtheria: UKMPPD emphasizes ADS (anti difteri serum) urgently',
  },
  {
    id: 'LEPROSY_TX',
    keywords: /\b(leprosy|hansen|mycobacterium\s*leprae)\b/i,
    usmleDrug: /\b(dapsone|rifampin)\b/i,
    ukmppdDrug: /\b(MDT|multi\s*drug|klofazimin|clofazimine)\b/i,
    conflict: 'Leprosy: Kemenkes = MDT WHO regimen (Dapsone+Rifampicin+Clofazimine)',
  },
];

// SKDI Level 3B — stabilize and refer, NOT definitive treatment
const SKDI_3B_CONDITIONS = [
  /\b(appendicitis|appendectomy)\b/i,
  /\b(cholecystitis|cholecystectomy)\b/i,
  /\b(fracture\s+(?:femur|pelvis|spine))\b/i,
  /\b(bowel\s*obstruction)\b/i,
  /\b(ectopic\s*pregnancy)\b/i,
  /\b(placenta\s*previa)\b/i,
  /\b(intracranial\s*hemorrhage|epidural|subdural)\b/i,
  /\b(myocardial\s*infarction|STEMI)\b/i,
  /\b(tension\s*pneumothorax)\b/i,
];

function checkLocalization(cases) {
  const issues = [];

  for (const c of cases) {
    const id = c._id ?? '?';
    if (c.meta?.examType === 'UKMPPD') continue;

    // Direct text concat (NOT JSON.stringify — that was causing 17s runtime)
    const text = `${c.vignette?.narrative || ''} ${c.prompt || ''} ${(c.options || []).map(o => o.text).join(' ')} ${c.rationale?.correct || ''}`;

    // D1: Treatment protocol conflicts
    for (const rule of LOCALIZATION_RULES) {
      if (rule.keywords.test(text)) {
        const correctOpt = c.options?.find(o => o.is_correct);
        const answerText = `${correctOpt?.text || ''} ${c.rationale?.correct || ''}`;
        if (rule.usmleDrug.test(answerText) && !rule.ukmppdDrug.test(answerText)) {
          issues.push({
            id, layer: 'D', code: 'D1_LOCAL_CONFLICT',
            msg: `${rule.id}: ${rule.conflict}`,
            severity: 'warning', source: c.meta?.source,
          });
        }
      }
    }

    // D2: SKDI 3B — flag if answer suggests definitive surgery
    for (const pattern of SKDI_3B_CONDITIONS) {
      if (pattern.test(text)) {
        const correctOpt = c.options?.find(o => o.is_correct);
        const ansText = (correctOpt?.text || '').toLowerCase();
        if (/\b(surgery|operate|surgical\s+intervention|excision|resection)\b/i.test(ansText)) {
          const prompt = (c.prompt || '').toLowerCase();
          if (/\b(next\s+step|management|treatment|what\s+(?:should|would))\b/i.test(prompt)) {
            issues.push({
              id, layer: 'D', code: 'D2_SKDI_3B',
              msg: 'Answer suggests surgery but UKMPPD = stabilize & refer',
              severity: 'warning', source: c.meta?.source,
            });
          }
        }
        break;
      }
    }
  }

  return issues;
}

// ═══════════════════════════════════════
// REPORT GENERATOR (Layer E)
// ═══════════════════════════════════════
function generateReport(cases, allIssues, semanticStats) {
  const bySeverity = { critical: 0, warning: 0, info: 0 };
  const byLayer = { A: 0, B: 0, C: 0, D: 0 };
  const bySource = {};

  for (const issue of allIssues) {
    bySeverity[issue.severity] = (bySeverity[issue.severity] || 0) + 1;
    byLayer[issue.layer] = (byLayer[issue.layer] || 0) + 1;
  }

  for (const c of cases) {
    const src = c.meta?.source || 'unknown';
    if (!bySource[src]) bySource[src] = { total: 0, withExplanation: 0, avgScore: 0, scoreSum: 0, scored: 0 };
    bySource[src].total++;
    if (c.rationale?.correct && c.rationale.correct.length > 10) bySource[src].withExplanation++;
    const score = c.validation?.overallScore || c.confidence || 0;
    if (score > 0) { bySource[src].scored++; bySource[src].scoreSum += score; }
  }
  for (const s of Object.values(bySource)) {
    s.avgScore = s.scored > 0 ? Math.round((s.scoreSum / s.scored) * 10) / 10 : 0;
    delete s.scoreSum; delete s.scored;
  }

  const byCategory = {};
  for (const c of cases) byCategory[c.category] = (byCategory[c.category] || 0) + 1;

  const conf = { 'high (≥4.0)': 0, 'medium (3.0-3.9)': 0, 'low (2.0-2.9)': 0, 'unverified (<2.0)': 0 };
  for (const c of cases) {
    const s = c.validation?.overallScore || c.confidence || 0;
    if (s >= 4.0) conf['high (≥4.0)']++;
    else if (s >= 3.0) conf['medium (3.0-3.9)']++;
    else if (s >= 2.0) conf['low (2.0-2.9)']++;
    else conf['unverified (<2.0)']++;
  }

  return {
    generatedAt: new Date().toISOString(),
    version: 'v3',
    totalCases: cases.length,
    totalIssues: allIssues.length,
    bySeverity,
    byLayer: { A_structural: byLayer.A, B_answer_sanity: byLayer.B, C_semantic_dedup: byLayer.C, D_localization: byLayer.D },
    semanticStats,
    bySource,
    byCategory,
    confidenceDistribution: conf,
    criticalIssues: allIssues.filter(i => i.severity === 'critical').slice(0, 100),
    localizationFlags: allIssues.filter(i => i.layer === 'D').slice(0, 50),
  };
}

// ═══════════════════════════════════════
// MAIN
// ═══════════════════════════════════════
function main() {
  const t0 = Date.now();
  console.log('══════════════════════════════════════════════════');
  console.log(' MedCase Pro — Validation Pipeline v3');
  console.log(' Enterprise Edition: 5 Genius Hacks');
  console.log('══════════════════════════════════════════════════\n');

  if (!existsSync(COMPILED_FILE)) {
    console.error('❌ compiled_cases.json not found. Run parse-all.js first.');
    process.exit(1);
  }

  console.log('📂 Loading compiled cases...');
  const cases = JSON.parse(readFileSync(COMPILED_FILE, 'utf-8'));
  console.log(`  Loaded ${cases.length.toLocaleString()} cases\n`);

  // Layer A
  console.log('🔍 Layer A: Structural Integrity...');
  const layerA = checkStructural(cases);
  console.log(`  Found ${layerA.length} issues (${layerA.filter(i => i.severity === 'critical').length} critical)\n`);

  // Layer B (with Hack 4: Proximity Contradiction)
  console.log('🔍 Layer B: Answer Sanity + Proximity Scanner...');
  const layerB = checkAnswerSanity(cases);
  const b3Count = layerB.filter(i => i.code === 'B3_PROXIMITY_CONTRADICTION').length;
  console.log(`  Found ${layerB.length} issues (${b3Count} proximity contradictions)\n`);

  // Layer C (Hack 1 + 2: Semantic Hash + Cross-Source Debate)
  console.log('🧠 Layer C: O(N) Semantic Hash + Cross-Source Debate...');
  const { issues: layerC, llmQueue, stats: semStats } = checkSemanticDuplicatesAndConflicts(cases);
  console.log(`  Semantic groups: ${semStats.dupeGroups}`);
  console.log(`  🔴 Cross-source conflicts: ${semStats.conflictCount}`);
  console.log(`  Found ${layerC.length} total issues\n`);

  // Layer D (Hack 5: Scalable Kemenkes Matrix)
  console.log(`🇮🇩 Layer D: Localization Engine (${LOCALIZATION_RULES.length} rules)...`);
  const layerD = checkLocalization(cases);
  console.log(`  Found ${layerD.length} USMLE↔UKMPPD conflicts\n`);

  // Combine
  const allIssues = [...layerA, ...layerB, ...layerC, ...layerD];

  // ═══════════════════════════════════════
  // QUARANTINE MANIFEST — Zero-Downtime frontend filter
  // ═══════════════════════════════════════
  console.log('🛡️ Generating Quarantine Manifest...');
  const criticalCodes = new Set(['A1_FEW_OPTIONS', 'A2_NO_CORRECT', 'A3_EMPTY_QUESTION', 'B2_IDENTICAL_OPTIONS', 'A8_PHANTOM_IMAGE']);
  const quarantine = [];
  const quarantinedIds = new Set();
  for (const issue of allIssues) {
    if ((issue.severity === 'critical' || criticalCodes.has(issue.code)) && !quarantinedIds.has(issue.id)) {
      quarantine.push({ id: issue.id, code: issue.code, reason: issue.msg, source: issue.source || null });
      quarantinedIds.add(issue.id);
    }
  }
  writeFileSync(QUARANTINE_FILE, JSON.stringify(quarantine, null, 2), 'utf-8');
  console.log(`  ☣️  ${quarantine.length} cases quarantined → ${QUARANTINE_FILE}\n`);

  // ═══════════════════════════════════════
  // SCT ALCHEMIST — Convert top MCQs to SCT format
  // ═══════════════════════════════════════
  console.log('🧪 SCT Alchemist: Harvesting MCQ→SCT candidates...');
  const sctBatch = [];
  for (const c of cases) {
    if (sctBatch.length >= 500) break;
    if (quarantinedIds.has(c._id)) continue;
    if (c.meta?.source !== 'medqa') continue;
    const correctOpt = c.options?.find(o => o.is_correct);
    if (!correctOpt) continue;
    const text = `${c.vignette?.narrative || ''} ${c.prompt || ''}`.trim();
    if (text.length < 100) continue;

    sctBatch.push({
      custom_id: `sct_${c._id}`,
      method: 'POST', url: '/v1/chat/completions',
      body: {
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'You are an expert Medical Examiner. Convert this MCQ into a Script Concordance Test (SCT). Output JSON: {"hypothesis": string, "new_finding": string, "likert": int (-2 to 2), "rationale": string, "panel_votes": {"minus2": int, "minus1": int, "zero": int, "plus1": int, "plus2": int}}. Panel votes should sum to 10 and reflect expert panel distribution.' },
          { role: 'user', content: `Vignette: ${text.substring(0, 800)}\nCorrect Answer: ${correctOpt.text}` },
        ],
      },
    });
  }
  if (sctBatch.length > 0) {
    writeFileSync(SCT_BATCH_FILE, sctBatch.map(q => JSON.stringify(q)).join('\n'), 'utf-8');
    console.log(`  🧬 ${sctBatch.length} MCQ→SCT prompts → ${SCT_BATCH_FILE}`);
  }
  console.log();

  // Generate report
  console.log('📊 Layer E: Generating report...');
  const report = generateReport(cases, allIssues, semStats);
  report.quarantineCount = quarantine.length;
  report.sctCandidates = sctBatch.length;
  writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2), 'utf-8');

  // 🔥 Hack 3: Export LLM Batch Queue
  if (llmQueue.length > 0) {
    const jsonl = llmQueue.map(q => JSON.stringify(q)).join('\n');
    writeFileSync(LLM_QUEUE_FILE, jsonl, 'utf-8');
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  // Print summary
  console.log('\n══════════════════════════════════════════════════');
  console.log(' VALIDATION v3.1 REPORT (+ Quarantine + SCT Alchemist)');
  console.log('══════════════════════════════════════════════════');
  console.log(`  ⏱️  Completed in ${elapsed}s`);
  console.log(`  Total cases:     ${report.totalCases.toLocaleString()}`);
  console.log(`  Total issues:    ${report.totalIssues}`);
  console.log(`    🔴 Critical:   ${report.bySeverity.critical}`);
  console.log(`    🟡 Warning:    ${report.bySeverity.warning}`);
  console.log(`    ℹ️  Info:       ${report.bySeverity.info}`);
  console.log();
  console.log('  By Layer:');
  console.log(`    A (Structural):      ${report.byLayer.A_structural}`);
  console.log(`    B (Answer Sanity):   ${report.byLayer.B_answer_sanity}`);
  console.log(`    C (Semantic Dedup):  ${report.byLayer.C_semantic_dedup}`);
  console.log(`    D (Localization):    ${report.byLayer.D_localization}`);
  console.log();
  console.log('  Confidence Distribution:');
  for (const [bucket, count] of Object.entries(report.confidenceDistribution)) {
    const pct = ((count / report.totalCases) * 100).toFixed(1);
    console.log(`    ${bucket}: ${count.toLocaleString()} (${pct}%)`);
  }
  console.log();
  console.log('  By Source:');
  for (const [src, s] of Object.entries(report.bySource).sort((a, b) => b[1].total - a[1].total)) {
    console.log(`    ${src}: ${s.total.toLocaleString()} (avg: ${s.avgScore}, ${s.withExplanation.toLocaleString()} w/ explanation)`);
  }
  console.log();
  console.log('  By Category:');
  for (const [cat, count] of Object.entries(report.byCategory).sort((a, b) => b - a)) {
    console.log(`    ${cat}: ${count.toLocaleString()} (${((count / report.totalCases) * 100).toFixed(1)}%)`);
  }

  if (llmQueue.length > 0) {
    console.log();
    console.log(`  🤖 AI SNIPER QUEUE: ${llmQueue.length} conflicts exported to llm_batch_queue.jsonl`);
    console.log(`     💡 Upload to OpenAI Batch API (50% discount) for resolution`);
  }

  console.log(`\n  Report: ${REPORT_FILE}`);
  console.log('══════════════════════════════════════════════════\n');

  if (report.bySeverity.critical > 0) {
    console.log(`⚠️  ${report.bySeverity.critical} CRITICAL issues. Review validation_report.json.`);
  }
}

main();
