import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DocumentDashboard } from "./components/DocumentDashboard";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DocumentDashboard />
  </StrictMode>
);
