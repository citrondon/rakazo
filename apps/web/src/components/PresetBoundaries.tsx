import { Trans } from "@lingui/react/macro";

/**
 * What a preset's bot will not do, shown next to the import preview. Nothing renders for a
 * preset that states no limits; the lines come from the preset, not from here.
 */
export function PresetBoundaries({ boundaries }: { boundaries: string[] }) {
  if (boundaries.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[13px] text-muted-foreground">
        <Trans>Won't do</Trans>
      </div>
      <ul className="flex list-disc flex-col gap-0.5 pl-4 text-[13px] text-muted-foreground">
        {boundaries.map((boundary) => (
          <li key={boundary}>{boundary}</li>
        ))}
      </ul>
    </div>
  );
}
