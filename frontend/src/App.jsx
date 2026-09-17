import React from "react";
import { Routes, Route, Outlet } from "react-router-dom";
import Layout from "./components/Layout";
import Home from "./pages/Home";
import Dashboard from "./pages/Dashboard";
import Inventory from "./pages/Inventory";
import Alerts from "./pages/Alerts";
import Activity from "./pages/Activity";
import ForecastDetail from "./pages/ForecastDetail";
import ForecastList from "./pages/ForecastList";
import Inbound from "./warehouse/Inbound";
import DemoModeBadge from "./components/DemoModeBadge";

// The Control Tower pages share a sidebar; the warehouse floor screens
// deliberately do not. A handheld has no room for navigation, and an operator
// standing at a dock has exactly one job on screen at a time. Wrapping only the
// office routes in Layout is what keeps those two worlds apart.
//
// DemoModeBadge (MVP2 Day 7) mounts on Home and every Control Tower page, not
// the handheld — the same reasoning that keeps the handheld chrome-free applies
// here: an operator at a dock has one job on screen, not a demo toggle.
function ControlTower() {
  return <Layout><DemoModeBadge /><Outlet /></Layout>;
}

export default function App() {
  return (
    <Routes>
      {/* Home is the front door: goods in, goods out, or the tower. */}
      <Route path="/" element={<><DemoModeBadge /><Home /></>} />

      {/* Warehouse floor, no chrome. */}
      <Route path="/warehouse/inbound" element={<Inbound />} />

      {/* Control Tower. */}
      <Route element={<ControlTower />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/inventory" element={<Inventory />} />
        <Route path="/inventory/:skuId/forecast" element={<ForecastDetail />} />
        {/* Reachable via a link from Inventory's header, not in Sidebar's
            permanent nav — MVP2 is still a feature branch (Stan's call). */}
        <Route path="/forecast" element={<ForecastList />} />
        <Route path="/alerts" element={<Alerts />} />
        <Route path="/activity" element={<Activity />} />
      </Route>
    </Routes>
  );
}
