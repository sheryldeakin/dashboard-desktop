/* Left sidebar nav for the todo-app-style shell. Mirrors TopNav's link
   set so the two can co-exist while we test the pattern. Active state is
   computed the same way as TopNav (path + optional ?focus=1 detection). */

const NAV_LINKS = [
  { href: "/home", label: "Today" },
  { href: "/todo", label: "Tasks" },
  { href: "/todo?focus=1", label: "Focus" },
  { href: "/stats", label: "Stats" },
  { href: "/history", label: "History" },
  { href: "/", label: "Display" },
  { href: "/admin", label: "Edit" },
  { href: "/settings", label: "Settings" },
];

export default function SideNav() {
  const path = window.location.pathname;
  const isFocusActive =
    path === "/todo" && window.location.search.includes("focus=1");

  const isActive = (href) => {
    if (href === "/todo?focus=1") return isFocusActive;
    if (href === "/todo") return path === "/todo" && !isFocusActive;
    return path === href;
  };

  return (
    <aside className="side-nav" aria-label="Main navigation">
      <div className="side-nav-brand">Dashboard</div>
      <nav className="side-nav-links">
        {NAV_LINKS.map(({ href, label }) => (
          <a
            key={href}
            href={href}
            className={isActive(href) ? "side-nav-link is-active" : "side-nav-link"}
          >
            {label}
          </a>
        ))}
      </nav>
    </aside>
  );
}
