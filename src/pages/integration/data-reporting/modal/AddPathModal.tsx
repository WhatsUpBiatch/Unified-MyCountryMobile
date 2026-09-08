import { yupResolver } from '@hookform/resolvers/yup';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { crmTypes, initialState, validationSchema } from '../../constant';
import { useEffect } from 'react';
import CustomSelect from '@/components/custom/custom-select';
import '@/components/mcm/mcm-page.css';

/**
 * The Add / Edit webhook form.
 *
 * Submit is disabled, and says why. Its handler was `return values` — no
 * mutation, no request, and no close — so filling the form in and pressing
 * Submit did nothing at all and gave no reason. There is no endpoint behind it
 * to call: see the note at the top of the Manage Webhook page. A control that
 * cannot do its job should refuse visibly rather than silently.
 */

const AddPathModal = ({
  handleClose,
  editForm,
}: {
  handleClose: () => void;
  editForm: { isEdit: boolean; formData: any };
}) => {
  const { isEdit = false, formData = {} } = editForm || {};

  const formInstance = useForm<any>({
    defaultValues: initialState,
    resolver: yupResolver(validationSchema),
    mode: 'onSubmit',
  });
  const {
    register,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = formInstance;

  useEffect(() => {
    if (!isEdit) return;
    /* `reset(type, path)` — reset takes (values, options), so passing the two
       fields as separate arguments handed it a string where it wanted an
       object and the form opened empty on every edit. */
    reset({ type: formData?.type ?? null, path: formData?.path ?? '' });
  }, [isEdit, formData, reset]);

  return (
    <form className="h-full w-full flex flex-col gap-4 justify-between">
      {/* The dialog's own close button is back; this heading used to carry a
          div with a click handler in its place. */}
      <DialogTitle className="text-base font-semibold">
        {isEdit ? 'Edit webhook' : 'Add a webhook'}
      </DialogTitle>

      <DialogDescription asChild>
        <div className="flex flex-col gap-4">
          <div className="mcm-notsaved" role="status">
            <strong>This cannot be saved yet.</strong>
            <span>
              There is no endpoint to store a webhook, so nothing you enter here is kept. The form
              is left in place because the fields are the ones it will need.
            </span>
          </div>

          <div className="w-full">
            <CustomSelect
              label={'Sends to'}
              options={crmTypes}
              handleChange={(e) => setValue(`type`, e)}
              value={watch('type')}
              error={(errors.type?.message as string) || undefined}
            />
          </div>
          <div className="w-full">
            <Input
              label="Posts to"
              {...register('path')}
              placeholder="https://hooks.zapier.com/hooks/catch/..."
              error={errors?.path?.message}
            />
          </div>
        </div>
      </DialogDescription>

      <div className="flex justify-end gap-2 w-full">
        <Button variant={'transparent'} onClick={handleClose} type="button">
          Close
        </Button>
        <Button variant={'primary'} type="button" disabled title="No endpoint to save this yet">
          Save
        </Button>
      </div>
    </form>
  );
};

export default AddPathModal;
