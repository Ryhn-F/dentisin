import { Banner } from '@/components/banner';
import { id } from '@/core/i18n/id';
import { rulesAreDraft, triageRules } from '@/domain/triage';

// Shown on every screening screen while the rules are not dentist-approved
// (backend contract: never present DRAFT output as clinically validated).
export function DraftNotice({ className }: { className?: string }) {
  if (!rulesAreDraft) return null;
  return (
    <Banner
      testID="screening-draft-notice"
      tone="warning"
      icon="science"
      title={id.screening.draftTitle}
      message={triageRules.notice}
      className={className}
    />
  );
}
