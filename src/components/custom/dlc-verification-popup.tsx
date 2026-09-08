import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription } from '@/components/ui/dialog';
import { CloseIcon } from '@/assets/icons';

interface DLCVerificationPopupProps {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const DLCVerificationPopup = ({ open, setOpen }: DLCVerificationPopupProps) => {

  /* Sent people to Compliance › Brands to register, which has been removed
     along with the rest of the 10DLC section. */
  const handleRedirectToDLC = () => {
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="w-1/4 p-3"
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <div className="flex flex-col gap-1.5 text-gray-900">
          <div className="font-semibold truncate text-md flex items-center justify-between">
            DLC Verification Required
            <div
              onClick={() => setOpen(false)}
              className="cursor-pointer ring-offset-background focus:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none"
            >
              <CloseIcon className="w-3 h-3" />
            </div>
          </div>
        </div>
        <DialogDescription>
          <div className="text-md">
            Your DLC (10DLC) verification is not completed. Please verify your DLC status before
            sending SMS to US number.
          </div>
        </DialogDescription>

        <div className="flex justify-end gap-2 w-full">
          <Button variant={'transparent'} type="button" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant={'outline'}
            className="min-w-[120px]"
            type="button"
            onClick={handleRedirectToDLC}
          >
            Go to DLC Page
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default DLCVerificationPopup;
