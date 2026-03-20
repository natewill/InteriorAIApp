export function getRemoveFurniturePrompt(): string {
    return `Inpaint the checkerboard region in this room photo.

Goal:
- Remove the targeted furniture naturally.
- If only a tiny fragment remains from the same object, remove that too.
- If the erased area is clearly accidental on mostly-visible furniture, restore that furniture section.

Rules:
- Keep room geometry and camera perspective unchanged.
- Match surrounding textures, lighting, and shadows.
- Blend seams so edits are invisible.
- Do not add new furniture or objects.
- Improve overall detail so the final image looks crisp and photorealistic.`
}
