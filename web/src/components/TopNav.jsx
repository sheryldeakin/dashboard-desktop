const NAV_LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/todo", label: "Tasks" },
  { href: "/admin", label: "Edit" },
  { href: "/history", label: "History" },
];

export default function TopNav() {
  const current = window.location.pathname;

  return (
    <nav className="top-nav" aria-label="Main navigation">
      {NAV_LINKS.map(({ href, label }) => (
        <a
          key={href}
          href={href}
          className={current === href ? "top-nav-link active" : "top-nav-link"}
        >
          {label}
        </a>
      ))}
    </nav>
  );
}
