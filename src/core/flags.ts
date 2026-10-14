// Feature flags. `medical_modules` gates photo screening and triage (ADR 002) and stays off in
// public builds until the regulatory status is clear and a dentist signs off the rules.
// Internal builds (Metro/dev client, or a release build made with EXPO_PUBLIC_INTERNAL_BUILD=true
// for the team's own test phones) turn it on so the flow can be tested with the DRAFT rules;
// EXPO_PUBLIC_MEDICAL_MODULES=false turns it off there too.
// `dataset_contribution` stays off until an ethics committee (KEPK) approval exists.

export function resolveMedicalModules(env: { dev: boolean; internalBuild?: string; medicalModules?: string }): boolean {
  const internal = env.dev || env.internalBuild === 'true';
  return internal && env.medicalModules !== 'false';
}

export const isInternalBuild = __DEV__ || process.env.EXPO_PUBLIC_INTERNAL_BUILD === 'true';

export const flags = {
  medical_modules: resolveMedicalModules({
    dev: __DEV__,
    internalBuild: process.env.EXPO_PUBLIC_INTERNAL_BUILD,
    medicalModules: process.env.EXPO_PUBLIC_MEDICAL_MODULES,
  }),
  dataset_contribution: false,
} as const;
