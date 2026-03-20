/**
 * SmartVignette — Amboss-Style Lab Value Tooltips
 * 
 * Detects lab values in vignette text and wraps them with
 * hover tooltips showing normal ranges. Zero context-switching!
 */
import { useMemo } from 'react';

// Comprehensive lab value reference database
const LAB_DB = [
  // Hematology
  { pattern: /\b(Hb|Hemoglobin|Haemoglobin)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'Hemoglobin', normal: '♂ 13.5–17.5 g/dL  |  ♀ 12.0–15.5 g/dL', unit: 'g/dL' },
  { pattern: /\b(Hct|Hematocrit|PCV)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'Hematocrit', normal: '♂ 38.3–48.6%  |  ♀ 35.5–44.9%', unit: '%' },
  { pattern: /\b(WBC|Leukosit|Leukocyte|White\s*(?:blood\s*)?cell)\s*(?:count)?\s*[:\-–]?\s*([\d,.]+)/gi, label: 'WBC', normal: '4,500–11,000 /μL', unit: '/μL' },
  { pattern: /\b(Platelet|Trombosit|PLT|Thrombocyte)\s*(?:count)?\s*[:\-–]?\s*([\d,.]+)/gi, label: 'Platelets', normal: '150,000–450,000 /μL', unit: '/μL' },
  { pattern: /\b(MCV)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'MCV', normal: '80–100 fL', unit: 'fL' },
  { pattern: /\b(MCH)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'MCH', normal: '27–33 pg', unit: 'pg' },
  { pattern: /\b(MCHC)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'MCHC', normal: '33–36 g/dL', unit: 'g/dL' },
  { pattern: /\b(RDW)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'RDW', normal: '11.5–14.5%', unit: '%' },
  { pattern: /\b(Reticulocyte)\s*(?:count)?\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'Reticulocytes', normal: '0.5–2.5%', unit: '%' },
  { pattern: /\b(ESR|Sed\s*rate)\s*[:\-–]?\s*(\d+)/gi, label: 'ESR', normal: '♂ 0–15 mm/hr  |  ♀ 0–20 mm/hr', unit: 'mm/hr' },
  
  // Coagulation
  { pattern: /\b(PT|Prothrombin\s*time)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'PT', normal: '11–13.5 seconds', unit: 'sec' },
  { pattern: /\b(INR)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'INR', normal: '0.8–1.2 (therapeutic 2.0–3.0)', unit: '' },
  { pattern: /\b(aPTT|PTT)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'aPTT', normal: '25–35 seconds', unit: 'sec' },
  { pattern: /\b(D-?dimer)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'D-dimer', normal: '<0.5 μg/mL (<500 ng/mL)', unit: 'μg/mL' },

  // Electrolytes
  { pattern: /\b(Na\+?|Sodium|Natrium)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'Sodium', normal: '135–145 mEq/L', unit: 'mEq/L' },
  { pattern: /\b(K\+?|Potassium|Kalium)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'Potassium', normal: '3.5–5.0 mEq/L', unit: 'mEq/L' },
  { pattern: /\b(Cl\-?|Chloride)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'Chloride', normal: '96–106 mEq/L', unit: 'mEq/L' },
  { pattern: /\b(Ca\s*(?:2\+)?|Calcium)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'Calcium', normal: '8.5–10.5 mg/dL (2.1–2.6 mmol/L)', unit: 'mg/dL' },
  { pattern: /\b(Mg|Magnesium)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'Magnesium', normal: '1.7–2.2 mg/dL', unit: 'mg/dL' },
  { pattern: /\b(Phosph(?:orus|ate)|PO4)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'Phosphate', normal: '2.5–4.5 mg/dL', unit: 'mg/dL' },
  { pattern: /\b(Bicarb(?:onate)?|HCO3)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'Bicarbonate', normal: '22–28 mEq/L', unit: 'mEq/L' },
  
  // Renal
  { pattern: /\b(BUN|Blood\s*urea\s*nitrogen)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'BUN', normal: '7–20 mg/dL', unit: 'mg/dL' },
  { pattern: /\b(Creatinine|Cr)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'Creatinine', normal: '♂ 0.7–1.3 mg/dL  |  ♀ 0.6–1.1 mg/dL', unit: 'mg/dL' },
  { pattern: /\b(GFR|eGFR)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'eGFR', normal: '>90 mL/min/1.73m²', unit: 'mL/min' },
  { pattern: /\b(Uric\s*acid)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'Uric Acid', normal: '♂ 3.4–7.0 mg/dL  |  ♀ 2.4–6.0 mg/dL', unit: 'mg/dL' },

  // Liver
  { pattern: /\b(AST|SGOT)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'AST (SGOT)', normal: '10–40 U/L', unit: 'U/L' },
  { pattern: /\b(ALT|SGPT)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'ALT (SGPT)', normal: '7–56 U/L', unit: 'U/L' },
  { pattern: /\b(ALP|Alk(?:aline)?\s*phos(?:phatase)?)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'ALP', normal: '44–147 U/L', unit: 'U/L' },
  { pattern: /\b(GGT|Gamma\s*GT)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'GGT', normal: '♂ 8–61 U/L  |  ♀ 5–36 U/L', unit: 'U/L' },
  { pattern: /\b(Bilirubin|Bil)\s*(?:total)?\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'Bilirubin (Total)', normal: '0.1–1.2 mg/dL', unit: 'mg/dL' },
  { pattern: /\b(Albumin|Alb)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'Albumin', normal: '3.5–5.5 g/dL', unit: 'g/dL' },
  { pattern: /\b(Total\s*protein)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'Total Protein', normal: '6.0–8.3 g/dL', unit: 'g/dL' },
  { pattern: /\b(LDH|Lactate\s*dehydrogenase)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'LDH', normal: '140–280 U/L', unit: 'U/L' },
  { pattern: /\b(Amylase)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'Amylase', normal: '28–100 U/L', unit: 'U/L' },
  { pattern: /\b(Lipase)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'Lipase', normal: '0–160 U/L', unit: 'U/L' },

  // Metabolic
  { pattern: /\b(Glucose|FBS|RBS|Blood\s*sugar)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'Glucose', normal: 'Fasting: 70–100 mg/dL | Random: <200 mg/dL', unit: 'mg/dL' },
  { pattern: /\b(HbA1c|A1c|Glycated\s*Hb)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'HbA1c', normal: 'Normal: <5.7%  |  Pre-DM: 5.7–6.4%  |  DM: ≥6.5%', unit: '%' },
  
  // Lipids
  { pattern: /\b(Total\s*cholesterol)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'Total Cholesterol', normal: 'Desirable: <200 mg/dL', unit: 'mg/dL' },
  { pattern: /\b(LDL)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'LDL', normal: 'Optimal: <100 mg/dL', unit: 'mg/dL' },
  { pattern: /\b(HDL)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'HDL', normal: '♂ >40 mg/dL  |  ♀ >50 mg/dL', unit: 'mg/dL' },
  { pattern: /\b(Triglycerides?|TG)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'Triglycerides', normal: 'Normal: <150 mg/dL', unit: 'mg/dL' },

  // Thyroid
  { pattern: /\b(TSH)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'TSH', normal: '0.4–4.0 mIU/L', unit: 'mIU/L' },
  { pattern: /\b(Free\s*T4|FT4)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'Free T4', normal: '0.8–1.8 ng/dL', unit: 'ng/dL' },
  { pattern: /\b(Free\s*T3|FT3)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'Free T3', normal: '2.3–4.2 pg/mL', unit: 'pg/mL' },
  
  // Cardiac
  { pattern: /\b(Troponin|TnI|TnT)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'Troponin', normal: '<0.04 ng/mL (high-sens <14 ng/L)', unit: 'ng/mL' },
  { pattern: /\b(CK-?MB|CKMB)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'CK-MB', normal: '0–25 U/L', unit: 'U/L' },
  { pattern: /\b(BNP)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'BNP', normal: '<100 pg/mL (heart failure unlikely)', unit: 'pg/mL' },
  { pattern: /\b(NT-?proBNP)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'NT-proBNP', normal: '<300 pg/mL (age-dependent)', unit: 'pg/mL' },
  { pattern: /\b(CRP|C-?reactive\s*protein)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'CRP', normal: '<1.0 mg/dL (<10 mg/L)', unit: 'mg/dL' },

  // ABG
  { pattern: /\b(pH)\s*[:\-–]?\s*(7\.\d+)/gi, label: 'Arterial pH', normal: '7.35–7.45', unit: '' },
  { pattern: /\b(pCO2|PaCO2)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'PaCO2', normal: '35–45 mmHg', unit: 'mmHg' },
  { pattern: /\b(pO2|PaO2)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'PaO2', normal: '75–100 mmHg', unit: 'mmHg' },
  { pattern: /\b(SpO2|SaO2|Sat(?:uration)?)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'SpO2', normal: '95–100%', unit: '%' },
  { pattern: /\b(Lactate)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'Lactate', normal: '0.5–2.0 mmol/L', unit: 'mmol/L' },

  // Iron
  { pattern: /\b(Ferritin)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'Ferritin', normal: '♂ 12–300 ng/mL  |  ♀ 12–150 ng/mL', unit: 'ng/mL' },
  { pattern: /\b(Serum\s*iron|Fe)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'Serum Iron', normal: '60–170 μg/dL', unit: 'μg/dL' },
  { pattern: /\b(TIBC)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'TIBC', normal: '250–370 μg/dL', unit: 'μg/dL' },

  // Vitamins
  { pattern: /\b(Vitamin\s*B12|B12)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'Vitamin B12', normal: '200–900 pg/mL', unit: 'pg/mL' },
  { pattern: /\b(Folate|Folic\s*acid)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'Folate', normal: '2.7–17.0 ng/mL', unit: 'ng/mL' },
  { pattern: /\b(Vitamin\s*D|25-?OH-?D)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'Vitamin D', normal: '30–100 ng/mL', unit: 'ng/mL' },

  // Inflammation / Tumor Markers
  { pattern: /\b(Procalcitonin|PCT)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'Procalcitonin', normal: '<0.1 ng/mL (sepsis >2.0)', unit: 'ng/mL' },
  { pattern: /\b(AFP|Alpha-?fetoprotein)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'AFP', normal: '<10 ng/mL', unit: 'ng/mL' },
  { pattern: /\b(PSA)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'PSA', normal: '<4.0 ng/mL (age-dependent)', unit: 'ng/mL' },
  { pattern: /\b(CEA)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'CEA', normal: '<2.5 ng/mL (non-smoker)', unit: 'ng/mL' },
  { pattern: /\b(CA\s*125)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'CA-125', normal: '<35 U/mL', unit: 'U/mL' },
  { pattern: /\b(CA\s*19-?9)\s*[:\-–]?\s*(\d+\.?\d*)/gi, label: 'CA 19-9', normal: '<37 U/mL', unit: 'U/mL' },
];

