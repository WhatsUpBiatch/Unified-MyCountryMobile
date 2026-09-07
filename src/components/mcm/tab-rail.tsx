/* The tab strip for an area whose views are routes.
 *
 * Lifted out of the company settings layout so the Numbers views can be the
 * same control rather than a second one that looks nearly like it. What it
 * carries beyond a row of links is the reason it is worth sharing: a marker
 * that travels between tabs instead of blinking, a row that scrolls sideways by
 * wheel or drag, a chevron at whichever end still has tabs behind it, and the
 * open tab scrolled into view on arrival.
 *
 * Styling lives in mcm-page.css under `.tabnav`.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';

export interface TabRailItem {
  /* The address this tab opens. Absolute, so the rail does not need to know
     which area it is in. */
  to: string;
  label: string;
}

interface TabRailProps {
  items: TabRailItem[];
  /* Names the row for a screen reader — "Company settings", "Number views". */
  ariaLabel: string;
}

export const TabRail = ({ items, ariaLabel }: TabRailProps) => {
  const { pathname } = useLocation();

  const railRef = useRef<HTMLElement | null>(null);
  const markerRef = useRef<HTMLSpanElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [markerReady, setMarkerReady] = useState(false);

  const measure = useCallback(() => {
    const rail = railRef.current;
    if (!rail) return;
    /* A pixel of slack: browsers hand back fractional scroll positions on
       zoomed or scaled displays, so an exact comparison never reaches the end
       and the right chevron would stay up forever. */
    const furthest = rail.scrollWidth - rail.clientWidth;
    setCanScrollLeft(rail.scrollLeft > 1);
    setCanScrollRight(rail.scrollLeft < furthest - 1);
  }, []);

  /* Puts the marker under the open section's label. Coordinates are taken
     inside the scrolling content, so they hold whatever the row is scrolled to
     and the marker travels with the tabs without being repositioned. */
  const placeMarker = useCallback(() => {
    const rail = railRef.current;
    const marker = markerRef.current;
    if (!rail || !marker) return;

    const tab = rail.querySelector<HTMLElement>('[aria-current="page"]');
    const label = tab?.querySelector<HTMLElement>('.tabnav-label');
    if (!tab || !label) {
      /* No section of this area is open — a redirect in flight, say. Better an
         absent marker than one parked under the wrong word. */
      marker.style.width = '0px';
      return;
    }

    /* Measured rectangles rather than offsetLeft/offsetWidth, which are whole
       numbers. At any zoom that is not 100%, or on a display whose scale factor
       is fractional, a tab's real edges fall between pixels — rounded offsets
       leave the marker up to a pixel adrift of the word it belongs to, and the
       error is different for every tab. Rects keep the fraction.

       Subtracting the row's own left edge and adding back how far it is
       scrolled turns viewport coordinates into content coordinates, which is
       what the marker is positioned in. The row has no border or padding, so
       its border box and the marker's containing block are the same box. */
    const rowBox = rail.getBoundingClientRect();
    const labelBox = label.getBoundingClientRect();
    const left = labelBox.left - rowBox.left + rail.scrollLeft;
    marker.style.transform = `translateX(${left}px)`;
    /* A real width, not a scaled-up seed — see .tabnav-marker for what scaling
       one pixel by sixty does to the marker as soon as the page is zoomed. */
    marker.style.width = `${labelBox.width}px`;
  }, []);

  useLayoutEffect(() => {
    const rail = railRef.current;
    if (!rail) return;

    measure();
    rail.addEventListener('scroll', measure, { passive: true });

    /* The strip has to re-measure when the window changes width and when the
       sidebar collapses — the second one moves the strip's edges without the
       window resizing at all, so a resize listener alone would miss it. */
    const observer = new ResizeObserver(() => {
      measure();
      placeMarker();
    });
    observer.observe(rail);

    /* Labels change width when the webfont lands, and the marker is cut to a
       label. Without this it keeps the fallback font's width until something
       else moves it. */
    document.fonts?.ready.then(placeMarker).catch(() => {});

    /* Turns a normal wheel — the one that scrolls the page up and down — into
       sideways movement while the pointer is over the strip. A trackpad's
       sideways swipe already works and is left alone. Registered by hand
       because React marks its own onWheel listener passive, and a passive
       listener cannot stop the page scrolling behind the strip. */
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      if (rail.scrollWidth <= rail.clientWidth) return;
      event.preventDefault();
      rail.scrollLeft += event.deltaY;
    };
    rail.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      rail.removeEventListener('scroll', measure);
      rail.removeEventListener('wheel', onWheel);
      observer.disconnect();
    };
  }, [measure, placeMarker]);

  /* Place the marker before the browser paints, then allow it to animate. Doing
     it in this order means the first section opens with the marker already
     under it, rather than sliding in from the left edge on arrival. */
  useLayoutEffect(() => {
    placeMarker();
    const frame = requestAnimationFrame(() => setMarkerReady(true));
    return () => cancelAnimationFrame(frame);
  }, [pathname, placeMarker]);

  /* Open Security from a bookmark and the strip should already be showing
     Security, not scrolled back to Phone rules with the open tab off-screen. */
  useEffect(() => {
    railRef.current?.querySelector('[aria-current=\'page\']')?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
    });
  }, [pathname]);

  const nudge = (direction: 1 | -1) => {
    const rail = railRef.current;
    if (!rail) return;
    /* Most of a screenful, not all of it: leaving a couple of tabs in view
       keeps a landmark, so it is obvious where the row has moved to. */
    rail.scrollBy({ left: direction * rail.clientWidth * 0.7, behavior: 'smooth' });
  };

  return (
    <div className={markerReady ? 'tabnav is-ready' : 'tabnav'}>
      {/* Links rather than buttons, so each section can be opened in a new
          tab, bookmarked, and sent to someone in a support reply. They also
          switch only on click — never on hover or focus — so arrowing along
          the row cannot change section by accident. */}
      <nav className="tabnav-scroll" aria-label={ariaLabel} ref={railRef}>
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className="tabnav-tab"
          >
            {/* data-label carries the same words a second time, hidden, to
                reserve the width this label takes once it is the bold open
                one. See .tabnav-label. */}
            <span className="tabnav-label" data-label={item.label}>
              {item.label}
            </span>
          </NavLink>
        ))}

        {/* One marker for the row, so switching section slides it across
            rather than blinking it out here and in there. Inside the
            scroller so it keeps its place when the row is scrolled. */}
        <span className="tabnav-marker" ref={markerRef} aria-hidden="true" />
      </nav>

      {/* Drawn only when there is something that way to reach, so no
          chevron is a reliable "nothing is hidden". */}
      {canScrollLeft && (
        <button
          type="button"
          className="tabnav-more back"
          onClick={() => nudge(-1)}
          tabIndex={-1}
          aria-hidden="true"
        >
          {/* The chevron sits on a surface of its own — see .tabnav-chip. */}
          <span className="tabnav-chip">
            <ChevronLeft size={15} strokeWidth={2.25} />
          </span>
        </button>
      )}
      {canScrollRight && (
        <button
          type="button"
          className="tabnav-more"
          onClick={() => nudge(1)}
          tabIndex={-1}
          aria-hidden="true"
        >
          <span className="tabnav-chip">
            <ChevronRight size={15} strokeWidth={2.25} />
          </span>
        </button>
      )}
    </div>
  );
};

export default TabRail;
