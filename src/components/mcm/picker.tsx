import { Fragment } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export type PickerOption = {
  label: string;
  value: string;
  /** Heading this option sits under. Consecutive options sharing one are
      grouped, the way <optgroup> did it. */
  group?: string;
  /** Listed but not choosable — with `note` saying why. */
  disabled?: boolean;
  note?: string;
};

/**
 * One value, chosen from a short list.
 *
 * The native `<select>` this replaces has its option list drawn by the
 * operating system: no CSS reaches it, so a menu opened as a plain white box
 * with a hard blue highlight in the middle of a themed page. `react-select`
 * replaces the list but brings its own look, which is why the same choice
 * appeared three different ways on three admin screens.
 *
 * Radix's radio group is the same thing a select is — one value, arrow keys,
 * type-ahead, announced as a choice — and it is already a dependency. It takes
 * {label, value} rather than plain strings because a name is rarely its own id.
 *
 * `showLabel` is the difference between the two shapes it takes: a filter chip
 * that names what it filters ("Agent: Sales assistant"), and a form field in a
 * row that is already labelled.
 */
export const Picker = ({
  label,
  value,
  options,
  onChange,
  className,
  showLabel = true,
  disabled = false,
  placeholder,
}: {
  label: string;
  value: string;
  options: PickerOption[];
  onChange: (option: PickerOption) => void;
  className?: string;
  showLabel?: boolean;
  disabled?: boolean;
  /** Shown when nothing matches `value` — "Select a manager", and so on. */
  placeholder?: string;
}) => {
  const current = options.find((option) => option.value === value);
  const shown = current?.label ?? placeholder ?? options[0]?.label ?? '';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        className={`fchip fchip-btn${current ? '' : ' is-empty'}${className ? ` ${className}` : ''}`}
        aria-label={`${label}: ${shown}`}
      >
        {showLabel ? <span className="fchip-l">{label}</span> : null}
        <span className="fchip-v">{shown}</span>
        <ChevronDown size={13} strokeWidth={2.5} aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="mcm-fchip-menu">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            const option = options.find((item) => item.value === next);
            if (option) onChange(option);
          }}
        >
          {options.map((option, index) => {
            const heading =
              option.group && option.group !== options[index - 1]?.group ? option.group : null;
            return (
              <Fragment key={option.value || `none-${label}-${index}`}>
                {heading ? <p className="mcm-fchip-group">{heading}</p> : null}
                <DropdownMenuRadioItem
                  value={option.value}
                  disabled={option.disabled}
                  title={option.note}
                >
                  <span>{option.label}</span>
                  {option.value === value ? (
                    <Check size={14} strokeWidth={2.5} aria-hidden="true" />
                  ) : null}
                </DropdownMenuRadioItem>
              </Fragment>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default Picker;
