import { clamp, saturate } from './math'
import type { Vehicle } from './physics'

export const travelYawForVehicle = (vehicle: Pick<Vehicle, 'forwardSpeed' | 'lateralSpeed'>): number =>
  Math.atan2(vehicle.lateralSpeed, Math.max(1, Math.abs(vehicle.forwardSpeed)))

export const visualYawForVehicle = (
  vehicle: Pick<Vehicle, 'isPlayer' | 'yawOffset' | 'forwardSpeed' | 'lateralSpeed' | 'packBumpPulse'>,
): number => {
  const travelYaw = travelYawForVehicle(vehicle)

  if (vehicle.isPlayer) {
    return clamp(vehicle.yawOffset * 1.18, -1.08, 1.08)
  }

  const yawTravelMismatch = Math.abs(vehicle.yawOffset - travelYaw)
  const lateralSlip = Math.abs(vehicle.lateralSpeed) / Math.max(1, Math.abs(vehicle.forwardSpeed) * 0.42)
  const travelWeight = clamp(
    0.46 +
      saturate(vehicle.packBumpPulse / 0.55) * 0.26 +
      saturate(lateralSlip) * 0.12 +
      saturate(yawTravelMismatch / 0.72) * 0.1,
    0.46,
    0.82,
  )
  return clamp(vehicle.yawOffset * (1 - travelWeight) + travelYaw * travelWeight, -0.92, 0.92)
}
