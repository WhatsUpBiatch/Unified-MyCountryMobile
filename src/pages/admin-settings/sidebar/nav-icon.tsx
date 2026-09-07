/* One icon set for the admin sidebar.
 *
 * The console's own icons come from several sources and were never reconciled:
 * across the nav alone they arrive in six different viewBoxes (18x17 up to
 * 26x26) and in two systems - some stroked at width 2, some filled with no
 * stroke at all. That cannot be evened out in CSS. A stroke width is expressed
 * in the icon's own coordinate space, so the same "2" scaled from a 26-unit box
 * down to 16px draws thinner than one scaled from an 18-unit box; and a filled
 * glyph has no stroke to match in the first place. Sized, coloured and
 * stroke-normalised, a row of them still read as a jumble.
 *
 * lucide-react is already a dependency and is one set: a single 24x24 box, one
 * stroke weight, drawn on the same grid. Same style the nav already had -
 * outline, rounded caps - just consistent.
 *
 * Only the sidebar uses this. Everything else in the app keeps the icon set it
 * has, so this cannot change a screen nobody looked at.
 *
 * Unmapped names fall through to the original Icon rather than rendering
 * nothing: the nav config is edited often, and a missing entry should cost a
 * mismatched glyph, not an invisible row.
 */

import {
  AudioLines,
  Bell,
  Blocks,
  Bot,
  Boxes,
  Brain,
  Building2,
  ChartColumn,
  CircleCheck,
  CircleDollarSign,
  CircleHelp,
  CirclePlay,
  CircleUser,
  CreditCard,
  FileCheck,
  FilePlus,
  Globe,
  Hash,
  Inbox,
  LayoutGrid,
  List,
  ListOrdered,
  Music,
  Package,
  Phone,
  PhoneCall,
  PhoneOutgoing,
  Play,
  Settings,
  Share2,
  Shield,
  UserCog,
  Users,
  Webhook,
  type LucideIcon,
} from 'lucide-react';

import { Icon } from '@/assets/icons/icon';
import type { IconType } from '@/assets/icons/type';

/* Keyed by the names the sidebar config already uses, so nothing there changes. */
const NAV_ICONS: Record<string, LucideIcon> = {
  AIBrainIcon: Brain,
  AIChatIcon: Bot,
  AllNumberIcon: List,
  AnalyticsIcon: ChartColumn,
  Billing: CreditCard,
  BoxBrandsIcon: Package,
  CallOutgoing: PhoneOutgoing,
  CallQueue: ListOrdered,
  CompayIcon: Building2,
  DepartmentIcon: Users,
  DocumentAdd: FilePlus,
  DollarSignCircle: CircleDollarSign,
  ExtensionIcon: Hash,
  FileCheckIcon: FileCheck,
  GreetingIcon: AudioLines,
  GlobeIcon: Globe,
  Grid: LayoutGrid,
  HashIcon: Hash,
  InboxIcon: Inbox,
  IntegrationIcon: Blocks,
  InventoryIcon: Boxes,
  MediaIcon: Music,
  NotificationIcon: Bell,
  PhoneCallingLine: PhoneCall,
  PhoneIcon: Phone,
  PhoneSystemIcon: PhoneCall,
  Play,
  PlayCircle: CirclePlay,
  PlayDottedCircle: CirclePlay,
  QuestionIcon: CircleHelp,
  RiChatVoiceLine: AudioLines,
  RoleIcon: UserCog,
  SettingIcon: Settings,
  SettingsIcon: Settings,
  ShareIcon: Share2,
  ShieldIcon: Shield,
  TickCircleIcon: CircleCheck,
  UserCircleIcon: CircleUser,
  UsersGroupLine: Users,
  WebhookIcon: Webhook,
};

export const NavIcon = ({ name, className }: { name?: string; className?: string }) => {
  const Mapped = name ? NAV_ICONS[name] : undefined;
  if (Mapped) return <Mapped className={className} strokeWidth={1.75} aria-hidden="true" />;
  return <Icon name={name as IconType} className={className} />;
};

export default NavIcon;
