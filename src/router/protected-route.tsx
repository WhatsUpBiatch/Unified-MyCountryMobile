import React from 'react';
import { Navigate } from 'react-router-dom';
import AccessDenied from '@/components/access-denied';
import UpgradeRequired from '@/components/plan-upgrade-required';
import { useCompanyFeatures } from '@/hooks/rbac';
import { useUser } from '@/hooks/use-user';

interface FeatureGuard {
  feature?: string; // plan level (IS_SHOW)
  permission?: string; // user level (action.view)
  /* For pages that must be administrator-only but have no permission key yet.
     A permission string the backend does not return reads as "no permission"
     and locks everyone out, so a page cannot be given its own key until the API
     ships it. This gate depends on nothing the backend has to add. */
  adminOnly?: boolean;
}

interface ProtectedRouteProps {
  element: React.ReactElement;
  guard?: FeatureGuard;
  trialRestricted?: boolean;
  /* What this route is called in the navigation, so a refusal can name it
     rather than saying "this section". */
  sectionName?: string;
}
const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  element,
  guard,
  trialRestricted = false,
  sectionName,
}) => {
  const { features, companyFeatures, IS_ADMIN } = useCompanyFeatures();
  const { user } = useUser();

  const resolve = (obj: unknown, path?: string) => {
    if (!path) return undefined;
    return path
      .split('.')
      .reduce<unknown>(
        (acc, key) =>
          acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined,
        obj,
      );
  };

  if (trialRestricted && user?.company_info?.is_trial === 'Y') {
    return <UpgradeRequired />;
  }

  /* Checked before the plan and permission gates: an administrator-only page is
     not an upgrade problem, so this must not offer them a bigger plan.

     It says so in place rather than redirecting. A silent bounce to the
     dashboard reads as a broken link — you click Security and end up on the
     home page with nothing said — and the tab strip cannot help someone who
     arrived from a bookmark or a pasted address. */
  if (guard?.adminOnly && !IS_ADMIN) {
    return <AccessDenied section={sectionName} />;
  }

  // Plan availability must always come from the company subscription, even
  // when the signed-in user has a custom role.
  const featureAvailable = resolve(companyFeatures.plan_features, guard?.feature);

  if (guard?.feature && featureAvailable !== true) {
    return IS_ADMIN ? (
      <UpgradeRequired featureKey={guard.feature} />
    ) : (
      <Navigate to="/dashboard" replace />
    );
  }

  /* ---------- PERMISSION CHECK ---------- */
  const hasPermission = resolve(features.plan_features, guard?.permission);

  // A missing key is not permission. This prevents stale/incorrect paths from
  // silently allowing a protected page.
  if (guard?.permission && hasPermission !== true) {
    return IS_ADMIN ? (
      <UpgradeRequired featureKey={guard.permission} />
    ) : (
      <Navigate to="/dashboard" replace />
    );
  }

  return element;
};

export default ProtectedRoute;
