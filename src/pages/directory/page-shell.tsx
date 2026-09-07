import type { ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Ic, McmIconSprite } from '@/components/mcm/icons';

/**
 * The shape every Directory page takes.
 *
 * People, Groups and External are three views of the same idea — a filtered
 * list of records you act on — so they are laid out by one component rather
 * than three hand-built pages. That is what stops them drifting apart: a change
 * to the header, the filter bar or the empty state lands on all of them at once
 * and none of them can quietly end up looking like a different product.
 *
 * Create and edit flows use `DirectoryDrawer` below for the same reason.
 */

export const DirectoryPage = ({
  title,
  description,
  note,
  actions,
  filters,
  children,
}: {
  title: string;
  description: string;
  /* An honest caveat about how far this screen really reaches, shown under the
     description. Optional, so every page that does not need one is unchanged. */
  note?: ReactNode;
  actions?: ReactNode;
  filters?: ReactNode;
  children: ReactNode;
}) => (
  <div className="page">
    <McmIconSprite />
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions}
    </div>
    {note ? <div className="page-caveat">{note}</div> : null}
    {filters ? <div className="tbar">{filters}</div> : null}
    <div className="panel-card">
      <div className="tbl-wrap">{children}</div>
    </div>
  </div>
);

/** A filter chip.
 *
 * It wrapped a native `<select>`. The option list of one of those is drawn by
 * the operating system: no CSS reaches it, so a filter menu opened as a plain
 * white box with a hard blue highlight in the middle of a themed page, and its
 * rows could not carry a tick, a count or anything else.
 *
 * Radix's radio group is the same choice a select makes — one value, arrow
 * keys, type-ahead, announced as a choice — and it is already a dependency.
 * Shared by People, Favourites and Locations, so all three change together.
 */
export const FilterChip = ({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger className="fchip fchip-btn" aria-label={`${label}: ${value}`}>
      <span className="fchip-l">{label}</span>
      <span className="fchip-v">{value}</span>
      <ChevronDown size={13} strokeWidth={2.5} aria-hidden="true" />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="mcm-fchip-menu">
      <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
        {options.map((option) => (
          <DropdownMenuRadioItem key={option} value={option}>
            <span>{option}</span>
            {option === value ? (
              <Check size={14} strokeWidth={2.5} aria-hidden="true" />
            ) : null}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
);

export const SearchChip = ({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) => (
  <label className="fchip" style={{ flex: '1 1 220px', maxWidth: 320 }}>
    <Ic n="search" size={13} />
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      style={{ border: 0, background: 'transparent', width: '100%', outline: 'none' }}
    />
  </label>
);

/** The row every Directory list falls back to, so empty never looks broken. */
export const EmptyRow = ({ span, message }: { span: number; message: string }) => (
  <tr>
    <td colSpan={span}>
      <div className="empty">
        <Ic n="users" size={30} />
        <p>{message}</p>
      </div>
    </td>
  </tr>
);

/**
 * Create / edit surface.
 *
 * The platform opens these in its own SideDrawer with app styling; inside a
 * console page they use the console's drawer shape instead, so saving a record
 * looks like the page you saved it from.
 */
export const DirectoryDrawer = ({
  title,
  onClose,
  footer,
  children,
}: {
  title: string;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) => (
  <>
    <div className="scrim" onClick={onClose} aria-hidden />
    <aside className="drw" role="dialog" aria-label={title}>
      <div className="drw-h">
        <h2>{title}</h2>
        <button type="button" className="mini" onClick={onClose} aria-label="Close">
          <Ic n="x" size={12} />
        </button>
      </div>
      <div className="drw-b">{children}</div>
      {footer ? <div className="drw-f">{footer}</div> : null}
    </aside>
  </>
);

export default DirectoryPage;
