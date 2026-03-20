import { beforeEach, describe, expect, it, vi } from 'vitest';

function buildFetchResponse(jsonData, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => jsonData,
  };
}

async function loadFreshCaseLoader(compiledCases, quarantineManifest = null) {
  vi.resetModules();
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(buildFetchResponse(compiledCases))
    .mockResolvedValueOnce(
      quarantineManifest === null
        ? buildFetchResponse({}, false, 404)
        : buildFetchResponse(quarantineManifest),
    );

  vi.stubGlobal('fetch', fetchMock);

  const { caseBank: handCrafted } = await import('../data/caseBank.js');
  const loader = await import('../data/caseLoader.js');
  const cases = await loader.ensureCaseBankLoaded();

  return {
    fetchMock,
    handCraftedCount: handCrafted.length,
    loader,
    cases,
  };
}

describe('caseLoader runtime contracts', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('normalizes malformed compiled cases through the runtime hydrator', async () => {
    const malformedCompiled = [
      {
        title: '',
        category: 'unknown-category',
        question: 'What finding is most concerning?',
        vignette: 'String vignette survives normalization.',
        options: null,
        rationale: '',
        meta: null,
      },
    ];

    const { handCraftedCount, loader } = await loadFreshCaseLoader(malformedCompiled);
    const normalized = loader.getCaseById(handCraftedCount);

    expect(normalized).toMatchInlineSnapshot(`
      {
        "_id": ${handCraftedCount},
        "_searchKey": "what finding is most concerning? what finding is most concerning?  internal-medicine ",
        "category": "internal-medicine",
        "confidence": 0,
        "hash_id": "case_${handCraftedCount}",
        "meta": {
          "difficulty": 1,
          "examType": "BOTH",
          "needs_review": false,
          "provenance": [],
          "source": "manual",
          "tags": [],
          "truncated": false,
        },
        "options": [],
        "prompt": "Review this case and choose the best answer.",
        "q_type": "MCQ",
        "question": "What finding is most concerning?",
        "rationale": {
          "correct": "Explanation unavailable.",
          "distractors": {},
          "pearl": "",
        },
        "title": "What finding is most concerning?",
        "vignette": {
          "demographics": {
            "age": null,
            "sex": null,
          },
          "labFindings": "",
          "narrative": "What finding is most concerning?",
          "vitalSigns": null,
        },
      }
    `);
  });

  it('keeps hand-crafted cases, excludes quarantined compiled cases, and publishes the expected total', async () => {
    const compiledCases = [
      {
        _id: 'compiled_keep_1',
        title: 'Keep me',
        question: 'Question one',
        prompt: 'Question one',
        case_code: 'TMP-AAA-MCQ-00001',
        options: [{ id: 'A', text: 'Answer', is_correct: true }],
        meta: { source: 'medqa', examType: 'USMLE', difficulty: 2 },
      },
      {
        _id: 'compiled_quarantine',
        title: 'Skip me',
        question: 'Question two',
        prompt: 'Question two',
        case_code: 'TMP-AAA-MCQ-00002',
        options: [{ id: 'A', text: 'Answer', is_correct: true }],
        meta: { source: 'medqa', examType: 'USMLE', difficulty: 2, quarantined: true },
      },
      {
        _id: 'compiled_keep_2',
        title: 'Keep me too',
        question: 'Question three',
        prompt: 'Question three',
        case_code: 'TMP-AAA-MCQ-00003',
        options: [{ id: 'A', text: 'Answer', is_correct: true }],
        meta: { source: 'headqa', examType: 'MIR-Spain', difficulty: 3 },
      },
    ];

    const { cases, fetchMock, handCraftedCount, loader } = await loadFreshCaseLoader(compiledCases);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(loader.getCaseBankSnapshot()).toMatchObject({
      status: 'ready',
      compiledCount: compiledCases.length,
      handCraftedCount,
      totalCases: handCraftedCount + 2,
    });
    expect(cases).toHaveLength(handCraftedCount + 2);
    expect(cases.slice(0, handCraftedCount)).toHaveLength(handCraftedCount);
    expect(cases.some((caseData) => caseData.title === 'Skip me')).toBe(false);
    expect(cases.some((caseData) => caseData.title === 'Keep me')).toBe(true);
    expect(cases.some((caseData) => caseData.title === 'Keep me too')).toBe(true);
  });

  it('applies quarantine manifest removals after hydration', async () => {
    const { caseBank: handCrafted } = await import('../data/caseBank.js');
    const compiledCases = [
      {
        _id: 'compiled_keep',
        title: 'Manifest survivor',
        question: 'Question one',
        prompt: 'Question one',
        case_code: 'TMP-AAA-MCQ-00011',
        options: [{ id: 'A', text: 'Answer', is_correct: true }],
        meta: { source: 'medqa', examType: 'USMLE', difficulty: 2 },
      },
      {
        _id: 'compiled_drop',
        title: 'Manifest removal',
        question: 'Question two',
        prompt: 'Question two',
        case_code: 'TMP-AAA-MCQ-00012',
        options: [{ id: 'A', text: 'Answer', is_correct: true }],
        meta: { source: 'medqa', examType: 'USMLE', difficulty: 2 },
      },
    ];

    const expectedRemovedId = handCrafted.length + 1;
    const { cases, handCraftedCount, loader } = await loadFreshCaseLoader(compiledCases, [{ id: expectedRemovedId }]);

    expect(cases.some((caseData) => caseData.title === 'Manifest removal')).toBe(false);
    expect(cases.some((caseData) => caseData.title === 'Manifest survivor')).toBe(true);
    expect(loader.getCaseBankSnapshot().totalCases).toBe(handCraftedCount + 1);
  });
});
