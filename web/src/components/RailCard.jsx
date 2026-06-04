/* RailCard — convenience wrapper for Section with variant="card".
   Use this in right-rail columns. For main-column blocks use Section
   directly. Both render the same structure; the variant just swaps the
   outer chrome (rail-card hairlines vs section dividers). */

import Section from "./Section.jsx";

export default function RailCard({ title, icon, meta, className = "", children }) {
  return (
    <Section
      variant="card"
      title={title}
      icon={icon}
      meta={meta}
      className={className}
    >
      {children}
    </Section>
  );
}
