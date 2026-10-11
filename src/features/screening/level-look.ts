import type { IconName } from '@/components/icon';
import type { IconTileTone } from '@/components/icon-tile';
import type { TriageLevel } from '@/core/theme';

// Same icon per level as LevelBadge, for compact rows (color + icon + word, never color alone).
export const levelLook: Record<TriageLevel, { icon: IconName; tone: IconTileTone }> = {
  emergency: { icon: 'warning', tone: 'danger' },
  urgent: { icon: 'access-alarm', tone: 'coral' },
  scheduled: { icon: 'event', tone: 'sun' },
  routine: { icon: 'event-repeat', tone: 'mint' },
};
