import { Link } from 'react-router-dom';
import { ArrowRight, Construction } from 'lucide-react';
import '@/components/mcm/mcm-page.css';

/**
 * A Captain section that exists in the nav and not yet in the software.
 *
 * Used by Scenarios and Settings. It was two lines of grey text centred in an
 * otherwise empty frame — no title, no chrome, nothing to say whether the
 * section was unbuilt or the page had failed to load. Landing on it read as a
 * fault, and the only way out was the back button.
 *
 * It is a real page now: the same head every other Admin screen opens with, so
 * arriving here looks deliberate, and a way onward to the parts of Captain that
 * do work — an unbuilt section should not also be a dead end.
 *
 * Deliberately says nothing about what the section will do or when. Nothing in
 * this repo defines either, and a placeholder that invents a roadmap is worse
 * than one that admits there isn't a page yet.
 */

/* The Captain screens that are built. Kept here rather than passed in, because
   the answer is the same whichever unbuilt section you landed on. */
const WORKING = [
  { to: '/admin-settings/captain/playground', label: 'Playground', note: 'Try an assistant' },
  { to: '/admin-settings/captain/documents', label: 'Documents', note: 'What it reads' },
  { to: '/admin-settings/captain/faqs', label: 'FAQs', note: 'What it answers' },
  { to: '/admin-settings/captain/actions', label: 'Actions', note: 'What it can do' },
];

const CaptainComingSoon = ({ title }: { title: string }) => (
  <section className="mcm-adminpage mcm-soon">
    <div className="mcm-adminpage-head">
      <div className="mcm-adminpage-title">
        <div className="mcm-adminpage-eyebrow">Captain</div>
        <h1>{title}</h1>
        <p>This part of Captain has not been built yet.</p>
      </div>
    </div>

    <div className="mcm-soon-body">
      <div className="mcm-soon-card">
        <span className="mcm-soon-mark" aria-hidden="true">
          <Construction size={22} strokeWidth={1.75} />
        </span>
        <h2>Nothing here yet</h2>
        <p>
          {title} is in the menu because it is planned, not because it is ready. There is nothing
          to configure on this screen and nothing is being saved.
        </p>

        <div className="mcm-soon-links">
          <div className="mcm-soon-links-h">What does work</div>
          <div className="mcm-soon-links-grid">
            {WORKING.filter((item) => !item.label.startsWith(title)).map((item) => (
              <Link to={item.to} key={item.to}>
                <span>
                  <b>{item.label}</b>
                  {item.note}
                </span>
                <ArrowRight size={15} strokeWidth={2} aria-hidden="true" />
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  </section>
);

export default CaptainComingSoon;
