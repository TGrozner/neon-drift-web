import * as THREE from 'three'
import { SHIP_PROFILES } from '../../shared/constants'
import { add3, cross3, normalize3, scale3, type Vec3 } from '../../shared/math'
import type { RaceState } from '../../shared/race'
import { trackToWorld, type RaceTrack } from '../../shared/track'
import type { Vehicle } from '../../shared/physics'

const toThree = (v: Vec3): THREE.Vector3 => new THREE.Vector3(v.x, v.y, v.z)

const colorForPower = (power: number): string => {
  if (power < 0.22) return '#ffbf4a'
  if (power > 0.74) return '#5dfd7a'
  return '#6ce8ff'
}

export class NeonRenderer {
  private readonly canvas: HTMLCanvasElement
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(72, 1, 0.1, 700)
  private readonly shipGroups = new Map<string, THREE.Group>()
  private readonly shipMaterials = new Map<string, THREE.MeshStandardMaterial>()
  private readonly slipstreamGroup = new THREE.Group()
  private lastCameraUpdate = performance.now()
  private cameraTarget = new THREE.Vector3()
  private trackId = ''

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setClearColor('#05060b')
    this.scene.fog = new THREE.FogExp2('#05060b', 0.006)
    this.scene.add(this.slipstreamGroup)

    const hemi = new THREE.HemisphereLight('#8be9ff', '#08030d', 1.1)
    this.scene.add(hemi)
    const sun = new THREE.DirectionalLight('#ffffff', 2.1)
    sun.position.set(18, 38, 24)
    this.scene.add(sun)

