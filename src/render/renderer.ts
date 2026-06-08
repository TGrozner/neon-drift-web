import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { SHIP_PROFILES } from '../../shared/constants'
import { add3, clamp, cross3, dot3, normalize3, scale3, type Vec3 } from '../../shared/math'
import type { RaceState } from '../../shared/race'
import { slipstreamSegmentInfluence } from '../../shared/slipstream'
import { trackToWorld, type RaceTrack } from '../../shared/track'
import type { Vehicle } from '../../shared/physics'
import { publicAsset } from '../publicAssets'

const toThree = (v: Vec3): THREE.Vector3 => new THREE.Vector3(v.x, v.y, v.z)

const modelLoader = new GLTFLoader()
const modelCache = new Map<string, Promise<THREE.Group>>()

const shipModels = {
  balanced: publicAsset('models/neon_drift/ships/prototype_scout.glb'),
  swift: publicAsset('models/neon_drift/ships/prototype_swift.glb'),
  heavy: publicAsset('models/neon_drift/ships/prototype_heavy.glb'),
} as const

const trackKitModels = {
  trackSlab: publicAsset('models/neon_drift/tracks/prototype_kit/track_slab.glb'),
  trackRail: publicAsset('models/neon_drift/tracks/prototype_kit/track_rail.glb'),
  gatePost: publicAsset('models/neon_drift/tracks/prototype_kit/gate_post.glb'),
  gateBeam: publicAsset('models/neon_drift/tracks/prototype_kit/gate_beam.glb'),
  speedPad: publicAsset('models/neon_drift/tracks/prototype_kit/speed_pad.glb'),
  rechargePad: publicAsset('models/neon_drift/tracks/prototype_kit/recharge_pad.glb'),
  startLine: publicAsset('models/neon_drift/tracks/prototype_kit/start_line.glb'),
} as const

type TrackKitModelId = keyof typeof trackKitModels

const RENDERED_SLIPSTREAM_SEGMENTS = 96
const ENABLE_SOURCE_SHIP_MODELS = true
const ENABLE_SOURCE_TRACK_KIT_MODELS = true
const CAMERA_FAR_PLANE = 1050
const SCENE_FOG_DENSITY = 0.0042
const HORIZON_GRID_SIZE = 420
const HORIZON_GRID_DIVISIONS = 84

export const VISUAL_LIGHTING = {
  bloomBase: 0.3,
  bloomBoost: 0.22,
  bloomRadiusBase: 0.31,
  bloomRadiusBoost: 0.1,
  exposureBase: 0.86,
  exposureBoost: 0.04,
  trackEdgeOpacity: 0.36,
  guideSideOpacity: 0.2,
  guideCenterOpacity: 0.18,
  environmentBeaconEmissive: 0.82,
  startLineEmissive: 0.56,
  gatePostBaseEmissive: 0.54,
  gateBeamBaseEmissive: 0.58,
  gateLineBaseOpacity: 0.32,
  padBaseEmissive: 0.62,
  padChevronEmissive: 0.86,
  sourceTrackStrongEmissive: 0.42,
  sourceTrackRailEmissive: 0.28,
  sourceTrackMutedEmissive: 0.24,
  slabEmissive: 0.22,
  railEmissive: 0.32,
  nextGateLineBaseOpacity: 0.42,
  nextGateLinePulseOpacity: 0.14,
  nextGatePostBaseEmissive: 0.5,
  nextGatePostPulseEmissive: 0.22,
  nextGateBeamBaseEmissive: 0.58,
  nextGateBeamPulseEmissive: 0.3,
  lastGateLineOpacity: 0.2,
  lastGatePostEmissive: 0.34,
  lastGateBeamEmissive: 0.42,
  idleGateLineOpacity: 0.14,
  idleGatePostEmissive: 0.22,
  idleGateBeamEmissive: 0.26,
} as const

const sourceTrackKitEmissiveIntensity = (modelId: TrackKitModelId): number => {
  if (modelId === 'trackRail') return VISUAL_LIGHTING.sourceTrackRailEmissive
  if (modelId === 'gatePost' || modelId === 'trackSlab') return VISUAL_LIGHTING.sourceTrackMutedEmissive
  return VISUAL_LIGHTING.sourceTrackStrongEmissive
}

const loadModel = (url: string): Promise<THREE.Group> => {
  const cached = modelCache.get(url)
  if (cached) return cached
  const promise = new Promise<THREE.Group>((resolve, reject) => {
    modelLoader.load(url, (gltf) => resolve(gltf.scene), undefined, reject)
  })
  modelCache.set(url, promise)
  return promise
}

