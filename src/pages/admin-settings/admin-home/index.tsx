import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, History } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useCompanyFeatures } from '@/hooks/rbac';
import { useUser } from '@/hooks/use-user';
import Loader from '@/components/custom/loader';
import { Ic, McmIconSprite } from '@/components/mcm/icons';
import { adminSettingArr, canShowItem } from '../sidebar';
import { NavIcon } from '../sidebar/nav-icon';
import { useAdminShortcuts } from '../use-admin-shortcuts';
import '@/components/mcm/mcm-page.css';

/**
 * Admin — the landing page.
 *
 * Admin has ~35 screens across 11 sections. An accordion makes you open a
 * section to discover what is in it; this lays every screen a person can reach
 * on one page, grouped, so the whole area is legible at a glance and one click
 * away. It reads the same `adminSettingArr` the nav does, so a screen someone
 * lacks permission for never appears here either.
 */

type Entry = { title: string; path: string };
type Group = { title: string; icon: string; tone: number; entries: Entry[] };

/* Eleven cards in one grey is what made the page read as a list rather than as
   a place. Each section takes a hue from `.tone-1`…`.tone-8` in CSS; this only
   picks which.

   By position in the nav, not by a hash of the name. A hash is stable against
   reordering, which sounds like the better property until you count: eight
   buckets over eleven names collided into six hues, three sections sharing one
   while two went unused - so the colour stopped telling cards apart, which was
   its whole job. Position gives the first eight a distinct hue each and repeats
   only after that, and never puts two neighbours on the same one.

   What it costs is that inserting a section recolours the ones after it. That
   is a developer editing `adminSettingArr`, not something that moves on its own
   - and the tone is a landmark for finding a card again within a session, not
   an identifier anyone memorises.

   Fixed when the groups are built, not read off the rendered list: the rendered
   list is the filtered one, so a tone taken from a card's place in it would
   repaint every card on the page with each character typed into search. */
const TONE_COUNT = 8;

/* The matched run of characters, marked. Searching a list of fifty names and
   getting back a shorter list of fifty names asks you to find the match again
   yourself. First occurrence only - these are screen names, not prose. */
const Marked = ({ text, needle }: { text: string; needle: string }) => {
  if (!needle) return <>{text}</>;
  const at = text.toLowerCase().indexOf(needle);
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="mcm-admincard-hit">{text.slice(at, at + needle.length)}</mark>
      {text.slice(at + needle.length)}
    </>
  );
};

