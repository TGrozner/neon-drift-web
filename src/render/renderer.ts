import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { SHIP_PROFILES } from '../../shared/constants'
import { add3, clamp, cross3, dot3, normalize3, scale3, type Vec3 } from '../../shared/math'
import type { RaceState } from '../../shared/race'
import { trackToWorld, type RaceTrack } from '../../shared/track'
import type { Vehicle } from '../../shared/physics'

const toThree = (v: Vec3): THREE.Vector3 => new THREE.Vector3(v.x, v.y, v.z)

const modelLoader = new GLTFLoader()
const modelCache = new Map<string, Promise<THREE.Group>>()

const shipModels = {
  balanced: '/models/neon_drift/ships/prototype_scout.glb',
  swift: '/models/neon_drift/ships/prototype_swift.glb',
  heavy: '/models/neon_drift/ships/prototype_heavy.glb',
} as const
const RENDERED_SLIPSTREAM_SEGMENTS = 24
const ENABLE_SOURCE_SHIP_MODELS = true

const loadModel = (url: string): Promise<THREE.Group> => {
  const cached = modelCache.get(url)
  if (cached) return cached
  const promise = new Promise<THREE.Group>((resolve, reject) => {
    modelLoader.load(url, (gltf) => resolve(gltf.scene), undefined, reject)
  })
  modelCache.set(url, promise)
  return promise
}

const cloneModel = (template: THREE.Group): THREE.Group => {
  const clone = template.clone(true)
  clone.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    if (Array.isArray(mesh.material)) {
      mesh.material = mesh.material.map((material) => material.clone())
    } else if (mesh.material) {
      mesh.material = mesh.material.clone()
    }
  })
  return clone
}

const shouldPreserveDrawingBuffer = (): boolean =>
  new URLSearchParams(window.location.search).has('e2e') ||
  Boolean((window as Window & typeof globalThis & { __NEON_E2E__?: boolean }).__NEON_E2E__)

const renderPixelRatio = (): number => Math.min(window.devicePixelRatio, 1.5)

const colorForPower = (power: number): string => {
  if (power < 0.22) return '#ffbf4a'
  if (power > 0.74) return '#5dfd7a'
  return '#6ce8ff'
}

export const createRenderBasis = (
  forward: Vec3,
  up: Vec3,
  fallbackRight: Vec3 = { x: 0, y: 0, z: 1 },
): { forward: Vec3; up: Vec3; right: Vec3 } => {
  const x = normalize3(forward)
  const z = normalize3(cross3(x, up), fallbackRight)
  const y = normalize3(cross3(z, x), up)
  return { forward: x, up: y, right: z }
}

