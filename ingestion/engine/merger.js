/**
 * MedCase Pro — Frankenstein Merge Engine
 * 
 * Transforms destructive dedup into Symbiotic Data Enrichment.
 * 
 * 5 Hacks (tuned):
 *   1. Order-Agnostic Bipartite Hashing — immune to shuffled options
 *   2. Frankenstein Grafting — harvest explanation from donor cases
 *   3. FSRS Tombstone Aliasing — protect student review history
 *   4. Wisdom of the Crowd — consensus boost +0.15/source (max +0.5)
 *   5. Same-Context Only — NO cross-merge USMLE↔UKMPPD (different epidemiology)
 * 
 * Usage: imported by parse-all.js after normalization, before output
 */
import { writeFileSync } from 'fs';
import { join } from 'path';

const OUTPUT_DIR = join(import.meta.dirname, '..', 'output');

// Medical stop words for semantic hashing
const STOP_WORDS = new Set([
  'patient', 'presents', 'years', 'year', 'old', 'with', 'history', 'days', 'hours',
  'which', 'following', 'most', 'likely', 'diagnosis', 'treatment', 'management',
  'step', 'best', 'next', 'what', 'should', 'about', 'the', 'and', 'for', 'was',
  'were', 'from', 'that', 'this', 'have', 'been', 'would', 'could', 'does', 'will',
  'more', 'than', 'other', 'each', 'after', 'before', 'during', 'between', 'into',
  'such', 'when', 'where', 'there', 'then', 'also', 'very', 'some', 'show', 'shows',
  'revealed', 'examination', 'physical', 'findings', 'found', 'noted', 'report',
]);

// Placeholder explanation patterns
const PLACEHOLDER_PATTERNS = [
  'see reference for detailed explanation',
  'explanation unavailable',
  'no explanation available',
  'refer to textbook',
];

function isPlaceholderExplanation(text) {
  if (!text || text.length < 20) return true;
  const lower = text.toLowerCase().trim();
  return PLACEHOLDER_PATTERNS.some((p) => lower.includes(p));
}

/**
 * 🔥 Hack 1: Semantic hash — 8 longest medical jargon words, sorted alphabetically
 */
function getSemanticHash(text) {
  if (!text || text.length < 30) return '';
  const words = text.toLowerCase().replace(/[^a-z]+/g, ' ').split(/\s+/)
    .filter((w) => w.length > 4 && !STOP_WORDS.has(w));
  const jargon = [...new Set(words)].sort((a, b) => b.length - a.length).slice(0, 8);
  if (jargon.length < 4) return '';
  return jargon.sort().join('_');
}

/**
 * 🔥 Hack 1b: Order-agnostic options hash — immune to shuffled A/B/C/D
 */
function getOptionsHash(options) {
  if (!Array.isArray(options) || options.length < 2) return '';
  return options
    .map((o) => (o.text || '').toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 30))
    .filter((t) => t.length > 3)
    .sort()
    .join('_');
}

/**
 * Get exam context for same-context-only merging
 * 🔥 Hack 5: UKMPPD and USMLE are DIFFERENT contexts — never merge across them
 */
function getExamContext(c) {
  const examType = c.meta?.examType || 'BOTH';
  if (examType === 'UKMPPD') return 'UKMPPD';
  if (examType === 'USMLE') return 'USMLE';
  return 'BOTH'; // "BOTH" can merge with either
}

function canMerge(contextA, contextB) {
  if (contextA === 'BOTH' || contextB === 'BOTH') return true;
  return contextA === contextB; // Only same context
}

/**
 * Main merge function
 * @param {Array} cases — normalized cases from parse-all.js
 * @returns {Array} — merged golden records
 */
