import { useState, useId, type ReactNode } from 'react';
import { Button, Popover, PopoverContent, Layer } from '@carbon/react';
import { Filter } from '@carbon/icons-react';

interface TableFilterFlyoutProps {
  children: ReactNode;
  /** Number of active filters (shows badge on icon) */
  activeFilterCount?: number;
  onReset: () => void;
}

/**
 * Carbon-compliant filter flyout for DataTable toolbars.
 * Uses Carbon Popover with isTabTip, matching the official
 * DataTable filtering Storybook pattern.
 *
 * Usage:
 * ```tsx
 * <TableFilterFlyout activeFilterCount={1} onReset={resetFilters}>
 *   <Dropdown ... />
 * </TableFilterFlyout>
 * ```
 */
export function TableFilterFlyout({ children, activeFilterCount = 0, onReset }: TableFilterFlyoutProps) {
  const [isOpen, setIsOpen] = useState(false);
  const filterId = useId();

  return (
    <Layer>
      <Popover<any>
        open={isOpen}
        isTabTip
        onRequestClose={() => setIsOpen(false)}
        align="bottom-end"
      >
        <button
          aria-label="Filter"
          type="button"
          aria-expanded={isOpen}
          onClick={() => setIsOpen(!isOpen)}
          className={`cds--toolbar-action cds--overflow-menu${activeFilterCount > 0 ? ' table-filter-flyout__trigger--active' : ''}`}
        >
          <Filter />
          {activeFilterCount > 0 && (
            <span className="table-filter-flyout__badge">{activeFilterCount}</span>
          )}
        </button>
        <PopoverContent id={filterId}>
          <div className="table-filter-flyout__content">
            <fieldset className="cds--fieldset">
              <legend className="cds--label">Filter options</legend>
              {children}
            </fieldset>
          </div>
          <div className="table-filter-flyout__actions">
            <Button
              kind="secondary"
              size="sm"
              onClick={() => {
                onReset();
                setIsOpen(false);
              }}
            >
              Reset filters
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </Layer>
  );
}
