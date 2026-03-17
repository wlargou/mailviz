import { Tag } from '@carbon/react';
import { red60, blue60, purple60, orange40, green60, cyan50 } from '@carbon/colors';
import type { Label } from '../../types/task';

// Map label hex colors (from DB) to the closest Carbon Tag type.
// Keys use @carbon/colors palette tokens — values happen to match
// the hex strings stored in the database.
const colorToTagType: Record<string, string> = {
  [red60]: 'red',         // Bug
  [blue60]: 'blue',       // Feature
  [purple60]: 'purple',   // Documentation
  [orange40]: 'magenta',  // Design
  [green60]: 'green',     // Backend
  [cyan50]: 'cyan',       // Frontend
};

// Fallback: pick a Carbon tag type based on the color hex
function getTagType(color: string): string {
  if (colorToTagType[color]) return colorToTagType[color];

  // Parse hex to determine dominant channel
  const hex = color.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  if (r > g && r > b) return 'red';
  if (g > r && g > b) return 'green';
  if (b > r && b > g) return 'blue';
  return 'teal';
}

interface LabelTagProps {
  label: Label;
  size?: 'sm' | 'md' | 'lg';
}

export function LabelTag({ label, size = 'sm' }: LabelTagProps) {
  return (
    <Tag type={getTagType(label.color) as any} size={size}>
      {label.name}
    </Tag>
  );
}
