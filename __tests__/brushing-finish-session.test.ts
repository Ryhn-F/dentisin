import type { BrushingRecord } from '@/domain/models';
import { DEFAULT_LIMITS } from '@/domain/models';
import {
  MIN_RECORD_S,
  TARGET_DURATION_S,
  clipSeconds,
  proofMimeForUri,
  proofRecordingLimits,
  remainingSeconds,
  voiceCueFor,
  zoneForElapsed,
} from '@/features/brushing/brushing-session';
import { finishBrushingSession, type FinishDeps, type FinishInput, type ProofTarget } from '@/features/brushing/finish-session';

jest.mock('expo-file-system', () => ({ File: jest.fn(), Directory: jest.fn(), Paths: {}, UploadType: { BINARY_CONTENT: 0 } }));

const CHILD = '33333333-3333-4333-8333-333333333333';
const OWNER = '22222222-2222-4222-8222-222222222222';
const USER = '11111111-1111-4111-8111-111111111111';
const CLIP = 'file:///cache/Camera/clip.mp4';

const target: ProofTarget = { available: true, childId: CHILD, ownerId: OWNER, audience: 'parent', needsPermission: false };

function deps(over: Partial<FinishDeps> = {}): FinishDeps & Record<string, jest.Mock> {
  const record = (childId: string, input: { durationS: number; cameraMode?: boolean }): BrushingRecord => ({
    id: 'brushing-1',
    childId,
    startedAt: '2026-10-18T07:00:00.000Z',
    durationS: input.durationS,
    spiritScore: null,
    slot: 'morning',
    cameraMode: input.cameraMode ?? false,
    synced: false,
    proofId: null,
  });
  return {
    addBrushing: jest.fn(record),
    recordBrushingProof: jest.fn(() => 'event-1'),
    fileSize: jest.fn(() => 6_000_000),
    removeFile: jest.fn(),
    enqueueUpload: jest.fn(async (i) => ({ proofId: i.proofId }) as never),
    flush: jest.fn(),
    newId: jest.fn(() => 'proof-1'),
    ...over,
  } as FinishDeps & Record<string, jest.Mock>;
}

const input = (over: Partial<FinishInput> = {}): FinishInput => ({
  childId: CHILD,
  elapsedS: 120,
  clip: { uri: CLIP, durationS: 118 },
  target,
  limits: DEFAULT_LIMITS,
  userId: USER,
  ...over,
});

describe('session helpers (same timing in timer and camera mode)', () => {
  it('splits the target into four 30-second zones', () => {
    expect(TARGET_DURATION_S).toBe(120);
    expect([0, 29, 30, 59, 60, 90, 119, 120, 500].map((s) => zoneForElapsed(s))).toEqual([0, 0, 1, 1, 2, 3, 3, 3, 3]);
    expect(zoneForElapsed(-5)).toBe(0);
    expect(remainingSeconds(45)).toBe(75);
    expect(remainingSeconds(500)).toBe(0);
  });

  it('voice cue follows the zone while running, says done at the end, and is silent otherwise', () => {
    expect([0, 30, 60, 90, 119].map((s) => voiceCueFor(true, false, s))).toEqual(['start', 'zone2', 'zone3', 'zone4', 'zone4']);
    expect(voiceCueFor(false, false, 45)).toBeNull();
    expect(voiceCueFor(false, true, 12)).toBe('done');
  });

  it('derives recorder limits from my_account().limits (max 180 s, a little under the byte limit)', () => {
    expect(proofRecordingLimits(DEFAULT_LIMITS)).toEqual({ maxDuration: 180, maxFileSize: Math.floor(10_485_760 * 0.97) });
    expect(proofRecordingLimits({ proofMaxBytes: 5_000_000, proofMaxDurationS: 600 }).maxDuration).toBe(180);
    expect(proofRecordingLimits({ proofMaxBytes: 5_000_000, proofMaxDurationS: 90 }).maxDuration).toBe(90);
  });

  it('picks the mime from the file the camera wrote', () => {
    expect(proofMimeForUri('file:///cache/Camera/a.mp4')).toBe('video/mp4');
    expect(proofMimeForUri('file:///cache/Camera/a.MOV')).toBe('video/quicktime');
  });

  it('counts only active recording time', () => {
    const start = 1_000_000;
    expect(clipSeconds({ startedAt: start, pausedMs: 0, pausedAt: null }, start + 61_400, 180)).toBe(61);
    expect(clipSeconds({ startedAt: start, pausedMs: 20_000, pausedAt: null }, start + 80_000, 180)).toBe(60);
    expect(clipSeconds({ startedAt: start, pausedMs: 0, pausedAt: start + 50_000 }, start + 70_000, 180)).toBe(50);
    expect(clipSeconds({ startedAt: start, pausedMs: 0, pausedAt: null }, start + 400_000, 180)).toBe(180);
  });
});

