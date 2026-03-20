import { useAppStore, useAppActions } from '@/store/useAppStore';
import ImageUpload from '../ImageUpload';
import LabeledSlider from './LabeledSlider';

export default function TransformModePanel() {
  const referenceImage = useAppStore((state) => state.referenceImage);
  const transformStrength = useAppStore((state) => state.transformStrength);
  const numberOfImages = useAppStore((state) => state.numberOfImages);

  const { setReferenceImage, setTransformStrength, setNumberOfImages } = useAppActions();
  return (
    <div className="flex h-full w-full flex-col gap-5 px-1">
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Reference Style
        </label>
        <ImageUpload
          label="Upload reference"
          image={referenceImage}
          onImageChange={setReferenceImage}
          compact
        />
      </div>
      <LabeledSlider
        label="Transform Strength"
        value={transformStrength}
        min={0}
        max={100}
        suffix="%"
        onChange={setTransformStrength}
        helperLeft="Subtle"
        helperRight="Complete"
      />
      <LabeledSlider
        label="Number of Images"
        value={numberOfImages}
        min={1}
        max={10}
        onChange={setNumberOfImages}
      />
    </div>
  );
}
