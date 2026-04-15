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

  it('promotes headqa biochemistry rescues when IPD labels lose cleanly to biochem consensus', () => {
    const updated = applyResolvedCategory({
      source: 'headqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'HQA-IPD-MCQ-00163',
      title: 'Which enzyme uses FAD as a coenzyme',
      prompt: 'Which enzyme uses FAD as a coenzyme?',
      vignette: {
        narrative: 'Which enzyme uses FAD as a coenzyme?',
      },
      meta: {
        source: 'headqa',
        tags: ['general-medicine'],
      },
    });

    expect(updated.category).toBe('Biokimia');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.base_confidence).toBe('medium');
    expect(updated.meta.category_resolution.promotion_rule).toBe('headqa_biochemistry_consensus2');
  });

  it('promotes medqa pediatric cases when the raw label, pediatric tags, and infant wording all agree', () => {
    const updated = applyResolvedCategory({
      source: 'medqa',
      category: 'Ilmu Kesehatan Anak',
      case_code: 'MQA-GEN-MCQ-00022',
      title: 'A 3000-g female newborn is delivered at term with a continuous heart murmur',
      prompt: 'Which of the following is the most likely diagnosis for this patient?',
      vignette: {
        narrative: 'A female newborn is delivered at term with a continuous cardiac murmur, cloudy lenses, and hearing loss.',
      },
      meta: {
        source: 'medqa',
        tags: ['pediatrics', 'cardiology'],
        organ_system: 'cardiovascular',
        topic_keywords: ['heart', 'cardiac', 'murmur', 'cardiology'],
      },
    });

    expect(updated.category).toBe('Ilmu Kesehatan Anak');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.base_confidence).toBe('high');
    expect(updated.meta.category_resolution.promotion_rule).toBe(null);
  });

  it('promotes medqa surgery cases when raw category and surgical context stay aligned', () => {
    const updated = applyResolvedCategory({
      source: 'medqa',
      category: 'Bedah',
      case_code: 'MQA-BDH-MCQ-00003',
      title: '38-year-old woman undergoes hemithyroidectomy for treatment of papillary thyroid carcinoma',
      prompt: 'This patient is most likely to experience which of the following symptoms?',
      vignette: {
        narrative: 'A 38-year-old woman undergoes hemithyroidectomy for treatment of localized papillary thyroid carcinoma. During the surgery, a structure adjacent to the superior thyroid artery is damaged.',
      },
      meta: {
        source: 'medqa',
        tags: ['endocrinology', 'oncology', 'surgery', 'dermatology'],
        organ_system: 'dermatology',
      },
    });

    expect(updated.category).toBe('Bedah');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.base_confidence).toBe('high');
    expect(updated.meta.category_resolution.promotion_rule).toBe(null);
  });

  it('honors applied AI adjudication when the item should stay in the current category', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-01001',
      title: 'Which fibrous joint is classified as a syndesmosis?',
      meta: {
        source: 'medmcqa',
        category_review_needed: true,
        category_resolution: {
          raw_category: 'Ilmu Penyakit Dalam',
          raw_normalized_category: 'Ilmu Penyakit Dalam',
          resolved_category: 'Ilmu Penyakit Dalam',
          confidence: 'low',
          category_conflict: true,
          winning_signals: [],
          runner_up_category: 'Bedah',
          runner_up_score: 3,
          prefix: 'IPD',
          promotion_rule: null,
        },
        category_adjudication: {
          status: 'applied',
          playbook: 'category_adjudication',
          decision: 'KEEP_CURRENT',
          recommended_category: 'Ilmu Penyakit Dalam',
          current_category: 'Ilmu Penyakit Dalam',
          runner_up_category: 'Bedah',
          confidence: 'MEDIUM',
        },
      },
    });

    expect(updated.category).toBe('Ilmu Penyakit Dalam');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.adjudication_decision).toBe('KEEP_CURRENT');
    expect(updated.meta.category_resolution.promotion_rule).toBe('ai_category_adjudication_keep_current');
  });

  it('honors applied AI adjudication when the item should promote to the runner-up category', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-01002',
      title: 'Unlocker of the knee joint',
      meta: {
        source: 'medmcqa',
        category_review_needed: true,
        category_resolution: {
          raw_category: 'Ilmu Penyakit Dalam',
          raw_normalized_category: 'Ilmu Penyakit Dalam',
          resolved_category: 'Ilmu Penyakit Dalam',
          confidence: 'low',
          category_conflict: true,
          winning_signals: [],
          runner_up_category: 'Bedah',
          runner_up_score: 3,
          prefix: 'IPD',
          promotion_rule: null,
        },
        category_adjudication: {
          status: 'applied',
          playbook: 'category_adjudication',
          decision: 'PROMOTE_RUNNER_UP',
          recommended_category: 'Bedah',
          current_category: 'Ilmu Penyakit Dalam',
          runner_up_category: 'Bedah',
          confidence: 'MEDIUM',
        },
      },
    });

    expect(updated.category).toBe('Bedah');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.adjudication_decision).toBe('PROMOTE_RUNNER_UP');
    expect(updated.meta.category_resolution.promotion_rule).toBe('ai_category_adjudication_promote_runner_up');
  });

  it('honors applied AI adjudication when a stale runner-up should promote to a distinct target category', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-00107',
      title: 'Mandibular nerve does not supply:',
      meta: {
        source: 'medmcqa',
        category_review_needed: true,
        category_resolution: {
          raw_category: 'Ilmu Penyakit Dalam',
          raw_normalized_category: 'Ilmu Penyakit Dalam',
          resolved_category: 'Kedokteran Gigi',
          confidence: 'low',
          category_conflict: true,
          winning_signals: [],
          runner_up_category: 'Ilmu Penyakit Dalam',
          runner_up_score: 4,
          prefix: 'IPD',
          promotion_rule: null,
        },
        category_adjudication: {
          status: 'applied',
          playbook: 'category_adjudication',
          decision: 'PROMOTE_RUNNER_UP',
          recommended_category: 'Kedokteran Gigi',
          current_category: 'Ilmu Penyakit Dalam',
          target_category: 'Kedokteran Gigi',
          runner_up_category: 'Ilmu Penyakit Dalam',
          confidence: 'HIGH',
        },
      },
    });

    expect(updated.category).toBe('Kedokteran Gigi');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.adjudication_decision).toBe('PROMOTE_RUNNER_UP');
    expect(updated.meta.category_resolution.promotion_rule).toBe('ai_category_adjudication_promote_target');
  });

  it('promotes targeted headqa pharmacology rescues when the content signal clearly beats stale IPD metadata', () => {
    const updated = applyResolvedCategory({
      source: 'headqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'HQA-IPD-MCQ-00999',
      title: 'Receptor pharmacology check',
      prompt: 'Which receptor is targeted by this agonist?',
      vignette: {
        narrative: 'Which receptor is targeted by this agonist during pharmacology testing?',
      },
      meta: {
        source: 'headqa',
      },
    });

    expect(updated.category).toBe('Farmakologi');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.base_confidence).toBe('medium');
    expect(updated.meta.category_resolution.promotion_rule).toBe('headqa_targeted_runner1');
  });

  it('promotes medmcqa pediatric rescues when breast-milk wording beats stale IPD metadata', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-00755',
      title: 'Fatty acid found exclusively in breast milk is:-',
      prompt: 'Fatty acid found exclusively in breast milk is:-',
      vignette: {
        narrative: 'The question asks about a nutrient that is found in breast milk and is specific to infant feeding.',
      },
      meta: {
        source: 'medmcqa',
      },
    });

    expect(updated.category).toBe('Ilmu Kesehatan Anak');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.promotion_rule).toBe('medmcqa_pediatrics_consensus10');
  });

  it('promotes medmcqa surgery rescues when fracture-heavy wording narrowly beats stale IPD metadata', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77777',
      title: 'Fracture management question',
      prompt: 'Which nerve is injured in supracondylar fracture?',
      vignette: {
        narrative: 'A trauma patient has a fracture around the elbow.',
      },
      meta: {
        source: 'medmcqa',
      },
    });

    expect(updated.category).toBe('Bedah');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.promotion_rule).toBe('medmcqa_surgery_consensus10');
  });

  it('promotes medmcqa medicine-tagged pediatrics questions when pediatric metadata and child cues fully agree', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77805',
      prompt: 'Parents of a child with bronchiectasis may give a past history of:',
      vignette: {
        narrative: 'A medicine-tagged child presents with bronchiectasis and the question asks about prior history.',
      },
      meta: {
        source: 'medmcqa',
        subject: 'Medicine',
        tags: ['medicine', 'bronchiectasis'],
        organ_system: 'pediatrics',
        topic_keywords: ['child'],
      },
    });

    expect(updated.category).toBe('Ilmu Kesehatan Anak');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.promotion_rule).toBe('medmcqa_pediatrics_medicine_consensus10');
  });

  it('confirms medmcqa pediatric labels when raw category, subject, and pediatrics tag already agree but runner-up noise keeps them in review', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Kesehatan Anak',
      case_code: 'MMC-GEN-MCQ-77809',
      prompt: 'Which is not true?',
      vignette: {
        narrative: 'ear',
      },
      meta: {
        source: 'medmcqa',
        subject: 'Pediatrics',
        tags: ['pediatrics'],
        organ_system: 'ENT',
        topic_keywords: ['ear'],
      },
    });

    expect(updated.category).toBe('Ilmu Kesehatan Anak');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.promotion_rule).toBe('medmcqa_pediatrics_subject_tag_confirm_consensus10');
  });

  it('confirms medmcqa psychiatry labels when psychiatry metadata already matches the raw bucket and only close runner-up noise remains', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Psikiatri',
      case_code: 'MMC-PSI-MCQ-77810',
      title: 'Subcortical dementia with eye complaint',
      prompt: 'All are causes of subcortical dementia except -',
      meta: {
        source: 'medmcqa',
        subject: 'Psychiatry',
        tags: ['psychiatry'],
        organ_system: 'ophthalmology',
        topic_keywords: ['eye'],
      },
    });

    expect(updated.category).toBe('Psikiatri');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.promotion_rule).toBe('medmcqa_psychiatry_subject_tag_confirm_consensus9');
  });

  it('promotes medmcqa dental pathology stems when explicit caries wording cleanly beats stale IPD metadata', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77811',
      title: 'Positive zone of enamel caries is the:',
      prompt: 'Positive zone of enamel caries is the:',
      vignette: {
        narrative: 'Positive zone of enamel caries is the:',
      },
      meta: {
        source: 'medmcqa',
        subject: 'Pathology',
        tags: ['pathology'],
        organ_system: 'dermatology',
        topic_keywords: ['lesion'],
      },
    });

    expect(updated.category).toBe('Kedokteran Gigi');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.promotion_rule).toBe('medmcqa_dental_exact_phrase_consensus6');
  });

  it('promotes medmcqa dental anatomy stems when TMJ wording keeps oral anatomy ahead of a stale broad runner-up', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77812',
      title: 'Sensory nerve supply of capsule of TMJ is',
      prompt: 'Sensory nerve supply of capsule of TMJ is?',
      vignette: {
        narrative: 'Sensory nerve supply of capsule of TMJ is:',
      },
      meta: {
        source: 'medmcqa',
        subject: 'Anatomy',
        tags: ['anatomy'],
        organ_system: 'general',
      },
    });

    expect(updated.category).toBe('Kedokteran Gigi');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.promotion_rule).toBe('medmcqa_dental_exact_phrase_consensus6');
  });

  it('promotes medmcqa pediatric items when radiology is just a stale modality label but pediatrics metadata clearly owns the case', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Radiologi',
      case_code: 'MMC-GEN-MCQ-77814',
      title: 'Vesicoureteric reflux is diagnosed by:',
      prompt: 'Vesicoureteric reflux is diagnosed by:',
      vignette: {
        narrative: 'Vesicoureteric reflux is diagnosed by:',
      },
      options: [
        { option_text: 'Micturating cystography' },
        { option_text: 'X ray abdomen' },
        { option_text: 'CECT Abdomen' },
        { option_text: 'Intravenous pyelography' },
      ],
      meta: {
        source: 'medmcqa',
        subject: 'Pediatrics',
        tags: ['pediatrics', 'gastro intestinal system'],
        organ_system: 'gastrointestinal',
        topic_keywords: ['intestinal', 'abdomen'],
      },
    });

    expect(updated.category).toBe('Ilmu Kesehatan Anak');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.promotion_rule).toBe('medmcqa_pediatrics_modality_subject_tag_consensus5');
  });

  it('promotes medmcqa dental RVG items when radiology is only the imaging modality and dental metadata remains exact', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Radiologi',
      case_code: 'MMC-BDH-MCQ-77815',
      title: 'All are true about RVG except:',
      prompt: 'All are true about RVG except:',
      vignette: {
        narrative: 'All are true about RVG except:',
      },
      options: [
        { option_text: '80% reduction of patient exposure' },
        { option_text: 'Instant imaging' },
        { option_text: 'Easy storage and retrieval' },
        { option_text: 'Sharper than silver halide' },
      ],
      meta: {
        source: 'medmcqa',
        subject: 'Dental',
        tags: ['dental'],
        organ_system: 'general',
      },
    });

    expect(updated.category).toBe('Kedokteran Gigi');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.promotion_rule).toBe('medmcqa_dental_rvg_modality_consensus5');
  });

  it('keeps medmcqa psychiatry child cases in psychiatry when pediatrics drift only comes from child metadata', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Psikiatri',
      case_code: 'MMC-PSI-MCQ-77816',
      title: 'Stimulant drug is given to child for',
      prompt: 'Stimulant drug is given to child for ?',
      vignette: {
        narrative: 'Stimulant drug is given to child for ?',
      },
      options: [
        { option_text: 'Conduct disorder' },
        { option_text: 'Speech developmental disorder' },
        { option_text: 'Pervasive disorder' },
        { option_text: 'ADHD' },
      ],
      meta: {
        source: 'medmcqa',
        subject: 'Psychiatry',
        tags: ['psychiatry'],
        organ_system: 'pediatrics',
        topic_keywords: ['child'],
      },
    });

    expect(updated.category).toBe('Psikiatri');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.promotion_rule).toBe('medmcqa_psychiatry_child_drift_rescue12');
  });

  it('keeps medmcqa pediatric-surgery stems in surgery when child metadata would otherwise drag them into pediatrics', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Bedah',
      case_code: 'MMC-BDH-MCQ-77817',
      title: 'child with vesicoureteric reflux of grade 2 comes to OPD',
      prompt: 'What is the preferred treatment method',
      vignette: {
        narrative: 'A child with vesicoureteric reflux of grade 2 comes to OPD. What is the preferred treatment method',
      },
      options: [
        { option_text: 'Antibiotics' },
        { option_text: 'Observation' },
        { option_text: 'Sting operation' },
        { option_text: 'Ureteric reimplantation' },
      ],
      meta: {
        source: 'medmcqa',
        subject: 'Surgery',
        tags: ['surgery'],
        organ_system: 'pediatrics',
        topic_keywords: ['child'],
      },
    });

    expect(updated.category).toBe('Bedah');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.promotion_rule).toBe('medmcqa_surgery_child_drift_rescue13');
  });

  it('keeps medmcqa obstetric congenital cases in obgyn when newborn metadata alone would push them into pediatrics', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Obstetri & Ginekologi',
      case_code: 'MMC-OBG-MCQ-77818',
      title: 'woman with a history of repeated abortions gave birth to a low birth weight child',
      prompt: 'The most probable diagnosis is',
      vignette: {
        narrative: 'A woman with a history of repeated abortions gave birth to a low birth weight child',
      },
      options: [
        { option_text: 'Congenital HIV' },
        { option_text: 'Congenital syphilis' },
        { option_text: 'Congenital rubella' },
        { option_text: 'Pemphigus' },
      ],
      meta: {
        source: 'medmcqa',
        subject: 'Gynaecology & Obstetrics',
        tags: ['gynaecology & obstetrics'],
        organ_system: 'pediatrics',
        topic_keywords: ['child', 'congenital'],
      },
    });

    expect(updated.category).toBe('Obstetri & Ginekologi');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.promotion_rule).toBe('medmcqa_obg_child_drift_rescue10');
  });

  it('promotes medmcqa obstetric rescues when placenta wording narrowly beats stale IPD metadata', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77778',
      title: 'Placenta question',
      prompt: 'Which placental exchange is most important?',
      vignette: {
        narrative: 'This pregnancy question asks about placenta physiology.',
      },
      meta: {
        source: 'medmcqa',
      },
    });

    expect(updated.category).toBe('Obstetri & Ginekologi');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.promotion_rule).toBe('medmcqa_obgyn_consensus11');
  });

  it('promotes medmcqa forensic rescues when medicolegal subject metadata cleanly beats stale IPD labels', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77779',
      title: 'IPC 314 deals with?',
      prompt: 'IPC 314 deals with?',
      vignette: {
        narrative: 'A legal question asks about IPC 314 and its implications.',
      },
      meta: {
        source: 'medmcqa',
        subject: 'Forensic Medicine',
        tags: ['forensic medicine'],
        organ_system: 'obstetrics',
        topic_keywords: ['placenta'],
      },
    });

    expect(updated.category).toBe('Forensik');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.promotion_rule).toBe('medmcqa_forensic_subject_tag_consensus9');
  });

  it('promotes medmcqa pharmacology rescues when drug-subject metadata edges out stale broad labels', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77780',
      title: 'All are true about hydroquinone',
      prompt: 'Which of the following is not true about hydroquinone?',
      vignette: {
        narrative: 'This item reviews hydroquinone use and adverse effects.',
      },
      meta: {
        source: 'medmcqa',
        subject: 'Pharmacology',
        tags: ['pharmacology'],
        organ_system: 'obstetrics',
        topic_keywords: ['placenta'],
      },
    });

    expect(updated.category).toBe('Farmakologi');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.promotion_rule).toBe('medmcqa_pharmacology_subject_tag_consensus9');
  });

  it('promotes medmcqa biochemistry exact subject-tag matches when broad IPD labels lag behind clear biochemistry metadata', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77806',
      prompt: 'With help of the drug shown below, serotonin is synthesized from which precursor amino acid?',
      vignette: {
        narrative: 'A drug-related stem asks which precursor amino acid is used to synthesize serotonin.',
      },
      meta: {
        source: 'medmcqa',
        subject: 'Biochemistry',
        tags: ['biochemistry', 'all india exam'],
        organ_system: 'pharmacology',
        topic_keywords: ['drug'],
      },
    });

    expect(updated.category).toBe('Biokimia');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.promotion_rule).toBe('medmcqa_biochemistry_subject_tag_consensus11');
  });

  it('promotes medmcqa radiology rescues when imaging metadata beats stale IPD labels but remains low confidence by score alone', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77781',
      title: 'Radiation dose safe in pregnancy',
      prompt: 'Radiation dose safe in pregnancy is',
      vignette: {
        narrative: 'The question asks about the safe radiation dose threshold during pregnancy.',
      },
      meta: {
        source: 'medmcqa',
        subject: 'Radiology',
        tags: ['radiology'],
        organ_system: 'obstetrics',
        topic_keywords: ['placenta'],
      },
    });

    expect(updated.category).toBe('Radiologi');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.promotion_rule).toBe('medmcqa_radiology_subject_tag_consensus9');
  });

  it('promotes medmcqa anaesthesia exact subject-tag matches when broad IPD labels lag behind clear anaesthesia metadata', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77797',
      prompt: 'For anesthesiology mild systemic disease included in ASA grade-',
      vignette: {
        narrative: 'For anesthesiology mild systemic disease included in ASA grade-',
      },
      meta: {
        source: 'medmcqa',
        subject: 'Anaesthesia',
        tags: ['anaesthesia', 'anaesthesia for special situations'],
      },
    });

    expect(updated.category).toBe('Anestesi & Emergency Medicine');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.promotion_rule).toBe('medmcqa_anaesthesia_subject_tag_consensus7');
  });

  it('promotes medmcqa radiology exact subject-tag matches when x-ray wording keeps imaging ahead of a close surgical runner-up', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77791',
      prompt: 'Which of the following is true regarding the central beam in this x-ray?',
      vignette: {
        narrative: 'The question asks about central beam placement in an x ray projection.',
      },
      meta: {
        source: 'medmcqa',
        subject: 'Radiology',
        tags: ['radiology'],
        organ_system: 'musculoskeletal',
      },
    });

    expect(updated.category).toBe('Radiologi');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.base_confidence).toBe('high');
    expect(updated.meta.category_resolution.resolved_category).toBe('Radiologi');
  });

  it('promotes medmcqa public-health rescues when screening wording backs social medicine metadata', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77782',
      title: 'Community screening question',
      prompt: 'Screening is done because of all except:',
      vignette: {
        narrative: 'A screening program is evaluated as part of public health prevention work.',
      },
      meta: {
        source: 'medmcqa',
        subject: 'Social & Preventive Medicine',
        topic_keywords: ['renal'],
      },
    });

    expect(updated.category).toBe('Ilmu Kesehatan Masyarakat');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.promotion_rule).toBe('medmcqa_public_health_subject_consensus7');
  });

  it('does not treat a generic medicine tag as community medicine when only screening metadata points there', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77807',
      prompt: 'Which of the following is the most specific and sensitive screening test for renovascular hypertension?',
      vignette: {
        narrative: 'The stem asks for the most specific and sensitive screening test for renovascular hypertension.',
      },
      meta: {
        source: 'medmcqa',
        subject: 'Medicine',
        tags: ['medicine', 'all india exam'],
        organ_system: 'public_health',
        topic_keywords: ['screening'],
      },
    });

    expect(updated.category).toBe('Ilmu Penyakit Dalam');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.resolved_category).toBe('Ilmu Penyakit Dalam');
  });

  it('keeps strong epidemiology/public-health wording eligible for public-health resolution even with a generic medicine tag', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77808',
      prompt: 'The true statement about the epidemiology of H. pylori is:',
      vignette: {
        narrative: 'A medicine-tagged item asks about epidemiology and prevalence as a public health question.',
      },
      meta: {
        source: 'medmcqa',
        subject: 'Medicine',
        tags: ['medicine'],
        organ_system: 'public_health',
        topic_keywords: ['epidemiology', 'prevalence'],
      },
    });

    expect(updated.category).toBe('Ilmu Kesehatan Masyarakat');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.resolved_category).toBe('Ilmu Kesehatan Masyarakat');
  });

  it('promotes medmcqa pharmacology exact subject-tag matches when drug wording keeps a broad IPD label only narrowly behind', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77792',
      prompt: 'What should be the dose rate of drug X in this patient?',
      vignette: {
        narrative: 'The clinician asks about the appropriate dose rate of a drug in this patient.',
      },
      meta: {
        source: 'medmcqa',
        subject: 'Pharmacology',
        tags: ['pharmacology'],
        organ_system: 'gastrointestinal',
      },
    });

    expect(updated.category).toBe('Farmakologi');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.base_confidence).toBe('high');
    expect(updated.meta.category_resolution.resolved_category).toBe('Farmakologi');
  });

  it('promotes medmcqa medicine-tagged drug questions when pharmacology organ metadata and textual drug cues fully agree', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77795',
      prompt: 'Drug of choice for treatment of CML is:',
      vignette: {
        narrative: 'Drug of choice for treatment of CML is:',
      },
      meta: {
        source: 'medmcqa',
        subject: 'Medicine',
        tags: ['medicine'],
        organ_system: 'pharmacology',
        topic_keywords: ['drug'],
      },
    });

    expect(updated.category).toBe('Farmakologi');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.promotion_rule).toBe('medmcqa_pharmacology_medicine_consensus10');
  });

  it('promotes medmcqa medicine-tagged neuro questions when neurological organ metadata and sharp neuro cues fully agree', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77796',
      prompt: 'Window period for thrombolysis in a stroke patient is:',
      vignette: {
        narrative: 'Window period for thrombolysis in a stroke patient is:',
      },
      meta: {
        source: 'medmcqa',
        subject: 'Medicine',
        tags: ['medicine'],
        organ_system: 'neurological',
        topic_keywords: ['stroke'],
      },
    });

    expect(updated.category).toBe('Neurologi');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.promotion_rule).toBe('medmcqa_neurology_medicine_consensus10');
  });

  it('promotes medmcqa medicine-tagged ent questions when ent metadata and nasal wording fully agree', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77800',
      prompt: 'In acute rhinitis, nasal drainage normally is:',
      vignette: {
        narrative: 'A medicine-tagged patient with acute rhinitis has nasal drainage findings that guide diagnosis.',
      },
      meta: {
        source: 'medmcqa',
        subject: 'Medicine',
        tags: ['medicine'],
        organ_system: 'ENT',
        topic_keywords: ['nasal'],
      },
    });

    expect(updated.category).toBe('THT');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.promotion_rule).toBe('medmcqa_ent_medicine_consensus10');
  });

  it('promotes medmcqa medicine-tagged psychiatry questions when psychiatry metadata and sharp psych cues fully agree', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77802',
      prompt: 'Characteristic feature of korsakoff psychosis is',
      vignette: {
        narrative: 'A medicine-tagged patient presents with psychosis features characteristic of Korsakoff syndrome.',
      },
      meta: {
        source: 'medmcqa',
        subject: 'Medicine',
        tags: ['medicine'],
        organ_system: 'psychiatry',
        topic_keywords: ['psychosis'],
      },
    });

    expect(updated.category).toBe('Psikiatri');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.promotion_rule).toBe('medmcqa_psychiatry_medicine_consensus10');
  });

  it('promotes medmcqa medicine-tagged ophthalmology questions when eye metadata and sharp eye cues fully agree', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77803',
      prompt: 'The eye movements are normal and she experiences no double vision.',
      vignette: {
        narrative: 'A medicine-tagged patient has an eye complaint with pupillary abnormality and preserved vision.',
      },
      meta: {
        source: 'medmcqa',
        subject: 'Medicine',
        tags: ['medicine', 'c.n.s.'],
        organ_system: 'ophthalmology',
        topic_keywords: ['eye', 'vision'],
      },
    });

    expect(updated.category).toBe('Mata');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.promotion_rule).toBe('medmcqa_ophthalmology_medicine_consensus10');
  });

  it('promotes medmcqa ophthalmology exact subject-tag matches when broad IPD labels lag behind clean eye metadata', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77804',
      prompt: 'The only cranial nerve which supplies a contralateral muscle is-',
      vignette: {
        narrative: 'This item asks which cranial nerve supplies a contralateral muscle.',
      },
      meta: {
        source: 'medmcqa',
        subject: 'Ophthalmology',
        tags: ['ophthalmology'],
        organ_system: 'musculoskeletal',
      },
    });

    expect(updated.category).toBe('Mata');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.promotion_rule).toBe('medmcqa_ophthalmology_subject_tag_consensus7');
  });

  it('keeps radiology-tagged sinus x-ray questions in review when ent overlap stays too strong for auto-promotion', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77801',
      prompt: 'If the patient’s mouth is open during x-ray, the sphenoid sinus is seen superimposed over-',
      vignette: {
        narrative: 'A radiology question asks about an x ray view where the sphenoid sinus is superimposed.',
      },
      meta: {
        source: 'medmcqa',
        subject: 'Radiology',
        tags: ['radiology'],
        organ_system: 'ENT',
        topic_keywords: ['sinusitis', 'nasal'],
      },
    });

    expect(updated.category).toBe('Ilmu Penyakit Dalam');
    expect(updated.meta.category_review_needed).toBe(true);
    expect(updated.meta.category_resolution.promotion_rule).toBe(null);
  });

  it('promotes medmcqa public-health exact subject-tag matches even when broad raw metadata still says IPD', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77786',
      prompt: 'Function of PHC are-',
      vignette: {
        narrative: 'Function of PHC are-',
      },
      meta: {
        source: 'medmcqa',
        subject: 'Social & Preventive Medicine',
        tags: ['social & preventive medicine', 'health care of community & international health'],
      },
    });

    expect(updated.category).toBe('Ilmu Kesehatan Masyarakat');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.base_confidence).toBe('low');
    expect(updated.meta.category_resolution.promotion_rule).toBe('medmcqa_public_health_subject_tag_consensus7');
  });

  it('promotes medmcqa dental exact subject-tag matches over noisy pediatric signals in pediatric dentistry items', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Bedah',
      case_code: 'MMC-BDH-MCQ-77787',
      prompt: '1st dental visit of the child should be at the age of:',
      vignette: {
        narrative: 'A pediatric dentistry question asks the ideal age of the first dental visit for a child.',
      },
      meta: {
        source: 'medmcqa',
        subject: 'Dental',
        tags: ['dental'],
        organ_system: 'pediatrics',
        topic_keywords: ['child'],
      },
    });

    expect(updated.category).toBe('Kedokteran Gigi');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.base_confidence).toBe('low');
    expect(updated.meta.category_resolution.promotion_rule).toBe('medmcqa_dental_subject_tag_consensus12');
  });

  it('promotes medmcqa dental exact subject-tag matches even when the last supporting cue sits inside answer options', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Bedah',
      case_code: 'MMC-BDH-MCQ-77788',
      prompt: 'All of the following are true for light cure composite except:',
      options: [
        { option_text: 'Tooth discoloration is avoided by careful finishing.' },
        { option_text: 'Composite curing is unaffected by visible light.' },
      ],
      meta: {
        source: 'medmcqa',
        subject: 'Dental',
        tags: ['dental'],
        organ_system: 'ophthalmology',
      },
    });

    expect(updated.category).toBe('Kedokteran Gigi');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.base_confidence).toBe('high');
    expect(updated.meta.category_resolution.resolved_category).toBe('Kedokteran Gigi');
  });

  it('promotes medmcqa public-health exact subject-tag matches up to the broader surveillance runner-up band', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77789',
      prompt: 'WHO surveillance is done in all except',
      vignette: {
        narrative: 'WHO surveillance is done in all except.',
      },
      meta: {
        source: 'medmcqa',
        subject: 'Social & Preventive Medicine',
        tags: ['social & preventive medicine'],
        organ_system: 'infectious',
      },
    });

    expect(updated.category).toBe('Ilmu Kesehatan Masyarakat');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.base_confidence).toBe('low');
    expect(updated.meta.category_resolution.promotion_rule).toBe('medmcqa_public_health_subject_tag_consensus7');
  });

  it('does not misread accidental as a dental signal inside broader words', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77783',
      prompt: 'The industry with the highest accidental death rate is',
      vignette: {
        narrative: 'The industry with the highest accidental death rate is asked here.',
      },
      meta: {
        source: 'medmcqa',
      },
    });

    expect(updated.category).toBe('Ilmu Penyakit Dalam');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.resolved_category).toBe('Ilmu Penyakit Dalam');
  });

  it('does not misread incidental skin wording as a dermatology category rescue', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77790',
      prompt: 'Deposition of Anti ds DNA Ab in kidney, skin, choroid plexus and joints is seen in:',
      vignette: {
        narrative: 'Deposition of Anti ds DNA Ab in kidney, skin, choroid plexus and joints is seen in.',
      },
      meta: {
        source: 'medmcqa',
        organ_system: 'dermatology',
        subject: 'Medicine',
        tags: ['medicine'],
      },
    });

    expect(updated.category).toBe('Ilmu Penyakit Dalam');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.resolved_category).toBe('Ilmu Penyakit Dalam');
  });

  it('does not misread carotid sinus anatomy as an ent rescue', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77791',
      prompt: 'Carotid sinus/baroreceptor is located at the origin of',
      vignette: {
        narrative: 'Carotid sinus baroreceptor is located at the origin of which vessel?',
      },
      meta: {
        source: 'medmcqa',
      },
    });

    expect(updated.category).toBe('Ilmu Penyakit Dalam');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.resolved_category).toBe('Ilmu Penyakit Dalam');
  });

  it('does not misread year-old OCR splits as an ear ent rescue', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77792',
      prompt: 'A 6-y ear-old girl presented with abdominal pain after admission.',
      vignette: {
        narrative: 'A 6-y ear-old girl presented with abdominal pain after admission.',
      },
      meta: {
        source: 'medmcqa',
        organ_system: 'ENT',
        topic_keywords: ['ear'],
      },
    });

    expect(updated.category).toBe('Ilmu Penyakit Dalam');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.resolved_category).toBe('Ilmu Penyakit Dalam');
  });

  it('does not misread osmolarity as a molar-tooth keyword', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77784',
      prompt: 'Maximum contribution of plasma osmolarity is by',
      vignette: {
        narrative: 'Maximum contribution of plasma osmolarity is by.',
      },
      meta: {
        source: 'medmcqa',
      },
    });

    expect(updated.category).toBe('Ilmu Penyakit Dalam');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.resolved_category).toBe('Ilmu Penyakit Dalam');
  });

  it('does not route multidrug-resistant epidemiology questions into pharmacology just because they contain the word drug', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77793',
      prompt: "Over 60% of the world's Multi Drug Resistant TB cases are seen in which of the following countries?",
      vignette: {
        narrative: "Over 60% of the world's Multi Drug Resistant TB cases are seen in which of the following countries?",
      },
      meta: {
        source: 'medmcqa',
        subject: 'Medicine',
        tags: ['medicine'],
        organ_system: 'pharmacology',
        topic_keywords: ['drug'],
      },
    });

    expect(updated.category).toBe('Ilmu Penyakit Dalam');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.resolved_category).toBe('Ilmu Penyakit Dalam');
  });

  it('lets microbiology dose questions escape noisy medmcqa pharmacology metadata', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77794',
      prompt: 'Infective dose of salmonella typhi ?',
      vignette: {
        narrative: 'Infective dose of salmonella typhi ?',
      },
      meta: {
        source: 'medmcqa',
        subject: 'Microbiology',
        tags: ['microbiology'],
        organ_system: 'pharmacology',
        topic_keywords: ['dose'],
      },
    });

    expect(updated.category).toBe('Mikrobiologi');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.resolved_category).toBe('Mikrobiologi');
  });

  it('does not expand generic ectopic topic keywords into obstetric category matches', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77795',
      prompt: 'Most common site for ectopic salivary gland tumour is:',
      vignette: {
        narrative: 'Most common site for ectopic salivary gland tumour is:',
      },
      meta: {
        source: 'medmcqa',
        subject: 'Pathology',
        tags: ['pathology'],
        organ_system: 'obstetrics',
        topic_keywords: ['ectopic'],
      },
    });

    expect(updated.category).toBe('Patologi Anatomi');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.resolved_category).toBe('Patologi Anatomi');
  });

  it('does not expand generic pregnancy topic keywords into ectopic pregnancy category matches', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77796',
      prompt: 'Highest LAP score is seen in -',
      vignette: {
        narrative: 'Highest leukocyte alkaline phosphatase score is seen in which condition?',
      },
      meta: {
        source: 'medmcqa',
        subject: 'Pathology',
        tags: ['pathology'],
        organ_system: 'obstetrics',
        topic_keywords: ['pregnancy'],
      },
    });

    expect(updated.category).toBe('Patologi Anatomi');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.resolved_category).toBe('Patologi Anatomi');
  });

  it('does not expand generic dose topic keywords into pharmacology category matches', () => {
    const resolved = resolveCaseCategory({
      source: 'medqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MQA-IPD-MCQ-77797',
      prompt: 'Radiation exposure varies with cumulative dose over time.',
      vignette: {
        narrative: 'The discussion focuses on epidemiologic radiation exposure and cumulative dose.',
      },
      meta: {
        source: 'medqa',
        topic_keywords: ['dose'],
      },
    });

    expect(resolved.resolved_category).toBe('Ilmu Penyakit Dalam');
    expect(resolved.category_conflict).toBe(false);
  });

  it('suppresses noisy medmcqa anatomy metadata when a broad raw label lacks real anatomy evidence', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77785',
      prompt: 'Pharmacodynamics includes',
      vignette: {
        narrative: 'Pharmacodynamics includes.',
      },
      meta: {
        source: 'medmcqa',
        subject: 'Anatomy',
        tags: ['anatomy'],
      },
    });

    expect(updated.category).toBe('Ilmu Penyakit Dalam');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.resolved_category).toBe('Ilmu Penyakit Dalam');
  });

  it('suppresses broad medmcqa pathology metadata when dental wording is the real signal', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77798',
      prompt: 'Critical pH for initiation of caries:',
      vignette: {
        narrative: 'Critical pH for initiation of caries is being asked in this dental item.',
      },
      options: [
        { id: 'A', text: 'The saliva stays supersaturated', is_correct: true },
        { id: 'B', text: 'The enamel dissolves after plaque acidification', is_correct: false },
      ],
      meta: {
        source: 'medmcqa',
        subject: 'Pathology',
        tags: ['pathology'],
      },
    });

    expect(updated.category).toBe('Kedokteran Gigi');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.resolved_category).toBe('Kedokteran Gigi');
  });

  it('suppresses broad medmcqa pathology metadata when surgery wording is the real signal', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77799',
      prompt: 'In cleft lip surgery rule of 10 says',
      vignette: {
        narrative: 'This surgery item asks about the cleft lip rule of 10 before operation.',
      },
      meta: {
        source: 'medmcqa',
        subject: 'Pathology',
        tags: ['pathology'],
      },
    });

    expect(updated.category).toBe('Bedah');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.resolved_category).toBe('Bedah');
  });

  it('suppresses broad medmcqa pathology metadata when the item is really a basic biochemistry cue', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77800',
      prompt: 'Enzyme-deficient in Alkaptonuria',
      vignette: {
        narrative: 'The question asks which enzyme is deficient in alkaptonuria.',
      },
      meta: {
        source: 'medmcqa',
        subject: 'Pathology',
        tags: ['pathology'],
      },
    });

    expect(updated.category).toBe('Biokimia');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.resolved_category).toBe('Biokimia');
  });

  it('suppresses broad medmcqa pathology metadata when pap-smear screening context is public-health driven', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77801',
      prompt: 'For diagnosis of carcinoma cervix, PAP smear screening is done to',
      vignette: {
        narrative: 'The screening program aims to prevent progression of cervical disease.',
      },
      options: [
        { id: 'A', text: '100% informative', is_correct: false },
        { id: 'B', text: 'Prevents progress of the disease', is_correct: true },
      ],
      meta: {
        source: 'medmcqa',
        subject: 'Pathology',
        tags: ['pathology'],
        organ_system: 'gynecology',
      },
    });

    expect(updated.category).toBe('Ilmu Kesehatan Masyarakat');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.resolved_category).toBe('Ilmu Kesehatan Masyarakat');
  });

  it('suppresses broad medmcqa pathology metadata when emergency-priority wording is the real signal', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77808',
      prompt: 'A patient arrives at the emergency department complaining of midsternal chest pain. Which of the following nursing action should take priority?',
      vignette: {
        narrative: 'A patient arrives at the emergency department complaining of midsternal chest pain. Which of the following nursing action should take priority?',
      },
      options: [
        { id: 'A', text: 'A complete history with emphasis on preceding events.', is_correct: false },
        { id: 'B', text: 'An electrocardiogram', is_correct: false },
        { id: 'C', text: 'Careful assessment of vital signs', is_correct: true },
      ],
      meta: {
        source: 'medmcqa',
        subject: 'Pathology',
        tags: ['pathology'],
      },
    });

    expect(updated.category).toBe('Anestesi & Emergency Medicine');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.resolved_category).toBe('Anestesi & Emergency Medicine');
    expect(updated.meta.category_resolution.promotion_rule).toBe('medmcqa_targeted_consensus4');
  });

  it('suppresses broad medmcqa pathology metadata when std wording really belongs to derm-venereology', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77809',
      prompt: 'All of the following are STD except:',
      vignette: {
        narrative: 'This derm-venereology question asks which infection is not an STD.',
      },
      options: [
        { id: 'A', text: 'Herpes', is_correct: false },
        { id: 'B', text: 'Scabies', is_correct: false },
        { id: 'C', text: 'Candida', is_correct: false },
        { id: 'D', text: 'Leprosy', is_correct: true },
      ],
      meta: {
        source: 'medmcqa',
        subject: 'Pathology',
        tags: ['pathology'],
      },
    });

    expect(updated.category).toBe('Kulit & Kelamin');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.resolved_category).toBe('Kulit & Kelamin');
  });

  it('suppresses broad medmcqa pathology metadata when corneal anatomy clearly points to ophthalmology', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77810',
      prompt: 'In which layer of cornea is copper deposited to form a Kayser-Fleischer ring?',
      vignette: {
        narrative: 'Kayser-Fleischer ring in Wilson disease is seen at Descemet membrane in the cornea.',
      },
      meta: {
        source: 'medmcqa',
        subject: 'Pathology',
        tags: ['pathology'],
      },
    });

    expect(updated.category).toBe('Mata');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.resolved_category).toBe('Mata');
  });

  it('suppresses broad medmcqa pathology metadata for paul-bunnell internal-medicine items', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77811',
      prompt: 'Paul-Bunnell test is positive in:',
      vignette: {
        narrative: 'Paul-Bunnell test is positive in infectious mononucleosis.',
      },
      options: [
        { id: 'A', text: 'Infectious mononucleosis', is_correct: true },
        { id: 'B', text: 'Multiple myeloma', is_correct: false },
      ],
      meta: {
        source: 'medmcqa',
        subject: 'Pathology',
        tags: ['pathology'],
      },
    });

    expect(updated.category).toBe('Ilmu Penyakit Dalam');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.resolved_category).toBe('Ilmu Penyakit Dalam');
  });

  it('promotes biopsy-led medmcqa pathology items even without pathology subject metadata', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77802',
      prompt: 'Skin biopsy in leprosy is characterized by:',
      vignette: {
        narrative: 'A skin biopsy in leprosy is characterized by granulomatous change.',
      },
      meta: {
        source: 'medmcqa',
        subject: 'Skin',
        tags: ['skin'],
      },
    });

    expect(updated.category).toBe('Patologi Anatomi');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.resolved_category).toBe('Patologi Anatomi');
    expect(updated.meta.category_resolution.promotion_rule).toBe('medmcqa_pathology_text_runner4');
  });

  it('promotes onion-skin renal biopsy cases into pathology even when ipd clues are strong', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77812',
      prompt: 'The most likely diagnosis is',
      vignette: {
        narrative: 'In a 60-year-old hypertensive male with renal failure, renal biopsy shows onion skin appearance. The most likely diagnosis is',
      },
      options: [
        { id: 'A', text: 'Hyaline arteriosclerosis', is_correct: false },
        { id: 'B', text: 'Hyperplastic arteriosclerosis', is_correct: true },
      ],
      meta: {
        source: 'medmcqa',
        subject: 'Pathology',
        tags: ['pathology'],
        organ_system: 'dermatology',
        topic_keywords: ['skin'],
      },
    });

    expect(updated.category).toBe('Patologi Anatomi');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.resolved_category).toBe('Patologi Anatomi');
    expect(updated.meta.category_resolution.confidence).toBe('high');
  });

  it('promotes peutz-jeghers style pathology syndromes when the item points to colonic polyps', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77813',
      prompt: 'Which of the following additional findings would most likely be present?',
      vignette: {
        narrative: 'A child presents with freckles all over the body, including the buccal mucosa, lips, palms, soles, and skin not exposed to the sun. Which additional finding would most likely be present?',
      },
      options: [
        { id: 'A', text: 'Colonic polyps', is_correct: true },
        { id: 'B', text: 'Desmoid tumors', is_correct: false },
        { id: 'C', text: 'Epidermoid cysts', is_correct: false },
        { id: 'D', text: 'Osteomas of the jaw', is_correct: false },
      ],
      meta: {
        source: 'medmcqa',
        subject: 'Pathology',
        tags: ['pathology'],
        organ_system: 'dermatology',
        topic_keywords: ['skin'],
      },
    });

    expect(updated.category).toBe('Patologi Anatomi');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.resolved_category).toBe('Patologi Anatomi');
    expect(updated.meta.category_resolution.confidence).toBe('high');
  });

  it('promotes hypophosphatasia pathology items when phosphoethanolamine is explicitly present', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77814',
      prompt: 'The child is suffering from.',
      vignette: {
        narrative: 'A 9-year-old child has horizontal anterior bone loss, reduced cementum, and urinary phosphoethanolamine excretion. The child is suffering from.',
      },
      options: [
        { id: 'A', text: 'Hypophosphatasia', is_correct: true },
        { id: 'B', text: 'Vitamin D resistant rickets', is_correct: false },
        { id: 'C', text: 'Juvenile periodontitis', is_correct: false },
      ],
      meta: {
        source: 'medmcqa',
        subject: 'Pathology',
        tags: ['pathology'],
        organ_system: 'musculoskeletal',
        topic_keywords: ['bone'],
      },
    });

    expect(updated.category).toBe('Patologi Anatomi');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.resolved_category).toBe('Patologi Anatomi');
    expect(updated.meta.category_resolution.confidence).toBe('high');
  });

  it('promotes explicit medmcqa histopathology prompts over broad ipd raw labels', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77803',
      title: '16-year-old female presents with primary amenorrhea and raised FSH',
      prompt: 'What would be the histopathological finding in the ovary?',
      vignette: {
        narrative: 'A 16-year-old female presents with primary amenorrhea and raised FSH. On examination, her height was 58 inches. What would be the histopathological finding in the ovary?',
      },
      options: [
        { id: 'A', text: 'Absence of oocytes in the ovaries (streak ovaries)', is_correct: true },
        { id: 'B', text: 'Mucinous cystadenoma', is_correct: false },
        { id: 'C', text: 'Psamomma bodies', is_correct: false },
        { id: 'D', text: 'Hemorrhagic Corpus Leuteum', is_correct: false },
      ],
      meta: {
        source: 'medmcqa',
        subject: 'Pathology',
        tags: ['pathology', 'genetics'],
      },
    });

    expect(updated.category).toBe('Patologi Anatomi');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.resolved_category).toBe('Patologi Anatomi');
    expect(updated.meta.category_resolution.promotion_rule).toBe('medmcqa_pathology_subject_tag_consensus5');
  });

  it('promotes histologically worded medmcqa morphology items into pathology', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77805',
      prompt: 'Histologically, this lesion is most likely composed of a proliferation of which tissue component?',
      vignette: {
        narrative: 'A child has a large port-wine stain since birth. Histologically, this lesion is composed of a proliferation of capillaries.',
      },
      options: [
        { id: 'A', text: 'Capillaries', is_correct: true },
        { id: 'B', text: 'Fibroblasts', is_correct: false },
      ],
      meta: {
        source: 'medmcqa',
        subject: 'Pathology',
        tags: ['pathology', 'disease of infancy & childhood'],
        organ_system: 'dermatology',
        topic_keywords: ['lesion'],
      },
    });

    expect(updated.category).toBe('Patologi Anatomi');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.resolved_category).toBe('Patologi Anatomi');
    expect(updated.meta.category_resolution.base_confidence).toBe('high');
  });

  it('does not let atherosclerotic plaque wording create a dental plaque false positive', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77806',
      prompt: 'The presence of which feature in an atherosclerotic plaque indicates a complicated lesion?',
      vignette: {
        narrative: 'The presence of lines of Zahn in an atherosclerotic plaque indicates a complicated lesion.',
      },
      options: [
        { id: 'A', text: 'Cholesterol crystals', is_correct: false },
        { id: 'B', text: 'Lines of Zahn', is_correct: true },
      ],
      meta: {
        source: 'medmcqa',
        subject: 'Pathology',
        tags: ['pathology'],
        organ_system: 'dermatology',
        topic_keywords: ['lesion'],
      },
    });

    expect(updated.category).toBe('Patologi Anatomi');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.resolved_category).toBe('Patologi Anatomi');
  });

  it('suppresses broad medmcqa pathology metadata for basic enzyme metabolism questions', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77807',
      prompt: 'Cyclo-oxygenase pathway of arachidonic acid metabolism does not give rise to:',
      vignette: {
        narrative: 'This basic metabolism item asks which product is not generated by the cyclo-oxygenase pathway.',
      },
      meta: {
        source: 'medmcqa',
        subject: 'Pathology',
        tags: ['pathology'],
      },
    });

    expect(updated.category).toBe('Biokimia');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.resolved_category).toBe('Biokimia');
  });

  it('does not let endodermal sinus wording create an ent false positive in pathology items', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77804',
      prompt: 'Endodermal sinus tumour is characterized by ?',
      vignette: {
        narrative: 'An endodermal sinus tumour is characterized by Schiller-Duval bodies.',
      },
      meta: {
        source: 'medmcqa',
        subject: 'Pathology',
        tags: ['pathology'],
      },
    });

    expect(updated.category).toBe('Patologi Anatomi');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.resolved_category).toBe('Patologi Anatomi');
  });

  it('rescues streptococcus host-receptor medmcqa items back to internal medicine when pathology metadata is just stale noise', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77808',
      title: 'Host receptor for streptococcus pyogenes is',
      prompt: 'Host receptor for streptococcus pyogenes is?',
      vignette: {
        narrative: 'Host receptor for streptococcus pyogenes is?',
      },
      options: [
        { id: 'A', text: 'CD4', is_correct: false },
        { id: 'B', text: 'CD21', is_correct: false },
        { id: 'C', text: 'CD44', is_correct: false },
        { id: 'D', text: 'CD46', is_correct: true },
      ],
      meta: {
        source: 'medmcqa',
        subject: 'Pathology',
        tags: ['pathology', 'misc. (w.b.c)'],
      },
    });

    expect(updated.category).toBe('Ilmu Penyakit Dalam');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.resolved_category).toBe('Ilmu Penyakit Dalam');
    expect(updated.meta.category_resolution.promotion_rule).toBe('medmcqa_medicine_streptococcus_host_receptor_consensus5');
  });

  it('rescues peripheral-smear plus spine-xray sickle-pattern medmcqa items back to internal medicine', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77809',
      title: 'Which will the patient with following peripheral smear and X-ray spine present with?',
      prompt: 'Which will the patient with following peripheral smear and X-ray spine present with?',
      vignette: {
        narrative: 'The question shows a peripheral smear and X-ray spine and asks the likely clinical presentation.',
      },
      options: [
        { id: 'A', text: 'Hand Foot syndrome', is_correct: true },
        { id: 'B', text: 'Black urine', is_correct: false },
        { id: 'C', text: 'Elevated haptoglobin', is_correct: false },
        { id: 'D', text: 'Splenomegaly with gall stones', is_correct: false },
      ],
      meta: {
        source: 'medmcqa',
        subject: 'Pathology',
        tags: ['pathology', 'blood'],
      },
    });

    expect(updated.category).toBe('Ilmu Penyakit Dalam');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.resolved_category).toBe('Ilmu Penyakit Dalam');
    expect(updated.meta.category_resolution.promotion_rule).toBe('medmcqa_medicine_peripheral_smear_xray_handfoot_consensus5');
  });

  it('promotes sharp anatomy subject-tag medmcqa items when artery-vein-foramen cues are explicit', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77810',
      title: 'Artery of anatomical snuffbox',
      prompt: 'Artery of anatomical snuffbox is:',
      vignette: {
        narrative: 'Artery of anatomical snuffbox is radial artery.',
      },
      meta: {
        source: 'medmcqa',
        subject: 'Anatomy',
        tags: ['anatomy'],
      },
    });

    expect(updated.category).toBe('Anatomi');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.resolved_category).toBe('Anatomi');
    expect(updated.meta.category_resolution.promotion_rule).toBe('medmcqa_anatomy_subject_tag_consensus4');
  });

  it('promotes morphology-heavy medmcqa pathology items when pathology metadata is explicit and runner-up pathology is close', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77815',
      title: 'Reed Sternberg cells are found in',
      prompt: 'Reed Sternberg cells are found in',
      vignette: {
        narrative: 'A morphology question asks which disease is characterized by Reed Sternberg cells.',
      },
      meta: {
        source: 'medmcqa',
        subject: 'Pathology',
        tags: ['pathology', 'haematology'],
        organ_system: 'hematology',
      },
    });

    expect(updated.category).toBe('Patologi Anatomi');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.resolved_category).toBe('Patologi Anatomi');
    expect(updated.meta.category_resolution.promotion_rule).toBe('medmcqa_pathology_morphology_subject_tag_runner6');
  });

  it('keeps clinically phrased medmcqa pathology metadata in internal medicine when morphology support is absent', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77816',
      title: 'Paul-Bunnell test is positive in',
      prompt: 'Paul-Bunnell test is positive in',
      vignette: {
        narrative: 'Paul-Bunnell test is positive in infectious mononucleosis.',
      },
      meta: {
        source: 'medmcqa',
        subject: 'Pathology',
        tags: ['pathology'],
        organ_system: 'infectious',
      },
    });

    expect(updated.category).toBe('Ilmu Penyakit Dalam');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.resolved_category).toBe('Ilmu Penyakit Dalam');
  });

  it('promotes explicit medmcqa microbiology items when subject metadata and textual cues agree', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77817',
      title: 'False about Corona viruses',
      prompt: 'False about Corona viruses',
      vignette: {
        narrative: '',
      },
      meta: {
        source: 'medmcqa',
        subject: 'Microbiology',
        tags: ['microbiology'],
        organ_system: 'infectious',
      },
    });

    expect(updated.category).toBe('Mikrobiologi');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.resolved_category).toBe('Mikrobiologi');
    expect(updated.meta.category_resolution.promotion_rule).toBe('medmcqa_microbiology_subject_tag_runner6');
  });

  it('does not promote stray medmcqa microbiology metadata when the stem is clearly a medicine absorption question', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77818',
      title: 'Which of the following is the main site of absorption of vitamin B12?',
      prompt: 'Which of the following is the main site of absorption of vitamin B12?',
      vignette: {
        narrative: 'This medicine question asks the main site of absorption of vitamin B12.',
      },
      meta: {
        source: 'medmcqa',
        subject: 'Microbiology',
        tags: ['microbiology', 'parasitology'],
        organ_system: 'gastrointestinal',
      },
    });

    expect(updated.category).toBe('Ilmu Penyakit Dalam');
    expect(updated.meta.category_review_needed).toBe(true);
    expect(updated.meta.category_resolution.resolved_category).toBe('Ilmu Penyakit Dalam');
    expect(updated.meta.category_resolution.promotion_rule).toBe(null);
  });

  it('promotes exact medmcqa microbiology phrases when pathogen wording is specific and metadata agrees', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77821',
      title: 'Rat bite fever is caused by',
      prompt: 'Rat bite fever is caused by',
      vignette: {
        narrative: '',
      },
      meta: {
        source: 'medmcqa',
        subject: 'Microbiology',
        tags: ['microbiology'],
        organ_system: 'infectious',
        category_resolution: {
          raw_category: 'Ilmu Penyakit Dalam',
          raw_normalized_category: 'Ilmu Penyakit Dalam',
          resolved_category: 'Ilmu Penyakit Dalam',
          confidence: 'low',
          base_confidence: 'low',
          category_conflict: true,
          winning_signals: [
            { source: 'raw', weight: 4, match: 'Ilmu Penyakit Dalam' },
          ],
          runner_up_category: 'Mikrobiologi',
          runner_up_score: 6,
          prefix: 'IPD',
          promotion_rule: null,
        },
      },
    });

    expect(updated.category).toBe('Mikrobiologi');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.resolved_category).toBe('Mikrobiologi');
    expect(updated.meta.category_resolution.promotion_rule).toBe('medmcqa_microbiology_exact_phrase_runner6');
  });

  it('locks in low-confidence medmcqa microbiology resolutions when exact organism wording is already explicit', () => {
    const updated = applyResolvedCategory({
      _id: 8602,
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-05164',
      title: 'Dark ground microscopy is used for detection of -',
      prompt: 'Dark ground microscopy is used for detection of -',
      vignette: {
        demographics: {
          age: null,
          sex: null,
        },
        narrative: 'Dark ground microscopy is used for detection of -',
        vitalSigns: null,
        labFindings: null,
      },
      options: [
        { id: 'A', text: 'Spirochetes', is_correct: true },
        { id: 'B', text: 'Chlamydia', is_correct: false },
        { id: 'C', text: 'Fungi', is_correct: false },
        { id: 'D', text: 'Virus', is_correct: false },
      ],
      meta: {
        source: 'medmcqa',
        subject: 'Microbiology',
        tags: ['microbiology'],
        organ_system: 'general',
        category_resolution: {
          raw_category: 'Ilmu Penyakit Dalam',
          raw_normalized_category: 'Ilmu Penyakit Dalam',
          resolved_category: 'Mikrobiologi',
          confidence: 'low',
          base_confidence: 'low',
          category_conflict: true,
          winning_signals: [
            { source: 'subject', weight: 3, match: 'Microbiology' },
            { source: 'tags', weight: 3, match: 'microbiology' },
          ],
          runner_up_category: 'Patologi Anatomi',
          runner_up_score: 5,
          prefix: 'IPD',
          promotion_rule: null,
        },
      },
    });

    expect(updated.category).toBe('Mikrobiologi');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.resolved_category).toBe('Mikrobiologi');
    expect(updated.meta.category_resolution.promotion_rule).toBe('medmcqa_microbiology_exact_phrase_consensus5');
  });

  it('locks in low-confidence medmcqa microbiology lab items when explicit microbiology technique wording is present', () => {
    const updated = applyResolvedCategory({
      _id: 46434,
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-20624',
      title: 'Phase-contrast microscopy is based on the principle of:',
      prompt: 'Phase-contrast microscopy is based on the principle of:',
      vignette: {
        demographics: {
          age: null,
          sex: null,
        },
        narrative: 'Phase-contrast microscopy is based on the principle of:',
        vitalSigns: null,
        labFindings: null,
      },
      options: [
        { id: 'A', text: 'Different refractive indices of object', is_correct: true },
        { id: 'B', text: 'Different reflective indices of object', is_correct: false },
        { id: 'C', text: 'Light scattering', is_correct: false },
        { id: 'D', text: 'Light attenuation', is_correct: false },
      ],
      meta: {
        source: 'medmcqa',
        subject: 'Microbiology',
        tags: ['microbiology'],
        organ_system: 'general',
        category_resolution: {
          raw_category: 'Ilmu Penyakit Dalam',
          raw_normalized_category: 'Ilmu Penyakit Dalam',
          resolved_category: 'Mikrobiologi',
          confidence: 'low',
          base_confidence: 'low',
          category_conflict: true,
          winning_signals: [
            { source: 'subject', weight: 3, match: 'Microbiology' },
            { source: 'tags', weight: 3, match: 'microbiology' },
          ],
          runner_up_category: 'Patologi Anatomi',
          runner_up_score: 5,
          prefix: 'IPD',
          promotion_rule: null,
        },
      },
    });

    expect(updated.category).toBe('Mikrobiologi');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.resolved_category).toBe('Mikrobiologi');
    expect(updated.meta.category_resolution.promotion_rule).toBe('medmcqa_microbiology_exact_phrase_consensus5');
  });

  it('promotes exact medmcqa pathology phrases even when stale raw metadata points to a different specialty', () => {
    const updated = applyResolvedCategory({
      _id: 12222,
      source: 'medmcqa',
      category: 'Mata',
      case_code: 'MMC-IPD-MCQ-77822',
      title: 'Loss of hetrozygosity associated with ?',
      prompt: 'Loss of hetrozygosity is associated with:',
      vignette: {
        demographics: {
          age: null,
          sex: null,
        },
        narrative: 'Loss of hetrozygosity is associated with:',
        vitalSigns: null,
        labFindings: null,
      },
      options: [
        { id: 'A', text: 'Acute myeloid leukemia', is_correct: false },
        { id: 'B', text: 'ALL', is_correct: false },
        { id: 'C', text: 'Retinoblastoma', is_correct: true },
        { id: 'D', text: 'Promyelocitic leukemia', is_correct: false },
      ],
      meta: {
        source: 'medmcqa',
        subject: 'Pathology',
        tags: ['pathology'],
        organ_system: 'hematology',
        category_resolution: {
          raw_category: 'Mata',
          raw_normalized_category: 'Mata',
          resolved_category: 'Patologi Anatomi',
          confidence: 'low',
          base_confidence: 'low',
          category_conflict: true,
          winning_signals: [
            { source: 'subject', weight: 3, match: 'Pathology' },
            { source: 'tags', weight: 3, match: 'pathology' },
          ],
          runner_up_category: 'Ilmu Penyakit Dalam',
          runner_up_score: 5,
          prefix: 'IPD',
          promotion_rule: null,
        },
      },
    });

    expect(updated.category).toBe('Patologi Anatomi');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.resolved_category).toBe('Patologi Anatomi');
    expect(updated.meta.category_resolution.promotion_rule).toBe('medmcqa_pathology_exact_phrase_subject_tag_consensus5');
  });

  it('keeps ambiguous medmcqa pathology crossovers in review when the phrase is still forensic-adjacent', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Forensik',
      case_code: 'MMC-IPD-MCQ-77823',
      title: 'Lines of Zahn occur in',
      prompt: 'Lines of Zahn occur in',
      vignette: {
        narrative: '',
      },
      meta: {
        source: 'medmcqa',
        subject: 'Pathology',
        tags: ['pathology'],
        organ_system: 'hematology',
        category_resolution: {
          raw_category: 'Forensik',
          raw_normalized_category: 'Forensik',
          resolved_category: 'Patologi Anatomi',
          confidence: 'low',
          base_confidence: 'low',
          category_conflict: true,
          winning_signals: [
            { source: 'subject', weight: 3, match: 'Pathology' },
            { source: 'tags', weight: 3, match: 'pathology' },
          ],
          runner_up_category: 'Forensik',
          runner_up_score: 5,
          prefix: 'IPD',
          promotion_rule: null,
        },
      },
    });

    expect(updated.category).toBe('Forensik');
    expect(updated.meta.category_review_needed).toBe(true);
    expect(updated.meta.category_resolution.resolved_category).toBe('Patologi Anatomi');
    expect(updated.meta.category_resolution.promotion_rule).toBe(null);
  });

  it('promotes explicit medmcqa dermatology items when skin metadata and lesion language agree', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77819',
      title: 'Gottron papules are seen in',
      prompt: 'Gottron papules are seen in',
      vignette: {
        narrative: '',
      },
      meta: {
        source: 'medmcqa',
        subject: 'Skin',
        tags: ['skin'],
        organ_system: 'dermatology',
      },
    });

    expect(updated.category).toBe('Kulit & Kelamin');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.resolved_category).toBe('Kulit & Kelamin');
    expect(updated.meta.category_resolution.promotion_rule).toBe('medmcqa_dermatology_subject_tag_runner3');
  });

  it('does not blindly promote stale medmcqa skin metadata when dermatology organ-system support is absent', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77820',
      title: 'Type of inheritance of Wilson disease is?',
      prompt: 'Type of inheritance of Wilson disease is?',
      vignette: {
        narrative: '',
      },
      meta: {
        source: 'medmcqa',
        subject: 'Skin',
        tags: ['skin'],
        organ_system: 'gastrointestinal',
      },
    });

    expect(updated.category).toBe('Ilmu Penyakit Dalam');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.promotion_rule).toBe(null);
  });

  it('promotes exact medmcqa anatomy phrases when tags support anatomy even if subject metadata fell back to unknown', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-77824',
      title: 'Parasympathetic supply to lacrimal glands are passed through',
      prompt: 'Parasympathetic supply to lacrimal glands are passed through',
      vignette: {
        narrative: '',
      },
      meta: {
        source: 'medmcqa',
        subject: 'Unknown',
        tags: ['unknown', 'anatomy'],
        organ_system: 'general',
        category_resolution: {
          raw_category: 'Ilmu Penyakit Dalam',
          raw_normalized_category: 'Ilmu Penyakit Dalam',
          resolved_category: 'Ilmu Penyakit Dalam',
          confidence: 'low',
          base_confidence: 'low',
          category_conflict: true,
          winning_signals: [
            { source: 'raw', weight: 4, match: 'Ilmu Penyakit Dalam' },
          ],
          runner_up_category: 'Anatomi',
          runner_up_score: 3,
          prefix: 'IPD',
          promotion_rule: null,
        },
      },
    });

    expect(updated.category).toBe('Anatomi');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.resolved_category).toBe('Anatomi');
    expect(updated.meta.category_resolution.promotion_rule).toBe('medmcqa_anatomy_exact_phrase_runner6');
  });

  it('promotes medmcqa anatomy items when anatomy metadata agrees with runner-up anatomy and core structure wording', () => {
    const updated = applyResolvedCategory({
      _id: 208,
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-00124',
      title: 'Gastrosplenic ligament is derived from',
      prompt: 'Gastrosplenic ligament is derived from?',
      vignette: {
        demographics: {
          age: null,
          sex: null,
        },
        narrative: 'Gastrosplenic ligament is derived from?',
        vitalSigns: null,
        labFindings: null,
      },
      options: [
        { id: 'A', text: 'Splenic artery', is_correct: false },
        { id: 'B', text: 'Splenic vein', is_correct: false },
        { id: 'C', text: 'Dorsal mesogastrium', is_correct: true },
        { id: 'D', text: 'Ventral mesogastrium', is_correct: false },
      ],
      meta: {
        source: 'medmcqa',
        subject: 'Anatomy',
        topic: 'Abdomen & Pelvis',
        tags: ['anatomy', 'abdomen & pelvis'],
        organ_system: 'gastrointestinal',
        category_resolution: {
          raw_category: 'Ilmu Penyakit Dalam',
          raw_normalized_category: 'Ilmu Penyakit Dalam',
          resolved_category: 'Ilmu Penyakit Dalam',
          confidence: 'low',
          base_confidence: 'low',
          category_conflict: true,
          winning_signals: [
            { source: 'raw', weight: 4, match: 'Ilmu Penyakit Dalam' },
            { source: 'organ_system', weight: 3, match: 'gastrointestinal' },
          ],
          runner_up_category: 'Anatomi',
          runner_up_score: 6,
          prefix: 'IPD',
          promotion_rule: null,
        },
      },
    });

    expect(updated.category).toBe('Anatomi');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.resolved_category).toBe('Anatomi');
    expect(updated.meta.category_resolution.promotion_rule).toBe('medmcqa_anatomy_subject_tag_runner6');
  });

  it('locks in low-confidence medmcqa anatomy resolutions when exact branch or foramen wording is explicit', () => {
    const updated = applyResolvedCategory({
      _id: 28520,
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-09483',
      title: 'The maxillary nerve arises from the trigeminal ganglion in...',
      prompt: 'It passes forward in the lateral wall of the cavernous sinus and leaves the skull through which of the following foramen to enter the pterygopalatine fossa?',
      vignette: {
        demographics: {
          age: null,
          sex: null,
        },
        narrative: 'The maxillary nerve arises from the trigeminal ganglion in the middle cranial fossa. It passes forward in the lateral wall of the cavernous sinus and leaves the skull through which of the following foramen to enter the pterygopalatine fossa?',
        vitalSigns: null,
        labFindings: null,
      },
      options: [
        { id: 'A', text: 'Foramen ovale', is_correct: false },
        { id: 'B', text: 'Foramen spinosum', is_correct: false },
        { id: 'C', text: 'Foramen rotundum', is_correct: true },
        { id: 'D', text: 'Foramen lacerum', is_correct: false },
      ],
      meta: {
        source: 'medmcqa',
        subject: 'Anatomy',
        topic: 'Head and neck',
        tags: ['anatomy', 'head and neck'],
        organ_system: 'general',
        topic_keywords: [],
        category_resolution: {
          raw_category: 'Ilmu Penyakit Dalam',
          raw_normalized_category: 'Ilmu Penyakit Dalam',
          resolved_category: 'Anatomi',
          confidence: 'low',
          base_confidence: 'low',
          category_conflict: true,
          winning_signals: [
            { source: 'keyword', weight: 1, match: 'foramen' },
            { source: 'narrative', weight: 2, match: 'foramen' },
            { source: 'options', weight: 1, match: 'foramen' },
            { source: 'content-consensus', weight: 2, match: 'keyword+narrative+options' },
          ],
          runner_up_category: 'Kedokteran Gigi',
          runner_up_score: 5,
          prefix: 'IPD',
          promotion_rule: null,
        },
      },
    });

    expect(updated.category).toBe('Anatomi');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.resolved_category).toBe('Anatomi');
    expect(updated.meta.category_resolution.promotion_rule).toBe('medmcqa_anatomy_exact_phrase_consensus5');
  });

  it('rescues medmcqa orthopaedics injury stems from stale anatomy labels back into surgery', () => {
    const updated = applyResolvedCategory({
      _id: 4338,
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-02578',
      title: 'Pivot shift test is positive with',
      prompt: 'Pivot shift test is positive with',
      vignette: {
        demographics: {
          age: null,
          sex: null,
        },
        narrative: 'Pivot shift test is positive with',
        vitalSigns: null,
        labFindings: null,
      },
      options: [
        { id: 'A', text: 'Anterior cruciate ligament tear', is_correct: true },
        { id: 'B', text: 'Posterior cruciate ligament tear', is_correct: false },
        { id: 'C', text: 'Medial meniscus injury', is_correct: false },
        { id: 'D', text: 'Lateral meniscus injury', is_correct: false },
      ],
      meta: {
        source: 'medmcqa',
        subject: 'Orthopaedics',
        topic: 'Injuries Around the Thigh & Knee',
        questionMode: 'rapid_recall',
        tags: ['orthopaedics', 'injuries around the thigh & knee'],
        organ_system: 'musculoskeletal',
        topic_keywords: ['ligament'],
        category_resolution: {
          raw_category: 'Ilmu Penyakit Dalam',
          raw_normalized_category: 'Ilmu Penyakit Dalam',
          resolved_category: 'Anatomi',
          confidence: 'low',
          base_confidence: 'low',
          category_conflict: true,
          winning_signals: [
            { source: 'topic_keywords', weight: 3, match: 'ligament' },
            { source: 'options', weight: 1, match: 'ligament' },
          ],
          runner_up_category: 'Bedah',
          runner_up_score: 6,
          prefix: 'IPD',
          promotion_rule: null,
        },
      },
    });

    expect(updated.category).toBe('Bedah');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.resolved_category).toBe('Bedah');
    expect(updated.meta.category_resolution.promotion_rule).toBe('medmcqa_orthopaedics_runner_bedah_consensus6');
  });

  it('rescues medmcqa orthopaedics stems from stale ipd labels when orthopaedics metadata is the only competing specialty signal', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-00032',
      title: "Ortolani's test is done for",
      prompt: "Ortolani's test is done for",
      vignette: {
        narrative: "Ortolani's test is done for",
      },
      meta: {
        source: 'medmcqa',
        subject: 'Orthopaedics',
        tags: ['orthopaedics', 'congenital dislocation of hip (c.d.h.)'],
        organ_system: 'pediatrics',
      },
    });

    expect(updated.category).toBe('Bedah');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.resolved_category).toBe('Bedah');
    expect(updated.meta.category_resolution.promotion_rule).toBe('medmcqa_orthopaedics_subject_tag_rescue3');
  });

  it('rescues medmcqa pathology stems back into pathology when internal-medicine organ signals only barely outrank subject-tag metadata', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-00102',
      title: 'Vinyl chloride has been implicated in -',
      prompt: 'Vinyl chloride has been implicated in -',
      vignette: {
        narrative: 'Vinyl chloride has been implicated in -',
      },
      meta: {
        source: 'medmcqa',
        subject: 'Pathology',
        tags: ['pathology'],
        organ_system: 'gastrointestinal',
      },
    });

    expect(updated.category).toBe('Patologi Anatomi');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.resolved_category).toBe('Patologi Anatomi');
    expect(updated.meta.category_resolution.promotion_rule).toBe('medmcqa_pathology_subject_tag_rescue_runner6');
  });

  it('rescues medmcqa microbiology stems back into microbiology when infectious organ hints barely outrank subject-tag metadata', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-01748',
      title: 'Malt workers lung is associated with:',
      prompt: 'Malt workers lung is associated with:',
      vignette: {
        narrative: 'Malt workers lung is associated with:',
      },
      meta: {
        source: 'medmcqa',
        subject: 'Microbiology',
        tags: ['microbiology'],
        organ_system: 'infectious',
      },
    });

    expect(updated.category).toBe('Mikrobiologi');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.resolved_category).toBe('Mikrobiologi');
    expect(updated.meta.category_resolution.promotion_rule).toBe('medmcqa_microbiology_subject_tag_rescue_runner6');
  });

  it('rescues medmcqa dermatology stems back into kulit dan kelamin when skin metadata is consistent but the raw label still wins by one point', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-IPD-MCQ-00177',
      title: 'Groove sign is seen in-',
      prompt: 'Groove sign is seen in-',
      vignette: {
        narrative: 'Groove sign is seen in-',
      },
      meta: {
        source: 'medmcqa',
        subject: 'Skin',
        tags: ['skin', 's.t.d.'],
        organ_system: 'dermatology',
      },
    });

    expect(updated.category).toBe('Kulit & Kelamin');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.resolved_category).toBe('Kulit & Kelamin');
    expect(updated.meta.category_resolution.promotion_rule).toBe('medmcqa_dermatology_subject_tag_rescue3');
  });

  it('self-confirms medmcqa surgery cases when raw and resolved surgery agree but renal metadata keeps the runner-up too close', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Bedah',
      case_code: 'MMC-BDH-MCQ-00208',
      title: 'Which statement is false?',
      prompt: 'Which renal structure is involved?',
      meta: {
        source: 'medmcqa',
        subject: 'Surgery',
        tags: ['surgery'],
        organ_system: 'renal',
        topic_keywords: ['renal'],
      },
    });

    expect(updated.category).toBe('Bedah');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.resolved_category).toBe('Bedah');
    expect(updated.meta.category_resolution.promotion_rule).toBe('medmcqa_surgery_subject_tag_confirm_consensus9');
  });

  it('rescues medmcqa surgery cases back from medicine drift when raw, subject, and tags still agree on surgery', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Bedah',
      case_code: 'MMC-BDH-MCQ-00431',
      title: 'Renal transplantation is most commonly done in -',
      prompt: 'Renal transplantation is most commonly done in -',
      vignette: {
        narrative: 'Renal transplantation is most commonly done in -',
      },
      meta: {
        source: 'medmcqa',
        subject: 'Surgery',
        tags: ['surgery'],
        organ_system: 'renal',
        topic_keywords: ['renal'],
      },
    });

    expect(updated.category).toBe('Bedah');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.resolved_category).toBe('Bedah');
    expect(updated.meta.category_resolution.promotion_rule).toBe('medmcqa_surgery_subject_tag_rescue10');
  });

  it('rescues medmcqa psychiatry drug stems back from pharmacology drift when the source metadata still points to psychiatry', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Psikiatri',
      case_code: 'MMC-PSI-MCQ-00091',
      title: 'An antipsychotic drug with prolonged action -',
      prompt: 'An antipsychotic drug with prolonged action -',
      vignette: {
        narrative: 'Drug with prolonged action -',
      },
      meta: {
        source: 'medmcqa',
        subject: 'Psychiatry',
        tags: ['psychiatry'],
        organ_system: 'pharmacology',
        topic_keywords: ['drug'],
      },
    });

    expect(updated.category).toBe('Psikiatri');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.resolved_category).toBe('Psikiatri');
    expect(updated.meta.category_resolution.promotion_rule).toBe('medmcqa_psychiatry_pharmacology_drift_rescue10');
  });

  it('rescues medmcqa surgery drug stems back from pharmacology drift when raw and subject-tag metadata still agree on surgery', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Bedah',
      case_code: 'MMC-BDH-MCQ-00089',
      title: 'Drug used for Buerger disease',
      prompt: 'Drug used for Buerger disease',
      vignette: {
        narrative: 'Which drug is used for this disease?',
      },
      meta: {
        source: 'medmcqa',
        subject: 'Surgery',
        tags: ['surgery', 'aerial disorders'],
        organ_system: 'pharmacology',
        topic_keywords: ['drug'],
      },
    });

    expect(updated.category).toBe('Bedah');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.resolved_category).toBe('Bedah');
    expect(updated.meta.category_resolution.promotion_rule).toBe('medmcqa_surgery_pharmacology_drift_rescue10');
  });

  it('keeps medmcqa surgery confirmations stable when raw and resolved surgery metadata already agree cleanly', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Bedah',
      case_code: 'MMC-BDH-MCQ-00109',
      title: 'Surgical decision check',
      prompt: 'Which surgical option is most appropriate for this patient?',
      vignette: {
        narrative: 'This surgery question concerns postoperative management after an orthopaedic procedure.',
      },
      meta: {
        source: 'medmcqa',
        tags: ['surgery'],
      },
    });

    expect(updated.category).toBe('Bedah');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.resolved_category).toBe('Bedah');
  });

  it('promotes targeted medqa public-health rescues when organ-system evidence is sharp and uncontested', () => {
    const updated = applyResolvedCategory({
      source: 'medqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MQA-IPD-MCQ-00998',
      title: 'Population screening design question',
      prompt: 'Which of the following best describes this public health study?',
      vignette: {
        narrative: 'A population screening program is evaluated to see whether prevention efforts lower community disease burden.',
      },
      meta: {
        source: 'medqa',
        organ_system: 'public health',
      },
    });

    expect(updated.category).toBe('Ilmu Kesehatan Masyarakat');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.base_confidence).toBe('high');
    expect(updated.meta.category_resolution.promotion_rule).toBe(null);
  });

  it('promotes targeted medmcqa rescues when keyword and narrative consensus narrowly beats stale broad labels', () => {
    const updated = applyResolvedCategory({
      source: 'medmcqa',
      category: 'Ilmu Penyakit Dalam',
      case_code: 'MMC-GEN-MCQ-00011',
      title: 'Newborn emergency counseling',
      prompt: 'A newborn requires counseling during neonatal follow-up.',
      vignette: {
        narrative: 'A newborn presents for neonatal follow-up after an uncomplicated delivery.',
      },
      meta: {
        source: 'medmcqa',
      },
    });

    expect(updated.category).toBe('Ilmu Kesehatan Anak');
    expect(updated.meta.category_review_needed).toBe(false);
    expect(updated.meta.category_resolution.base_confidence).toBe('low');
    expect(updated.meta.category_resolution.promotion_rule).toBe('medmcqa_pediatrics_consensus10');
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
