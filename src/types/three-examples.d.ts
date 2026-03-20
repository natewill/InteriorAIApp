declare module 'three/examples/jsm/loaders/GLTFLoader.js' {
  export class GLTFLoader {
    load(
      url: string,
      onLoad: (gltf: { scene: unknown }) => void,
      onProgress?: (event: ProgressEvent<EventTarget>) => void,
      onError?: (error: unknown) => void
    ): void;
  }
}

declare module 'three/examples/jsm/controls/TransformControls.js' {
  export class TransformControls {
    constructor(camera: any, domElement: HTMLElement);
    enabled: boolean;
    dragging: boolean;
    axis: string | null;
    setMode(mode: string): void;
    setSpace(space: string): void;
    setSize(size: number): void;
    attach(object: any): void;
    getHelper(): any;
    addEventListener(type: string, listener: (event: { value?: boolean }) => void): void;
    dispose(): void;
  }
}
