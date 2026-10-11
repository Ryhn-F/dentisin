import { fireEvent, render, screen } from '@testing-library/react-native';
import { useEffect, useState } from 'react';
import { Linking } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { id } from '@/core/i18n/id';
import { ThemeProvider } from '@/core/theme';
import { triageRules, type Answer } from '@/domain/triage';
import { PainScale } from '@/features/screening/components/pain-scale';
import { QuestionCard } from '@/features/screening/components/question-card';
import { ResultDetails } from '@/features/screening/components/result-details';
import type { Pain } from '@/features/screening/pipeline';

const mockPermission = { current: { granted: true, canAskAgain: true } as { granted: boolean; canAskAgain: boolean } | null };

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
  useFocusEffect: (cb: () => void | (() => void)) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useEffect: effect } = require('react');
    effect(cb, [cb]);
  },
}));
jest.mock('expo-keep-awake', () => ({ useKeepAwake: jest.fn() }));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: { JPEG: 'jpeg' } }));
jest.mock('expo-file-system', () => ({ File: jest.fn() }));
jest.mock('expo-camera', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return {
    CameraView: (props: { onCameraReady?: () => void; enableTorch?: boolean; facing?: string }) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useEffect: effect } = require('react');
      effect(() => props.onCameraReady?.(), []);
      return <View testID="camera-view" accessibilityHint={`torch:${String(props.enableTorch)} facing:${props.facing}`} />;
    },
    useCameraPermissions: () => [mockPermission.current, jest.fn()],
  };
});

const s = id.screening;

describe('QuestionCard', () => {
  function Harness() {
    const [value, setValue] = useState<Answer | undefined>();
    return <QuestionCard index={1} total={7} question="Apakah anak demam?" value={value} onChange={setValue} />;
  }

  it('is a labelled radio group with three answers, including "Tidak tahu"', async () => {
    await render(<Harness />);
    expect(screen.getByLabelText(s.questionLabel(1, 7, 'Apakah anak demam?'))).toBeOnTheScreen();
    const unknown = screen.getByRole('radio', { name: s.answers.unknown });
    expect(unknown).not.toBeChecked();
    await fireEvent.press(unknown);
    expect(screen.getByRole('radio', { name: s.answers.unknown })).toBeChecked();
    expect(screen.getByRole('radio', { name: s.answers.yes })).not.toBeChecked();
  });
});

describe('PainScale', () => {
  function Harness() {
    const [value, setValue] = useState<Pain | null>(null);
    return <PainScale value={value} onChange={setValue} />;
  }

  it('offers 0–10 and "Tidak tahu" as radios', async () => {
    await render(<Harness />);
    expect(screen.getAllByRole('radio')).toHaveLength(12);
    await fireEvent.press(screen.getByRole('radio', { name: s.symptoms.painValue(7) }));
    expect(screen.getByRole('radio', { name: s.symptoms.painValue(7) })).toBeChecked();
    expect(screen.getAllByText(s.symptoms.painValue(7)).length).toBeGreaterThan(0);
    await fireEvent.press(screen.getByRole('radio', { name: s.symptoms.painUnknown }));
    expect(screen.getByRole('radio', { name: s.symptoms.painUnknown })).toBeChecked();
  });
});

