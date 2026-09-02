/* Shown in place of a screen the signed-in person is not allowed to open.
 *
 * These routes used to answer with a silent redirect to the dashboard. From the
 * outside that is indistinguishable from the product being broken: you click
 * Security, you land on the home page, and nothing anywhere says why. Hiding the
 * tab helps the people who see the strip, but not anyone arriving from a
 * bookmark, a link in a support reply, or a typed address.
 *
 * So the address stays where it is and the screen explains itself, with the way
 * onwards offered rather than taken automatically.
 */

import { useEffect } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { handleAlert } from '@/lib/utils';

interface AccessDeniedProps {
  /* What they were trying to open, in the words the navigation uses for it. */
  section?: string;
}

const AccessDenied: React.FC<AccessDeniedProps> = ({ section }) => {
  const navigate = useNavigate();
  const what = section ? `the ${section} section` : 'this section';

  useEffect(() => {
    /* The toast catches the case where this panel is not what they end up
       looking at — a link opened in the background, a redirect elsewhere in the
       app. Fired once, on arrival. */
    handleAlert({ text: `You do not have access to ${what}`, type: 'error' });
  }, [what]);

  return (
    <div className="flex h-full min-h-0 w-full items-start justify-center overflow-y-auto p-6">
      <div className="mt-10 w-full max-w-md rounded-xl border border-gray-200 bg-white p-8 text-center">
        <ShieldAlert size={44} className="mx-auto text-amber-500" />
        <h2 className="mt-4 text-lg font-semibold text-gray-900">You cannot open {what}</h2>
        <p className="mt-1 text-sm text-gray-500">
          It is open to administrators only. Ask an administrator at your company if you need to see
          or change what is in here.
        </p>
        <div className="mt-6 flex items-center justify-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="cs-btn-outline"
            onClick={() => navigate(-1)}
          >
            Go back
          </Button>
          <Button
            type="button"
            variant="primary"
            className="cs-save"
            onClick={() => navigate('/admin-settings')}
          >
            Admin settings
          </Button>
        </div>
      </div>
    </div>
  );
};

export default AccessDenied;