export function executeFrankensteinMerge(cases) {
  const t0 = Date.now();
  console.log('\n══════════════════════════════════════');
  console.log(' 🧬 FRANKENSTEIN MERGE ENGINE');
  console.log('══════════════════════════════════════');
  console.log(`  Input: ${cases.length.toLocaleString()} cases\n`);

  const clusters = new Map();
  const stats = {
    duplicatesAbsorbed: 0,
    graftedExplanations: 0,
    graftedPearls: 0,
    consensusBoosts: 0,
    crossContextSkipped: 0,
  };

  // ═══════════════════════════
  // PHASE 1: CLUSTERING
  // ═══════════════════════════
  const unclustered = [];

  for (const c of cases) {
    const text = `${c.vignette?.narrative || ''} ${c.prompt || ''}`;
    const semHash = getSemanticHash(text);

    if (!semHash) {
      unclustered.push(c);
      continue;
    }

    const optHash = getOptionsHash(c.options);
    const clusterId = `${semHash}::${optHash}`;

    if (!clusters.has(clusterId)) clusters.set(clusterId, []);
    clusters.get(clusterId).push(c);
  }

  // ═══════════════════════════
  // PHASE 2: MERGE
  // ═══════════════════════════
  const goldenRecords = [...unclustered]; // Keep unclustered as-is
  const redirectMap = {};

  for (const group of clusters.values()) {
    if (group.length === 1) {
      goldenRecords.push(group[0]);
      continue;
    }

    // 🔥 Hack 5: Check context compatibility — split if cross-context
    const contextGroups = new Map();
    for (const c of group) {
      const ctx = getExamContext(c);
      if (!contextGroups.has(ctx)) contextGroups.set(ctx, []);
      contextGroups.get(ctx).push(c);
    }

    // If we have both UKMPPD and USMLE in same cluster → DON'T merge them
    const hasUKMPPD = contextGroups.has('UKMPPD');
    const hasUSMLE = contextGroups.has('USMLE');
    const hasBOTH = contextGroups.has('BOTH');

    let mergeGroups;
    if (hasUKMPPD && hasUSMLE) {
      // Cross-context: keep both as separate groups
      stats.crossContextSkipped += Math.min(
        contextGroups.get('UKMPPD').length,
        contextGroups.get('USMLE').length
      );

      mergeGroups = [];
      // UKMPPD group: merge among themselves + BOTH
      const ukmppdCases = [...(contextGroups.get('UKMPPD') || []), ...(hasBOTH ? contextGroups.get('BOTH') : [])];
      if (ukmppdCases.length > 0) mergeGroups.push(ukmppdCases);

      // USMLE group: merge among themselves (BOTH already used above)
      const usmleCases = contextGroups.get('USMLE') || [];
      if (usmleCases.length > 0) mergeGroups.push(usmleCases);
    } else {
      // Same context or all BOTH: merge normally
      mergeGroups = [group];
    }

    // Process each merge group
    for (const mergeGroup of mergeGroups) {
      if (mergeGroup.length === 1) {
        goldenRecords.push(mergeGroup[0]);
        continue;
      }

      // Sort: highest confidence first
      mergeGroup.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));

      const host = { ...mergeGroup[0] };
      host.aliases = [...(host.aliases || [])];
      host.meta = { ...host.meta };
      host.meta.merged_sources = [host.meta.source || 'unknown'];
      host.rationale = { ...(host.rationale || {}) };

      let consensusVotes = 0;

      // Graft from donors
      for (let i = 1; i < mergeGroup.length; i++) {
        const donor = mergeGroup[i];
        stats.duplicatesAbsorbed++;

        // 🔥 Hack 3: FSRS Tombstone — use hash_id for aliasing
        const donorId = donor.hash_id || `case_${donor._id}`;
        host.aliases.push(donorId);
        if (donor._id !== undefined) {
          redirectMap[donorId] = host.hash_id || `case_${host._id}`;
        }

        // Track sources
        const donorSource = donor.meta?.source || 'unknown';
        if (!host.meta.merged_sources.includes(donorSource)) {
          host.meta.merged_sources.push(donorSource);
          consensusVotes++;
        }

        // 🔥 Hack 2: Graft explanation if host has placeholder
        if (isPlaceholderExplanation(host.rationale.correct) && !isPlaceholderExplanation(donor.rationale?.correct)) {
          host.rationale.correct = donor.rationale.correct;
          host.rationale._grafted_from = donorSource;
          stats.graftedExplanations++;
        }

        // Graft pearl
        if ((!host.rationale.pearl || host.rationale.pearl.length < 5) && donor.rationale?.pearl?.length > 5) {
          host.rationale.pearl = donor.rationale.pearl;
          stats.graftedPearls++;
        }

        // Graft distractor explanations
        if (donor.rationale?.distractors && typeof donor.rationale.distractors === 'object') {
          host.rationale.distractors = host.rationale.distractors || {};
          for (const [key, text] of Object.entries(donor.rationale.distractors)) {
            if (!host.rationale.distractors[key] && text) {
              host.rationale.distractors[key] = text;
            }
          }
        }

        // Graft tags (set union)
        if (Array.isArray(donor.meta?.tags) && donor.meta.tags.length > 0) {
          host.meta.tags = [...new Set([...(host.meta.tags || []), ...donor.meta.tags])];
        }
      }

      // 🔥 Hack 4: Wisdom of the Crowd (tuned: +0.15/source, max +0.5)
      if (consensusVotes > 0) {
        const bonus = Math.min(0.5, consensusVotes * 0.15);
        host.confidence = Math.min(5.0, (host.confidence || 3.0) + bonus);
        host.meta.is_high_yield = true;
        host.meta.consensus_sources = host.meta.merged_sources.length;
        stats.consensusBoosts++;
      }

      goldenRecords.push(host);
    }
  }

  // Save redirect map for frontend FSRS rescue
  const redirectPath = join(OUTPUT_DIR, 'redirect_map.json');
  writeFileSync(redirectPath, JSON.stringify(redirectMap, null, 2));

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`  ✅ MERGE COMPLETE in ${elapsed}s`);
  console.log(`  📉 Absorbed: ${stats.duplicatesAbsorbed} duplicate cases`);
  console.log(`  💉 Grafted: ${stats.graftedExplanations} explanations, ${stats.graftedPearls} pearls`);
  console.log(`  🚀 Consensus boost: ${stats.consensusBoosts} cases marked high-yield`);
  console.log(`  🛡️ Cross-context preserved: ${stats.crossContextSkipped} (UKMPPD≠USMLE)`);
  console.log(`  🔗 Redirect map: ${Object.keys(redirectMap).length} tombstone aliases`);
  console.log(`  📦 Output: ${goldenRecords.length.toLocaleString()} golden records\n`);

  return goldenRecords;
}
