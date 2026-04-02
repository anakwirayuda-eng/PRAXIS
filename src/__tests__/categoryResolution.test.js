import { describe, expect, it } from 'vitest';
import { applyResolvedCategory, resolveCaseCategory, UNCLASSIFIED_CATEGORY } from '../data/categoryResolution.js';

describe('categoryResolution', () => {
  it('resolves clear dental cases away from generic surgery labels', () => {
    const resolved = resolveCaseCategory({
      category: 'Bedah',
      case_code: 'MMC-BDH-MCQ-00010',
      title: 'Which of the following is true about calcification of teeth',
      meta: { tags: ['dental'] },
    });

    expect(resolved.resolved_category).toBe('Kedokteran Gigi');
    expect(resolved.category_conflict).toBe(true);
    expect(resolved.confidence).toBe('high');
  });

  it('resolves ophthalmology content even when the case code prefix says IPD', () => {
    const resolved = resolveCaseCategory({
      category: 'Mata',
      case_code: 'MMC-IPD-MCQ-00016',
      title: 'Which of the following is true statement regarding human eye',
      meta: { tags: ['ophthalmology'] },
    });

    expect(resolved.resolved_category).toBe('Mata');
    expect(resolved.confidence).toBe('high');
  });

  it('auto-fixes high-confidence pharmacology conflicts from stale IPD labels', () => {
    const updated = applyResolvedCategory({
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-00068',
      title: 'DNA dependent RNA synthesis is inhibited by which of the following drug?',
      meta: { tags: ['pharmacology'] },
    });

    expect(updated.category).toBe('Farmakologi');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.resolved_category).toBe('Farmakologi');
  });

  it('sends unknown categories to Unclassified instead of IPD fallback', () => {
    const updated = applyResolvedCategory({
      category: 'totally-unknown-bucket',
      title: 'Generic question with no strong specialty clues',
      prompt: 'Choose the best answer.',
      meta: { tags: [] },
    });

    expect(updated.category).toBe(UNCLASSIFIED_CATEGORY);
    expect(updated.meta.category_review_needed).toBe(true);
  });

  it('trusts pediatric content signals over noisy raw OBG labels in pedmedqa', () => {
    const resolved = resolveCaseCategory({
      source: 'pedmedqa',
      category: 'Obstetri & Ginekologi',
      case_code: 'PMD-OBG-MCQ-00196',
      title: 'A 17-year-old boy presents to the emergency department',
      vignette: {
        narrative: 'High-altitude illness in an adolescent patient with cough, dyspnea, hemoptysis, and vomiting.',
      },
      meta: {
        organ_system: 'pediatrics',
        topic_keywords: ['pediatrics'],
      },
    });

    expect(resolved.resolved_category).toBe('Ilmu Kesehatan Anak');
    expect(resolved.confidence).toBe('high');
  });

  it('rescues obvious dentistry items from stale IPD labels in polish-ldek-en', () => {
    const updated = applyResolvedCategory({
      source: 'polish-ldek-en',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'PLK-IPD-MCQ-00268',
      title: 'Which of the following can be used to isolate the tooth with inadequate coronal structure?',
      prompt: 'Choose the single best answer.',
      options: [
        { option_text: 'deep-reaching clamps.' },
        { option_text: 'placement of orthodontic bands.' },
        { option_text: 'gingivectomy.' },
      ],
      meta: { tags: ['LDEK', 'Poland'] },
    });

    expect(updated.category).toBe('Kedokteran Gigi');
    expect(updated.meta.category_review_needed).toBe(false);
  });
});
