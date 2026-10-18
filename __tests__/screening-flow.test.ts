// Screening flow logic: red-flag short-circuit, engine input assembly (boxes stripped),
// fail-safe errors, detector handling, session store and local saving rules.
import { encode } from 'jpeg-js';

import { resolveMedicalModules } from '@/core/flags';
import { useLocalData } from '@/data/local-store';
import type { ChildProfile } from '@/domain/models';
import { triageRules, type Answer } from '@/domain/triage';
import {
  ageInMonths,
  analyzePhoto,
  buildTriageInput,
  isEmergencyAlready,
  redFlagQuestions,
  runTriage,
  symptomQuestions,
  withLowestForUnasked,
} from '@/features/screening/pipeline';
import { photoFromRecord, photoFromSession } from '@/features/screening/referral-data';
import { useScreeningSession } from '@/features/screening/session-store';
import { nullDetector, type Detection, type Detector } from '@/ml/detector';
import { base64ToBytes, choosePictureSize, decodeJpeg, fitLongestSide, frameToCrop } from '@/ml/photo';
import type { QualityResult } from '@/ml/quality-gate';

jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: { JPEG: 'jpeg' } }));
jest.mock('expo-file-system', () => ({ File: jest.fn() }));

const allNo = (): Record<string, Answer> => Object.fromEntries(triageRules.questions.map((q) => [q.id, 'no']));
const pixels = { width: 4, height: 4, channels: 3 as const, data: new Uint8Array(48) };
const box = { x: 0.1, y: 0.2, w: 0.1, h: 0.2 };

describe('flags', () => {
  it('medical modules are on only in internal builds', () => {
    expect(resolveMedicalModules({ dev: false })).toBe(false);
    expect(resolveMedicalModules({ dev: false, internalBuild: 'false' })).toBe(false);
    expect(resolveMedicalModules({ dev: false, medicalModules: 'true' })).toBe(false);
    expect(resolveMedicalModules({ dev: true })).toBe(true);
    expect(resolveMedicalModules({ dev: false, internalBuild: 'true' })).toBe(true);
    expect(resolveMedicalModules({ dev: true, medicalModules: 'false' })).toBe(false);
  });
});

describe('pipeline', () => {
  it('splits the rules questions into red flags and symptoms', () => {
    expect(redFlagQuestions.length + symptomQuestions.length).toBe(triageRules.questions.length);
    expect(redFlagQuestions.every((q) => q.group === 'red_flag')).toBe(true);
  });

  it('computes age in months, null when unknown or out of range', () => {
    const now = new Date(2026, 9, 11); // 11 Oct 2026
    expect(ageInMonths(2018, 3, now)).toBe(8 * 12 + 7);
    expect(ageInMonths(2018, null, now)).toBeNull();
    expect(ageInMonths(null, 3, now)).toBeNull();
    expect(ageInMonths(2027, 1, now)).toBeNull();
    expect(ageInMonths(1990, 1, now)).toBeNull();
  });

  it('short-circuits on a red flag (yes or unknown) but not on "no" answers', () => {
    const redOnly = (answer: Answer) => Object.fromEntries(redFlagQuestions.map((q, i) => [q.id, i === 3 ? answer : 'no']));
    expect(isEmergencyAlready(redOnly('yes'), null)).toBe(true);
    // Today's cautious params: an unknown red flag is treated as emergency.
    expect(isEmergencyAlready(redOnly('unknown'), null)).toBe(true);
    expect(isEmergencyAlready(redOnly('no'), null)).toBe(false);
    expect(isEmergencyAlready(allNo(), 0)).toBe(false);
  });

  it('fills only unasked questions with the lowest values', () => {
    const filled = withLowestForUnasked({ facial_swelling: 'yes', white_spot: 'unknown' }, null);
    expect(filled.answers.facial_swelling).toBe('yes');
    expect(filled.answers.white_spot).toBe('unknown');
    expect(filled.answers.night_pain).toBe('no');
    expect(filled.pain).toBe(0);
    expect(withLowestForUnasked({}, 'unknown').pain).toBe('unknown');
  });

  it('strips boxes before triage (ADR 014)', () => {
    const detections: Detection[] = [{ class: 'caries_primary', confidence: 0.7, box }];
    const input = buildTriageInput({ answers: allNo(), pain: 0, ageMonths: 96, photoStatus: 'assessed', detections });
    expect(input.detections).toEqual([{ class: 'caries_primary', confidence: 0.7 }]);
    const out = runTriage(input);
    expect(out.kind).toBe('result');
  });

  it('turns engine errors into a fail-safe outcome, never a level', () => {
    const missingPain = buildTriageInput({ answers: allNo(), pain: null, ageMonths: 96, photoStatus: 'not_taken', detections: [] });
    expect(runTriage(missingPain)).toEqual({ kind: 'error', code: 'PAIN_INVALID' });
    const missingAnswer = buildTriageInput({ answers: {}, pain: 0, ageMonths: 96, photoStatus: 'not_taken', detections: [] });
    expect(runTriage(missingAnswer)).toEqual({ kind: 'error', code: 'MISSING_SYMPTOM' });
  });

  it('a photo without a detector is not assessed, and never gets detections', async () => {
    await expect(analyzePhoto(pixels, nullDetector)).resolves.toEqual({
      photoStatus: 'not_taken',
      detections: [],
      detectorAvailable: false,
    });
    await expect(nullDetector.detect(pixels)).rejects.toMatchObject({ code: 'detector_unavailable' });
  });

  it('uses detections from an available detector and fails closed when it throws', async () => {
    const detections: Detection[] = [{ class: 'caries_permanent', confidence: 0.9, box }];
    const ok: Detector = { available: true, name: 'test', modelVersion: '0.0.1', detect: async () => detections };
    const broken: Detector = { ...ok, detect: async () => Promise.reject(new Error('boom')) };
    await expect(analyzePhoto(pixels, ok)).resolves.toEqual({ photoStatus: 'assessed', detections, detectorAvailable: true });
    await expect(analyzePhoto(pixels, broken)).resolves.toMatchObject({ photoStatus: 'not_taken', detectorAvailable: false });
    await expect(analyzePhoto(null, ok)).resolves.toMatchObject({ photoStatus: 'not_taken' });
  });

  it('describes the photo for the referral letter', () => {
    expect(photoFromSession('use', true)).toBe('assessed');
    expect(photoFromSession('use', false)).toBe('not_assessed');
    expect(photoFromSession('quality_failed', false)).toBe('quality_failed');
    expect(photoFromSession('red_flag', false)).toBe('not_taken');
    expect(photoFromRecord({ photoTaken: true, photoStatus: 'not_taken' })).toBe('not_assessed');
    expect(photoFromRecord({ photoTaken: false, photoStatus: 'not_taken' })).toBe('not_taken');
    expect(photoFromRecord({ photoTaken: true, photoStatus: 'assessed' })).toBe('assessed');
    expect(photoFromRecord({ photoTaken: true, photoStatus: 'quality_failed' })).toBe('quality_failed');
  });
});

