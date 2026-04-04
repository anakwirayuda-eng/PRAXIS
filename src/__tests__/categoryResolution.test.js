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

  it('promotes low-confidence polish-ldek-en dental items when runner-up noise is minimal', () => {
    const updated = applyResolvedCategory({
      source: 'polish-ldek-en',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'PLK-IPD-MCQ-00006',
      title: 'The Preventive Resin Restoration (PRR) type I method is based on:',
      prompt: 'Choose the single best answer.',
      options: [
        { option_text: 'etching the enamel and sealing pits and fissures.' },
        { option_text: 'systemic antibiotic prophylaxis.' },
        { option_text: 'intravenous hydration only.' },
      ],
      meta: { tags: ['LDEK'] },
    });

    expect(updated.category).toBe('Kedokteran Gigi');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.base_confidence).toBe('low');
    expect(updated.meta.category_resolution.promotion_rule).toBe('polish_ldek_dental_runner2');
  });

  it('promotes consensus-backed polish-ldek-en dental cases even when raw metadata is wildly wrong', () => {
    const updated = applyResolvedCategory({
      source: 'polish-ldek-en',
      category: 'Mata',
      case_code: 'PLK-MTA-MCQ-00014',
      title: 'To detect an approximal caries, apart from the traditional visual and tactile methods:',
      prompt: 'Choose the single best answer.',
      vignette: {
        narrative: 'Caries detection in dental practice requires careful clinical evaluation.',
      },
      meta: {
        tags: ['LDEK'],
      },
    });

    expect(updated.category).toBe('Kedokteran Gigi');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.promotion_rule).toBe('polish_ldek_dental_consensus4');
  });

  it('promotes targeted tw-medqa category rescues with sharp low-runner-up signals', () => {
    const updated = applyResolvedCategory({
      source: 'tw-medqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'TWM-IPD-MCQ-00081',
      title: 'PCR is one of the greatest discoveries of the twentieth century.',
      prompt: 'Pilih jawaban yang paling tepat.',
      options: [
        { option_text: 'DNA template' },
        { option_text: 'heat stable polymerase' },
        { option_text: 'RNA primer only' },
      ],
      meta: { tags: ['Taiwan'] },
    });

    expect(updated.category).toBe('Biokimia');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.promotion_rule).toBe('tw_medqa_targeted_runner2');
  });

  it('promotes targeted pubmedqa specialty rescues when the winning signal is sharp and uncontested', () => {
    const updated = applyResolvedCategory({
      source: 'pubmedqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'PMQ-IPD-MCQ-00018',
      title: 'Specialist categorization check',
      prompt: 'Does the specialty signal remain decisive?',
      vignette: {
        narrative: 'The abstract discusses study outcomes without adding extra specialty keywords.',
      },
      meta: {
        organ_system: 'pharmacology',
      },
    });

    expect(updated.category).toBe('Farmakologi');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.promotion_rule).toBe('pubmedqa_targeted_runner2');
  });

  it('scores meta-only subject/topic fields the same way as top-level fields', () => {
    const topLevel = resolveCaseCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-00002',
      title: 'True regarding lag phase is',
      subject: 'Microbiology',
      topic: 'microbiology',
      meta: { tags: ['microbiology'] },
    });

    const metaOnly = resolveCaseCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-00002',
      title: 'True regarding lag phase is',
      meta: {
        subject: 'Microbiology',
        topic: 'microbiology',
        tags: ['microbiology'],
      },
    });

    expect(metaOnly.resolved_category).toBe(topLevel.resolved_category);
    expect(metaOnly.confidence).toBe(topLevel.confidence);
    expect(metaOnly.runner_up_score).toBe(topLevel.runner_up_score);
    expect(metaOnly.winning_signals).toEqual(topLevel.winning_signals);
  });

  it('treats string vignettes the same as narrative objects for scoring', () => {
    const objectVignette = resolveCaseCategory({
      source: 'pubmedqa',
      category: 'Ilmu Kesehatan Masyarakat',
      vignette: {
        narrative: 'Bone anchor fixation was used during the surgical repair.',
      },
      meta: {
        topic_keywords: ['bone'],
      },
    });

    const stringVignette = resolveCaseCategory({
      source: 'pubmedqa',
      category: 'Ilmu Kesehatan Masyarakat',
      vignette: 'Bone anchor fixation was used during the surgical repair.',
      meta: {
        topic_keywords: ['bone'],
      },
    });

    expect(stringVignette.resolved_category).toBe(objectVignette.resolved_category);
    expect(stringVignette.confidence).toBe(objectVignette.confidence);
    expect(stringVignette.winning_signals).toEqual(objectVignette.winning_signals);
  });
});
