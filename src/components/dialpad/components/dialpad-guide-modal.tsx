import { ChevronDown, Info, PhoneCall, X } from 'lucide-react';

type DialpadGuideModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

const DialpadGuideModal = ({ isOpen, onClose }: DialpadGuideModalProps) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f172a]/30 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[430px] rounded-xl bg-white p-6 shadow-[0_24px_44px_rgba(18,31,53,0.32)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#e9f2ff] text-primary">
              <Info className="h-4 w-4" />
            </span>
            <h3 className="text-2xl font-semibold text-[#1e2d44]">Dialer Guide</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f5f7fb] text-[#74839a] transition hover:bg-[#e8edf6]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5">
          <div className="flex gap-3">
            <span className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#e5f8ef] text-[#21a366]">
              <PhoneCall className="h-4 w-4" />
            </span>
            <div>
              <p className="text-lg font-semibold text-[#1f2e45]">Making Calls</p>
              <p className="mt-1 text-sm leading-6 text-[#5d6c83]">
                Enter at least 3 digits. The green call button activates automatically once valid
                digits are recognized.
              </p>
            </div>
          </div>

          <div className="flex gap-3">
            <span className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#eaf3ff] text-[#3479f0]">
              <ChevronDown className="h-4 w-4" />
            </span>
            <div>
              <p className="text-lg font-semibold text-[#1f2e45]">Caller ID Selection</p>
              <p className="mt-1 text-sm leading-6 text-[#5d6c83]">
                Use the dropdown to change your outbound DID. Your selected line is applied
                immediately.
              </p>
            </div>
          </div>

          {/* <div className="flex gap-3">
            <span className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#f2ecff] text-[#8b5cf6]">
              <UserPlus className="h-4 w-4" />
            </span>
            <div>
              <p className="text-lg font-semibold text-[#1f2e45]">Add New Contact</p>
              <p className="mt-1 text-sm leading-6 text-[#5d6c83]">
                Type a number in the dialpad, then use the Add new contact link to save it quickly.
              </p>
            </div>
          </div> */}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-7 w-full rounded-full bg-[#0c1833] px-5 py-3 text-base font-semibold text-white transition hover:bg-[#0a1429]"
        >
          Got it, thanks!
        </button>
      </div>
    </div>
  );
};

export default DialpadGuideModal;
