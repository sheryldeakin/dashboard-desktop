import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ToastProvider } from "./components/Toast.jsx";
import { ContentProvider } from "./contexts/ContentContext.jsx";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ToastProvider>
      <ContentProvider>
        <App />
      </ContentProvider>
    </ToastProvider>
  </React.StrictMode>
);
