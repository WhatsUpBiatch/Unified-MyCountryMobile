import * as React from 'react';
import { cn } from '@/lib/utils';
import { Label } from './label';
import ErrorTooltip from '../custom/error-tooltip';
import { EyeLine, EyeLineOff } from '@/assets/icons';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: React.ReactNode;
  error?: any;
  Icon?: React.ReactNode;
  onIconClick?: () => void;
  IconPosition?: string;
  showEye?: boolean;
}

/* forwardRef so a caller can reach the real <input>. Without it a `ref` prop is
   dropped on the floor: it does not raise, the ref just stays null and whatever
   it was for - focusing a field, selecting its text - silently never happens.
   Callers that pass no ref are unaffected. */
const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    className,
    type = 'text',
    label = null,
    error = '',
    Icon = null,
    IconPosition = 'right-0 inset-y-0 pr-2',
    onIconClick,
    showEye = false,
    ...props
  },
  ref,
) {
  const [showPassword, setShowPassword] = React.useState(false);

  const isSearchInput =
    typeof props.placeholder === 'string' && props.placeholder.toLowerCase().includes('search');

  return (
    <div className="flex flex-col gap-1.5 w-full">
      {(label || error) && (
        <div className="flex items-center justify-between">
          <Label>{label}</Label>
          <div className="flex items-start ">{error && <ErrorTooltip text={error} />}</div>
        </div>
      )}
      <div className="relative w-full">
        {Icon && (
          <span
            onClick={onIconClick}
            className={`absolute ${IconPosition} cursor-pointer text-gray-500 flex items-center`}
          >
            {Icon}
          </span>
        )}
        {showEye && (
          <span
            onClick={() => setShowPassword((p) => !p)}
            className={`absolute ${IconPosition} cursor-pointer text-gray-500 flex items-center`}
          >
            {showPassword ? <EyeLineOff /> : <EyeLine />}
          </span>
        )}
        <div className="flex">
          <input
            ref={ref}
            autoComplete="off"
            type={!showPassword ? type : 'text'}
            data-slot="input"
            className={cn(
              'border normal-case focus:outline-none disabled:bg-gray-300 disabled:text-slate-500 disabled:border-gray-200 disabled:shadow-none text-gray-700 placeholder:text-gray-700 bg-white shadow-sm text-sm  rounded-xl w-full px-3 min-h-10',
              error
                ? 'border-red-500 focus:border-red-500 focus:ring-0'
                : 'border-gray-300 focus:shadow-secondary/5 focus:ring-white shadow-secondary/5 focus:border-primary hover:border-primary',
              className,
            )}
            {...props}
            {...(isSearchInput && props.maxLength === undefined ? { maxLength: 50 } : {})}
            {...(type === 'number'
              ? {
                  onKeyDown: (e) => {
                    if (type === 'number') {
                      const invalidChars = ['e', 'E', '+', '-'];
                      if (invalidChars.includes(e.key)) {
                        e.preventDefault();
                      }
                    }
                  },
                }
              : {})}
          />
        </div>
      </div>
    </div>
  );
});

export { Input };
