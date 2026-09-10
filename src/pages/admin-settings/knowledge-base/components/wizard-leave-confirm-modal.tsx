import { AlertTriangle } from 'lucide-react';

function WizardLeaveConfirmModal({
  open,
  onStay,
  onDiscard,
}: {
  open: boolean;
  onStay: () => void;
  onDiscard: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] grid place-items-center bg-slate-950/55 px-4">
      <div className="w-[440px] max-w-[92vw] overflow-hidden rounded-xl bg-white shadow-[0_20px_60px_rgba(0,0,0,0.22)]">
        <div className="flex items-start gap-[14px] px-6 pb-[14px] pt-[22px]">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#FEF3C7] text-[#92400E]">
            <AlertTriangle className="h-[22px] w-[22px]" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="mb-[5px] text-[17px] font-bold text-gray-950">Leave the wizard?</h3>
            <p className="text-[13px] leading-[1.55] text-slate-600">
              You're in the middle of creating an agent. Leaving will discard your unsaved changes.
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-[9px] px-6 pb-[22px] pt-[14px]">
          <button
            type="button"
            onClick={onStay}
            className="rounded-lg border border-gray-200 bg-white px-[18px] py-[9px] text-sm font-semibold text-slate-700 transition hover:bg-gray-50"
          >
            Stay
          </button>
          <button
            type="button"
            onClick={onDiscard}
            className="rounded-lg bg-[#EF4444] px-[18px] py-[9px] text-sm font-semibold text-white transition hover:bg-[#B91C1C]"
          >
            Discard & leave
          </button>
        </div>
      </div>
    </div>
  );
}

export default WizardLeaveConfirmModal;
