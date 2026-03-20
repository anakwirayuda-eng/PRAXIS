/**
 * MedCase Pro — Validation Pipeline v2
 * 5-Layer answer integrity checker + cross-source verifier + localization engine
 *
 * Layers:
 *   A — Structural Integrity (malformed data)
 *   B — Answer Sanity (suspicious answers)
 *   C — Duplicate Detection (near-duplicate questions)
 *   D — Localization Conflict Detection (USMLE vs UKMPPD)
 *   E — Statistics & Report Generation
 *
 * Usage: node ingestion/validators/validate.js
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const OUTPUT_DIR = join(import.meta.dirname, '..', 'output');
const COMPILED_FILE = join(OUTPUT_DIR, 'compiled_cases.json');
const REPORT_FILE = join(OUTPUT_DIR, 'validation_report.json');

// ═══════════════════════════════════════
// LAYER A: STRUCTURAL INTEGRITY
// ═══════════════════════════════════════
function checkStructural(cases) {
  const issues = [];
  const hashIds = new Set();

  for (const c of cases) {
    const id = c._id ?? '?';

    // A1: Must have options
    if (!Array.isArray(c.options) || c.options.length < 2) {
      issues.push({ id, layer: 'A', code: 'A1_FEW_OPTIONS', msg: `Only ${c.options?.length || 0} options`, severity: 'critical' });
    }

    // A2: Exactly 1 correct answer (for MCQ)
    if (c.q_type === 'MCQ' && Array.isArray(c.options)) {
      const correctCount = c.options.filter(o => o.is_correct).length;
      if (correctCount === 0) {
        issues.push({ id, layer: 'A', code: 'A2_NO_CORRECT', msg: 'No correct answer marked', severity: 'critical' });
      } else if (correctCount > 1) {
        issues.push({ id, layer: 'A', code: 'A2_MULTI_CORRECT', msg: `${correctCount} answers marked correct`, severity: 'warning' });
      }
    }

    // A3: Non-empty question text
    const narrative = c.vignette?.narrative || '';
    const prompt = c.prompt || '';
    if (narrative.length < 10 && prompt.length < 10) {
      issues.push({ id, layer: 'A', code: 'A3_EMPTY_QUESTION', msg: 'Question text too short', severity: 'critical' });
    }

    // A4: Non-empty option text
    if (Array.isArray(c.options)) {
      for (const opt of c.options) {
        if (!opt.text || opt.text.trim().length < 1) {
          issues.push({ id, layer: 'A', code: 'A4_EMPTY_OPTION', msg: `Option ${opt.id} has empty text`, severity: 'warning' });
          break;
        }
      }
    }

    // A5: Duplicate hash_ids
    const hid = c.hash_id || '';
    if (hid && hashIds.has(hid)) {
      issues.push({ id, layer: 'A', code: 'A5_DUPE_HASHID', msg: `Duplicate hash_id: ${hid}`, severity: 'warning' });
    }
    hashIds.add(hid);

    // A6: Title sanity
    if (!c.title || c.title.length > 200) {
      issues.push({ id, layer: 'A', code: 'A6_BAD_TITLE', msg: `Title length: ${c.title?.length || 0}`, severity: 'info' });
    }

    // A7: Category check
    const validCats = ['internal-medicine', 'surgery', 'obgyn', 'pediatrics', 'neurology', 'psychiatry', 'emergency', 'public-health'];
    if (!validCats.includes(c.category)) {
      issues.push({ id, layer: 'A', code: 'A7_BAD_CATEGORY', msg: `Unknown category: ${c.category}`, severity: 'info' });
    }
  }

  return issues;
}

// ═══════════════════════════════════════
// LAYER B: ANSWER SANITY
// ═══════════════════════════════════════
function checkAnswerSanity(cases) {
  const issues = [];

  for (const c of cases) {
    const id = c._id ?? '?';
    if (!Array.isArray(c.options)) continue;

    // B1: Correct answer text suspiciously short
    const correctOpt = c.options.find(o => o.is_correct);
    if (correctOpt && correctOpt.text.trim().length < 2) {
      issues.push({ id, layer: 'B', code: 'B1_SHORT_ANSWER', msg: `Correct answer is "${correctOpt.text}"`, severity: 'warning' });
    }

    // B2: All options identical
    const uniqueTexts = new Set(c.options.map(o => o.text.trim().toLowerCase()));
    if (uniqueTexts.size === 1 && c.options.length > 1) {
      issues.push({ id, layer: 'B', code: 'B2_IDENTICAL_OPTIONS', msg: 'All options have same text', severity: 'critical' });
    }

    // B3: Explanation contradicts answer (heuristic)
    const explanation = c.rationale?.correct || '';
    if (explanation.length > 20 && correctOpt) {
      // Check if explanation explicitly says "incorrect" for the marked correct answer
      const expLower = explanation.toLowerCase();
      const ansLower = correctOpt.text.toLowerCase().substring(0, 30);
      if (expLower.includes('incorrect') && expLower.includes(ansLower)) {
        issues.push({ id, layer: 'B', code: 'B3_CONTRADICTED', msg: 'Explanation mentions correct answer as incorrect', severity: 'warning' });
      }
    }

    // B4: Option text too long (might be malformed — options merged)
    for (const opt of c.options) {
      if (opt.text.length > 500) {
        issues.push({ id, layer: 'B', code: 'B4_LONG_OPTION', msg: `Option ${opt.id} is ${opt.text.length} chars`, severity: 'info' });
        break;
      }
    }
  }

  return issues;
}

// ═══════════════════════════════════════
// LAYER C: DUPLICATE DETECTION
// ═══════════════════════════════════════
function checkDuplicates(cases) {
  const issues = [];

  // Create fingerprints from first 80 chars of question text (normalized)
  const fingerprints = new Map(); // fingerprint → [case_ids]

  for (const c of cases) {
    const text = (c.vignette?.narrative || c.prompt || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (text.length < 30) continue;

    // Use first 80 chars as fingerprint (fast, catches exact dupes)
    const fp = text.substring(0, 80);
    if (!fingerprints.has(fp)) {
      fingerprints.set(fp, []);
    }
    fingerprints.get(fp).push(c._id);
  }

  // Find groups with >1 case
  let dupeGroups = 0;
  let totalDupes = 0;
  for (const [fp, ids] of fingerprints) {
    if (ids.length > 1) {
      dupeGroups++;
      totalDupes += ids.length - 1;
      // Only flag first 100 groups to avoid report bloat
      if (dupeGroups <= 100) {
        issues.push({
          id: ids[0],
          layer: 'C',
          code: 'C1_NEAR_DUPLICATE',
          msg: `${ids.length} near-duplicate questions (IDs: ${ids.slice(0, 5).join(', ')}${ids.length > 5 ? '...' : ''})`,
          severity: 'warning',
          relatedIds: ids,
        });
      }
    }
  }

  if (dupeGroups > 100) {
    issues.push({
      id: -1, layer: 'C', code: 'C1_SUMMARY',
      msg: `${dupeGroups} total duplicate groups (${totalDupes} extra items). Showing first 100.`,
      severity: 'info',
    });
  }

  return issues;
}

// ═══════════════════════════════════════
// LAYER D: LOCALIZATION CONFLICT DETECTION
// ═══════════════════════════════════════

// Key conflicts between USMLE and UKMPPD guidelines
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
    conflict: 'TB Tx: USMLE=RIPE, UKMPPD=OAT Kategori 1 (2HRZE/4HR3), FDC (Kemenkes)',
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
];

// SKDI Level check — Level 3B means "stabilize and refer", NOT definitive treatment
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
    const text = [
      c.vignette?.narrative || '',
      c.prompt || '',
      ...(c.options || []).map(o => o.text),
      c.rationale?.correct || '',
    ].join(' ');

    // Skip already-UKMPPD sourced items (they're already localized)
    if (c.meta?.examType === 'UKMPPD') continue;

    // D1: Check for tropical disease treatment conflicts
    for (const rule of LOCALIZATION_RULES) {
      if (rule.keywords.test(text)) {
        // Check if the answer uses USMLE-specific treatment
        const correctOpt = c.options?.find(o => o.is_correct);
        const answerText = correctOpt?.text || '';
        const explanationText = c.rationale?.correct || '';
        const fullAnswer = answerText + ' ' + explanationText;

        if (rule.usmleDrug.test(fullAnswer) && !rule.ukmppdDrug.test(fullAnswer)) {
          issues.push({
            id, layer: 'D', code: 'D1_LOCAL_CONFLICT',
            msg: `${rule.id}: ${rule.conflict}`,
            severity: 'warning',
            source: c.meta?.source,
          });
        }
      }
    }

    // D2: SKDI Level 3B check — flag if answer suggests definitive surgery for 3B conditions
    for (const pattern of SKDI_3B_CONDITIONS) {
      if (pattern.test(text)) {
        const correctOpt = c.options?.find(o => o.is_correct);
        const ansText = (correctOpt?.text || '').toLowerCase();
        if (/\b(surgery|operate|surgical\s+intervention|excision|resection)\b/i.test(ansText)) {
          // Check if it's a "what to do" type question
          const prompt = (c.prompt || '').toLowerCase();
          if (/\b(next\s+step|management|treatment|what\s+(?:should|would))\b/i.test(prompt)) {
            issues.push({
              id, layer: 'D', code: 'D2_SKDI_3B',
              msg: `SKDI 3B: Answer suggests surgery but UKMPPD context → stabilize & refer`,
              severity: 'warning',
              source: c.meta?.source,
            });
          }
        }
        break; // One match per case is enough
      }
    }
  }

  return issues;
}

// ═══════════════════════════════════════
// LAYER E: STATISTICS & REPORT
// ═══════════════════════════════════════
function generateReport(cases, allIssues) {
  const bySeverity = { critical: 0, warning: 0, info: 0 };
  const byLayer = { A: 0, B: 0, C: 0, D: 0 };
  const byCode = {};
  const bySource = {};

  for (const issue of allIssues) {
    bySeverity[issue.severity] = (bySeverity[issue.severity] || 0) + 1;
    byLayer[issue.layer] = (byLayer[issue.layer] || 0) + 1;
    byCode[issue.code] = (byCode[issue.code] || 0) + 1;
  }

  // Source stats
  for (const c of cases) {
    const src = c.meta?.source || 'unknown';
    if (!bySource[src]) bySource[src] = { total: 0, withExplanation: 0, withValidation: 0, avgScore: 0, scoreSum: 0 };
    bySource[src].total++;
    if (c.rationale?.correct && c.rationale.correct.length > 10) bySource[src].withExplanation++;
    if (c.validation) { bySource[src].withValidation++; bySource[src].scoreSum += c.validation.overallScore || 0; }
  }
  for (const stats of Object.values(bySource)) {
    stats.avgScore = stats.withValidation > 0 ? Math.round((stats.scoreSum / stats.withValidation) * 10) / 10 : 0;
    delete stats.scoreSum;
  }

  // Category distribution
  const byCategory = {};
  for (const c of cases) { byCategory[c.category] = (byCategory[c.category] || 0) + 1; }

  // Confidence distribution
  const confidenceBuckets = { 'high (≥4.0)': 0, 'medium (3.0-3.9)': 0, 'low (2.0-2.9)': 0, 'unverified (<2.0)': 0 };
  for (const c of cases) {
    const score = c.validation?.overallScore || c.confidence || 0;
    if (score >= 4.0) confidenceBuckets['high (≥4.0)']++;
    else if (score >= 3.0) confidenceBuckets['medium (3.0-3.9)']++;
    else if (score >= 2.0) confidenceBuckets['low (2.0-2.9)']++;
    else confidenceBuckets['unverified (<2.0)']++;
  }

  return {
    generatedAt: new Date().toISOString(),
    totalCases: cases.length,
    totalIssues: allIssues.length,
    bySeverity,
    byLayer: {
      'A_structural': byLayer.A,
      'B_answer_sanity': byLayer.B,
      'C_duplicates': byLayer.C,
      'D_localization': byLayer.D,
    },
    byCode,
    bySource,
    byCategory,
    confidenceDistribution: confidenceBuckets,
    criticalIssues: allIssues.filter(i => i.severity === 'critical').slice(0, 50),
    localizationFlags: allIssues.filter(i => i.layer === 'D').slice(0, 50),
  };
}

// ═══════════════════════════════════════
// MAIN
// ═══════════════════════════════════════
function main() {
  console.log('══════════════════════════════════════════════════');
  console.log(' MedCase Pro — Validation Pipeline v2');
  console.log(' 5-Layer Answer Integrity Checker');
  console.log('══════════════════════════════════════════════════\n');

  if (!existsSync(COMPILED_FILE)) {
    console.error('❌ compiled_cases.json not found. Run parse-all.js first.');
    process.exit(1);
  }

  console.log('📂 Loading compiled cases...');
  const cases = JSON.parse(readFileSync(COMPILED_FILE, 'utf-8'));
  console.log(`  Loaded ${cases.length} cases\n`);

  // Run all layers
  console.log('🔍 Layer A: Structural Integrity...');
  const layerA = checkStructural(cases);
  console.log(`  Found ${layerA.length} issues (${layerA.filter(i=>i.severity==='critical').length} critical)\n`);

  console.log('🔍 Layer B: Answer Sanity...');
  const layerB = checkAnswerSanity(cases);
  console.log(`  Found ${layerB.length} issues\n`);

  console.log('🔍 Layer C: Duplicate Detection...');
  const layerC = checkDuplicates(cases);
  console.log(`  Found ${layerC.length} duplicate groups\n`);

  console.log('🔍 Layer D: Localization Conflicts...');
  const layerD = checkLocalization(cases);
  console.log(`  Found ${layerD.length} potential USMLE↔UKMPPD conflicts\n`);

  // Combine and generate report
  const allIssues = [...layerA, ...layerB, ...layerC, ...layerD];
  console.log('📊 Layer E: Generating report...');
  const report = generateReport(cases, allIssues);

  writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2), 'utf-8');

  // Print summary
  console.log('\n══════════════════════════════════════════════════');
  console.log(' VALIDATION REPORT SUMMARY');
  console.log('══════════════════════════════════════════════════');
  console.log(`  Total cases:     ${report.totalCases}`);
  console.log(`  Total issues:    ${report.totalIssues}`);
  console.log(`    🔴 Critical:   ${report.bySeverity.critical}`);
  console.log(`    🟡 Warning:    ${report.bySeverity.warning}`);
  console.log(`    ℹ️  Info:       ${report.bySeverity.info}`);
  console.log();
  console.log('  By Layer:');
  console.log(`    A (Structural):    ${report.byLayer.A_structural}`);
  console.log(`    B (Answer Sanity): ${report.byLayer.B_answer_sanity}`);
  console.log(`    C (Duplicates):    ${report.byLayer.C_duplicates}`);
  console.log(`    D (Localization):  ${report.byLayer.D_localization}`);
  console.log();
  console.log('  Confidence Distribution:');
  for (const [bucket, count] of Object.entries(report.confidenceDistribution)) {
    const pct = ((count / report.totalCases) * 100).toFixed(1);
    console.log(`    ${bucket}: ${count} (${pct}%)`);
  }
  console.log();
  console.log('  By Source:');
  for (const [src, stats] of Object.entries(report.bySource).sort((a, b) => b[1].total - a[1].total)) {
    console.log(`    ${src}: ${stats.total} (avg score: ${stats.avgScore}, ${stats.withExplanation} with explanation)`);
  }
  console.log();
  console.log('  By Category:');
  for (const [cat, count] of Object.entries(report.byCategory).sort((a, b) => b - a)) {
    const pct = ((count / report.totalCases) * 100).toFixed(1);
    console.log(`    ${cat}: ${count} (${pct}%)`);
  }
  console.log(`\n  Report saved to: ${REPORT_FILE}`);
  console.log('══════════════════════════════════════════════════');

  // Exit with error code if critical issues found
  if (report.bySeverity.critical > 0) {
    console.log(`\n⚠️  ${report.bySeverity.critical} CRITICAL issues found. Review validation_report.json.`);
  }
}

main();
