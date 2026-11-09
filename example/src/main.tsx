import { StrictMode, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { DocumentDashboard } from "./components/DocumentDashboard";
import { getLocale, locales, resolveSupported, setLocale, subscribe } from "virtual:autoi18n";

function App() {
  const locale = useSyncExternalStore(subscribe, getLocale, getLocale);
  return (
    <>
      <label>
        <span>Language</span>{" "}
        <select value={locale} onChange={event => void setLocale(event.target.value)}>
          {locales.map(code => <option key={code} value={code}>{code}</option>)}
        </select>
      </label>
      <DocumentDashboard />
    </>
  );
}

setLocale(resolveSupported(navigator.languages)).then(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
});
