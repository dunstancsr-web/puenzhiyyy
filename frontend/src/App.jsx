import React from "react";
import { Routes, Route, Outlet } from "react-router-dom";
import Layout from "./components/Layout";
import Launcher from "./pages/Launcher";
import Dashboard from "./pages/Dashboard";
import Inventory from "./pages/Inventory";
import Alerts from "./pages/Alerts";
import Activity from "./pages/Activity";
import Inbound from "./warehouse/Inbound";

// The Control Tower pages share a sidebar; the warehouse floor screens
// deliberately do not. A handheld has no room for navigation, and an operator
// standing at a dock has exactly one job on screen at a time. Wrapping only the
// office routes in Layout is what keeps those two worlds apart.
function ControlTower() {
  return <Layout><Outlet /></Layout>;
}

export default function App() {
  return (
    <Routes>
      {/* The launcher is the front door: goods in, goods out, or the tower. */}
      <Route path="/" element={<Launcher />} />

      {/* Warehouse floor, no chrome. */}
      <Route path="/warehouse/inbound" element={<Inbound />} />

      {/* Control Tower. */}
      <Route element={<ControlTower />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/inventory" element={<Inventory />} />
        <Route path="/alerts" element={<Alerts />} />
        <Route path="/activity" element={<Activity />} />
      </Route>
    </Routes>
  );
}
