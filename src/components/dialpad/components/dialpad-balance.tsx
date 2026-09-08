import { useDialpad } from '@/hooks/use-dialpad';
import { useUser } from '@/hooks/use-user';
import { CircleDollarSign } from 'lucide-react';

const DialpadBalance = () => {
  const { closeDialpad } = useDialpad();
  const { user } = useUser();

  const balanceAmount = Number(user?.company_info?.amount ?? 0);

  /* Adding credit lived in Billing › Purchase, which has been removed. The
     balance is still worth showing; the button that went nowhere is not. */
  const handleAddCredit = () => {
    closeDialpad();
  };

  return (
    <div className="mb-2.5 flex items-center justify-between gap-1.5 rounded-full border border-[#e6ebf3] bg-white px-1.5 py-1 max-[380px]:mb-2 max-[380px]:px-[5px] max-[380px]:py-[3px] sm:mb-3 sm:gap-2 sm:px-2 sm:py-1 md:mb-2 lg:mb-2 xl:mb-4">
      <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-white max-[380px]:h-[18px] max-[380px]:w-[18px] sm:h-6 sm:w-6 lg:h-6.5 lg:w-6.5 xl:h-8 xl:w-8">
          <CircleDollarSign className="h-3 w-3 max-[380px]:h-2.5 max-[380px]:w-2.5 sm:h-4 sm:w-4" />
        </span>
        <div className="min-w-0 leading-none">
          <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[#60708c] max-[380px]:text-[8px] sm:text-[10px] md:text-[10px] xl:text-[11px]">
            Balance
          </p>
          <p className="mt-0.5 truncate text-[11px] font-semibold text-[#1a2842] max-[380px]:text-[10px]  sm:text-xs md:text-[11px] xl:text-sm">
            {Number.isFinite(balanceAmount) ? balanceAmount.toFixed(2) : '0.00'}{' '}
            <span className="text-[9px] uppercase tracking-[0.08em] text-[#8a97ab] max-[380px]:text-[8px] sm:text-[10px]">
              USD
            </span>
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={handleAddCredit}
        className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-[9px] font-semibold text-white transition hover:bg-primary max-[380px]:px-1.5 max-[380px]:py-0.5 max-[380px]:text-[8px] sm:px-2.5 sm:py-1 sm:text-[10px] md:px-3 md:text-[10.5px] lg:px-3.5 lg:py-1.5 xl:text-xs"
      >
        + Add Credit
      </button>
    </div>
  );
};

export default DialpadBalance;
