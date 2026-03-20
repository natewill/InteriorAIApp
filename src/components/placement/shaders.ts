export const compositeVertexShader = `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
    }
`

export const compositeFragmentShader = `
    uniform sampler2D tRoom;
    uniform sampler2D tRoomDepth;
    uniform sampler2D tFurniture;
    uniform bool occlusionEnabled;
    uniform float depthBias;

    varying vec2 vUv;

    vec3 linearToSrgb(vec3 color) {
        return pow(color, vec3(1.0 / 2.2));
    }

    void main() {
        vec4 roomColor = texture2D(tRoom, vUv);
        vec4 furnitureColor = texture2D(tFurniture, vUv);
        float roomDepth = texture2D(tRoomDepth, vUv).r;
        float biasedDepth = clamp(roomDepth + depthBias, 0.0, 1.0);

        if (furnitureColor.a < 0.01) {
            gl_FragColor = vec4(linearToSrgb(roomColor.rgb), 1.0);
            return;
        }

        if (occlusionEnabled) {
            // Hard occlusion: bright (near) hides furniture, dark (far) shows it
            float occlude = step(0.55, biasedDepth);
            float finalAlpha = furnitureColor.a * (1.0 - occlude);
            vec3 blended = mix(roomColor.rgb, furnitureColor.rgb, finalAlpha);
            gl_FragColor = vec4(linearToSrgb(blended), 1.0);
        } else {
            vec3 blended = mix(roomColor.rgb, furnitureColor.rgb, furnitureColor.a);
            gl_FragColor = vec4(linearToSrgb(blended), 1.0);
        }
    }
`
