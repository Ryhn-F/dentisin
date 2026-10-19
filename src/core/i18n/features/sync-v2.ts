// Outbox / sync status v2 (SYNC_EVENTS.md).
// UI strings only (Bahasa Indonesia); wired into `id.syncV2` in ../id.ts and scanned by
// __tests__/forbidden-phrases.test.ts.

export const syncV2 = {
  title: 'Sinkronisasi',

  /** SyncStatusPill states added by the outbox (the others stay in id.components.sync). */
  status: {
    attention: 'Perlu dicek',
  },

  /** One-line explanations of the outbox state (useSyncMessage). */
  messages: {
    localOnly: 'Mode tanpa akun: data hanya disimpan di HP ini.',
    pending: 'Ada data yang belum terkirim. Data dikirim otomatis saat ada sinyal.',
    offline: 'Tidak ada sinyal. Data tetap tersimpan di HP ini dan dikirim nanti.',
    unavailable: 'Kirim data belum tersedia dari server. Data tetap tersimpan di HP ini.',
    authRequired: 'Masuk lagi untuk melanjutkan kirim data. Data tetap tersimpan di HP ini.',
    needsAttention: 'Ada data yang tidak bisa dikirim. Buka daftar untuk melihat alasannya.',
  },

  /** "Needs attention" list. */
  attentionTitle: 'Data yang perlu dicek',
  attentionEmpty: 'Semua data sudah terkirim.',
  dismiss: 'Tutup',
  dismissLabel: 'Tutup catatan ini',
  syncNow: 'Kirim sekarang',
  syncNowLabel: 'Kirim data yang belum terkirim sekarang',
  lastSynced: (time: string) => `Terakhir terkirim ${time}`,
  neverSynced: 'Belum pernah terkirim dari HP ini.',
  statusTitle: 'Status',
  /** "Data yang perlu dicek" row: what the event was, for whom, and when. */
  entryLabel: (what: string, child: string, time: string) => `${what}, ${child}, ${time}`,

  /** Event types in plain words (sync_events types, SYNC_EVENTS.md §3). */
  types: {
    consent_changed: 'Izin data',
    child_upserted: 'Profil anak',
    screening_recorded: 'Hasil skrining',
    brushing_recorded: 'Sikat gigi',
    referral_created: 'Surat rujukan',
    image_upload_registered: 'Foto gigi',
    screening_requested: 'Permintaan periksa',
    brushing_proof_registered: 'Video sikat gigi',
  },

  /** Why the server refused an event (rejection codes, SYNC_EVENTS.md §2). */
  codes: {
    consent_required: 'Izin kirim data belum aktif untuk anak ini.',
    forbidden: 'Data ini tidak bisa dikirim dari akun ini.',
    deletion_pending: 'Data anak ini sedang dalam proses hapus, jadi tidak dikirim lagi.',
    limit_exceeded: 'Batas harian sudah tercapai. Coba lagi besok.',
    feature_disabled: 'Fitur ini belum aktif.',
    schema_invalid: 'Data tidak lengkap sehingga tidak dikirim.',
    unknown_event_type: 'Versi aplikasi ini perlu diperbarui.',
    event_id_conflict: 'Data ini sudah pernah dikirim dengan isi berbeda.',
    entity_conflict: 'Data ini sudah ada di server.',
    dependency_rejected: 'Menunggu data lain yang tidak bisa dikirim.',
    unknown: 'Data ini tidak bisa dikirim.',
  },

  /** Child accounts (simple words, grade-4 level). */
  kid: {
    syncOff: 'Catatanmu disimpan di HP ini. Minta orang tua menyalakan kirim data.',
    pending: 'Catatanmu akan dikirim saat ada sinyal.',
    limitReached: 'Hari ini sudah cukup. Coba lagi besok, ya.',
  },
} as const;