    const grid = new THREE.GridHelper(260, 52, '#1a5367', '#101622')
    grid.position.y = -0.08
    this.scene.add(grid)
  }

  dispose(): void {
    this.renderer.dispose()
    this.shipGroups.clear()
    this.shipMaterials.clear()
  }

  resize(): void {
    const width = this.canvas.clientWidth
    const height = this.canvas.clientHeight
    if (width <= 0 || height <= 0) return
    const pixelWidth = Math.floor(width * Math.min(window.devicePixelRatio, 2))
    const pixelHeight = Math.floor(height * Math.min(window.devicePixelRatio, 2))
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.renderer.setSize(width, height, false)
      this.camera.aspect = width / height
      this.camera.updateProjectionMatrix()
    }
  }

  update(race: RaceState): void {
    this.resize()
    if (this.trackId !== race.track.id) {
      this.rebuildTrack(race.track)
      this.trackId = race.track.id
    }

    for (const vehicle of race.vehicles) {
      this.updateShip(race.track, vehicle)
    }
    this.updateSlipstream(race)
    this.updateCamera(race)
    this.renderer.render(this.scene, this.camera)
  }

  private rebuildTrack(track: RaceTrack): void {
    const stale = this.scene.getObjectByName('track-root')
    if (stale) this.scene.remove(stale)
    const root = new THREE.Group()
    root.name = 'track-root'

    const samples = 320
    const vertices: number[] = []
    const indices: number[] = []
    for (let i = 0; i <= samples; i += 1) {
      const distance = (track.totalLength * i) / samples
      const profile = track.sample(distance)
      const left = add3(profile.center, scale3(profile.right, -profile.width * 0.5))
      const right = add3(profile.center, scale3(profile.right, profile.width * 0.5))
      vertices.push(left.x, left.y, left.z, right.x, right.y, right.z)
      if (i < samples) {
        const base = i * 2
        indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2)
      }
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
    geometry.setIndex(indices)
    geometry.computeVertexNormals()
    const trackMesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: '#141824',
        roughness: 0.74,
        metalness: 0.12,
        emissive: '#061421',
      }),
    )
    root.add(trackMesh)

    const edgeMaterial = new THREE.LineBasicMaterial({ color: '#6ce8ff' })
    for (const side of [-1, 1]) {
      const points: THREE.Vector3[] = []
      for (let i = 0; i <= samples; i += 1) {
        const distance = (track.totalLength * i) / samples
        const profile = track.sample(distance)
        points.push(toThree(add3(profile.center, scale3(profile.right, profile.width * 0.5 * side))))
      }
      root.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), edgeMaterial))
    }

    const gateMaterial = new THREE.LineBasicMaterial({ color: '#ff3df2' })
    for (const gate of track.gates) {
      const profile = track.sample(gate.distance)
      const left = trackToWorld(track, gate.distance, -gate.halfWidth, 0.35)
      const right = trackToWorld(track, gate.distance, gate.halfWidth, 0.35)
      const leftTop = add3(left, scale3(profile.up, 5.8))
      const rightTop = add3(right, scale3(profile.up, 5.8))
      const gateGeometry = new THREE.BufferGeometry().setFromPoints([
        toThree(left),
        toThree(leftTop),
        toThree(leftTop),
        toThree(rightTop),
        toThree(rightTop),
        toThree(right),
      ])
      root.add(new THREE.LineSegments(gateGeometry, gateMaterial))
    }

    for (const pad of track.pads) {
      const profile = track.sample(pad.distance)
      const padMesh = new THREE.Mesh(
        new THREE.BoxGeometry(pad.halfLength * 2, 0.16, pad.halfWidth * 2),
        new THREE.MeshStandardMaterial({
          color: pad.kind === 'boost' ? '#6ce8ff' : '#5dfd7a',
          emissive: pad.kind === 'boost' ? '#164d6b' : '#164d24',
          transparent: true,
          opacity: 0.86,
        }),
      )
      padMesh.position.copy(toThree(trackToWorld(track, pad.distance, pad.lane, 0.14)))
      this.applyBasis(padMesh, profile.tangent, profile.up, profile.right)
      root.add(padMesh)
    }

    this.scene.add(root)
  }

  private updateShip(track: RaceTrack, vehicle: Vehicle): void {
    let group = this.shipGroups.get(vehicle.id)
    if (!group) {
      group = this.createShip(vehicle)
      this.shipGroups.set(vehicle.id, group)
      this.scene.add(group)
    }

    const profile = track.sample(vehicle.distance)
    const position = trackToWorld(track, vehicle.distance, vehicle.lane, 1.25)
    const forward = normalize3(add3(scale3(profile.tangent, Math.cos(vehicle.yawOffset)), scale3(profile.right, Math.sin(vehicle.yawOffset))))
    const visualRight = normalize3(cross3(profile.up, forward), profile.right)
    group.position.copy(toThree(position))
    this.applyBasis(group, forward, profile.up, visualRight)

    const material = this.shipMaterials.get(vehicle.id)
    if (material) {
      material.emissive.set(vehicle.isBoosting ? '#5dfd7a' : colorForPower(vehicle.power))
      material.emissiveIntensity = 0.45 + vehicle.boostIntensity * 1.25 + vehicle.airbrakeExitPulse * 1.4
    }

    const pulseScale = 1 + vehicle.speedPadPulse * 0.12 + vehicle.airbrakeExitPulse * 0.16
    group.scale.setScalar(pulseScale)
  }

  private createShip(vehicle: Vehicle): THREE.Group {
    const group = new THREE.Group()
    const profile = SHIP_PROFILES[vehicle.profileId]
    const material = new THREE.MeshStandardMaterial({
      color: vehicle.isPlayer ? profile.color : '#dbe9ff',
      roughness: 0.28,
      metalness: 0.48,
      emissive: profile.color,
      emissiveIntensity: 0.35,
    })
    this.shipMaterials.set(vehicle.id, material)

    const body = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.46, 1.2), material)
    body.position.x = -0.15
    group.add(body)

    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.72, 1.25, 4), material)
    nose.rotation.z = -Math.PI * 0.5
    nose.position.x = 1.8
    group.add(nose)

    const trailMaterial = new THREE.MeshBasicMaterial({
      color: '#6ce8ff',
      transparent: true,
      opacity: 0.38,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    const trail = new THREE.Mesh(new THREE.ConeGeometry(0.45, 4.8, 12, 1, true), trailMaterial)
    trail.rotation.z = Math.PI * 0.5
    trail.position.x = -3.05
    group.add(trail)

    return group
  }

  private updateSlipstream(race: RaceState): void {
    this.slipstreamGroup.clear()
    const material = new THREE.MeshBasicMaterial({
      color: '#6ce8ff',
      transparent: true,
      opacity: 0.08,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })

    for (const segment of race.slipstream.segments.slice(-70)) {
      const age = race.raceTime - segment.createdAt
      const alpha = Math.max(0, 1 - age / segment.lifetime)
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(segment.halfLength * 2, segment.halfWidth * 2),
        material.clone(),
      )
      const profile = race.track.sample(segment.centerDistance)
      mesh.position.copy(toThree(trackToWorld(race.track, segment.centerDistance, segment.lane, 0.55)))
      this.applyBasis(mesh, profile.tangent, profile.up, profile.right)
      mesh.scale.y = 1 + alpha * 0.3
      const meshMaterial = mesh.material as THREE.MeshBasicMaterial
      meshMaterial.opacity = 0.025 + alpha * segment.intensity * 0.12
      this.slipstreamGroup.add(mesh)
    }
  }

  private updateCamera(race: RaceState): void {
    const player = race.vehicles.find((vehicle) => vehicle.id === race.playerId) ?? race.vehicles[0]
    const profile = race.track.sample(player.distance)
    const position = trackToWorld(race.track, player.distance, player.lane, 1.8)
    const speedRatio = player.telemetry.speedRatio
    const behind = scale3(profile.tangent, -(18 + speedRatio * 16 + player.boostIntensity * 6))
    const above = scale3(profile.up, 10 + speedRatio * 7)
    const side = scale3(profile.right, player.lane * -0.18)
    const desired = toThree(add3(add3(add3(position, behind), above), side))
    const now = performance.now()
    const dt = Math.min(0.05, (now - this.lastCameraUpdate) / 1000)
    this.lastCameraUpdate = now
    this.camera.position.lerp(desired, Math.min(1, dt * 5))
    this.cameraTarget.lerp(toThree(add3(position, scale3(profile.tangent, 14 + speedRatio * 10))), Math.min(1, dt * 7))
    this.camera.lookAt(this.cameraTarget)
    this.camera.fov = 82 + Math.min(34, speedRatio * 18 + player.boostIntensity * 12 + player.speedPadPulse * 9)
    this.camera.updateProjectionMatrix()
  }

  private applyBasis(object: THREE.Object3D, forward: Vec3, up: Vec3, right: Vec3): void {
    const basis = new THREE.Matrix4().makeBasis(toThree(forward), toThree(up), toThree(right))
    object.quaternion.setFromRotationMatrix(basis)
  }
}
