/**
 * PRAXIS — Zero-Trust Ingestion Schemas (Zod v4)
 * Validates raw source data BEFORE parsing. Fail-Fast > Fail-Silent.
 * 
 * Usage: import { validateMedMCQA, validateMedQA, ... } from './schemas.js';
 */
import { z } from 'zod';

// ═══════════════════════════════════════
// MEDMCQA — THE CHRONIC PROBLEM CHILD
// `cop` has drifted across upstream snapshots. We accept 0-4 here and let
// parse-all.js detect whether the batch is 0-indexed or 1-indexed.
// ═══════════════════════════════════════
export const MedMCQAItemSchema = z.object({
  question: z.string().min(5, 'Question too short'),
  opa: z.string().min(1, 'Option A empty'),
  opb: z.string().optional().default(''),
  opc: z.string().optional().default(''),
  opd: z.string().optional().default(''),
  cop: z.coerce.number().int().min(0).max(4, 'FATAL: cop must be in [0-4]. Upstream schema likely drifted.'),
  exp: z.string().optional().default(''),
  subject_name: z.string().optional().default(''),
  topic_name: z.string().optional().default(''),
  id: z.union([z.string(), z.number()]).optional(),
});

// ═══════════════════════════════════════
// MEDQA (USMLE)
// answer_idx or answer identifies correct option
// ═══════════════════════════════════════
export const MedQAItemSchema = z.object({
  question: z.string().min(10, 'Question too short'),
  options: z.record(z.string(), z.string()).refine(
    opts => Object.keys(opts).length >= 2,
    'Must have at least 2 options'
  ),
  answer_idx: z.string().regex(/^[A-E]$/, 'answer_idx must be A-E').optional(),
  answer: z.string().optional(),
  meta_info: z.string().optional().default(''),
  explanation: z.string().optional().default(''),
}).refine(
  item => item.answer_idx || item.answer,
  'Must have either answer_idx or answer'
);

// ═══════════════════════════════════════
// PUBMEDQA
// ═══════════════════════════════════════
export const PubMedQAItemSchema = z.object({
  question: z.string().min(5),
  context: z.union([z.string(), z.array(z.string())]).optional(),
  long_answer: z.string().optional().default(''),
  final_decision: z.string().optional(),
});

// ═══════════════════════════════════════
// HEADQA (Spanish/English medical exam)
// answer key is 1-indexed (ra field)
// ═══════════════════════════════════════
export const HeadQAItemSchema = z.object({
  qtext: z.string().min(5),
  answers: z.array(z.object({
    aid: z.coerce.number(),
    atext: z.string(),
  })).min(2),
  ra: z.coerce.number().int().min(1).max(5, 'ra must be 1-indexed [1-5]'),
});

// ═══════════════════════════════════════
// MMLU (Multiple format variants)
// ═══════════════════════════════════════
export const MMLUItemSchema = z.object({
  question: z.string().min(3),
  choices: z.array(z.string()).min(2).optional(),
  A: z.string().optional(),
  B: z.string().optional(),
  C: z.string().optional(),
  D: z.string().optional(),
  answer: z.union([z.string(), z.number()]),
}).passthrough();

// ═══════════════════════════════════════
// UKMPPD (Indonesian medical exam)
// ═══════════════════════════════════════
export const UKMPPDItemSchema = z.object({
  question: z.string().min(5),
  options: z.record(z.string(), z.string()).optional(),
  answer: z.string().optional(),
  explanation: z.string().optional().default(''),
}).passthrough();

// ═══════════════════════════════════════
// VALIDATION RUNNER
// Validates array of items, returns { valid, invalid, errors }
// ═══════════════════════════════════════
export function validateBatch(items, schema, sourceName) {
  const valid = [];
  const invalid = [];
  const errors = [];

  for (let i = 0; i < items.length; i++) {
    const result = schema.safeParse(items[i]);
    if (result.success) {
      valid.push(result.data);
    } else {
      invalid.push({ index: i, item: items[i], errors: result.error.issues });
      if (errors.length < 5) {
        errors.push({
          index: i,
          issues: result.error.issues.map(e => `${e.path.join('.')}: ${e.message}`),
        });
      }
    }
  }

  const pct = ((valid.length / items.length) * 100).toFixed(1);
  console.log(`  🛡️ [Zod] ${sourceName}: ${valid.length}/${items.length} passed (${pct}%) | ${invalid.length} rejected`);
  
  if (errors.length > 0) {
    console.log(`  ⚠️  Sample errors:`);
    errors.forEach(e => e.issues.forEach(i => console.log(`     [#${e.index}] ${i}`)));
  }

  // FAIL-FAST: If >20% invalid, something is catastrophically wrong with the source
  if (invalid.length > items.length * 0.2) {
    throw new Error(
      `🔴 ZERO-TRUST BREACH: ${sourceName} has ${invalid.length}/${items.length} invalid items (${(100-parseFloat(pct)).toFixed(1)}%). ` +
      `Source schema may have changed. Aborting pipeline to prevent data poisoning.`
    );
  }

  return { valid, invalid, errors };
}
