// Feature flags. `medical_modules` gates photo detection and triage (ADR 002) and
// stays off in public builds until the regulatory status is clear.
// `dataset_contribution` stays off until an ethics committee (KEPK) approval exists.
export const flags = {
  medical_modules: false,
  dataset_contribution: false,
} as const;
