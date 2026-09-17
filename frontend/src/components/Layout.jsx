import React from "react";
import Sidebar from "./Sidebar";

// minHeight subtracts --demo-banner-height (0px normally) rather than a bare
// 100vh - the demo banner shifts the whole page down via body's padding-top,
// and without this the sidebar's own bottom items run past the visible
// window instead of actually fitting in the smaller space (see index.css).
export default function Layout({ children }) {
  return (
    <div style={{ display: "flex", minHeight: "calc(100vh - var(--demo-banner-height))" }}>
      <Sidebar />
      <main
        className="app-main"
        style={{
          flex: 1,
          overflowY: "auto",
          background: "var(--bg)",
          minHeight: "calc(100vh - var(--demo-banner-height))",
        }}
      >
        {children}
      </main>
    </div>
  );
}
