import { describe, expect, it } from 'vitest';
import { sanitizeFdiTryoutCase } from '../data/fdiTryoutSanitizer';

describe('sanitizeFdiTryoutCase', () => {
  it('moves leaked prompt text out of an answer option', () => {
    const input = {
      title: 'F U T U R E D O C T O R I N D O N E S I A . C O M test',
      prompt: 'Pilih jawaban yang paling tepat.',
      vignette: {
        narrative: 'F U T U R E D O C T O R I N D O N E S I A . C O M Seorang laki-laki 50 tahun datang cek kolesterol.',
      },
      meta: { source: 'fdi-tryout', quality_score: 90 },
      options: [
        { id: 'C', text: 'Hasil lab didapatkan LDL 50 dan TG 400. Terapi yang tepat adalah ....', is_correct: false },
        { id: 'A', text: 'Simvastatin', is_correct: false },
        { id: 'B', text: 'Gemfibrozil', is_correct: true },
        { id: 'D', text: 'Atorvastatin dan fenofibrat', is_correct: false },
        { id: 'E', text: 'Bile acid sequestrant', is_correct: false },
      ],
    };

    const result = sanitizeFdiTryoutCase(input);

    expect(result.prompt).toContain('Terapi yang tepat');
    expect(result.options).toHaveLength(4);
    expect(result.options[0].id).toBe('A');
    expect(result.options.some((option) => /LDL 50/i.test(option.text))).toBe(false);
    expect(result.vignette.narrative).not.toContain('F U T U R E');
  });

  it('extracts a real question from the end of the narrative when prompt is generic', () => {
    const input = {
      prompt: 'Pilih jawaban yang paling tepat.',
      vignette: {
        narrative: 'F U T U R E D O C T O R I N D O N E S I A . C O M Seorang perempuan 68 tahun datang dengan sering lupa sejak 5 bulan. Pasien punya riwayat stroke. Diagnosis pada pasien ini adalah ...',
      },
      meta: { source: 'fdi-tryout' },
      options: [
        { id: 'A', text: 'Demensia vaskular', is_correct: true },
        { id: 'B', text: 'Alzheimer', is_correct: false },
        { id: 'C', text: 'Delirium', is_correct: false },
        { id: 'D', text: 'Amnesia global', is_correct: false },
        { id: 'E', text: 'Skizofrenia', is_correct: false },
      ],
    };

    const result = sanitizeFdiTryoutCase(input);

    expect(result.prompt).toBe('Diagnosis pada pasien ini adalah ...');
    expect(result.vignette.narrative).not.toContain('Diagnosis pada pasien ini');
    expect(result.meta.quality_flags).toContain('fdi_prompt_extracted');
  });

  it('quarantines cases whose recovered prompt still depends on a missing image', () => {
    const input = {
      prompt: 'Pilih jawaban yang paling tepat.',
      vignette: {
        narrative: 'Seorang anak 7 tahun datang dengan nyeri telinga kiri.',
      },
      meta: { source: 'fdi-tryout' },
      options: [
        { id: 'C', text: 'Pada otoskopi telinga kiri didapatkan gambar seperti berikut. Tatalaksana definitif yang tepat adalah ...', is_correct: false },
        { id: 'A', text: 'H2O2 3%', is_correct: false },
        { id: 'B', text: 'Miringotomi', is_correct: true },
        { id: 'D', text: 'Amoksisilin', is_correct: false },
        { id: 'E', text: 'Miringoplasti', is_correct: false },
      ],
    };

    const result = sanitizeFdiTryoutCase(input);

    expect(result.meta.quarantined).toBe(true);
    expect(result.meta.status).toBe('QUARANTINED_FDI_TRYOUT_IMAGE_CONTEXT');
  });
});