const preloadSourceModels = (): void => {
  if (ENABLE_SOURCE_SHIP_MODELS) {
    for (const url of Object.values(shipModels)) void loadModel(url).catch(() => undefined)
  }
  if (ENABLE_SOURCE_TRACK_KIT_MODELS) {
    for (const url of Object.values(trackKitModels)) void loadModel(url).catch(() => undefined)
  }
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

type GatePortal = {
  postMaterial: THREE.MeshStandardMaterial
  beamMaterial: THREE.MeshStandardMaterial
  lineMaterial: THREE.LineBasicMaterial
}

type TrackKitBasisInstance = {
  position: Vec3
  profile: { tangent: Vec3; up: Vec3; right: Vec3 }
  scale: THREE.Vector3
  color?: THREE.ColorRepresentation
}

type TrackKitMatrixInstance = {
  matrix: THREE.Matrix4
  color?: THREE.ColorRepresentation
}

type TrackKitInstance = TrackKitBasisInstance | TrackKitMatrixInstance

type NeonRenderStats = {
  calls: number
  triangles: number
  sourceShipCount: number
  bloomStrength: number
  toneMappingExposure: number
  slipstreamSegmentCount: number
  renderedSlipstreamSegmentCount: number
  renderedSlipstreamGroundBandCount: number
  playerSlipstreamPulse: number
  playerSlipstreamVisualBandCount: number
  playerSlipstreamVisualStrength: number
  gatePortalCount: number
  padMarkerCount: number
  trackEnvironmentInstances: number
  sourceTrackGateModelCount: number
  sourceTrackGatePartModelCount: number
  sourceTrackPadModelCount: number
  sourceTrackStartLineModelCount: number
  sourceTrackSlabModelCount: number
  sourceTrackRailModelCount: number
  sourceTrackKitLoaded: boolean
}

export class NeonRenderer {
  private readonly canvas: HTMLCanvasElement
  private readonly renderer: THREE.WebGLRenderer
  private readonly composer: EffectComposer
  private readonly bloomPass: UnrealBloomPass
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(72, 1, 0.1, CAMERA_FAR_PLANE)
  private readonly shipGroups = new Map<string, THREE.Group>()
  private readonly shipMaterials = new Map<string, THREE.MeshStandardMaterial>()
  private readonly gateLines = new Map<number, THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>>()
  private readonly gatePortals = new Map<number, GatePortal>()
  private readonly slipstreamGroup = new THREE.Group()
  private readonly slipstreamMesh: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  private readonly slipstreamGroundMesh: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  private readonly slipstreamDummy = new THREE.Object3D()
  private readonly slipstreamColor = new THREE.Color()
  private renderedSlipstreamSegmentCount = 0
  private renderedSlipstreamGroundBandCount = 0
  private playerSlipstreamVisualBandCount = 0
  private playerSlipstreamVisualStrength = 0
  private lastCameraUpdate = performance.now()
  private cameraTarget = new THREE.Vector3()
  private smoothedCameraForward = new THREE.Vector3()
  private cameraRoll = 0
  private trackId = ''
  private padMarkerCount = 0
  private trackEnvironmentInstances = 0
  private sourceTrackGateModelCount = 0
  private sourceTrackGatePartModelCount = 0
  private sourceTrackPadModelCount = 0
  private sourceTrackStartLineModelCount = 0
  private sourceTrackSlabModelCount = 0
  private sourceTrackRailModelCount = 0
  private expectedSourceTrackGateModelCount = 0
  private expectedSourceTrackGatePartModelCount = 0
  private expectedSourceTrackPadModelCount = 0
  private expectedSourceTrackStartLineModelCount = 0
  private expectedSourceTrackSlabModelCount = 0
  private expectedSourceTrackRailModelCount = 0

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
    this.renderer.toneMappingExposure = VISUAL_LIGHTING.exposureBase
    this.renderer.setClearColor('#05060b')
    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), VISUAL_LIGHTING.bloomBase, VISUAL_LIGHTING.bloomRadiusBase, 0.28)
    this.composer.addPass(this.bloomPass)
    this.composer.addPass(new OutputPass())
    this.scene.fog = new THREE.FogExp2('#05060b', SCENE_FOG_DENSITY)
    this.slipstreamMesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        color: '#ffffff',
        transparent: true,
        opacity: 0.2,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        vertexColors: true,
      }),
      RENDERED_SLIPSTREAM_SEGMENTS,
    )
    this.slipstreamMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.slipstreamMesh.renderOrder = 2
    this.slipstreamMesh.frustumCulled = false
    this.slipstreamGroundMesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        color: '#ff2df4',
        transparent: true,
        opacity: 0.085,
        depthTest: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
        vertexColors: true,
      }),
      RENDERED_SLIPSTREAM_SEGMENTS,
    )
    this.slipstreamGroundMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.slipstreamGroundMesh.renderOrder = 1
    this.slipstreamGroundMesh.frustumCulled = false
    this.slipstreamGroup.add(this.slipstreamGroundMesh, this.slipstreamMesh)
    this.scene.add(this.slipstreamGroup)

    const hemi = new THREE.HemisphereLight('#8be9ff', '#08030d', 0.82)
    this.scene.add(hemi)
    const sun = new THREE.DirectionalLight('#ffffff', 1.42)
    sun.position.set(18, 38, 24)
    this.scene.add(sun)

    const grid = new THREE.GridHelper(HORIZON_GRID_SIZE, HORIZON_GRID_DIVISIONS, '#1a5367', '#101622')
    grid.position.y = -0.08
    grid.material.opacity = 0.12
    grid.material.transparent = true
    this.scene.add(grid)
    preloadSourceModels()
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
    const statsWindow = window as Window & typeof globalThis & { __NEON_RENDER_STATS?: NeonRenderStats }
    const stats = statsWindow.__NEON_RENDER_STATS ?? {
      calls: 0,
      triangles: 0,
      sourceShipCount: 0,
      bloomStrength: 0,
      toneMappingExposure: 0,
      slipstreamSegmentCount: 0,
      renderedSlipstreamSegmentCount: 0,
      renderedSlipstreamGroundBandCount: 0,
      playerSlipstreamPulse: 0,
      playerSlipstreamVisualBandCount: 0,
      playerSlipstreamVisualStrength: 0,
      gatePortalCount: 0,
      padMarkerCount: 0,
      trackEnvironmentInstances: 0,
      sourceTrackGateModelCount: 0,
      sourceTrackGatePartModelCount: 0,
      sourceTrackPadModelCount: 0,
      sourceTrackStartLineModelCount: 0,
      sourceTrackSlabModelCount: 0,
      sourceTrackRailModelCount: 0,
      sourceTrackKitLoaded: false,
    }
    stats.calls = this.renderer.info.render.calls
    stats.triangles = this.renderer.info.render.triangles
    stats.sourceShipCount = [...this.shipGroups.values()].filter((group) => group.getObjectByName('source-ship-model')).length
    stats.bloomStrength = this.bloomPass.strength
    stats.toneMappingExposure = this.renderer.toneMappingExposure
    stats.slipstreamSegmentCount = race.slipstream.segments.length
    stats.renderedSlipstreamSegmentCount = this.renderedSlipstreamSegmentCount
    stats.renderedSlipstreamGroundBandCount = this.renderedSlipstreamGroundBandCount
    stats.playerSlipstreamPulse = race.vehicles.find((vehicle) => vehicle.id === race.playerId)?.slipstreamPulse ?? 0
    stats.playerSlipstreamVisualBandCount = this.playerSlipstreamVisualBandCount
    stats.playerSlipstreamVisualStrength = this.playerSlipstreamVisualStrength
    stats.gatePortalCount = this.gatePortals.size
    stats.padMarkerCount = this.padMarkerCount
    stats.trackEnvironmentInstances = this.trackEnvironmentInstances
    stats.sourceTrackGateModelCount = this.sourceTrackGateModelCount
    stats.sourceTrackGatePartModelCount = this.sourceTrackGatePartModelCount
    stats.sourceTrackPadModelCount = this.sourceTrackPadModelCount
    stats.sourceTrackStartLineModelCount = this.sourceTrackStartLineModelCount
    stats.sourceTrackSlabModelCount = this.sourceTrackSlabModelCount
    stats.sourceTrackRailModelCount = this.sourceTrackRailModelCount
    stats.sourceTrackKitLoaded =
      this.sourceTrackSlabModelCount >= this.expectedSourceTrackSlabModelCount &&
      this.sourceTrackRailModelCount >= this.expectedSourceTrackRailModelCount &&
      this.sourceTrackGateModelCount >= this.expectedSourceTrackGateModelCount &&
      this.sourceTrackGatePartModelCount >= this.expectedSourceTrackGatePartModelCount &&
      this.sourceTrackPadModelCount >= this.expectedSourceTrackPadModelCount &&
      this.sourceTrackStartLineModelCount >= this.expectedSourceTrackStartLineModelCount
    statsWindow.__NEON_RENDER_STATS = stats
  }

  private rebuildTrack(track: RaceTrack): void {
    const stale = this.scene.getObjectByName('track-root')
    if (stale) {
      this.scene.remove(stale)
      this.disposeObject(stale)
    }
    this.gateLines.clear()
    this.gatePortals.clear()
    this.padMarkerCount = 0
    this.trackEnvironmentInstances = 0
    this.sourceTrackGateModelCount = 0
    this.sourceTrackGatePartModelCount = 0
    this.sourceTrackPadModelCount = 0
    this.sourceTrackStartLineModelCount = 0
    this.sourceTrackSlabModelCount = 0
    this.sourceTrackRailModelCount = 0
    this.expectedSourceTrackSlabModelCount = 0
    this.expectedSourceTrackRailModelCount = 0
    this.expectedSourceTrackGateModelCount = ENABLE_SOURCE_TRACK_KIT_MODELS ? track.gates.length : 0
    this.expectedSourceTrackGatePartModelCount = ENABLE_SOURCE_TRACK_KIT_MODELS ? track.gates.length * 3 : 0
    this.expectedSourceTrackPadModelCount = ENABLE_SOURCE_TRACK_KIT_MODELS ? track.pads.length : 0
    this.expectedSourceTrackStartLineModelCount = ENABLE_SOURCE_TRACK_KIT_MODELS ? 1 : 0
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

    const edgeMaterial = new THREE.LineBasicMaterial({
      color: '#6ce8ff',
      transparent: true,
      opacity: VISUAL_LIGHTING.trackEdgeOpacity,
    })
    for (const side of [-1, 1]) {
      const points: THREE.Vector3[] = []
      for (let i = 0; i <= samples; i += 1) {
        const distance = (track.totalLength * i) / samples
        const profile = track.sample(distance)
        points.push(toThree(add3(profile.center, scale3(profile.right, profile.width * 0.5 * side))))
      }
      root.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), edgeMaterial))
    }

    this.addTrackGuideStrips(root, track)
    this.addTrackEnvironment(root, track)
    this.addTrackKitSegments(root, track)

    for (const gate of track.gates) {
      this.addGatePortal(root, track, gate)
    }

    for (const pad of track.pads) {
      this.addPadMarker(root, track, pad)
    }

    const startProfile = track.sample(0)
    const startMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.36, 0.18, startProfile.width + 1.6),
      new THREE.MeshStandardMaterial({
        color: '#ff3df2',
        emissive: '#4d1049',
        emissiveIntensity: VISUAL_LIGHTING.startLineEmissive,
        roughness: 0.38,
        metalness: 0.22,
      }),
    )
    startMesh.position.copy(toThree(trackToWorld(track, 0, 0, 0.18)))
    this.applyBasis(startMesh, startProfile.tangent, startProfile.up, startProfile.right)
    root.add(startMesh)
    this.addSourceTrackKitModel(
      root,
      'startLine',
      'source-track-start-line-model',
      trackToWorld(track, 0, 0, 0.18),
      startProfile,
      new THREE.Vector3(0.72, 0.36, 2 * (startProfile.width + 1.6)),
      startMesh,
      () => {
        this.sourceTrackStartLineModelCount += 1
      },
    )

    this.scene.add(root)
  }

  private addTrackGuideStrips(root: THREE.Group, track: RaceTrack): void {
    const samples = 260
    const guides = [
      { laneRatio: -0.26, color: '#274f66', opacity: VISUAL_LIGHTING.guideSideOpacity },
      { laneRatio: 0, color: '#ffbf4a', opacity: VISUAL_LIGHTING.guideCenterOpacity },
      { laneRatio: 0.26, color: '#274f66', opacity: VISUAL_LIGHTING.guideSideOpacity },
    ]
    for (const guide of guides) {
      const points: THREE.Vector3[] = []
      for (let i = 0; i <= samples; i += 1) {
        const distance = (track.totalLength * i) / samples
        const profile = track.sample(distance)
        points.push(toThree(trackToWorld(track, distance, profile.width * guide.laneRatio, 0.22)))
      }
      root.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(points),
          new THREE.LineBasicMaterial({
            color: guide.color,
            transparent: true,
            opacity: guide.opacity,
          }),
        ),
      )
    }
  }

  private addTrackEnvironment(root: THREE.Group, track: RaceTrack): void {
    const beaconCount = Math.round(clamp(track.totalLength / 8, 52, 150))
    const dummy = new THREE.Object3D()
    const beaconMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({
        color: '#6ce8ff',
        roughness: 0.38,
        metalness: 0.28,
        emissive: '#2be4ff',
        emissiveIntensity: VISUAL_LIGHTING.environmentBeaconEmissive,
      }),
      beaconCount,
    )

    for (let i = 0; i < beaconCount; i += 1) {
      const distance = (track.totalLength * i) / beaconCount
      const profile = track.sample(distance)
      const side = i % 2 === 0 ? 1 : -1
      const position = add3(
        add3(profile.center, scale3(profile.right, side * (profile.width * 0.5 + 1.2))),
        scale3(profile.up, 0.42),
      )
      dummy.position.copy(toThree(position))
      this.applyBasis(dummy, profile.tangent, profile.up, profile.right)
      dummy.scale.set(0.34, 0.22, 0.92)
      dummy.updateMatrix()
      beaconMesh.setMatrixAt(i, dummy.matrix)
    }

    beaconMesh.instanceMatrix.needsUpdate = true
    root.add(beaconMesh)
    this.trackEnvironmentInstances = beaconCount
  }

  private addGatePortal(root: THREE.Group, track: RaceTrack, gate: RaceTrack['gates'][number]): void {
    const profile = track.sample(gate.distance)
    const postMaterial = new THREE.MeshStandardMaterial({
      color: '#252b3c',
      roughness: 0.42,
      metalness: 0.48,
      emissive: '#3b0d45',
      emissiveIntensity: VISUAL_LIGHTING.gatePostBaseEmissive,
    })
    const beamMaterial = new THREE.MeshStandardMaterial({
      color: '#ff3df2',
      roughness: 0.32,
      metalness: 0.38,
      emissive: '#ff3df2',
      emissiveIntensity: VISUAL_LIGHTING.gateBeamBaseEmissive,
    })
    const postGeometry = new THREE.BoxGeometry(0.62, 5.8, 0.62)
    for (const lane of [profile.width * 0.5 + 0.84, -profile.width * 0.5 - 0.84]) {
      const post = new THREE.Mesh(postGeometry, postMaterial)
      post.position.copy(toThree(trackToWorld(track, gate.distance, lane, 3.1)))
      this.applyBasis(post, profile.tangent, profile.up, profile.right)
      root.add(post)
      this.addSourceTrackKitModel(
        root,
        'gatePost',
        'source-track-gate-post-model',
        trackToWorld(track, gate.distance, lane, 1.2),
        profile,
        new THREE.Vector3(0.56, 5.8, 0.56),
        post,
        () => {
          this.sourceTrackGatePartModelCount += 1
        },
      )
    }

    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.4, gate.halfWidth * 2 + 1.2), beamMaterial)
    beam.position.copy(toThree(trackToWorld(track, gate.distance, 0, 6.15)))
    this.applyBasis(beam, profile.tangent, profile.up, profile.right)
    root.add(beam)
    this.addSourceTrackKitModel(
      root,
      'gateBeam',
      'source-track-gate-beam-model',
      trackToWorld(track, gate.distance, 0, 3.65),
      profile,
      new THREE.Vector3(0.52, 0.48, 2 * (profile.width + 1.9)),
      beam,
      () => {
        this.sourceTrackGateModelCount += 1
        this.sourceTrackGatePartModelCount += 1
      },
    )

    const left = trackToWorld(track, gate.distance, -gate.halfWidth, 0.42)
    const right = trackToWorld(track, gate.distance, gate.halfWidth, 0.42)
    const leftTop = add3(left, scale3(profile.up, 6.2))
    const rightTop = add3(right, scale3(profile.up, 6.2))
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
      opacity: VISUAL_LIGHTING.gateLineBaseOpacity,
      toneMapped: false,
    })
    const gateLine = new THREE.LineSegments(gateGeometry, gateMaterial)
    gateLine.userData.gateIndex = gate.index
    root.add(gateLine)
    this.gateLines.set(gate.index, gateLine)
    this.gatePortals.set(gate.index, { postMaterial, beamMaterial, lineMaterial: gateMaterial })
  }

  private addPadMarker(root: THREE.Group, track: RaceTrack, pad: RaceTrack['pads'][number]): void {
    const profile = track.sample(pad.distance)
    const group = new THREE.Group()
    const isBoost = pad.kind === 'boost'
    const color = isBoost ? '#6ce8ff' : '#5dfd7a'
    const emissive = isBoost ? '#164d6b' : '#164d24'
    group.position.copy(toThree(trackToWorld(track, pad.distance, pad.lane, 0.16)))
    this.applyBasis(group, profile.tangent, profile.up, profile.right)

    const base = new THREE.Mesh(
      new THREE.BoxGeometry(pad.halfLength * 2, 0.16, pad.halfWidth * 2),
      new THREE.MeshStandardMaterial({
        color,
        emissive,
        emissiveIntensity: VISUAL_LIGHTING.padBaseEmissive,
        roughness: 0.34,
        metalness: 0.28,
        transparent: true,
        opacity: 0.9,
      }),
    )
    group.add(base)

    const chevronMaterial = new THREE.MeshStandardMaterial({
      color: '#f7fbff',
      emissive: color,
      emissiveIntensity: VISUAL_LIGHTING.padChevronEmissive,
      roughness: 0.24,
      metalness: 0.18,
    })
    for (let i = 0; i < 3; i += 1) {
      const x = -pad.halfLength * 0.62 + i * pad.halfLength * 0.62
      for (const side of [-1, 1]) {
        const chevron = new THREE.Mesh(new THREE.BoxGeometry(pad.halfLength * 0.36, 0.08, 0.16), chevronMaterial)
        chevron.position.set(x, 0.13, side * pad.halfWidth * 0.24)
        chevron.rotation.y = side * (isBoost ? -0.62 : 0.62)
        group.add(chevron)
      }
    }

    root.add(group)
    this.padMarkerCount += 1
    this.addSourceTrackKitModel(
      root,
      isBoost ? 'speedPad' : 'rechargePad',
      isBoost ? 'source-track-speed-pad-model' : 'source-track-recharge-pad-model',
      trackToWorld(track, pad.distance, pad.lane, isBoost ? 0.24 : 0.25),
      profile,
      new THREE.Vector3(6.2, 0.16, 4 * pad.halfWidth),
      group,
      () => {
        this.sourceTrackPadModelCount += 1
      },
    )
  }

  private addSourceTrackKitModel(
    root: THREE.Group,
    modelId: TrackKitModelId,
    name: string,
    position: Vec3,
    profile: { tangent: Vec3; up: Vec3; right: Vec3 },
    scale: THREE.Vector3,
    fallback?: THREE.Object3D | THREE.Object3D[],
    onLoaded?: () => void,
  ): void {
    if (!ENABLE_SOURCE_TRACK_KIT_MODELS) return
    void loadModel(trackKitModels[modelId]).then((template) => {
      if (!root.parent || this.scene.getObjectByName('track-root') !== root) return
      const model = cloneModel(template)
      model.name = name
      model.position.copy(toThree(position))
      this.applyBasis(model, profile.tangent, profile.up, profile.right)
      model.scale.copy(scale)
      this.tintTrackKitModel(model, modelId)
      const fallbacks = Array.isArray(fallback) ? fallback : fallback ? [fallback] : []
      for (const object of fallbacks) object.visible = false
      root.add(model)
      onLoaded?.()
    }).catch(() => undefined)
  }

  private addSourceTrackKitInstances(
    root: THREE.Group,
    modelId: TrackKitModelId,
    name: string,
    instances: TrackKitInstance[],
    fallback: THREE.Object3D | THREE.Object3D[],
    onLoaded: () => void,
  ): void {
    if (!ENABLE_SOURCE_TRACK_KIT_MODELS || instances.length === 0) return
    void loadModel(trackKitModels[modelId]).then((template) => {
      if (!root.parent || this.scene.getObjectByName('track-root') !== root) return
      template.updateMatrixWorld(true)
      const group = new THREE.Group()
      group.name = name
      const dummy = new THREE.Object3D()
      const instanceMatrix = new THREE.Matrix4()
      const instanceColor = new THREE.Color()
      const usesInstanceColor = instances.some((instance) => instance.color)
      let batchCount = 0
      template.traverse((object) => {
        const mesh = object as THREE.Mesh
        if (!mesh.isMesh || !mesh.geometry) return
        const meshMatrix = mesh.matrixWorld.clone()
        const instanced = new THREE.InstancedMesh(
          mesh.geometry.clone(),
          this.cloneTrackKitMaterial(mesh.material, modelId, usesInstanceColor),
          instances.length,
        )
        instanced.name = `${name}-${mesh.name || 'mesh'}`
        instanced.frustumCulled = false
        for (let index = 0; index < instances.length; index += 1) {
          const instance = instances[index]
          if ('matrix' in instance) {
            instanceMatrix.copy(instance.matrix).multiply(meshMatrix)
          } else {
            dummy.position.copy(toThree(instance.position))
            this.applyBasis(dummy, instance.profile.tangent, instance.profile.up, instance.profile.right)
            dummy.scale.copy(instance.scale)
            dummy.updateMatrix()
            instanceMatrix.copy(dummy.matrix).multiply(meshMatrix)
          }
          instanced.setMatrixAt(index, instanceMatrix)
          if (instance.color) {
            instanced.setColorAt(index, instanceColor.set(instance.color))
          }
        }
        instanced.instanceMatrix.needsUpdate = true
        if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true
        group.add(instanced)
        batchCount += 1
      })
      if (batchCount === 0) return
      const fallbacks = Array.isArray(fallback) ? fallback : [fallback]
      for (const object of fallbacks) object.visible = false
      root.add(group)
      onLoaded()
    }).catch(() => undefined)
  }

  private cloneTrackKitMaterial(
    material: THREE.Material | THREE.Material[],
    modelId: TrackKitModelId,
    usesInstanceColor = false,
  ): THREE.Material | THREE.Material[] {
    if (Array.isArray(material)) {
      return material.map((entry) => this.cloneTrackKitMaterial(entry, modelId, usesInstanceColor) as THREE.Material)
    }
    const clone = material.clone()
    this.tintTrackKitMaterialInstance(clone, modelId, usesInstanceColor)
    return clone
  }

  private tintTrackKitModel(model: THREE.Group, modelId: TrackKitModelId): void {
    model.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh) return
      const meshMaterial = mesh.material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[]
      const materials = Array.isArray(meshMaterial) ? meshMaterial : [meshMaterial]
      for (const material of materials) {
        this.tintTrackKitMaterialInstance(material, modelId)
      }
    })
  }

  private tintTrackKitMaterialInstance(
    material: THREE.Material,
    modelId: TrackKitModelId,
    usesInstanceColor = false,
  ): void {
    const color =
      modelId === 'rechargePad'
        ? '#5dfd7a'
        : modelId === 'speedPad' || modelId === 'trackRail'
          ? '#6ce8ff'
          : modelId === 'trackSlab'
            ? '#274f66'
            : '#ff3df2'
    const emissiveMaterial = material as THREE.MeshStandardMaterial
    if (!emissiveMaterial || !('emissive' in emissiveMaterial)) return
    if (usesInstanceColor) {
      material.vertexColors = true
      if ('color' in emissiveMaterial) emissiveMaterial.color = new THREE.Color('#ffffff')
    }
    emissiveMaterial.emissive = new THREE.Color(color)
    emissiveMaterial.emissiveIntensity = sourceTrackKitEmissiveIntensity(modelId)
    emissiveMaterial.toneMapped = false
  }

  private addTrackKitSegments(root: THREE.Group, track: RaceTrack): void {
    const segments = track.visualSegments
    const segmentCount = segments.length
    this.expectedSourceTrackSlabModelCount = ENABLE_SOURCE_TRACK_KIT_MODELS ? segmentCount : 0
    this.expectedSourceTrackRailModelCount = ENABLE_SOURCE_TRACK_KIT_MODELS ? segmentCount * 2 : 0
    const slabMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({
        color: '#171b28',
        roughness: 0.7,
        metalness: 0.16,
        emissive: '#081927',
        emissiveIntensity: VISUAL_LIGHTING.slabEmissive,
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
        emissiveIntensity: VISUAL_LIGHTING.railEmissive,
      }),
      segmentCount * 2,
    )
    const dummy = new THREE.Object3D()
    const slabInstances: TrackKitInstance[] = []
    const railInstances: TrackKitInstance[] = []
    let railIndex = 0
    for (let i = 0; i < segments.length; i += 1) {
      const profile = segments[i]
      slabInstances.push({
        position: profile.center,
        profile,
        scale: new THREE.Vector3((profile.length + 0.96) * 2, 0.48, profile.width * 2),
      })
      this.setInstance(
        slabMesh,
        i,
        dummy,
        add3(profile.center, scale3(profile.up, -0.08)),
        profile,
        new THREE.Vector3(profile.length + 0.96, 0.14, profile.width),
      )

      const railOffset = profile.width * 0.5 + 0.34
      for (const side of [-1, 1]) {
        railInstances.push({
          position: add3(add3(profile.center, scale3(profile.right, railOffset * side)), scale3(profile.up, 0.42)),
          profile,
          scale: new THREE.Vector3((profile.length + 0.96) * 2, 1.64, 0.44),
        })
        this.setInstance(
          railMesh,
          railIndex,
          dummy,
          add3(add3(profile.center, scale3(profile.right, railOffset * side)), scale3(profile.up, 0.42)),
          profile,
          new THREE.Vector3(profile.length + 0.96, 0.82, 0.22),
        )
        railIndex += 1
      }
    }
    slabMesh.instanceMatrix.needsUpdate = true
    railMesh.instanceMatrix.needsUpdate = true
    root.add(slabMesh, railMesh)
    this.addSourceTrackKitInstances(root, 'trackSlab', 'source-track-slab-models', slabInstances, slabMesh, () => {
      this.sourceTrackSlabModelCount += slabInstances.length
    })
    this.addSourceTrackKitInstances(root, 'trackRail', 'source-track-rail-models', railInstances, railMesh, () => {
      this.sourceTrackRailModelCount += railInstances.length
    })
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
      material.emissive.set(vehicle.slipstreamPulse > 0.05 ? '#ff3df2' : vehicle.isBoosting ? '#5dfd7a' : colorForPower(vehicle.power))
      material.emissiveIntensity = 0.32 + vehicle.boostIntensity * 0.72 + vehicle.airbrakeExitPulse * 0.82 + vehicle.slipstreamPulse * 0.24
    }
    const sourceMaterials = group.userData.sourceMaterials as THREE.MeshStandardMaterial[] | undefined
    if (sourceMaterials) {
      for (const sourceMaterial of sourceMaterials) {
        sourceMaterial.emissive.set(vehicle.slipstreamPulse > 0.05 ? '#ff3df2' : vehicle.isBoosting ? '#5dfd7a' : colorForPower(vehicle.power))
        sourceMaterial.emissiveIntensity = 0.14 + vehicle.boostIntensity * 0.42 + vehicle.airbrakeExitPulse * 0.48 + vehicle.slipstreamPulse * 0.16
      }
    }

    const trail = group.getObjectByName('engine-trail') as THREE.Mesh<THREE.ConeGeometry, THREE.MeshBasicMaterial> | undefined
    if (trail) {
      const trailPower = clamp(
        vehicle.telemetry.speedRatio * 0.72 +
          vehicle.boostIntensity * 0.52 +
          vehicle.speedPadPulse * 0.34 +
          vehicle.slipstreamPulse * 0.24,
        0.18,
        1.72,
      )
      trail.scale.set(0.8 + trailPower * 0.32, 0.72 + trailPower * 1.35, 0.8 + trailPower * 0.32)
      trail.material.opacity = clamp(0.16 + trailPower * 0.28, 0.14, 0.62)
      trail.material.color.set(
        vehicle.slipstreamPulse > 0.05
          ? '#ff3df2'
          : vehicle.isBoosting
            ? '#5dfd7a'
            : vehicle.airbrakeExitPulse > 0.05 ? '#ffbf4a' : '#6ce8ff',
      )
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
    const player = race.vehicles.find((vehicle) => vehicle.id === race.playerId) ?? race.vehicles[0]
    const segments = race.slipstream.segments
      .filter((segment) => segment.ownerId !== race.playerId)
      .slice(-RENDERED_SLIPSTREAM_SEGMENTS)
    this.renderedSlipstreamSegmentCount = 0
    this.renderedSlipstreamGroundBandCount = 0
    this.playerSlipstreamVisualBandCount = 0
    this.playerSlipstreamVisualStrength = 0
    for (let index = 0; index < RENDERED_SLIPSTREAM_SEGMENTS; index += 1) {
      const segment = segments[index]
      if (!segment) {
        this.slipstreamDummy.scale.set(0, 0, 0)
        this.slipstreamDummy.updateMatrix()
        this.slipstreamMesh.setMatrixAt(index, this.slipstreamDummy.matrix)
        this.slipstreamGroundMesh.setMatrixAt(index, this.slipstreamDummy.matrix)
        this.slipstreamMesh.setColorAt(index, this.slipstreamColor.setRGB(0, 0, 0))
        this.slipstreamGroundMesh.setColorAt(index, this.slipstreamColor.setRGB(0, 0, 0))
        continue
      }
      const age = race.raceTime - segment.createdAt
      const alpha = Math.max(0, 1 - age / segment.lifetime)
      if (alpha <= 0) {
        this.slipstreamDummy.scale.set(0, 0, 0)
        this.slipstreamDummy.updateMatrix()
        this.slipstreamMesh.setMatrixAt(index, this.slipstreamDummy.matrix)
        this.slipstreamGroundMesh.setMatrixAt(index, this.slipstreamDummy.matrix)
        this.slipstreamMesh.setColorAt(index, this.slipstreamColor.setRGB(0, 0, 0))
        this.slipstreamGroundMesh.setColorAt(index, this.slipstreamColor.setRGB(0, 0, 0))
        continue
      }
      const influence = slipstreamSegmentInfluence(
        segment,
        race.track,
        player.id,
        player.distance,
        player.lane,
        race.raceTime,
      )
      if (influence.strength > 0) {
        this.playerSlipstreamVisualBandCount += 1
        this.playerSlipstreamVisualStrength += influence.strength
      }
      this.renderedSlipstreamSegmentCount += 1
      this.renderedSlipstreamGroundBandCount += 1
      const profile = race.track.sample(segment.centerDistance)
      this.slipstreamDummy.position.copy(toThree(trackToWorld(race.track, segment.centerDistance, segment.lane, 0.48)))
      this.applyBasis(this.slipstreamDummy, profile.tangent, profile.right, profile.up)
      this.slipstreamDummy.scale.set(segment.halfLength * 2, segment.halfWidth * 2, 1)
      this.slipstreamDummy.updateMatrix()
      this.slipstreamGroundMesh.setMatrixAt(index, this.slipstreamDummy.matrix)
      const activeStrength = clamp(influence.strength, 0, 1)
      const groundBrightness = 0.2 + alpha * segment.intensity * 0.19 + activeStrength * 0.2
      this.slipstreamGroundMesh.setColorAt(
        index,
        this.slipstreamColor.setRGB(groundBrightness, groundBrightness * 0.08, groundBrightness * 0.78),
      )

      this.slipstreamDummy.position.copy(toThree(trackToWorld(race.track, segment.centerDistance, segment.lane, 1.05)))
      this.applyBasis(this.slipstreamDummy, profile.tangent, profile.up, profile.right)
      this.slipstreamDummy.scale.set(segment.halfLength * 2, 1.05 + alpha * 0.82, 1)
      this.slipstreamDummy.updateMatrix()
      this.slipstreamMesh.setMatrixAt(index, this.slipstreamDummy.matrix)
      const brightness = 0.14 + alpha * segment.intensity * 0.24 + activeStrength * 0.14
      this.slipstreamMesh.setColorAt(index, this.slipstreamColor.setRGB(brightness, brightness * 0.14, brightness * 0.78))
    }
    this.slipstreamMesh.instanceMatrix.needsUpdate = true
    if (this.slipstreamMesh.instanceColor) this.slipstreamMesh.instanceColor.needsUpdate = true
    this.slipstreamGroundMesh.instanceMatrix.needsUpdate = true
    if (this.slipstreamGroundMesh.instanceColor) this.slipstreamGroundMesh.instanceColor.needsUpdate = true
  }

  private updateGateHighlights(race: RaceState): void {
    const player = race.vehicles.find((vehicle) => vehicle.id === race.playerId) ?? race.vehicles[0]
    const pulse = 0.5 + Math.sin((race.raceTime + race.phaseTime) * 9.2) * 0.5
    for (const [index, gateLine] of this.gateLines) {
      const material = gateLine.material
      const portal = this.gatePortals.get(index)
      if (index === player.nextGateIndex) {
        material.color.set('#fff27a')
        material.opacity = VISUAL_LIGHTING.nextGateLineBaseOpacity + pulse * VISUAL_LIGHTING.nextGateLinePulseOpacity
        portal?.postMaterial.emissive.set('#6ce8ff')
        portal?.beamMaterial.color.set('#fff27a')
        portal?.beamMaterial.emissive.set('#fff27a')
        if (portal) {
          portal.postMaterial.emissiveIntensity =
            VISUAL_LIGHTING.nextGatePostBaseEmissive + pulse * VISUAL_LIGHTING.nextGatePostPulseEmissive
          portal.beamMaterial.emissiveIntensity =
            VISUAL_LIGHTING.nextGateBeamBaseEmissive + pulse * VISUAL_LIGHTING.nextGateBeamPulseEmissive
        }
      } else if (index === player.lastGateIndex) {
        material.color.set('#5dfd7a')
        material.opacity = VISUAL_LIGHTING.lastGateLineOpacity
        portal?.postMaterial.emissive.set('#174d25')
        portal?.beamMaterial.color.set('#5dfd7a')
        portal?.beamMaterial.emissive.set('#5dfd7a')
        if (portal) {
          portal.postMaterial.emissiveIntensity = VISUAL_LIGHTING.lastGatePostEmissive
          portal.beamMaterial.emissiveIntensity = VISUAL_LIGHTING.lastGateBeamEmissive
        }
      } else {
        material.color.set('#ff3df2')
        material.opacity = VISUAL_LIGHTING.idleGateLineOpacity
        portal?.postMaterial.emissive.set('#35103d')
        portal?.beamMaterial.color.set('#ff3df2')
        portal?.beamMaterial.emissive.set('#ff3df2')
        if (portal) {
          portal.postMaterial.emissiveIntensity = VISUAL_LIGHTING.idleGatePostEmissive
          portal.beamMaterial.emissiveIntensity = VISUAL_LIGHTING.idleGateBeamEmissive
        }
      }
    }
  }

  private updatePostProcessing(race: RaceState): void {
    const player = race.vehicles.find((vehicle) => vehicle.id === race.playerId) ?? race.vehicles[0]
    const energy = clamp(
      player.boostIntensity * 0.45 +
        player.speedPadPulse * 0.34 +
        player.airbrakeExitPulse * 0.3 +
        player.slipstreamPulse * 0.08 +
        player.rivalPassPulse * 0.2 +
        player.knockoutRewardPulse * 0.26,
      0,
      1,
    )
    this.bloomPass.strength = VISUAL_LIGHTING.bloomBase + energy * VISUAL_LIGHTING.bloomBoost
    this.bloomPass.radius = VISUAL_LIGHTING.bloomRadiusBase + energy * VISUAL_LIGHTING.bloomRadiusBoost
    this.renderer.toneMappingExposure = VISUAL_LIGHTING.exposureBase + energy * VISUAL_LIGHTING.exposureBoost
  }

  private disposeObject(object: THREE.Object3D): void {
    object.traverse((child) => {
      const renderable = child as THREE.Object3D & {
        geometry?: THREE.BufferGeometry
        material?: THREE.Material | THREE.Material[]
      }
      renderable.geometry?.dispose()
      const materials = Array.isArray(renderable.material) ? renderable.material : [renderable.material]
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
      player.slipstreamPulse * 0.42 +
      player.rivalPassPulse * 1.44 +
      player.knockoutRewardPulse * 1.64 +
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
        player.slipstreamPulse * 2.4 +
        player.airbrakeExitPulse * 8 +
        player.rivalPassPulse * 5.6 +
        player.knockoutRewardPulse * 6.2 +
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
