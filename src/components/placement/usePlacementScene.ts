import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { initPlacementScene, type PlacementSceneApi } from './scene'

interface UsePlacementSceneArgs {
    containerRef: RefObject<HTMLDivElement>
    roomImageUrl: string
    depthImageUrl: string
    glbUrl: string
    scaleFactor: number
    depthOffset: number
    showRotateGizmo: boolean
}

export function usePlacementScene({
    containerRef,
    roomImageUrl,
    depthImageUrl,
    glbUrl,
    scaleFactor,
    depthOffset,
    showRotateGizmo,
}: UsePlacementSceneArgs) {
    const apiRef = useRef<PlacementSceneApi | null>(null)
    const depthOffsetRef = useRef(depthOffset)
    const showRotateGizmoRef = useRef(showRotateGizmo)
    const scaleFactorRef = useRef(scaleFactor)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        depthOffsetRef.current = depthOffset
    }, [depthOffset])

    useEffect(() => {
        showRotateGizmoRef.current = showRotateGizmo
    }, [showRotateGizmo])

    useEffect(() => {
        scaleFactorRef.current = scaleFactor
    }, [scaleFactor])

    useEffect(() => {
        if (!containerRef.current || !glbUrl) return

        let cancelled = false
        let localApi: PlacementSceneApi | null = null

        setLoading(true)
        setError(null)

        initPlacementScene({
            container: containerRef.current,
            roomImageUrl,
            depthImageUrl,
            glbUrl,
            showRotateGizmo: showRotateGizmoRef.current,
        })
            .then((api) => {
                localApi = api
                if (cancelled) {
                    api.dispose()
                    return
                }
                apiRef.current = api
                api.setDepthOffset(depthOffsetRef.current)
                api.setGizmoVisible(showRotateGizmoRef.current)
                api.setScaleFactor(scaleFactorRef.current)
                setLoading(false)
            })
            .catch((err) => {
                if (cancelled) return
                console.error('Scene init error:', err)
                setError(err instanceof Error ? err.message : 'Failed to load scene')
                setLoading(false)
            })

        return () => {
            cancelled = true
            if (localApi) {
                localApi.dispose()
            }
            if (apiRef.current === localApi) {
                apiRef.current = null
            }
        }
    }, [containerRef, roomImageUrl, depthImageUrl, glbUrl])

    useEffect(() => {
        apiRef.current?.setDepthOffset(depthOffset)
    }, [depthOffset])

    useEffect(() => {
        apiRef.current?.setScaleFactor(scaleFactor)
    }, [scaleFactor])

    useEffect(() => {
        apiRef.current?.setGizmoVisible(showRotateGizmo)
    }, [showRotateGizmo])

    const captureComposite = useCallback(async () => {
        if (!apiRef.current) {
            throw new Error('Scene not initialized')
        }
        return apiRef.current.captureComposite()
    }, [])

    const captureMask = useCallback(async () => {
        if (!apiRef.current) {
            throw new Error('Scene not initialized')
        }
        return apiRef.current.captureMask()
    }, [])

    const reset = useCallback(() => {
        apiRef.current?.reset()
    }, [])

    return {
        loading,
        error,
        captureComposite,
        captureMask,
        reset,
    }
}
