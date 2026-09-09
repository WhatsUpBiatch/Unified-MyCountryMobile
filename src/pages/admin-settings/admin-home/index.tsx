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
import './admin-home.css';

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
type Group = { title: string; icon: string; entries: Entry[] };


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
      .filter((group: any) => group.entries.length > 0);
  }, [features, IS_ADMIN, user_info]);

  const allEntries = useMemo(
    () =>
      groups.flatMap((group) => group.entries.map((entry) => ({ ...entry, group: group.title }))),
    [groups],
  );

  const needle = search.trim().toLowerCase();

  /* Searching and browsing are different jobs, so they get different views.
     Filtering the grid in place returned ten partly-filled cards and left you
     hunting the same names again in a smaller haystack. With something typed
     the page becomes one ranked list instead.

     Ranked, not merely filtered: a screen whose name STARTS with what you
     typed is almost always the one you meant, so "roles" puts Roles above
     "Default permissions (Roles)". Area-name matches come last — typing
     "numbers" should offer the Numbers screens, but under anything actually
     called that. */
  const results = useMemo(() => {
    if (!needle) return [];
    const rank = (entry: { title: string; group: string }) => {
      const title = entry.title.toLowerCase();
      if (title.startsWith(needle)) return 0;
      if (title.includes(needle)) return 1;
      if (entry.group.toLowerCase().includes(needle)) return 2;
      return 3;
    };
    return allEntries
      .map((entry) => ({ entry, score: rank(entry) }))
      .filter((row) => row.score < 3)
      .sort((a, b) => a.score - b.score || a.entry.title.localeCompare(b.entry.title))
      .map((row) => row.entry);
  }, [allEntries, needle]);

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
          <h1>Admin</h1>
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

      <div className="mcm-adminhome-body">
        {needle ? (
          /* ── results ────────────────────────────────────────────────────
              One ranked list. The area travels with each row, so you never
              have to work out which card a result came from. */
          results.length ? (
            <div className="mcm-adminres">
              <p className="mcm-adminres-c">
                {results.length} {results.length === 1 ? 'screen' : 'screens'} matching “{search}”
              </p>
              <ul>
                {results.map((entry) => (
                  <li key={entry.path}>
                    <Link to={entry.path}>
                      <span className="mcm-adminres-t">
                        <Marked text={entry.title} needle={needle} />
                      </span>
                      <span className="mcm-adminres-g">{entry.group}</span>
                      <ChevronRight className="mcm-admincard-go" size={15} aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mcm-adminhome-empty">Nothing matches “{search}”.</p>
          )
        ) : (
          <>
            {/* ── recents ──────────────────────────────────────────────────
                A strip, not a tab. These are the fastest route to the screen
                somebody wants and they were behind a click, on a tab whose
                label had to carry a count because you could not see what was
                under it. */}
            {recentEntries.length ? (
              <div className="mcm-adminrecent">
                <span className="mcm-adminrecent-k">
                  <History size={13} strokeWidth={1.9} aria-hidden="true" />
                  Recent
                </span>
                <div className="mcm-adminrecent-l">
                  {recentEntries.map((entry) => (
                    <Link key={entry.path} to={entry.path} className="mcm-adminchip">
                      {entry.title}
                      <span className="mcm-adminchip-g">{entry.group}</span>
                    </Link>
                  ))}
                </div>
                <button type="button" className="mcm-adminhome-clear" onClick={clearRecent}>
                  Clear
                </button>
              </div>
            ) : null}

            {/* One panel holding the whole index, with the areas as sections
                flowing inside it — not ten panels. Ten boxes gave the page ten
                outlines, ten header fills and ten sets of row rules to say what
                two levels of type say on their own, and none of those areas is
                a thing you act on as a unit, so boxing them grouped nothing. */}
            <div className="mcm-adminindex">
              <div className="mcm-admingrid">
              {groups.map((group) => (
                  <div className="mcm-admincard" key={group.title}>
                    {/* The section's own nav icon, not a decoration chosen here:
                        `group.icon` is the name the sidebar already renders for
                        this section, so a section is the same mark in both places
                        and this page reads as a map of the nav rather than as a
                        second, unrelated list of the same screens. */}
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
                            <span className="mcm-admincard-txt">{entry.title}</span>
                            <ChevronRight className="mcm-admincard-go" size={15} aria-hidden="true" />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
};

export default AdminHome;
