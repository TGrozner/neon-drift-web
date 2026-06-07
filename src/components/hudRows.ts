import type { Vehicle } from '../../shared/physics'

export type StandingHudRow = {
  position: number
  vehicle: Vehicle
}

export const standingsForHud = (
  standings: Vehicle[],
  playerId: string,
  maxRows = 4,
): StandingHudRow[] => {
  if (maxRows <= 0) return []
  const rows = standings.slice(0, maxRows).map((vehicle, index) => ({
    position: index + 1,
    vehicle,
  }))
  const playerIndex = standings.findIndex((vehicle) => vehicle.id === playerId)
  if (playerIndex >= maxRows) {
    rows[rows.length - 1] = {
      position: playerIndex + 1,
      vehicle: standings[playerIndex],
    }
  }
  return rows
}