describe('finishBrushingSession', () => {
  it('timer mode: records the session (streak) and nothing else', async () => {
    const d = deps();
    const res = await finishBrushingSession(input({ clip: null, target: null }), d);
    expect(d.addBrushing).toHaveBeenCalledWith(CHILD, { durationS: 120, cameraMode: false });
    expect(d.recordBrushingProof).not.toHaveBeenCalled();
    expect(res.proof).toEqual({ kind: 'none' });
    expect(res.brushing?.id).toBe('brushing-1');
  });

  it('does not record sessions shorter than 10 s and deletes their clip', async () => {
    const d = deps();
    const res = await finishBrushingSession(input({ elapsedS: MIN_RECORD_S - 1 }), d);
    expect(d.addBrushing).not.toHaveBeenCalled();
    expect(d.removeFile).toHaveBeenCalledWith(CLIP);
    expect(res).toEqual({ brushing: null, proof: { kind: 'skipped', reason: 'too_short' } });
  });

  it('records nothing without a child profile', async () => {
    const d = deps();
    const res = await finishBrushingSession(input({ childId: null, clip: null, target: null }), d);
    expect(d.addBrushing).not.toHaveBeenCalled();
    expect(res.proof).toEqual({ kind: 'none' });
  });

  it('camera mode: brushing first (cameraMode), then the proof event, then the upload queue', async () => {
    const d = deps();
    const res = await finishBrushingSession(input(), d);
    expect(d.addBrushing).toHaveBeenCalledWith(CHILD, { durationS: 120, cameraMode: true });
    expect(d.recordBrushingProof).toHaveBeenCalledWith({
      proofId: 'proof-1',
      childId: CHILD,
      brushingRecordId: 'brushing-1',
      sizeBytes: 6_000_000,
      durationS: 118,
      mime: 'video/mp4',
    });
    expect(d.enqueueUpload).toHaveBeenCalledWith({
      userId: USER,
      proofId: 'proof-1',
      eventId: 'event-1',
      childId: CHILD,
      ownerId: OWNER,
      audience: 'parent',
      mime: 'video/mp4',
      sourceUri: CLIP,
      sizeBytes: 6_000_000,
      durationS: 118,
    });
    expect(d.flush).toHaveBeenCalled();
    expect(d.removeFile).not.toHaveBeenCalled();
    expect(res.proof).toEqual({ kind: 'queued', proofId: 'proof-1', audience: 'parent' });
    const order = ([d.addBrushing, d.recordBrushingProof, d.enqueueUpload] as unknown as jest.Mock[]).map((m) => m.mock.invocationCallOrder[0]);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('the proof belongs to the child the camera was allowed for', async () => {
    const d = deps();
    await finishBrushingSession(input({ childId: 'some-other-active-child' }), d);
    expect(d.addBrushing).toHaveBeenCalledWith(CHILD, expect.anything());
  });

  it.each([
    ['over proof_max_bytes', { fileSize: jest.fn(() => DEFAULT_LIMITS.proofMaxBytes + 1) }, {}, 'too_large'],
    ['over proof_max_duration_s', {}, { clip: { uri: CLIP, durationS: 181 } }, 'too_long'],
    ['shorter than 10 s', {}, { clip: { uri: CLIP, durationS: 9 } }, 'too_short'],
    ['the bridge refused (no capability / consent)', { recordBrushingProof: jest.fn(() => null) }, {}, 'not_sent'],
  ])('clip %s: not sent, file deleted, session still recorded', async (_name, depOver, inputOver, reason) => {
    const d = deps(depOver as Partial<FinishDeps>);
    const res = await finishBrushingSession(input(inputOver as Partial<FinishInput>), d);
    expect(d.addBrushing).toHaveBeenCalledWith(CHILD, { durationS: 120, cameraMode: true });
    expect(d.enqueueUpload).not.toHaveBeenCalled();
    expect(d.removeFile).toHaveBeenCalledWith(CLIP);
    expect(res.proof).toEqual({ kind: 'skipped', reason });
  });

  it('a missing file is reported as missing', async () => {
    const d = deps({ fileSize: jest.fn(() => null) });
    const res = await finishBrushingSession(input(), d);
    expect(d.recordBrushingProof).not.toHaveBeenCalled();
    expect(res.proof).toEqual({ kind: 'skipped', reason: 'missing' });
  });

  it('QuickTime clips (iOS) are registered as video/quicktime', async () => {
    const d = deps();
    await finishBrushingSession(input({ clip: { uri: 'file:///cache/Camera/clip.mov', durationS: 60 } }), d);
    expect(d.recordBrushingProof).toHaveBeenCalledWith(expect.objectContaining({ mime: 'video/quicktime', durationS: 60 }));
  });

  it('when the queue cannot take the clip (other user), the session stays recorded', async () => {
    const d = deps({ enqueueUpload: jest.fn(async () => null) });
    const res = await finishBrushingSession(input(), d);
    expect(res.proof).toEqual({ kind: 'skipped', reason: 'not_sent' });
    expect(d.removeFile).not.toHaveBeenCalled(); // the queue deleted it already
    expect(res.brushing).not.toBeNull();
  });

  it('a clip without a camera target (should not happen) is deleted', async () => {
    const d = deps();
    const res = await finishBrushingSession(input({ target: null }), d);
    expect(d.removeFile).toHaveBeenCalledWith(CLIP);
    expect(res.proof).toEqual({ kind: 'skipped', reason: 'not_sent' });
  });
});