export class NeonRenderer {
  private readonly canvas: HTMLCanvasElement
  private readonly renderer: THREE.WebGLRenderer
  private readonly composer: EffectComposer
  private readonly bloomPass: UnrealBloomPass
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(72, 1, 0.1, 700)
  private readonly shipGroups = new Map<string, THREE.Group>()
  private readonly shipMaterials = new Map<string, THREE.MeshStandardMaterial>()
  private readonly gateLines = new Map<number, THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>>()
  private readonly slipstreamGroup = new THREE.Group()
  private readonly slipstreamMesh: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  private readonly slipstreamDummy = new THREE.Object3D()
  private readonly slipstreamColor = new THREE.Color()
  private lastCameraUpdate = performance.now()
  private cameraTarget = new THREE.Vector3()
  private smoothedCameraForward = new THREE.Vector3()
  private cameraRoll = 0
  private trackId = ''

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: shouldPreserveDrawingBuffer(),
    })
    this.renderer.setPixelRatio(renderPixelRatio())
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.08
    this.renderer.setClearColor('#05060b')
    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.72, 0.58, 0.16)
    this.composer.addPass(this.bloomPass)
    this.composer.addPass(new OutputPass())
    this.scene.fog = new THREE.FogExp2('#05060b', 0.006)
    this.slipstreamMesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        color: '#6ce8ff',
        transparent: true,
        opacity: 0.18,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        vertexColors: true,
      }),
      RENDERED_SLIPSTREAM_SEGMENTS,
    )
    this.slipstreamMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.slipstreamGroup.add(this.slipstreamMesh)
    this.scene.add(this.slipstreamGroup)

    const hemi = new THREE.HemisphereLight('#8be9ff', '#08030d', 1.1)
    this.scene.add(hemi)
    const sun = new THREE.DirectionalLight('#ffffff', 2.1)
    sun.position.set(18, 38, 24)
    this.scene.add(sun)

    const grid = new THREE.GridHelper(260, 52, '#1a5367', '#101622')
    grid.position.y = -0.08
    grid.material.opacity = 0.32
    grid.material.transparent = true
    this.scene.add(grid)
  }

  dispose(): void {
    this.disposeObject(this.scene)
    this.renderer.dispose()
    this.shipGroups.clear()
    this.shipMaterials.clear()
  }

  resize(): void {
    const width = this.canvas.clientWidth
    const height = this.canvas.clientHeight
    if (width <= 0 || height <= 0) return
    const pixelRatio = renderPixelRatio()
    const pixelWidth = Math.floor(width * pixelRatio)
    const pixelHeight = Math.floor(height * pixelRatio)
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.renderer.setSize(width, height, false)
      this.composer.setSize(width, height)
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
    this.updateGateHighlights(race)
    this.updateCamera(race)
    this.updatePostProcessing(race)
    this.composer.render()
    const statsWindow = window as Window & typeof globalThis & {
      __NEON_RENDER_STATS?: { calls: number; triangles: number; sourceShipCount: number; bloomStrength: number }
    }
    const stats = statsWindow.__NEON_RENDER_STATS ?? { calls: 0, triangles: 0, sourceShipCount: 0, bloomStrength: 0 }
    stats.calls = this.renderer.info.render.calls
    stats.triangles = this.renderer.info.render.triangles
    stats.sourceShipCount = [...this.shipGroups.values()].filter((group) => group.getObjectByName('source-ship-model')).length
    stats.bloomStrength = this.bloomPass.strength
    statsWindow.__NEON_RENDER_STATS = stats
  }

  private rebuildTrack(track: RaceTrack): void {
    const stale = this.scene.getObjectByName('track-root')
    if (stale) {
      this.scene.remove(stale)
      this.disposeObject(stale)
    }
    this.gateLines.clear()
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

    this.addTrackKitSegments(root, track)

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
      const gateMaterial = new THREE.LineBasicMaterial({
        color: '#ff3df2',
        transparent: true,
        opacity: 0.36,
        toneMapped: false,
      })
      const gateLine = new THREE.LineSegments(gateGeometry, gateMaterial)
      gateLine.userData.gateIndex = gate.index
      root.add(gateLine)
      this.gateLines.set(gate.index, gateLine)
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

    const startProfile = track.sample(0)
    const startMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.36, 0.18, startProfile.width + 1.6),
      new THREE.MeshStandardMaterial({
        color: '#ff3df2',
        emissive: '#4d1049',
        emissiveIntensity: 0.9,
        roughness: 0.38,
        metalness: 0.22,
      }),
    )
    startMesh.position.copy(toThree(trackToWorld(track, 0, 0, 0.18)))
    this.applyBasis(startMesh, startProfile.tangent, startProfile.up, startProfile.right)
    root.add(startMesh)

    this.scene.add(root)
  }

  private addTrackKitSegments(root: THREE.Group, track: RaceTrack): void {
    const segmentCount = Math.round(clamp(track.totalLength / 6.8, 48, 120))
    const segmentLength = track.totalLength / segmentCount
    const slabMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({
        color: '#171b28',
        roughness: 0.7,
        metalness: 0.16,
        emissive: '#081927',
        emissiveIntensity: 0.32,
      }),
      segmentCount,
    )
    const railMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({
        color: '#263345',
        roughness: 0.5,
        metalness: 0.34,
        emissive: '#0d3d54',
        emissiveIntensity: 0.5,
      }),
      segmentCount * 2,
    )
    const dummy = new THREE.Object3D()
    let railIndex = 0
    for (let i = 0; i < segmentCount; i += 1) {
      const distance = (track.totalLength * (i + 0.5)) / segmentCount
      const profile = track.sample(distance)
      this.setInstance(
        slabMesh,
        i,
        dummy,
        add3(profile.center, scale3(profile.up, -0.08)),
        profile,
        new THREE.Vector3(segmentLength + 0.96, 0.14, profile.width),
      )

      const railOffset = profile.width * 0.5 + 0.34
      for (const side of [-1, 1]) {
        this.setInstance(
          railMesh,
          railIndex,
          dummy,
          add3(add3(profile.center, scale3(profile.right, railOffset * side)), scale3(profile.up, 0.42)),
          profile,
          new THREE.Vector3(segmentLength + 0.96, 0.82, 0.22),
        )
        railIndex += 1
      }
    }
    slabMesh.instanceMatrix.needsUpdate = true
    railMesh.instanceMatrix.needsUpdate = true
    root.add(slabMesh, railMesh)
  }

  private setInstance(
    mesh: THREE.InstancedMesh,
    index: number,
    dummy: THREE.Object3D,
    position: Vec3,
    profile: { tangent: Vec3; up: Vec3; right: Vec3 },
    scale: THREE.Vector3,
  ): void {
    dummy.position.copy(toThree(position))
    this.applyBasis(dummy, profile.tangent, profile.up, profile.right)
    dummy.scale.copy(scale)
    dummy.updateMatrix()
    mesh.setMatrixAt(index, dummy.matrix)
  }

  private updateShip(track: RaceTrack, vehicle: Vehicle): void {
    let group = this.shipGroups.get(vehicle.id)
    if (group && group.userData.profileId !== vehicle.profileId) {
      this.scene.remove(group)
      this.disposeObject(group)
      this.shipGroups.delete(vehicle.id)
      this.shipMaterials.delete(vehicle.id)
      group = undefined
    }
    if (!group) {
      group = this.createShip(vehicle)
      this.shipGroups.set(vehicle.id, group)
      this.scene.add(group)
    }

    const profile = track.sample(vehicle.distance)
    const hoverClearance = vehicle.telemetry.hoverClearance || 1.25
    const position = trackToWorld(track, vehicle.distance, vehicle.lane, hoverClearance)
    const visualYaw = clamp(vehicle.yawOffset * 1.18, -1.08, 1.08)
    const forward = normalize3(add3(scale3(profile.tangent, Math.cos(visualYaw)), scale3(profile.right, Math.sin(visualYaw))))
    const visualRight = normalize3(cross3(forward, profile.up), profile.right)
    group.position.copy(toThree(position))
    this.applyBasis(group, forward, profile.up, visualRight)
    group.rotateX(clamp(vehicle.visualBank, -0.84, 0.84))
    group.rotateZ(clamp(vehicle.visualPitch - vehicle.boostIntensity * 0.04 - vehicle.speedPadPulse * 0.035, -0.24, 0.18))

    const material = this.shipMaterials.get(vehicle.id)
    if (material) {
      material.emissive.set(vehicle.isBoosting ? '#5dfd7a' : colorForPower(vehicle.power))
      material.emissiveIntensity = 0.45 + vehicle.boostIntensity * 1.25 + vehicle.airbrakeExitPulse * 1.4
    }
    const sourceMaterials = group.userData.sourceMaterials as THREE.MeshStandardMaterial[] | undefined
    if (sourceMaterials) {
      for (const sourceMaterial of sourceMaterials) {
        sourceMaterial.emissive.set(vehicle.isBoosting ? '#5dfd7a' : colorForPower(vehicle.power))
        sourceMaterial.emissiveIntensity = 0.18 + vehicle.boostIntensity * 0.7 + vehicle.airbrakeExitPulse * 0.8
      }
    }

    const trail = group.getObjectByName('engine-trail') as THREE.Mesh<THREE.ConeGeometry, THREE.MeshBasicMaterial> | undefined
    if (trail) {
      const trailPower = clamp(
        vehicle.telemetry.speedRatio * 0.72 + vehicle.boostIntensity * 0.52 + vehicle.speedPadPulse * 0.34,
        0.18,
        1.7,
      )
      trail.scale.set(0.8 + trailPower * 0.32, 0.72 + trailPower * 1.35, 0.8 + trailPower * 0.32)
      trail.material.opacity = clamp(0.18 + trailPower * 0.34, 0.16, 0.72)
      trail.material.color.set(vehicle.isBoosting ? '#5dfd7a' : vehicle.airbrakeExitPulse > 0.05 ? '#ffbf4a' : '#6ce8ff')
    }

    const pulseScale = 1 + vehicle.speedPadPulse * 0.12 + vehicle.airbrakeExitPulse * 0.16
    group.scale.setScalar(pulseScale)
  }

  private createShip(vehicle: Vehicle): THREE.Group {
    const group = new THREE.Group()
    group.userData.profileId = vehicle.profileId
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
    trail.name = 'engine-trail'
    trail.rotation.z = Math.PI * 0.5
    trail.position.x = -3.05
    group.add(trail)

    const fallback = new THREE.Group()
    fallback.name = 'fallback-ship-model'
    fallback.add(body, nose)
    group.add(fallback)
    if (!ENABLE_SOURCE_SHIP_MODELS) return group

    void loadModel(shipModels[vehicle.profileId]).then((template) => {
      if (!group.parent || group.userData.profileId !== vehicle.profileId) return
      const model = cloneModel(template)
      model.name = 'source-ship-model'
      this.fitSourceShipModel(model)
      const sourceMaterials: THREE.MeshStandardMaterial[] = []
      model.traverse((object) => {
        const mesh = object as THREE.Mesh
        if (!mesh.isMesh) return
        if (mesh.name.includes('ReferenceCollisionBounds')) {
          mesh.visible = false
          return
        }
        const meshMaterial = mesh.material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[]
        const materials = Array.isArray(meshMaterial) ? meshMaterial : [meshMaterial]
        for (const sourceMaterial of materials) {
          if (!sourceMaterial || !('emissive' in sourceMaterial)) continue
          const materialName = sourceMaterial.name.toLowerCase()
          const meshName = mesh.name.toLowerCase()
          const isGlowMaterial =
            materialName.includes('cyan') ||
            materialName.includes('glow') ||
            materialName.includes('engine') ||
            meshName.includes('edge') ||
            meshName.includes('core') ||
            meshName.includes('emitter') ||
            meshName.includes('stripe')
          if (!isGlowMaterial) continue
          sourceMaterial.emissive = new THREE.Color(vehicle.isPlayer ? profile.color : '#6ce8ff')
          sourceMaterial.emissiveIntensity = vehicle.isPlayer ? 0.28 : 0.18
          sourceMaterial.toneMapped = false
          sourceMaterials.push(sourceMaterial)
        }
      })
      group.userData.sourceMaterials = sourceMaterials
      fallback.visible = false
      group.add(model)
    }).catch(() => undefined)

    return group
  }

  private fitSourceShipModel(model: THREE.Group): void {
    model.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(model)
    const size = new THREE.Vector3()
    box.getSize(size)
    if (size.z > size.x * 1.25) {
      model.rotation.y = Math.PI * 0.5
      model.updateMatrixWorld(true)
      box.setFromObject(model)
      box.getSize(size)
    }
    const scale = 3.65 / Math.max(0.001, size.x)
    model.scale.setScalar(scale)
    model.updateMatrixWorld(true)
    box.setFromObject(model)
    const center = new THREE.Vector3()
    box.getCenter(center)
    model.position.sub(center)
    model.position.y += 0.02
  }

  private updateSlipstream(race: RaceState): void {
    const segments = race.slipstream.segments.slice(-RENDERED_SLIPSTREAM_SEGMENTS)
    for (let index = 0; index < RENDERED_SLIPSTREAM_SEGMENTS; index += 1) {
      const segment = segments[index]
      if (!segment) {
        this.slipstreamDummy.scale.set(0, 0, 0)
        this.slipstreamDummy.updateMatrix()
        this.slipstreamMesh.setMatrixAt(index, this.slipstreamDummy.matrix)
        this.slipstreamMesh.setColorAt(index, this.slipstreamColor.setRGB(0, 0, 0))
        continue
      }
      const age = race.raceTime - segment.createdAt
      const alpha = Math.max(0, 1 - age / segment.lifetime)
      const profile = race.track.sample(segment.centerDistance)
      this.slipstreamDummy.position.copy(toThree(trackToWorld(race.track, segment.centerDistance, segment.lane, 0.55)))
      this.applyBasis(this.slipstreamDummy, profile.tangent, profile.right, profile.up)
      this.slipstreamDummy.scale.set(segment.halfLength * 2, segment.halfWidth * 2 * (1 + alpha * 0.3), 1)
      this.slipstreamDummy.updateMatrix()
      this.slipstreamMesh.setMatrixAt(index, this.slipstreamDummy.matrix)
      const brightness = 0.18 + alpha * segment.intensity * 0.82
      this.slipstreamMesh.setColorAt(index, this.slipstreamColor.setRGB(brightness, brightness, brightness))
    }
    this.slipstreamMesh.instanceMatrix.needsUpdate = true
    if (this.slipstreamMesh.instanceColor) this.slipstreamMesh.instanceColor.needsUpdate = true
  }

  private updateGateHighlights(race: RaceState): void {
    const player = race.vehicles.find((vehicle) => vehicle.id === race.playerId) ?? race.vehicles[0]
    const pulse = 0.5 + Math.sin((race.raceTime + race.phaseTime) * 9.2) * 0.5
    for (const [index, gateLine] of this.gateLines) {
      const material = gateLine.material
      if (index === player.nextGateIndex) {
        material.color.set('#fff27a')
        material.opacity = 0.72 + pulse * 0.24
      } else if (index === player.lastGateIndex) {
        material.color.set('#5dfd7a')
        material.opacity = 0.26
      } else {
        material.color.set('#ff3df2')
        material.opacity = 0.18
      }
    }
  }

  private updatePostProcessing(race: RaceState): void {
    const player = race.vehicles.find((vehicle) => vehicle.id === race.playerId) ?? race.vehicles[0]
    const energy = clamp(
      player.boostIntensity * 0.45 +
        player.speedPadPulse * 0.34 +
        player.airbrakeExitPulse * 0.3 +
        player.slipstreamPulse * 0.18 +
        player.rivalPassPulse * 0.2,
      0,
      1,
    )
    this.bloomPass.strength = 0.62 + energy * 0.58
    this.bloomPass.radius = 0.48 + energy * 0.18
    this.renderer.toneMappingExposure = 1.06 + energy * 0.12
  }

  private disposeObject(object: THREE.Object3D): void {
    object.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.geometry?.dispose()
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const material of materials) material?.dispose()
    })
  }

  private updateCamera(race: RaceState): void {
    const player = race.vehicles.find((vehicle) => vehicle.id === race.playerId) ?? race.vehicles[0]
    const profile = race.track.sample(player.distance)
    const position = trackToWorld(race.track, player.distance, player.lane, (player.telemetry.hoverClearance || 1.2) + 0.55)
    const speedRatio = player.telemetry.speedRatio
    const driveForward = normalize3(add3(scale3(profile.tangent, Math.cos(player.yawOffset)), scale3(profile.right, Math.sin(player.yawOffset))))
    const ahead = race.track.sample(player.distance + 8.4)
    const curveAmount = clamp((1 - dot3(profile.tangent, ahead.tangent)) / 0.28, 0, 1)
    const bankSafety = clamp((Math.abs(profile.bankDegrees) - 52) / 70, 0, 1)
    const trackBlend = 0.26 + (0.54 - 0.26) * bankSafety
    const targetForward = normalize3(add3(scale3(driveForward, 1 - trackBlend), scale3(profile.tangent, trackBlend)), profile.tangent)
    const above = scale3(profile.up, 2.55 + speedRatio * 1.35)
    const now = performance.now()
    const dt = Math.min(0.05, (now - this.lastCameraUpdate) / 1000)
    this.lastCameraUpdate = now
    const forwardSharpness = 8.4 * (1 - 0.48 * clamp(speedRatio, 0, 1) * curveAmount)
    const targetForwardThree = toThree(targetForward)
    if (this.smoothedCameraForward.lengthSq() <= 0.001) {
      this.smoothedCameraForward.copy(targetForwardThree)
    } else {
      this.smoothedCameraForward.lerp(targetForwardThree, Math.min(1, dt * forwardSharpness)).normalize()
    }

    const cameraForward = normalize3(
      {
        x: this.smoothedCameraForward.x,
        y: this.smoothedCameraForward.y,
        z: this.smoothedCameraForward.z,
      },
      targetForward,
    )
    const cameraRight = normalize3(cross3(cameraForward, profile.up), profile.right)
    const sideSlip = clamp(player.lateralSpeed / Math.max(1, SHIP_PROFILES[player.profileId].boostSpeed), -1, 1)
    const eventPush =
      player.boostStartPulse * 0.45 +
      player.speedPadPulse * 2.55 +
      player.airbrakeExitPulse * 2.25 +
      player.slipstreamPulse * 0.78 +
      player.rivalPassPulse * 1.44 +
      player.crashOutLaunchRemaining * 0.72
    const behind = scale3(cameraForward, -(6.8 + speedRatio * 2.4 + player.boostIntensity * 1.1 + eventPush * 0.42))
    const side = scale3(cameraRight, clamp(-sideSlip * 1.1 - player.telemetry.railPressure * Math.sign(player.lane) * 0.68, -1.8, 1.8))
    const shakeIntensity = clamp(
      player.boostStartPulse * 0.12 +
        player.speedPadPulse * 0.18 +
        player.airbrakeExitPulse * 0.16 +
        player.packBumpPulse * 0.22 +
        player.powerDamagePulse * 0.18 +
        player.telemetry.railPressure * 0.12,
      0,
      0.42,
    )
    const shakeRight = Math.sin(race.raceTime * 43.7) * shakeIntensity
    const shakeUp = Math.cos(race.raceTime * 37.1) * shakeIntensity * 0.62
    const shake = add3(scale3(cameraRight, shakeRight), scale3(profile.up, shakeUp))
    const desired = toThree(add3(add3(add3(add3(position, behind), above), side), shake))
    const lookAhead = (8.4 + speedRatio * 2.4) * (1 - curveAmount * 0.34)
    this.camera.position.lerp(desired, Math.min(1, dt * 13.8))
    this.cameraTarget.lerp(toThree(add3(add3(position, scale3(cameraForward, Math.max(5.5, lookAhead))), scale3(cameraRight, sideSlip * 0.42))), Math.min(1, dt * forwardSharpness))
    const cameraUp = new THREE.Vector3(0, 1, 0).lerp(toThree(profile.up), 0.92).normalize()
    this.camera.up.copy(cameraUp)
    this.camera.lookAt(this.cameraTarget)
    const targetRoll = clamp((profile.bankDegrees * 0.52 - sideSlip * 1.7) * (Math.PI / 180), -28 * Math.PI / 180, 28 * Math.PI / 180)
    this.cameraRoll += (targetRoll - this.cameraRoll) * Math.min(1, dt * 8.5)
    this.camera.rotateZ(this.cameraRoll)
    const targetFov = clamp(
      86 +
        speedRatio * 24 +
        player.boostIntensity * 9 +
        player.boostStartPulse * 3 +
        player.speedPadPulse * 8 +
        player.slipstreamPulse * 4.8 +
        player.airbrakeExitPulse * 8 +
        player.rivalPassPulse * 5.6 +
        player.packBumpPulse * 4.6,
      86,
      118,
    )
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 12.5)
    this.camera.updateProjectionMatrix()
  }

  private applyBasis(object: THREE.Object3D, forward: Vec3, up: Vec3, fallbackRight: Vec3): void {
    const axes = createRenderBasis(forward, up, fallbackRight)
    const basis = new THREE.Matrix4().makeBasis(toThree(axes.forward), toThree(axes.up), toThree(axes.right))
    object.quaternion.setFromRotationMatrix(basis)
  }
}
