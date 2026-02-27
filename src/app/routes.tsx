import type { RouteObject } from "react-router-dom";
import Home from "../pages/Home";
import Practice from "../pages/Practice";
import BeginnerPath from "../pages/BeginnerPath";
import CustomPath from "../pages/CustomPath";
import SettingsPage from "../pages/SettingsPage";
import ProgressPage from "../pages/ProgressPage";
import Debug from "../pages/Debug";
import VoicePractice from "../pages/VoicePractice";
import StudioPage from "../pages/StudioPage";

export const routes: RouteObject[] = [
  { path: "/", element: <Home /> },
  { path: "/practice", element: <Practice /> },
  { path: "/beginner", element: <BeginnerPath /> },
  { path: "/custom-path", element: <CustomPath /> },
  { path: "/settings", element: <SettingsPage /> },
  { path: "/progress", element: <ProgressPage /> },
  { path: "/studio", element: <StudioPage /> },
  { path: "/voice", element: <VoicePractice /> },
  { path: "/debug", element: <Debug /> },
];
