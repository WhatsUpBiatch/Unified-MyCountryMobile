import { SearchLine } from '@/assets/icons';
import TableManager from '@/components/custom/table-manager';
import { Input } from '@/components/ui/input';
import { useMemo, useState } from 'react';
import AddPathModal from '../modal/AddPathModal';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { crmTypes, editForm, SAMPLE_WEBHOOKS } from '../../constant';
import { Icon } from '@/assets/icons/icon';
import { convertDateFormateApis } from '@/lib/utils';
import '@/components/mcm/mcm-page.css';

/**
 * Integration ▸ Manage Webhook.
 *
 * NOTHING ON THIS SCREEN IS WIRED, and the screen now says so instead of
 * looking like it works. There is no webhook API in the product: no entry in
 * `services/api/routes`, no function in `services/api`, and the table's own
 * `fetcherKey` and `fetcherFn` were commented out in this file — so the list
 * could only ever say "No webhook found". The dialog's `onSubmit` was
 * `return values`, which saves nothing and does not even close the dialog, so
 * an administrator could fill the form in, press Submit, watch nothing happen,
 * and reasonably conclude the product was broken rather than unbuilt.
 *
 * The table is fed `SAMPLE_WEBHOOKS` so its columns can be designed against
 * realistic content. They are labelled as samples on the screen. When the
 * endpoint lands, swap `staticData` for the fetcher, delete the constant, and
 * remove the notice — in one change, so the three cannot drift apart.
 */

const ManageWebhook = () => {
  const [search, setSearch] = useState('');
  const [modalState, setModalState] = useState(false);
  const [editForm, setEditForm] = useState<editForm>({ isEdit: false, formData: {} });

  const columns = useMemo(
    () => [
      {
        /* Was `type` printed raw, so the cell read GOOGLE_SHEETS. The picker
           in the dialog already knows what each one is called. */
        header: 'Sends to',
        accessorKey: 'type',
        cell: ({ row }: any) => {
          const raw = row?.original?.type;
          return crmTypes.find((item) => item.value === raw)?.label || raw || '—';
        },
      },
      {
        /* A URL, in a monospace face and never wrapped mid-token: this is the
           one value on the row somebody checks character by character. */
        header: 'Posts to',
        accessorKey: 'path',
        cell: ({ row }: any) => (
          <code className="mcm-hook-path" title={row?.original?.path}>
            {row?.original?.path || '—'}
          </code>
        ),
      },
      {
        /* Was an ISO timestamp printed straight into the cell. */
        header: 'Created',
        accessorKey: 'created_at',
        cell: ({ row }: any) =>
          row?.original?.created_at ? convertDateFormateApis(row.original.created_at, 'LL') : '—',
      },
    ],
    [],
  );

  const handleClose = () => setModalState(false);
  const handleOpen = () => {
    setEditForm({ isEdit: false, formData: {} });
    setModalState(true);
  };

  return (
    <section className="mcm-intpage">
      <div className="mcm-intpage-head mcm-intpage-head-row">
        <div>
          <div className="mcm-intpage-eyebrow">Integration</div>
          <h1>Manage webhook</h1>
          <p>Endpoints the console posts to when calls, messages or contacts change.</p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Search webhooks"
            className="pl-10 min-h-9 rounded-lg"
            IconPosition="left-0 pl-2 inset-y-0"
            value={search}
            onChange={(e) => {
              const value = e.target.value;
              if (value.startsWith(' ')) return;
              setSearch(value);
            }}
            Icon={<SearchLine className="text-gray-700" />}
          />
          <button type="button" className="btn primary" onClick={handleOpen}>
            <Icon name="PlusIcon" className="w-3 h-3" />
            New webhook
          </button>
        </div>
      </div>

      {/* The page shell is a fixed-height flex column with `overflow: hidden`,
          so its body has to be the part that scrolls. Without `min-h-0` and a
          scroller here the notice, the table and the table's own pagination bar
          simply grew past the bottom of the page and were clipped — the footer
          ended up hard against the window edge with its lower border cut off. */}
      <div className="mcm-intbody">
        {/* Said plainly, and at the top, because the rows below look real and
            the button above looks like it works. */}
        <div className="mcm-notsaved" role="status">
          <strong>Webhooks are not connected yet.</strong>
          <span>
            The rows below are examples, not this account&rsquo;s webhooks, and nothing is posted
            to them. There is no endpoint to save one either, so adding a webhook here will not
            keep it. Until this is built, use the Zapier screen — those templates carry their own
            connection.
          </span>
        </div>

        <TableManager
          {...{
            columns,
            search,
            staticData: SAMPLE_WEBHOOKS,
            emptyTablePlaceholder: 'No webhook found',
            descriptionEmptyTable:
              'Create a webhook to enable real-time data integration with Zapier.',
          }}
        />
      </div>

      <Dialog open={modalState} onOpenChange={setModalState}>
        <DialogContent className="w-[calc(100vw_-_2rem)] max-w-lg p-4">
          <AddPathModal handleClose={handleClose} editForm={editForm} />
        </DialogContent>
      </Dialog>
    </section>
  );
};

export default ManageWebhook;
