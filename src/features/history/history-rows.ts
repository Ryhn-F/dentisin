// Pure description of one timeline entry as a list row: icon, title, subtitle, value.
// Adult screens (guardian / teen / guest) and the child account use different wording; the
// child's rows never mention results (a child account never sees them).
import type { IconName } from '@/components/icon';
import type { IconTileTone } from '@/components/icon-tile';
import { id } from '@/core/i18n/id';
import { fromServerLevel, type BrushingSlot, type HistoryItem, type ServerLevel } from '@/domain/models';
import { levelLook } from '@/features/screening/level-look';
import { formatClock, formatDateTime } from '@/ui/format';

import type { HistoryAudience, TimelineEntry } from './history-model';

const t = id.timeline;
const DAY_MS = 24 * 60 * 60 * 1000;

export type RowLook = {
  icon: IconName;
  tone: IconTileTone;
  title: string;
  subtitle: string;
  /** Right-hand value, e.g. the brushing duration. */
  value?: string;
};

const slotIcon: Record<BrushingSlot, { icon: IconName; tone: IconTileTone }> = {
  morning: { icon: 'wb-sunny', tone: 'sun' },
  evening: { icon: 'nightlight-round', tone: 'blue' },
  other: { icon: 'schedule', tone: 'lavender' },
};

/** Whole days from `now` to `iso`, rounded up (0 = today or already past). */
export function daysUntil(iso: string, now: Date = new Date()): number {
  const ms = Date.parse(iso) - now.getTime();
  return Number.isNaN(ms) ? 0 : Math.max(0, Math.ceil(ms / DAY_MS));
}

function join(parts: readonly (string | null | false | undefined)[]): string {
  return parts.filter((p): p is string => !!p).join(' · ');
}

function levelLabel(level: ServerLevel): string {
  return id.levels[fromServerLevel(level)].label;
}

function describeServer(item: HistoryItem, audience: HistoryAudience, now: Date): RowLook {
  const when = formatDateTime(item.occurredAt);
  const kid = audience === 'child';
  switch (item.kind) {
    case 'brushing': {
      const d = item.data;
      const look = slotIcon[d.slot];
      return {
        ...look,
        title: kid ? t.kid.brushing.title[d.slot] : t.row.brushing.title[d.slot],
        subtitle: join([when, !kid && d.hasProof && t.row.brushing.hasProof, !kid && !d.countsForStreak && t.row.brushing.notCounted]),
        value: formatClock(d.durationS),
      };
    }
    case 'screening': {
      const d = item.data;
      const app = fromServerLevel(d.level);
      return {
        ...levelLook[app],
        title: t.row.screening.title(levelLabel(d.level)),
        subtitle: join([
          when,
          d.redFlag && t.row.screening.redFlag,
          d.findingsCount > 0 && t.row.screening.findings(d.findingsCount),
          d.requestId && t.row.screening.answersRequest,
        ]),
      };
    }
    case 'referral': {
      const d = item.data;
      return {
        icon: 'description',
        tone: 'blue',
        title: t.row.referral.title,
        subtitle: join([when, levelLabel(d.level), t.row.referral.reasons(d.reasonCodes.length)]),
      };
    }
    case 'screening_request': {
      const d = item.data;
      return {
        icon: 'medical-services',
        tone: d.reasonCode === 'swelling' ? 'danger' : 'coral',
        title: kid ? t.kid.request.title(t.kid.reasons[d.reasonCode]) : t.row.request.title(t.reasons[d.reasonCode]),
        subtitle: kid ? join([t.kid.requestStatus[d.status], when]) : join([t.requestStatus[d.status], when]),
      };
    }
    case 'brushing_proof': {
      const d = item.data;
      const gone = d.status === 'deleted' || d.status === 'expired';
      if (kid) {
        const status = gone ? t.kid.proof.deleted : d.status === 'viewed' ? t.kid.proof.viewed : t.kid.proof.sent;
        return { icon: 'videocam', tone: 'mint', title: t.kid.proof.title, subtitle: join([status, when]), value: formatClock(d.durationS) };
      }
      const days = daysUntil(d.expiresAt, now);
      return {
        icon: 'videocam',
        tone: 'mint',
        title: t.row.proof.title,
        subtitle: join([
          t.proofStatus[d.status],
          !gone && (days === 0 ? t.row.proof.expiresToday : t.row.proof.expiresIn(days)),
          when,
        ]),
        value: formatClock(d.durationS),
      };
    }
  }
}

function screeningPhotoLabel(r: { photoStatus: 'assessed' | 'not_taken' | 'quality_failed'; photoTaken: boolean }) {
  if (r.photoStatus === 'assessed') return id.history.screeningPhoto.assessed;
  if (r.photoStatus === 'quality_failed') return id.history.screeningPhoto.quality_failed;
  return r.photoTaken ? id.history.screeningPhoto.notAssessed : id.history.screeningPhoto.not_taken;
}

/** Row content of a timeline entry, local or server. */
export function describeEntry(entry: TimelineEntry, audience: HistoryAudience, now: Date = new Date()): RowLook {
  const kid = audience === 'child';
  if (entry.origin === 'server') return describeServer(entry.item, audience, now);
  const unsyncedTag = entry.unsynced && (kid ? t.kid.unsynced : t.unsynced);
  const when = formatDateTime(entry.occurredAt);
  if (entry.kind === 'brushing') {
    const r = entry.record;
    return {
      ...slotIcon[r.slot],
      title: kid ? t.kid.brushing.title[r.slot] : t.row.brushing.title[r.slot],
      subtitle: join([when, !kid && r.proofId && t.row.brushing.hasProof, unsyncedTag]),
      value: formatClock(r.durationS),
    };
  }
  const r = entry.record;
  return {
    ...levelLook[r.level],
    title: t.row.screening.title(id.levels[r.level].label),
    subtitle: join([when, r.redFlag && t.row.screening.redFlag, screeningPhotoLabel(r), unsyncedTag]),
  };
}
