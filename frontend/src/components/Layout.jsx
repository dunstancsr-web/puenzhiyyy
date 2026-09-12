import React from "react";
import Sidebar from "./Sidebar";

export default function Layout({ children }) {
  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <Sidebar />
      <main
        className="app-main"
        style={{
          flex: 1,
          overflowY: "auto",
          background: "var(--bg)",
          minHeight: "100vh",
        }}
      >
        {children}
      </main>
    </div>
  );
}
