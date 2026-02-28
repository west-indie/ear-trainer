import { NavLink, useLocation } from "react-router-dom";
import { getProfile, subscribeProfile } from "../store/accountStore";
import { useEffect, useState } from "react";

export default function TopNav({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [profile, setProfile] = useState(getProfile());
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  const navLinks = [
    { to: "/", label: "Home" },
    { to: "/practice", label: "Practice" },
    { to: "/keyboard", label: "Keyboard" },
    { to: "/voice", label: "Voice" },
    { to: "/beginner", label: "Basics" },
    { to: "/progress", label: "Progress" },
    { to: "/studio", label: "Studio" },
    { to: "/debug", label: "Debug" },
  ];

  useEffect(() => subscribeProfile(() => setProfile(getProfile())), []);
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  return (
    <nav aria-label="Primary" className="topnav">
      <div className="topnav__brand">
        <div className="topnav__eyebrow">New Ultraviolet Systems Basic</div>
        <div className="topnav__title">VI-V-i Trainer</div>
        <div className="topnav__status">
          {profile.userId ? `${profile.displayName || "Learner"} | ${profile.syncState}` : "Local mode"}
        </div>
      </div>
      <div className="topnav__actions">
        <button
          type="button"
          className={menuOpen ? "topnav__menu-button topnav__menu-button--open" : "topnav__menu-button"}
          aria-expanded={menuOpen}
          aria-controls="topnav-links"
          onClick={() => setMenuOpen((current) => !current)}
        >
          <span className="topnav__menu-mark" aria-hidden="true">
            <span className="topnav__menu-bar topnav__menu-bar--red" />
            <span className="topnav__menu-bar topnav__menu-bar--blue" />
            <span className="topnav__menu-bar topnav__menu-bar--yellow" />
          </span>
          <span>Menu</span>
        </button>
        <button type="button" className="topnav__settings-button" onClick={onOpenSettings} aria-label="Open quick settings">
          Quick settings
        </button>
      </div>
      <div id="topnav-links" className={menuOpen ? "topnav__nav topnav__nav--open" : "topnav__nav"}>
        {navLinks.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            className={({ isActive }) => isActive ? "topnav__link topnav__link--active" : "topnav__link"}
          >
            {link.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
