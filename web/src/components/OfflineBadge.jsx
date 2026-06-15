/* OfflineBadge — small "offline" pill that appears when the backend
   isn't reachable. Reads apiOnline from ContentContext.

   Where it's rendered:
     - SideNav (bottom, next to brand) — visible on /home, /history,
       /stats, /settings.
     - TopNav (right side) — visible on /todo.

   Hidden when apiOnline is true so it doesn't take up space during the
   normal case. */

import { useContent } from "../contexts/ContentContext.jsx";

export default function OfflineBadge({ className = "" }) {
  const { apiOnline } = useContent();
  if (apiOnline) return null;
  return (
    <span
      className={`offline-badge ${className}`.trim()}
      title="Backend is unreachable. Local changes will sync when the connection returns."
      role="status"
      aria-live="polite"
    >
      <span className="offline-badge-dot" aria-hidden="true" />
      <span className="offline-badge-text">offline</span>
    </span>
  );
}
