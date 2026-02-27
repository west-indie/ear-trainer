import { NavLink } from "react-router-dom";
import { getProfile, subscribeProfile } from "../store/accountStore";
import { useEffect, useState } from "react";

export default function TopNav({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [profile, setProfile] = useState(getProfile());

  useEffect(() => subscribeProfile(() => setProfile(getProfile())), []);

  return (
    <nav aria-label="Primary" className="topnav">
      <div className="topnav__brand">
        <div className="topnav__eyebrow">New Ultraviolet Systems Basic</div>
        <div className="topnav__title">VI-V-i Trainer</div>
        <div className="topnav__status">
          {profile.userId ? `${profile.displayName || "Learner"} | ${profile.syncState}` : "Local mode"}
        </div>
      </div>
      <div className="topnav__nav">
        <NavLink to="/" className={({ isActive }) => isActive ? "topnav__link topnav__link--active" : "topnav__link"}>Home</NavLink>
        <NavLink to="/practice" className={({ isActive }) => isActive ? "topnav__link topnav__link--active" : "topnav__link"}>Practice</NavLink>
        <NavLink to="/voice" className={({ isActive }) => isActive ? "topnav__link topnav__link--active" : "topnav__link"}>Voice</NavLink>
        <NavLink to="/beginner" className={({ isActive }) => isActive ? "topnav__link topnav__link--active" : "topnav__link"}>Basics</NavLink>
        <NavLink to="/progress" className={({ isActive }) => isActive ? "topnav__link topnav__link--active" : "topnav__link"}>Progress</NavLink>
        <NavLink to="/studio" className={({ isActive }) => isActive ? "topnav__link topnav__link--active" : "topnav__link"}>Studio</NavLink>
        <NavLink to="/debug" className={({ isActive }) => isActive ? "topnav__link topnav__link--active" : "topnav__link"}>Debug</NavLink>
      </div>
      <div className="topnav__actions">
        <button onClick={onOpenSettings} aria-label="Open quick settings">
          Quick settings
        </button>
      </div>
    </nav>
  );
}
