import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { CallerIdOption } from '../types';

type DialpadCallerIdConfirmDialogProps = {
  open: boolean;
  currentOption: CallerIdOption | null;
  nextOption: CallerIdOption | null;
  onConfirm: () => void;
  onCancel: () => void;
  /* True when the number being chosen belongs to a group rather than to this
     person, in which case it is not saved. */
  isOneCallOnly?: boolean;
};

const DialpadCallerIdConfirmDialog = ({
  open,
  currentOption,
  nextOption,
  onConfirm,
  onCancel,
  isOneCallOnly = false,
}: DialpadCallerIdConfirmDialogProps) => {
  if (!nextOption) return null;

  const currentLabel = currentOption
    ? `${currentOption.label} (${currentOption.number})`
    : 'Current Caller ID';
  const nextLabel = `${nextOption.label} (${nextOption.number})`;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onCancel()}>
      <DialogContent
        className="w-[min(92vw,28rem)] overflow-hidden rounded-xl gap-0 border border-[#dbe4f3] p-0 shadow-[0_24px_48px_rgba(20,39,70,0.18)]"
        showCloseButton={false}
      >
        <DialogHeader className="rounded-t-xl border-b border-[#e8eef8] bg-[#f8fbff] px-5 py-4">
          <DialogTitle className="text-base font-semibold text-[#1f2f47]">
            Change Caller ID
          </DialogTitle>
        </DialogHeader>
        <div className="rounded-b-xl space-y-4 bg-white px-5 py-4">
          <DialogDescription className="text-sm leading-6 text-[#5e7394]">
            Do you want to switch Caller ID from{' '}
            <span className="font-semibold text-[#1f2f47]">{currentLabel}</span> to{' '}
            <span className="font-semibold text-[#1f2f47]">{nextLabel}</span>?
          </DialogDescription>
          {/* A shared number is borrowed for one call and is not saved as this
              person's number. Said here because the rest of this dialog reads
              like a lasting change, which it is for their own numbers. */}
          {isOneCallOnly && (
            <p className="text-xs font-medium text-[#5e7394]">
              This is a shared number, so it applies to this call only. Your own number stays
              your default.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="transparent" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="button" variant="outline" onClick={onConfirm}>
              Confirm
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default DialpadCallerIdConfirmDialog;
