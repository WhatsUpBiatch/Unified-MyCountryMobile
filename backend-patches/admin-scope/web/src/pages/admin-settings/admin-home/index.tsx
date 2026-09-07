import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCompanyFeatures } from '@/hooks/rbac';
import { useUser } from '@/hooks/use-user';
import Loader from '@/components/custom/loader';
import { Ic } from '@/components/mcm/icons';
import { adminSettingArr, canShowItem } from '../sidebar';
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
type Group = { title: string; icon: string; entries: Entry[] };

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
      .filter((group: Group) => group.entries.length > 0);
  }, [features, IS_ADMIN, user_info]);

  const allEntries = useMemo(
    () =>
      groups.flatMap((group) => group.entries.map((entry) => ({ ...entry, group: group.title }))),
    [groups],
  );

  const visibleGroups = useMemo(() => {
    const needle = search.trim().toLowerCase();
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
  }, [groups, search]);

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

  if (loader || !user_info) {
    return (
      <div className="flex h-full w-full items-center justify-center p-5">
        <Loader variant="blue" size="lg" />
      </div>
    );
  }

  return (
    <section className="mcm-adminhome flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden">
      <div className="mcm-adminhome-head">
        <div>
          <div className="mcm-adminhome-eyebrow">Admin</div>
          <h1>Everything you administer</h1>
          <p>
            {allEntries.length} screens across {groups.length} areas. Only what your role can reach
            is listed.
          </p>
        </div>
        <div className="mcm-adminhome-search">
          <Ic n="search" size={15} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search admin"
            aria-label="Search admin screens"
          />
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
                <div className="mcm-admincard" key={group.title}>
                  <div className="mcm-admincard-h">{group.title}</div>
                  <ul>
                    {group.entries.map((entry) => (
                      <li key={entry.path}>
                        <Link to={entry.path}>{entry.title}</Link>
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
          <div className="mcm-admingrid">
            <div className="mcm-admincard">
              <div className="mcm-admincard-h">Recently used</div>
              <ul>
                {recentEntries.map((entry) => (
                  <li key={entry.path}>
                    <Link to={entry.path}>
                      {entry.title}
                      <span className="mcm-admincard-group">{entry.group}</span>
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
