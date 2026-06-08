import type { Vehicle } from '../../shared/physics'

export const draftMeterRatio = (vehicle: Pick<Vehicle, 'slipstreamPulse'>): number =>
  Number.isFinite(vehicle.slipstreamPulse) ? Math.max(0, Math.min(1, vehicle.slipstreamPulse)) : 0

export const hasActiveDraft = (vehicle: Pick<Vehicle, 'slipstreamPulse'>, threshold = 0.05): boolean =>
  draftMeterRatio(vehicle) > threshold
