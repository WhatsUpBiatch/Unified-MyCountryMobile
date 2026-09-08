import { CircleFadingArrowUp } from 'lucide-react';

interface UpgradeRequiredProps {
  featureKey?: string;
  embedded?: boolean;
}

/* Shown wherever a plan-gated route refuses. The Upgrade button used to send
   people to Billing › Plan; with the Billing section gone there is nowhere in
   the app to change a plan, so the button has been removed rather than left
   pointing at a route that no longer exists. The copy says who to ask
   instead. */
const UpgradeRequired: React.FC<UpgradeRequiredProps> = ({ embedded = false }) => {
  return (
    <div
      className={`w-full flex flex-col items-center px-6 ${
        embedded
          ? 'h-full min-h-0 overflow-y-auto justify-start py-6 sm:justify-center'
          : 'h-screen justify-center'
      }`}
    >
      <div className="max-w-md w-full text-center bg-white p-10 rounded-lg border border-gray-200">
        {/* <Lock size={64} className="text-gray-400 mx-auto" /> */}
        <CircleFadingArrowUp size={50} className="text-gray-500 mx-auto" />

        <h2 className="text-lg font-semibold mt-4 text-gray-900">Upgrade to unlock this feature</h2>

        <p className="text-gray-500 mt-1">
          This feature is not part of your current plan. Speak to your account manager to have it
          added.
        </p>
      </div>
    </div>
  );
};

export default UpgradeRequired;