describe('ResultDetails', () => {
  const reasons = [{ id: 'CTX_PHOTO_NOT_ASSESSED', text: 'Foto gigi belum bisa dinilai.' }];
  const advice = ['ADV_RETAKE_OR_VISIT', 'ADV_DENTIST_SCHEDULED', 'ADV_DISCLAIMER_NOT_DIAGNOSIS', 'ADV_REFERRAL_CTA'];
  const text = (adviceId: string) => triageRules.advice.find((a) => a.id === adviceId)!.text;

  it('always shows level, reasons, advice, disclaimer, referral CTA and the DRAFT notice', async () => {
    const onReferral = jest.fn();
    await render(
      <ResultDetails level="scheduled" reasons={reasons} adviceIds={advice} rulesVersion="0.2.0-draft" onReferral={onReferral} />,
    );
    expect(screen.getByTestId('level-badge-scheduled')).toBeOnTheScreen();
    expect(screen.getByText(reasons[0].text)).toBeOnTheScreen();
    expect(screen.getByText(text('ADV_RETAKE_OR_VISIT'))).toBeOnTheScreen();
    expect(screen.getByTestId('result-disclaimer')).toHaveTextContent(id.common.disclaimer);
    expect(screen.getByText(text('ADV_REFERRAL_CTA'))).toBeOnTheScreen();
    expect(screen.getByTestId('screening-draft-notice')).toBeOnTheScreen();
    expect(screen.queryByTestId('emergency-card')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: s.result.referralAction }));
    expect(onReferral).toHaveBeenCalled();
  });

  it('emergency: shows the alert card with call buttons from the rules contacts', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await render(
      <ResultDetails
        level="emergency"
        reasons={[{ id: 'RF_TRISMUS', text: 'Tanda bahaya.' }]}
        adviceIds={['ADV_EMERGENCY_NOW', 'ADV_FASKES_TODAY', 'ADV_DISCLAIMER_NOT_DIAGNOSIS', 'ADV_REFERRAL_CTA']}
        rulesVersion="0.2.0-draft"
        onReferral={jest.fn()}
      />,
    );
    expect(screen.getByTestId('emergency-card')).toBeOnTheScreen();
    const first = triageRules.contacts.emergency_numbers.value[0];
    await fireEvent.press(screen.getByRole('button', { name: s.result.call(first) }));
    expect(open).toHaveBeenCalledWith(`tel:${first}`);
    // The contact advice is shown once (in the card), not repeated in the advice list.
    expect(screen.getAllByText(text('ADV_EMERGENCY_NOW'))).toHaveLength(1);
    open.mockRestore();
  });

  it('child mode: no outbound call links, asks for an adult instead', async () => {
    await render(
      <ThemeProvider initialMode="child">
        <ResultDetails
          level="emergency"
          reasons={[{ id: 'RF_TRISMUS', text: 'Tanda bahaya.' }]}
          adviceIds={['ADV_EMERGENCY_NOW', 'ADV_DISCLAIMER_NOT_DIAGNOSIS', 'ADV_REFERRAL_CTA']}
          rulesVersion="0.2.0-draft"
          onReferral={jest.fn()}
        />
      </ThemeProvider>,
    );
    expect(screen.getByText(s.result.callAdult)).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: s.result.call(triageRules.contacts.emergency_numbers.value[0]) })).toBeNull();
  });

  it('numbers each finding on the photo and in the list', async () => {
    await render(
      <ResultDetails
        level="urgent"
        reasons={reasons}
        adviceIds={advice}
        rulesVersion="0.2.0-draft"
        photo={{ uri: 'file:///photo.jpg', width: 640, height: 480 }}
        findings={[{ class: 'caries_primary', confidence: 0.8, box: { x: 0.1, y: 0.2, w: 0.1, h: 0.2 } }]}
        onReferral={jest.fn()}
      />,
    );
    expect(screen.getByTestId('finding-box-0')).toBeOnTheScreen();
    expect(screen.getByText(s.result.findings.caries_primary)).toBeOnTheScreen();
    expect(screen.getByLabelText(s.result.photoWithFindings(1))).toBeOnTheScreen();
  });
});

describe('Camera screen', () => {
  // Imported lazily so the module mocks above apply.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const CameraScreen = require('@/app/screening/camera').default as () => React.JSX.Element;

  function Mounted() {
    const [ready, setReady] = useState(false);
    useEffect(() => setReady(true), []);
    return ready ? (
      <SafeAreaProvider
        initialMetrics={{ frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } }}
      >
        <CameraScreen />
      </SafeAreaProvider>
    ) : null;
  }

  beforeEach(() => {
    mockPermission.current = { granted: true, canAskAgain: true };
  });

  it('shows the frame hint, reminders, labelled controls and the torch on by default', async () => {
    await render(<Mounted />);
    expect(screen.getByText(s.camera.frameHint)).toBeOnTheScreen();
    expect(screen.getByText(s.camera.checkTorchOn)).toBeOnTheScreen();
    expect(screen.getByText(s.camera.checkLips)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: s.camera.shutter })).toBeEnabled();
    expect(screen.getByRole('button', { name: s.camera.timerOn })).toBeOnTheScreen();
    expect(screen.getByRole('switch', { name: s.camera.torch })).toBeChecked();
    expect(screen.getByTestId('camera-view')).toHaveProp('accessibilityHint', 'torch:true facing:back');
  });

  it('turns the torch off and explains the front camera has no torch', async () => {
    await render(<Mounted />);
    await fireEvent.press(screen.getByRole('switch', { name: s.camera.torch }));
    expect(screen.getByText(s.camera.checkTorchOff)).toBeOnTheScreen();
    expect(screen.getByTestId('camera-view')).toHaveProp('accessibilityHint', 'torch:false facing:back');
    await fireEvent.press(screen.getByRole('button', { name: s.camera.flip }));
    expect(screen.getByText(s.camera.frontNote)).toBeOnTheScreen();
    expect(screen.queryByRole('switch', { name: s.camera.torch })).toBeNull();
  });

  it('starts a cancellable 3-second countdown', async () => {
    await render(<Mounted />);
    await fireEvent.press(screen.getByRole('button', { name: s.camera.shutter }));
    expect(screen.getAllByLabelText(s.camera.countdownLabel(3)).length).toBeGreaterThan(0);
    await fireEvent.press(screen.getByRole('button', { name: s.camera.cancelCountdown }));
    expect(screen.getByRole('button', { name: s.camera.shutter })).toBeOnTheScreen();
  });

  it('explains the permission and offers settings when it cannot be asked again', async () => {
    mockPermission.current = { granted: false, canAskAgain: false };
    await render(<Mounted />);
    expect(screen.getByText(s.camera.permissionDenied)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: s.camera.permissionSettings })).toBeOnTheScreen();
  });
});
