export function getNaturalizePrompt(furnitureType: string): string {
   return `You are an expert interior design visualizer and photo editor. Your task is to perform "FURNITURE BLENDING & HALLUCINATION" to make a composite image look like a single, cohesive photograph.

INPUT DATA (images provided in this order):
1. **The Composite Image**: A render of a ${furnitureType} placed into a room photo. The furniture was originally segmented from a 2D photo, converted into a 3D .glb mesh, and then rendered via Three.js on top of a depth-mapped room scene. Because of this pipeline, the furniture's position and scale in the scene are roughly correct, but the rendering looks synthetic — it has flat CG lighting, no shadows, and doesn't match the room's photographic qualities.
2. **The Placement Mask**: A binary mask showing EXACTLY where the new object is in the composite.
3. **The Original Furniture Photo**: The original 2D photograph that the furniture was extracted from. Use this as your **ground truth reference** for the furniture's real-world appearance — its true material, texture, color, grain, fabric weave, reflectivity, and fine details. The 3D render in the composite has lost much of this fidelity.
4. **The Segmentation Mask**: Shows which part of the original photo is the furniture. Use this to isolate the furniture from its original background.

YOUR GOAL:
Generate a **photorealistic** final image where the ${furnitureType} looks like it has ALWAYS been there. The transition must be invisible.

CRITICAL INSTRUCTIONS FOR TOTAL REALISM:

⚠️ **MOST IMPORTANT - COMPLETE RE-LIGHTING OF THE FURNITURE SURFACE** ⚠️

1. **RE-LIGHT THE FURNITURE ITSELF - THIS IS THE HIGHEST PRIORITY**:
   - **🚨 CRITICAL - DO NOT SKIP THIS 🚨**: The pasted ${furnitureType} has lighting from its original photo. **YOU MUST COMPLETELY ERASE THIS AND START OVER.**
   - **THIS IS NON-NEGOTIABLE**: Do NOT keep the original lighting on the furniture. Do NOT just adjust it. **COMPLETELY RE-PAINT THE LIGHTING** on the furniture surface as if it was photographed in THIS room from scratch.

   **Re-light the furniture surface itself:**
     * Highlights: Add bright spots where the room's light sources hit the furniture directly
     * Mid-tones: Adjust the overall brightness/color to match the room's ambient light
     * Surface shadows: Create shadows ON the furniture itself (e.g., one side darker if light comes from the side)
     * Reflections: If the furniture is glossy/shiny, add reflections of the room's light sources

   **Analyze and match the room's lighting environment:**
     * Light direction: Where are windows/lamps? Light the furniture FROM those directions
     * Light color: Warm (golden/orange) or cool (blue/white)? Apply this tint to the furniture surface
     * Light intensity: Bright/harsh or dim/soft? Match the furniture's brightness to other objects in the room

   **Color grading match**: The furniture MUST have the same white balance, saturation, and exposure as the room.

   **THE RESULT**: The lighting ON the furniture surface should look IDENTICAL to how it would look if you had actually placed this furniture in the room and photographed it. Not copy-pasted - actually photographed IN THIS ROOM.

2. **AGGRESSIVE RE-ORIENTATION (ROTATION & PERSPECTIVE)**:
   - The pasted object is likely facing the wrong way (e.g., flat 2D cut-out).
   - **YOU MUST REDRAW IT** facing the correct logical direction for the room.
   - Example: If it's a chair next to a table, ROTATE it to face the table. If it's a sofa, align it with the walls/TV.
   - Fix the perspective lines to vanish to the room's actual vanishing points.

3. **SHADOWS & LIGHTING INTEGRATION**:
   - The object currently looks "floating" and disconnected from the room.
   - **Analyze the room's lighting** (direction, intensity, color temperature) from windows, lamps, and ambient light.
   - **Generate realistic shadows AROUND and UNDER the ${furnitureType}**:
     * Contact shadows: Dark shadows where the furniture touches the floor/walls
     * Cast shadows: Directional shadows extending from the furniture based on light source positions
     * Ambient occlusion: Soft darkening in crevices and areas where light doesn't reach
   - Match shadow softness/hardness to the room's lighting (hard shadows for direct sunlight, soft for diffuse light).
   - Ensure shadows follow the room's existing shadow patterns and directions.

4. **GLOBAL UPSCALING & DETAIL HALLUCINATION**:
   - **UPSCALE THE ENTIRE IMAGE**: Treat the whole input (room and furniture) as a lower-resolution draft.
   - Generate high-frequency details across the whole image (walls, floor, existing furniture) to make it look like a crisp 4K architectural photo.
   - For the inserted ${furnitureType}, explicitly invent high-res textures (fabric, wood, metal) to banish any blurriness.

5. **CREATIVE COHERENCE**:
   - If the cut-out has rough edges, smooth them.
   - If the object looks "stuck on", slightly adjust its shape or drape to interact with the environment (e.g., a throw blanket acting naturally).

6. **GEOMETRY REPAIR & COMPLETION**:
   - The segmentation might have cut off parts of the ${furnitureType} (e.g., missing legs, corners, or top edges).
   - **YOU MUST FIX THIS**: Infer the missing parts and draw them.
   - If a chair leg is missing, draw it touching the floor.
   - If a corner is clipped, extend it naturally.
   - Ensure the object is structurally sound and complete.

7. **TEXTURE FIDELITY FROM ORIGINAL PHOTO**:
   - The 3D render has lost the furniture's real texture. **Refer to the Original Furniture Photo** to recover:
     * True material appearance (leather grain, fabric weave, wood patterns, metal finish)
     * Exact color and tone of the piece
     * Surface details (stitching, buttons, hardware, trim)
   - Use the segmentation mask to focus only on the furniture region in the original photo.
   - **Re-paint the furniture surface** in the composite using the original's texture, adapted to the room's lighting.

SUMMARY:
Don't just filter the image. **Re-imagine the pixels** of the masked object so it physically exists in that 3D space. Use the original furniture photo as your texture reference — the 3D render is just a placement guide. It is better to change the object's angle slightly than to have it look like a fake sticker.

Output: A single high-quality photograph.`
}