// Build a single mega-regex for efficient scanning
const MEGA_PATTERN = LAB_DB.map(entry => entry.pattern.source).join('|');
const MEGA_REGEX = new RegExp(`(${MEGA_PATTERN})`, 'gi');

function identifyLabMatch(matchText) {
  for (const entry of LAB_DB) {
    const fresh = new RegExp(entry.pattern.source, 'i');
    if (fresh.test(matchText)) {
      return entry;
    }
  }
  return null;
}

function LabTooltip({ text, labEntry }) {
  return (
    <span
      className="lab-tooltip-trigger"
      style={{
        position: 'relative',
        borderBottom: '1.5px dashed var(--accent-info)',
        cursor: 'help',
        color: 'var(--accent-info)',
        fontWeight: 600,
      }}
    >
      {text}
      <span
        className="lab-tooltip-popup"
        style={{
          position: 'absolute',
          bottom: 'calc(100% + 8px)',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'max-content',
          maxWidth: '280px',
          padding: '8px 12px',
          background: 'rgba(15, 23, 42, 0.95)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(148, 163, 184, 0.15)',
          borderRadius: '8px',
          fontSize: '0.75rem',
          lineHeight: 1.4,
          color: 'var(--text-secondary)',
          opacity: 0,
          pointerEvents: 'none',
          zIndex: 50,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          transition: 'opacity 0.15s ease',
          whiteSpace: 'normal',
          textAlign: 'left',
        }}
      >
        <span style={{ display: 'block', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>
          📋 {labEntry.label}
        </span>
        <span style={{ display: 'block', color: 'var(--accent-success)' }}>
          ✅ Normal: {labEntry.normal}
        </span>
      </span>
    </span>
  );
}

export default function SmartVignette({ text }) {
  const segments = useMemo(() => {
    if (!text) return [{ type: 'text', content: '' }];

    const parts = [];
    let lastIndex = 0;

    // Reset the regex
    const regex = new RegExp(MEGA_REGEX.source, 'gi');
    let match;

    while ((match = regex.exec(text)) !== null) {
      // Add preceding text
      if (match.index > lastIndex) {
        parts.push({ type: 'text', content: text.slice(lastIndex, match.index) });
      }

      const labEntry = identifyLabMatch(match[0]);
      if (labEntry) {
        parts.push({ type: 'lab', content: match[0], lab: labEntry });
      } else {
        parts.push({ type: 'text', content: match[0] });
      }

      lastIndex = match.index + match[0].length;
    }

    // Add remaining text
    if (lastIndex < text.length) {
      parts.push({ type: 'text', content: text.slice(lastIndex) });
    }

    return parts.length > 0 ? parts : [{ type: 'text', content: text }];
  }, [text]);

  return (
    <span className="smart-vignette">
      {segments.map((segment, i) =>
        segment.type === 'lab' ? (
          <LabTooltip key={i} text={segment.content} labEntry={segment.lab} />
        ) : (
          <span key={i}>{segment.content}</span>
        )
      )}
    </span>
  );
}
