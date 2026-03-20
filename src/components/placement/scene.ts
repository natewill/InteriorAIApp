import { compositeFragmentShader, compositeVertexShader } from './shaders'

interface InitPlacementSceneArgs {
    container: HTMLDivElement
    roomImageUrl: string
    depthImageUrl: string
    glbUrl: string
    showRotateGizmo: boolean
}

export interface PlacementSceneApi {
    setDepthOffset: (depthOffset: number) => void
    setScaleFactor: (scaleFactor: number) => void
    setGizmoVisible: (visible: boolean) => void
    captureComposite: () => Promise<string>
    captureMask: () => Promise<string>
    reset: () => void
    dispose: () => void
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMap = Map<any, any>

export async function initPlacementScene({
    container,
    roomImageUrl,
    depthImageUrl,
    glbUrl,
    showRotateGizmo,
}: InitPlacementSceneArgs): Promise<PlacementSceneApi> {
    const THREE = await import('three')
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js') //used to load .glbs
    const { TransformControls } = await import('three/examples/jsm/controls/TransformControls.js')
    // https://threejs.org/docs/#TransformControls

    const depthBiasScale = 0.2

    const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
    }) //load renderer
    renderer.autoClear = false
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.domElement.style.position = 'absolute'
    container.appendChild(renderer.domElement)

    const textureLoader = new THREE.TextureLoader()
    console.log('[scene] Loading room texture...')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const roomTexture = await new Promise<any>((resolve, reject) => {
        textureLoader.load(roomImageUrl, resolve, undefined, (err) => {
            console.error('[scene] Room texture load error:', err)
            reject(err)
        })
    })
    roomTexture.colorSpace = THREE.SRGBColorSpace
    console.log('[scene] Room texture loaded')

    // Compute renderer size to match the room image's aspect ratio
    // (letterbox/pillarbox within the container)
    const imgAspect = roomTexture.image.width / roomTexture.image.height

    const computeFit = () => {
        const cw = container.clientWidth
        const ch = container.clientHeight
        const containerAspect = cw / ch
        let w: number, h: number
        if (imgAspect > containerAspect) {
            w = cw; h = Math.round(cw / imgAspect)
        } else {
            h = ch; w = Math.round(ch * imgAspect)
        }
        return { w, h, offsetX: Math.round((cw - w) / 2), offsetY: Math.round((ch - h) / 2) }
    }

    let { w: width, h: height, offsetX, offsetY } = computeFit()
    let aspect = width / height

    renderer.setSize(width, height)
    renderer.domElement.style.left = `${offsetX}px`
    renderer.domElement.style.top = `${offsetY}px`

    console.log('[scene] Loading depth texture...')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const depthTexture = await new Promise<any>((resolve, reject) => {
        textureLoader.load(depthImageUrl, resolve, undefined, (err) => {
            console.error('[scene] Depth texture load error:', err)
            reject(err)
        })
    })
    console.log('[scene] Depth texture loaded')

    const furnitureScene = new THREE.Scene()
    furnitureScene.background = null

    const ambientLight = new THREE.AmbientLight(0xffffff, 8.0)
    furnitureScene.add(ambientLight)
    const dirLight = new THREE.DirectionalLight(0xffffff, 7.0)
    dirLight.position.set(5, 5, 5)
    furnitureScene.add(dirLight)
    const dirLight2 = new THREE.DirectionalLight(0xffffff, 5.0)
    dirLight2.position.set(-5, 3, -5)
    furnitureScene.add(dirLight2)

    const frustumSize = 2
    const camera = new THREE.OrthographicCamera(
        -frustumSize * aspect / 2,
        frustumSize * aspect / 2,
        frustumSize / 2,
        -frustumSize / 2,
        0.1,
        100
    )
    camera.position.z = 10
    camera.position.y = 4
    camera.lookAt(0, 0, 0)

    let dpr = Math.min(window.devicePixelRatio, 2)
    const furnitureRenderTarget = new THREE.WebGLRenderTarget(
        width * dpr,
        height * dpr,
        {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
        }
    )

    const gltfLoader = new GLTFLoader() //used to load .glb files
    console.log('[scene] Loading GLB from:', glbUrl)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gltf = await new Promise<{ scene: any }>((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error(`GLB load timed out after 60s. URL: ${glbUrl}`))
        }, 60_000)
        gltfLoader.load(
            glbUrl,
            (result) => { clearTimeout(timeout); resolve(result) },
            (progress) => {
                if (progress.lengthComputable) {
                    console.log(`[scene] GLB download: ${Math.round(progress.loaded / progress.total * 100)}%`)
                }
            },
            (err) => { clearTimeout(timeout); console.error('[scene] GLB load error:', err); reject(err) },
        )
    })

    const furniture = gltf.scene

    //load and normalize furniture
    const box = new THREE.Box3().setFromObject(furniture)
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z)
    const targetSize = 0.5
    const scaleFactor = targetSize / maxDim

    furniture.position.sub(center)
    furniture.scale.setScalar(scaleFactor)
    const floorBox = new THREE.Box3().setFromObject(furniture)
    furniture.position.x = 0
    furniture.position.z = 0
    // Keep the object grounded after orientation + scale normalization.
    furniture.position.y -= floorBox.min.y + 0.3
    const baseScale = furniture.scale.clone()
    let currentScaleFactor = 1
    furnitureScene.add(furniture)

    //https://threejs.org/docs/#TransformControls
    const transformControls = new TransformControls(camera, renderer.domElement)
    transformControls.setMode('rotate') 
    transformControls.setSpace('local')
    transformControls.setSize(0.9)
    transformControls.enabled = showRotateGizmo
    transformControls.attach(furniture)
    const transformHelper = transformControls.getHelper()
    transformHelper.visible = showRotateGizmo
    transformHelper.renderOrder = 10
    transformHelper.frustumCulled = false
    furnitureScene.add(transformHelper)

    let gizmoVisible = showRotateGizmo
    let isGizmoDragging = false
    transformControls.addEventListener('dragging-changed', (event) => {
        const value = (event as { value?: boolean }).value
        isGizmoDragging = Boolean(value)
    })

    const compositeScene = new THREE.Scene()
    const compositeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    const compositeMaterial = new THREE.ShaderMaterial({
        uniforms: {
            tRoom: { value: roomTexture },
            tRoomDepth: { value: depthTexture },
            tFurniture: { value: furnitureRenderTarget.texture },
            occlusionEnabled: { value: true },
            depthBias: { value: 0.0 },
        },
        vertexShader: compositeVertexShader,
        fragmentShader: compositeFragmentShader,
        depthTest: false,
        depthWrite: false,
    })
    const compositeGeometry = new THREE.PlaneGeometry(2, 2)
    const compositeQuad = new THREE.Mesh(compositeGeometry, compositeMaterial)
    compositeScene.add(compositeQuad)

    //resizing room image to fit container
    const handleResize = () => {
        const fit = computeFit()
        width = fit.w
        height = fit.h
        offsetX = fit.offsetX
        offsetY = fit.offsetY
        aspect = width / height
        dpr = Math.min(window.devicePixelRatio, 2)
        renderer.setPixelRatio(dpr)
        renderer.setSize(width, height)
        renderer.domElement.style.left = `${offsetX}px`
        renderer.domElement.style.top = `${offsetY}px`
        camera.left = -frustumSize * aspect / 2
        camera.right = frustumSize * aspect / 2
        camera.top = frustumSize / 2
        camera.bottom = -frustumSize / 2
        camera.updateProjectionMatrix()
        furnitureRenderTarget.setSize(width * dpr, height * dpr)
    }

    const handleWheel = (event: WheelEvent) => {
        event.preventDefault()
        camera.zoom = Math.max(0.05, camera.zoom - event.deltaY * 0.001)
        camera.updateProjectionMatrix()
    }

    let isDragging = false
    let startX = 0
    let startY = 0
    let startPos = { x: 0, y: 0 }

    //handles dragging furniture with mouse
    const handlePointerDown = (event: PointerEvent) => {
        if (event.button !== 0) return
        if (gizmoVisible && (transformControls.dragging || transformControls.axis || isGizmoDragging)) {
            return
        } //if we're in the rotate gizmo you can't move the furniture
        startX = event.clientX
        startY = event.clientY
        startPos = {
            x: furniture.position.x,
            y: furniture.position.y,
        }
        isDragging = true
        renderer.domElement.setPointerCapture(event.pointerId)
    }

    //updates furniture position while dragging
    const handlePointerMove = (event: PointerEvent) => {
        if (!isDragging) return
        const dx = (event.clientX - startX) / width
        const dy = (event.clientY - startY) / height
        furniture.position.x = startPos.x + dx * 2
        furniture.position.y = startPos.y - dy * 2
    }

    const handlePointerUp = (event: PointerEvent) => {
        isDragging = false
        renderer.domElement.releasePointerCapture(event.pointerId)
    }

    const handleContextMenu = (event: MouseEvent) => {
        event.preventDefault()
    }

    const resizeObserver = new ResizeObserver(handleResize)
    resizeObserver.observe(container)
    renderer.domElement.addEventListener('wheel', handleWheel, { passive: false })
    renderer.domElement.addEventListener('pointerdown', handlePointerDown)
    renderer.domElement.addEventListener('pointermove', handlePointerMove)
    renderer.domElement.addEventListener('pointerup', handlePointerUp)
    renderer.domElement.addEventListener('pointerleave', handlePointerUp)
    renderer.domElement.addEventListener('contextmenu', handleContextMenu)

    const renderFurnitureTarget = () => {
        const prevHelperVisible = transformHelper.visible
        transformHelper.visible = false
        renderer.setRenderTarget(furnitureRenderTarget)
        renderer.setClearColor(0x000000, 0)
        renderer.clear()
        renderer.render(furnitureScene, camera)
        transformHelper.visible = prevHelperVisible
    }

    let animationId = 0
    const animate = () => {
        animationId = requestAnimationFrame(animate)

        renderFurnitureTarget()

        renderer.setRenderTarget(null)
        renderer.setClearColor(0x000000, 1)
        renderer.clear(true, true, true)
        renderer.render(compositeScene, compositeCamera)

        if (gizmoVisible) {
            furniture.visible = false
            renderer.clearDepth()
            renderer.render(furnitureScene, camera)
            furniture.visible = true
        }
    }
    animate()

    const initialTransform = {
        position: { x: furniture.position.x, y: furniture.position.y, z: furniture.position.z },
        rotation: { x: furniture.rotation.x-0.35, y: furniture.rotation.y, z: furniture.rotation.z },//keep magic number
        scale: { x: furniture.scale.x, y: furniture.scale.y, z: furniture.scale.z },
    }

    const setDepthOffset = (depthOffset: number) => {
        if (!compositeMaterial.uniforms?.depthBias) return
        compositeMaterial.uniforms.depthBias.value = depthOffset * depthBiasScale
    }

    const setScaleFactor = (scaleFactor: number) => {
        currentScaleFactor = scaleFactor
        furniture.scale.set(
            baseScale.x * currentScaleFactor,
            baseScale.y * currentScaleFactor,
            baseScale.z * currentScaleFactor
        )
    }

    const setGizmoVisible = (visible: boolean) => {
        gizmoVisible = visible
        transformControls.enabled = visible
        transformHelper.visible = visible
    }

    const captureComposite = async () => {
        renderFurnitureTarget()
        renderer.setRenderTarget(null)
        renderer.render(compositeScene, compositeCamera)
        return renderer.domElement.toDataURL('image/png')
    }

    const captureMask = async () => {
        const prevHelperVisible = transformHelper.visible
        transformHelper.visible = false

        const originalMaterials: AnyMap = new Map()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        furniture.traverse((child: any) => {
            if (!child.isMesh) return
            originalMaterials.set(child, child.material)
            child.material = new THREE.MeshBasicMaterial({ color: 0xffffff })
        })

        renderer.setRenderTarget(furnitureRenderTarget)
        renderer.setClearColor(0x000000, 1)
        renderer.clear()
        renderer.render(furnitureScene, camera)
        renderer.setRenderTarget(null)

        const width = furnitureRenderTarget.width
        const height = furnitureRenderTarget.height
        const buffer = new Uint8Array(width * height * 4)
        renderer.readRenderTargetPixels(furnitureRenderTarget, 0, 0, width, height, buffer)

        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')!
        const imageData = ctx.createImageData(width, height)

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const srcIdx = ((height - y - 1) * width + x) * 4
                const dstIdx = (y * width + x) * 4
                imageData.data[dstIdx] = buffer[srcIdx]
                imageData.data[dstIdx + 1] = buffer[srcIdx + 1]
                imageData.data[dstIdx + 2] = buffer[srcIdx + 2]
                imageData.data[dstIdx + 3] = buffer[srcIdx + 3]
            }
        }
        ctx.putImageData(imageData, 0, 0)

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        furniture.traverse((child: any) => {
            if (child.isMesh && originalMaterials.has(child)) {
                child.material = originalMaterials.get(child)
            }
        })

        renderer.setClearColor(0x000000, 0)
        transformHelper.visible = prevHelperVisible

        return canvas.toDataURL('image/png')
    }

    const reset = () => {
        furniture.position.set(
            initialTransform.position.x,
            initialTransform.position.y,
            initialTransform.position.z
        )
        furniture.rotation.set(
            initialTransform.rotation.x,
            initialTransform.rotation.y,
            initialTransform.rotation.z
        )
        furniture.scale.set(
            baseScale.x * currentScaleFactor,
            baseScale.y * currentScaleFactor,
            baseScale.z * currentScaleFactor
        )
    }

    const dispose = () => {
        cancelAnimationFrame(animationId)
        resizeObserver.disconnect()
        renderer.domElement.removeEventListener('wheel', handleWheel)
        renderer.domElement.removeEventListener('pointerdown', handlePointerDown)
        renderer.domElement.removeEventListener('pointermove', handlePointerMove)
        renderer.domElement.removeEventListener('pointerup', handlePointerUp)
        renderer.domElement.removeEventListener('pointerleave', handlePointerUp)
        renderer.domElement.removeEventListener('contextmenu', handleContextMenu)
        transformControls.dispose()
        furnitureRenderTarget.dispose()
        renderer.dispose()
        if (renderer.domElement.parentElement === container) {
            container.removeChild(renderer.domElement)
        }
    }

    return {
        setDepthOffset,
        setScaleFactor,
        setGizmoVisible,
        captureComposite,
        captureMask,
        reset,
        dispose,
    }
}