describe('session store', () => {
  // The local store starts empty (no seed data): add the child under test.
  const child: ChildProfile = {
    id: 'c0c0c0c0-0000-4000-8000-0000000000a1',
    nickname: 'Uji',
    birthYear: 2018,
    birthMonth: 3,
    allergies: [],
  };
  useLocalData.getState().upsertChild(child);
  const passed: QualityResult = {
    passed: true,
    reasons: [],
    metrics: {} as QualityResult['metrics'],
    config_status: 'PLACEHOLDER',
  };

  function answerAll(answers: Record<string, Answer>, pain: number | 'unknown') {
    const s = useScreeningSession.getState();
    for (const [qid, a] of Object.entries(answers)) s.setAnswer(qid, a);
    s.setPain(pain);
  }

  beforeEach(() => {
    useLocalData.setState({ screenings: [] });
    useLocalData.getState().setConsent(child.id, 'a', true);
    useScreeningSession.getState().reset();
  });

  it('a skipped photo never yields routine and is saved locally without a photo', async () => {
    useScreeningSession.getState().start(child, new Date(2026, 9, 11));
    answerAll(allNo(), 0);
    const outcome = await useScreeningSession.getState().finish('skip');
    expect(outcome.kind).toBe('result');
    if (outcome.kind !== 'result') return;
    expect(outcome.output.level).toBe('scheduled');
    expect(outcome.output.reasons.map((r) => r.id)).toContain('CTX_PHOTO_NOT_ASSESSED');
    expect(outcome.output.advice_ids).toEqual(expect.arrayContaining(['ADV_DISCLAIMER_NOT_DIAGNOSIS', 'ADV_REFERRAL_CTA']));
    const s = useScreeningSession.getState();
    expect(s.saveState).toBe('saved');
    const [record] = useLocalData.getState().screenings;
    expect(record).toMatchObject({ childId: child.id, level: 'scheduled', photoTaken: false, photoStatus: 'not_taken', findings: [] });
    expect(JSON.stringify(record)).not.toMatch(/file:|uri/);
  });

  it('a used photo without a detector is "taken, not assessed" (no fake findings)', async () => {
    const s = useScreeningSession.getState();
    s.start(child);
    answerAll(allNo(), 0);
    s.setCapture({ uri: 'mem://photo', width: 640, height: 480, pixels }, passed);
    const outcome = await useScreeningSession.getState().finish('use');
    expect(outcome.kind === 'result' && outcome.output.level).toBe('scheduled');
    const after = useScreeningSession.getState();
    expect(after.analysis).toEqual({ photoStatus: 'not_taken', detections: [], detectorAvailable: false });
    expect(after.pixels).toBeNull();
    expect(useLocalData.getState().screenings[0]).toMatchObject({ photoTaken: true, modelVersion: null });
  });

  it('a red flag after step 1 is an emergency; unasked questions stay out of the record', async () => {
    const s = useScreeningSession.getState();
    s.start(child);
    for (const q of redFlagQuestions) s.setAnswer(q.id, q.id === 'facial_swelling' ? 'yes' : 'no');
    const outcome = await useScreeningSession.getState().finish('red_flag');
    expect(outcome.kind === 'result' && outcome.output.level).toBe('emergency');
    if (outcome.kind === 'result') {
      expect(outcome.output.reasons.map((r) => r.id)).not.toContain('SYM_WHITE_SPOT');
      expect(outcome.output.reasons.map((r) => r.id)).not.toContain('PAIN_UNKNOWN');
    }
    const [record] = useLocalData.getState().screenings;
    expect(record.redFlag).toBe(true);
    expect(record.pain).toBeNull();
    expect(record.answers.white_spot).toBeUndefined();
  });

  it('quality-failed photos keep that status', async () => {
    const s = useScreeningSession.getState();
    s.start(child);
    answerAll(allNo(), 3);
    await useScreeningSession.getState().finish('quality_failed');
    expect(useScreeningSession.getState().analysis?.photoStatus).toBe('quality_failed');
  });

  it('does not save without consent (a) or without a child', async () => {
    useLocalData.getState().setConsent(child.id, 'a', false);
    useScreeningSession.getState().start(child);
    answerAll(allNo(), 0);
    await useScreeningSession.getState().finish('skip');
    expect(useScreeningSession.getState().saveState).toBe('no_consent');

    useScreeningSession.getState().start(null);
    answerAll(allNo(), 0);
    await useScreeningSession.getState().finish('skip');
    expect(useScreeningSession.getState().saveState).toBe('no_child');
    expect(useLocalData.getState().screenings).toHaveLength(0);
  });

  it('counts attempts, discards captures and resets', () => {
    const s = useScreeningSession.getState();
    s.start(child);
    s.setCapture({ uri: 'mem://1', width: 1, height: 1, pixels }, passed);
    s.setCapture({ uri: 'mem://2', width: 1, height: 1, pixels }, passed);
    expect(useScreeningSession.getState().attempts).toBe(2);
    useScreeningSession.getState().discardCapture();
    expect(useScreeningSession.getState().capture).toBeNull();
    useScreeningSession.getState().reset();
    expect(useScreeningSession.getState().startedAt).toBeNull();
  });
});

