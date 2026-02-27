import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import TopNav from "./TopNav";
import SettingsDrawer from "./SettingsDrawer";
import { getSettings, subscribeSettings } from "../store/settingsStore";
import { rootMidiFromKey } from "../audio/music";
import { engine } from "../audio/engine";
import { trackEvent } from "../store/analyticsStore";

export default function Shell({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState(getSettings());

  useEffect(() => subscribeSettings(() => setSettings(getSettings())), []);

  useEffect(() => {
    trackEvent("page_view", location.pathname);
  }, [location.pathname]);

  useEffect(() => {
    const warm = () => {
      void engine.warm();
      window.removeEventListener("pointerdown", warm);
      window.removeEventListener("keydown", warm);
    };

    window.addEventListener("pointerdown", warm);
    window.addEventListener("keydown", warm);
    return () => {
      window.removeEventListener("pointerdown", warm);
      window.removeEventListener("keydown", warm);
    };
  }, []);

  useEffect(() => {
    if (settings.droneEnabled) {
      void engine.setDrone(
        rootMidiFromKey(settings.keyRoot, settings.octave),
        { tempoBpm: settings.tempoBpm, masterGain: settings.masterGain, timbre: settings.timbre },
        0.16,
      );
      return;
    }
    engine.clearDrone();
  }, [settings]);

  return (
    <div className="app-shell">
      <a href="#main-content" className="sr-only">Skip to content</a>
      <TopNav onOpenSettings={() => setSettingsOpen(true)} />
      <main id="main-content" className="shell-main">{children}</main>
      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