const AdminHome = () => {
  const { features, user_info } = useCompanyFeatures();
  const { loader } = useUser();
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'all' | 'recent'>('all');
  const { recent, clearRecent } = useAdminShortcuts();

  const IS_ADMIN = user_info?.role === 'ADMIN';
  const IS_ACCOUNT_ADMIN = String(user_info?.role || '').toUpperCase() === 'MANAGER';

  /* Sections flattened into groups of links, honouring the same visibility
     rules the nav applies. A section with no reachable screens is dropped. */
  const groups: Group[] = useMemo(() => {
    if (!user_info) return [];
    return adminSettingArr(features, IS_ADMIN, IS_ACCOUNT_ADMIN)
      .filter((section: any) => canShowItem(section, IS_ADMIN))
      .map((section: any) => {
        const entries: Entry[] =
          section?.type === 'accordion'
            ? (section?.children || [])
                .filter((child: any) => canShowItem(child, IS_ADMIN))
                .map((child: any) => ({ title: child.title, path: child.path }))
            : [{ title: section.title, path: section.path }];
        return { title: section.title, icon: section.icon, entries: entries.filter((e) => e.path) };
      })
      .filter((group: any) => group.entries.length > 0)
      /* After the empty sections are dropped, so the hues run 1,2,3… down the
         page the reader actually sees rather than skipping wherever a section
         was filtered out by permissions. */
      .map((group: any, index: number) => ({ ...group, tone: (index % TONE_COUNT) + 1 }));
  }, [features, IS_ADMIN, user_info]);

  const allEntries = useMemo(
    () =>
      groups.flatMap((group) => group.entries.map((entry) => ({ ...entry, group: group.title }))),
    [groups],
  );

  const needle = search.trim().toLowerCase();

  const visibleGroups = useMemo(() => {
    if (!needle) return groups;
    return groups
      .map((group) => ({
        ...group,
        entries: group.entries.filter(
          (entry) =>
            entry.title.toLowerCase().includes(needle) ||
            group.title.toLowerCase().includes(needle),
        ),
      }))
      .filter((group) => group.entries.length > 0);
  }, [groups, needle]);

  /* Recent is a list of paths; resolving each through `allEntries` means a
     screen you lose access to quietly disappears.
     A visited path may be a detail screen ("…/people/edit/42"), which is not
     itself a nav entry. Fall back to the longest nav path it sits under, so
     editing a person still counts as having used People rather than vanishing.
     Longest wins because "/admin-settings/phone" and "/admin-settings/phone/queues"
     can both be prefixes and only the more specific one is the screen you saw. */
  const resolveEntry = useCallback(
    (path: string) =>
      allEntries.find((entry) => entry.path === path) ||
      allEntries
        .filter((entry) => path.startsWith(`${entry.path}/`))
        .sort((a, b) => b.path.length - a.path.length)[0],
    [allEntries],
  );

  const recentEntries = useMemo(() => {
    const seen = new Set<string>();
    const resolved: Array<Entry & { group: string }> = [];
    recent.forEach((path) => {
      const entry = resolveEntry(path);
      /* Two detail routes can collapse onto the same screen, so dedupe after
         resolving, not before. */
      if (!entry || seen.has(entry.path)) return;
      seen.add(entry.path);
      resolved.push(entry);
    });
    /* Recent stores 24 so unresolvable routes cannot push real screens out;
       only the most recent eight are shown. */
    return resolved.slice(0, 8);
  }, [recent, resolveEntry]);

  /* The count comes from what actually resolves, so the tab never promises
     more than it can show. */
  const recentCount = recentEntries.length;

  /* "/" jumps to the search box, the way it does in every other directory a
     person uses all day. Guarded so it does not steal the character from
     someone typing a path into a field - including the search box itself. */
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      /* `closest` is optional-chained: a keydown can be dispatched at the
         document or the window, and neither has one. */
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('input, textarea, select, [contenteditable]')) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (loader || !user_info) {
    return (
      <div className="flex h-full w-full items-center justify-center p-5">
        <Loader variant="blue" size="lg" />
      </div>
    );
  }

  return (
    <section className="mcm-adminhome flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden">
      {/* The <Ic> icons on this page draw from a shared sprite, and <use> only
          resolves if that sprite is in the document. The admin area mounts it in
          admin-settings/page-shell, but this page does not render through the
          shell - so its search magnifier pointed at a symbol that did not exist
          and drew nothing, and the field read as though it had been built
          without an icon. Mounted here, once, the way dashboard and campaign
          already do it. Once per page is the rule: a second copy would put
          duplicate ids in the document and the icons would vanish again. */}
      <McmIconSprite />
      <div className="mcm-adminhome-head">
        <div>
          <div className="mcm-adminhome-eyebrow">Admin</div>
          <h1>Everything you administer</h1>
          {/* The same two numbers the sentence carried, but countable at a
              glance rather than read - this line is looked at far more often
              than it is read. The caveat stays prose, because it is one. */}
          <div className="mcm-adminhome-stats">
            <span className="mcm-adminhome-stat">
              <b>{allEntries.length}</b> screens
            </span>
            <span className="mcm-adminhome-stat">
              <b>{groups.length}</b> areas
            </span>
            <span className="mcm-adminhome-note">Only what your role can reach is listed.</span>
          </div>
        </div>
        <div className="mcm-adminhome-search">
          <Ic n="search" size={15} />
          <input
            ref={searchRef}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return;
              /* Empty box, second Escape: hand the key back so a dialog or
                 panel around this page can still be closed with it. */
              if (!search) return;
              event.stopPropagation();
              setSearch('');
            }}
            placeholder="Search admin"
            aria-label="Search admin screens"
          />
          {/* Hidden once there is something to read in the field, and while
              the field is focused - by then it has done its job. */}
          <kbd className="mcm-adminhome-kbd" aria-hidden="true">
            /
          </kbd>
        </div>
      </div>

      <div className="ptabstrip mcm-adminhome-tabs">
        <button type="button" className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>
          All
        </button>
        <button
          type="button"
          className={tab === 'recent' ? 'on' : ''}
          onClick={() => setTab('recent')}
        >
          Recently used{recentCount ? ` (${recentCount})` : ''}
        </button>
        {tab === 'recent' && recentCount ? (
          <button type="button" className="mcm-adminhome-clear" onClick={clearRecent}>
            Clear
          </button>
        ) : null}
      </div>

      <div className="mcm-adminhome-body">
        {tab === 'all' ? (
          visibleGroups.length ? (
            <div className="mcm-admingrid">
              {visibleGroups.map((group) => (
                <div className={`mcm-admincard tone-${group.tone}`} key={group.title}>
                  {/* The section's own nav icon, not a decoration chosen here:
                      `group.icon` is the name the sidebar already renders for
                      this section, so a section is the same mark in both
                      places and this page reads as a map of the nav rather
                      than as a second, unrelated list of the same screens. */}
                  <div className="mcm-admincard-h">
                    <span className="mcm-admincard-tile">
                      <NavIcon name={group.icon} />
                    </span>
                    <span className="mcm-admincard-t">{group.title}</span>
                    <span className="mcm-admincard-n">{group.entries.length}</span>
                  </div>
                  <ul>
                    {group.entries.map((entry) => (
                      <li key={entry.path}>
                        <Link to={entry.path}>
                          <span className="mcm-admincard-txt">
                            <Marked text={entry.title} needle={needle} />
                          </span>
                          <ChevronRight className="mcm-admincard-go" size={15} aria-hidden="true" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : (
            <p className="mcm-adminhome-empty">Nothing matches “{search}”.</p>
          )
        ) : recentEntries.length ? (
          <div className="mcm-admingrid is-single">
            {/* One card, so it is laid out as one card. Left in the
                multi-column grid it was a lone box beside two empty
                columns. */}
            <div className="mcm-admincard">
              <div className="mcm-admincard-h">
                <span className="mcm-admincard-tile">
                  <History strokeWidth={1.75} aria-hidden="true" />
                </span>
                <span className="mcm-admincard-t">Recently used</span>
                <span className="mcm-admincard-n">{recentEntries.length}</span>
              </div>
              <ul>
                {recentEntries.map((entry) => (
                  <li key={entry.path}>
                    <Link to={entry.path}>
                      <span className="mcm-admincard-txt">
                        {entry.title}
                        <span className="mcm-admincard-group">{entry.group}</span>
                      </span>
                      <ChevronRight className="mcm-admincard-go" size={15} aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <p className="mcm-adminhome-empty">Screens you open will show up here.</p>
        )}
      </div>
    </section>
  );
};

export default AdminHome;
