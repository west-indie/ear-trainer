import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./app/App";
import "./index.css";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const baseUrl = new URL(import.meta.env.BASE_URL, window.location.origin).href;
    const serviceWorkerUrl = `${import.meta.env.BASE_URL}sw.js`;

    void navigator.serviceWorker.getRegistrations().then((registrations) =>
      Promise.all(
        registrations.map((registration) => {
          if (registration.scope === baseUrl) return Promise.resolve(false);
          return registration.unregister();
        }),
      ),
    );

    void navigator.serviceWorker.register(serviceWorkerUrl);
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
