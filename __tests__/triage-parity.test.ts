// Parity with the Python reference engine: the shared table backend/triage/tests/cases.json
// (same cases pytest and the FastAPI /v1/screening/evaluate parity test run). Test-only params
// come from backend fixtures and never enter the app bundle. Skipped outside the monorepo.
import fs from 'node:fs';
import path from 'node:path';

import {
  TriageInputError,
  TriageParamsError,
  checkParams,
  evaluate,
  resolveParams,
  triageParams,
  triageRules,
  type Params,
  type TriageRules,
} from '@/domain/triage';

const backend = path.resolve(__dirname, '../../backend/triage');
const casesPath = path.join(backend, 'tests/cases.json');
const describeIfBackend = fs.existsSync(casesPath) ? describe : describe.skip;

type Case = {
  id: string;
  description: string;
  input: Record<string, unknown> & { params_profile: string };
  expected:
    | { error: string; error_code: string }
    | {
        level: string;
        reasons_ids: string[];
        advice_ids: string[];
        referral_template_id: string;
        lesions?: { detection_index: number; dentition: string; counted: boolean }[];
      };
};

const readJson = (p: string) => JSON.parse(fs.readFileSync(p, 'utf8'));

describeIfBackend('triage engine parity (backend/triage/tests/cases.json)', () => {
  const table: { format_version: number; cases: Case[] } = readJson(casesPath);
  const profiles: Record<string, { values: Record<string, unknown> }> = readJson(
    path.join(backend, 'tests/fixtures/params_profiles.json'),
  ).profiles;

  it('uses the format this port implements', () => {
    expect(table.format_version).toBe(2);
    expect(table.cases.length).toBeGreaterThanOrEqual(114);
  });

  it.each(table.cases.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    const { params_profile, ...input } = c.input;
    const params = resolveParams(triageRules, profiles[params_profile].values);
    if ('error' in c.expected) {
      expect(c.expected.error).toBe('TriageInputError');
      expect(() => evaluate(triageRules, input, params)).toThrow(TriageInputError);
      expect(() => evaluate(triageRules, input, params)).toThrow(
        expect.objectContaining({ code: c.expected.error_code }),
      );
      return;
    }
    const out = evaluate(triageRules, input, params);
    expect(out.level).toBe(c.expected.level);
    expect(out.reasons.map((r) => r.id)).toEqual(c.expected.reasons_ids);
    expect(out.advice_ids).toEqual(c.expected.advice_ids);
    expect(out.referral_template_id).toBe(c.expected.referral_template_id);
    expect(out.rules_version).toBe(triageRules.version);
    if (c.expected.lesions) {
      expect(
        out.lesions.map(({ detection_index, dentition, counted }) => ({ detection_index, dentition, counted })),
      ).toEqual(c.expected.lesions);
    }
  });
});

const symptoms = Object.fromEntries(triageRules.questions.map((q) => [q.id, 'no']));
const base = { detections: [], photo_status: 'not_taken', symptoms, age_months: 96, pain: 0 };

describe('triage engine units', () => {
  it('production params are the cautious if_unset values while rules are unset', () => {
    for (const [name, spec] of Object.entries(triageRules.params)) {
      expect(triageParams[name]).toBe(spec.value ?? spec.if_unset);
    }
  });

  it('never mutates its input and is deterministic', () => {
    const input = { ...base, detections: [{ class: 'caries_primary', confidence: 0.5 }], photo_status: 'assessed' };
    const snapshot = JSON.stringify(input);
    const a = evaluate(triageRules, input, triageParams);
    const b = evaluate(triageRules, input, triageParams);
    expect(a).toEqual(b);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('rejects a box on a detection (ADR 014)', () => {
    const input = {
      ...base,
      photo_status: 'assessed',
      detections: [{ class: 'caries_primary', confidence: 0.5, box: [0, 0, 1, 1] }],
    };
    expect(() => evaluate(triageRules, input, triageParams)).toThrow(
      expect.objectContaining({ code: 'DETECTION_INVALID' }),
    );
  });

  it.each([
    ['array input', [], 'INPUT_NOT_OBJECT'],
    ['null input', null, 'INPUT_NOT_OBJECT'],
    ['array detection', { ...base, photo_status: 'assessed', detections: [['caries_primary', 1]] }, 'DETECTION_INVALID'],
    ['boolean pain', { ...base, pain: true }, 'PAIN_INVALID'],
    ['undefined age', { ...base, age_months: undefined }, 'AGE_INVALID'],
  ])('rejects %s', (_name, input, code) => {
    expect(() => evaluate(triageRules, input, triageParams)).toThrow(expect.objectContaining({ code }));
  });

  describe('params', () => {
    it('rejects unknown overrides', () => {
      expect(() => resolveParams(triageRules, { nope: 1 })).toThrow(TriageParamsError);
      expect(() => resolveParams(triageRules, { nope: 1 })).toThrow(expect.objectContaining({ code: 'PARAM_UNKNOWN' }));
    });

    it('rejects unknown, missing and invalid values', () => {
      expect(() => checkParams(triageRules, { ...triageParams, nope: 1 })).toThrow(
        expect.objectContaining({ code: 'PARAM_UNKNOWN' }),
      );
      const { many_lesions_n: _dropped, ...missing } = triageParams;
      expect(() => checkParams(triageRules, missing)).toThrow(expect.objectContaining({ code: 'PARAM_MISSING' }));
      const bads: Params[] = [
        { many_lesions_n: 1.5 },
        { many_lesions_n: 0 },
        { primary_min_confidence: 2 },
        { primary_min_confidence: 'x' },
        { caries_indication_level: 'emergency' },
        { caries_indication_level: 3 },
      ];
      for (const bad of bads) {
        expect(() => checkParams(triageRules, { ...triageParams, ...bad })).toThrow(
          expect.objectContaining({ code: 'PARAM_INVALID' }),
        );
      }
    });

    it('evaluate checks params before input', () => {
      expect(() => evaluate(triageRules, null, {})).toThrow(TriageParamsError);
    });

    it('uses an explicit rules value over if_unset', () => {
      const rules: TriageRules = {
        ...triageRules,
        params: { ...triageRules.params, many_lesions_n: { ...triageRules.params.many_lesions_n, value: 3 } as never },
      };
      expect(resolveParams(rules).many_lesions_n).toBe(3);
    });
  });
});
