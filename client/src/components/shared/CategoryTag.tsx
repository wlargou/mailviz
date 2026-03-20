import { Tag } from '@carbon/react';
import type { CompanyCategory } from '../../types/customer';

interface CategoryTagProps {
  category: CompanyCategory | null | undefined;
}

export function CategoryTag({ category }: CategoryTagProps) {
  if (!category) return null;

  return (
    <Tag
      size="sm"
      className="category-tag"
      style={{
        backgroundColor: category.color,
        color: '#fff',
      }}
    >
      {category.label}
    </Tag>
  );
}
