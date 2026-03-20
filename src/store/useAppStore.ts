
import { create } from 'zustand';

type Mode = 'add' | 'transform' | 'remove';

interface AppState {
    mode: Mode;
    referenceImage: string | null;
    furnitureMask: string | null;
    removeMask: string | null;
    roomImage: string | null;
    roomDepthMap: string | null;
    glbUrl: string | null;
    glbGenerating: boolean;
    glbError: string | null;
    transformStrength: number;
    furnitureType: string;
    numberOfImages: number;
    results: string[] | null;

    actions: {
        setMode: (mode: Mode) => void;
        setReferenceImage: (image: string | null) => void;
        setFurnitureMask: (mask: string | null) => void;
        setRemoveMask: (mask: string | null) => void;
        setRoomImage: (image: string | null) => void;
        setRoomDepthMap: (map: string | null) => void;
        setGlbUrl: (url: string | null) => void;
        setGlbGenerating: (generating: boolean) => void;
        setGlbError: (error: string | null) => void;
        setTransformStrength: (strength: number) => void;
        setFurnitureType: (type: string) => void;
        setNumberOfImages: (count: number) => void;
        setResults: (results: string[] | null) => void;
        reset: () => void;
    };
}

export const useAppStore = create<AppState>((set) => ({
    mode: 'add',
    referenceImage: null,
    furnitureMask: null,
    removeMask: null,
    roomImage: null,
    roomDepthMap: null,
    glbUrl: null,
    glbGenerating: false,
    glbError: null,
    transformStrength: 50,
    furnitureType: 'chair',
    numberOfImages: 3,
    results: null,

    actions: {
        setMode: (mode) => set({ mode }),
        setReferenceImage: (referenceImage) => set({
            referenceImage,
            furnitureMask: null,
            glbUrl: null,
            glbGenerating: false,
            glbError: null,
        }),
        setFurnitureMask: (furnitureMask) => set({ furnitureMask }),
        setRemoveMask: (removeMask) => set({ removeMask }),
        setRoomImage: (roomImage) => set({ roomImage, removeMask: null, results: null, roomDepthMap: null }),
        setRoomDepthMap: (roomDepthMap) => set({ roomDepthMap }),
        setGlbUrl: (glbUrl) => set({ glbUrl }),
        setGlbGenerating: (glbGenerating) => set({ glbGenerating }),
        setGlbError: (glbError) => set({ glbError }),
        setTransformStrength: (transformStrength) => set({ transformStrength }),
        setFurnitureType: (furnitureType) => set({ furnitureType }),
        setNumberOfImages: (numberOfImages) => set({ numberOfImages }),
        setResults: (results) => set({ results }),
        reset: () => set({ results: null }),
    },
}));

export const useAppActions = () => useAppStore((state) => state.actions);