describe('photo helpers', () => {
  it('never upscales and keeps orientation', () => {
    expect(fitLongestSide(4000, 3000, 1280)).toEqual({ width: 1280 });
    expect(fitLongestSide(3000, 4000, 1280)).toEqual({ height: 1280 });
    expect(fitLongestSide(800, 600, 1280)).toEqual({ width: 800 });
  });

  it('maps the on-screen frame to photo pixels with a margin', () => {
    const view = { x: 0, y: 100, width: 300, height: 400 };
    const frame = { x: 30, y: 250, width: 240, height: 120 };
    const crop = frameToCrop({ width: 1500, height: 2000 }, view, frame, 0.25);
    // scale 5; x: (30 - 60) * 5 -> clamped to 0; y: (150 - 30) * 5 = 600
    expect(crop).toEqual({ originX: 0, originY: 600, width: 1500, height: 900 });
    expect(frameToCrop({ width: 2000, height: 1500 }, view, frame)).toBeNull(); // landscape photo
    expect(frameToCrop({ width: 0, height: 0 }, view, frame)).toBeNull();
  });

  it('picks the smallest 4:3 capture size that is large enough', () => {
    expect(choosePictureSize(['4000x3000', '1920x1080', '2048x1536', '1600x1200', '640x480', 'bad'])).toBe('1600x1200');
    expect(choosePictureSize(['1920x1080'])).toBeUndefined();
  });

  it('decodes JPEG bytes to RGB pixels and reports EXIF', () => {
    const rgba = new Uint8Array(8 * 6 * 4).fill(200);
    const jpeg = encode({ data: rgba, width: 8, height: 6 }, 90).data;
    const b64 = Buffer.from(jpeg).toString('base64');
    const img = decodeJpeg(base64ToBytes(b64));
    expect(img).toMatchObject({ width: 8, height: 6, channels: 3, hasExif: false });
    expect(img.data.length).toBe(8 * 6 * 3);
  });
});
