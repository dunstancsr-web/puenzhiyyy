import React from "react";
import { Routes, Route, Outlet, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import Home from "./pages/Home";
import Onboarding from "./pages/Onboarding";
import CatalogFields from "./pages/CatalogFields";
import Dashboard from "./pages/Dashboard";
import Inventory from "./pages/Inventory";
import Alerts from "./pages/Alerts";
import ForecastDetail from "./pages/ForecastDetail";
import ForecastList from "./pages/ForecastList";
import AuditTable from "./pages/AuditTable";
import ActionItems from "./pages/ActionItems";
import NotFound from "./pages/NotFound";
import Inbound from "./warehouse/Inbound";
import Outbound from "./warehouse/Outbound";
import DemoModeBadge from "./components/DemoModeBadge";
import NewDataPill from "./components/NewDataPill";

// The Control Tower pages share a sidebar; the warehouse floor screens
// deliberately do not. A handheld has no room for navigation, and an operator
// standing at a dock has exactly one job on screen at a time. Wrapping only the
// office routes in Layout is what keeps those two worlds apart.
//
// DemoModeBadge (MVP2 Day 7) mounts on Home, /onboarding, and every Control
// Tower page. The handheld screens get the `compact bannerOnly` form: no demo
// toggle for an operator at a dock, but a short banner while in demo mode, so a
// phone and a desktop that disagree about the mode are obvious at a glance. It
// also makes any page it is on honour the ?demo=1 join link. Every OTHER route
// must mount it explicitly (React Router
// doesn't share chrome across route elements the way Layout.jsx does for the
// Control Tower's own pages) - this list is the single place to check when
// adding a new route, so it doesn't silently miss the banner the way
// /onboarding originally did.
function ControlTower() {
  return <Layout><DemoModeBadge /><NewDataPill /><Outlet /></Layout>;
}

export default function App() {
  return (
    <Routes>
      {/* Home is the front door: goods in, goods out, or the tower. */}
      <Route path="/" element={<><DemoModeBadge /><Home /></>} />

      {/* Reachable on demand regardless of real data, for demoing the
          onboarding journey without actually emptying the database. Home
          itself renders this automatically when the catalog is empty.
          DemoModeBadge here too, not just on Home, so a manager landing here
          straight from the "Preview the onboarding journey" settings link
          while still in demo mode still sees the banner and Exit. */}
      <Route path="/onboarding" element={<><DemoModeBadge /><Onboarding /></>} />

      {/* Reference for the catalog spreadsheet's columns, linked from
          Onboarding step 1. Its own page rather than a modal, since it's
          the kind of thing someone leaves open in a second tab while
          filling in the spreadsheet in Excel. */}
      <Route path="/onboarding/catalog-fields" element={<><DemoModeBadge /><CatalogFields /></>} />

      {/* Warehouse floor, no chrome. */}
      <Route path="/warehouse/inbound" element={<><DemoModeBadge compact bannerOnly /><Inbound /></>} />
      <Route path="/warehouse/outbound" element={<><DemoModeBadge compact bannerOnly /><Outbound /></>} />

      {/* Control Tower. */}
      <Route element={<ControlTower />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/inventory" element={<Inventory />} />
        <Route path="/inventory/:skuId/forecast" element={<ForecastDetail />} />
        {/* Promoted to Sidebar's permanent nav 17 Sep (Stan's call, held open
            since design.md first shipped this page); still also reachable
            from Inventory's header link. */}
        <Route path="/forecast" element={<ForecastList />} />
        <Route path="/alerts" element={<Alerts />} />
        {/* Activity is now the History view inside Alerts (20 Sep, Stan's call). The old address still works. */}
        <Route path="/activity" element={<Navigate to="/alerts?view=history" replace />} />
        {/* On Sidebar's permanent nav as "Table" (Stan's call, 19 Sep) - a
            plain audit view built to check whether onboarding's basic
            columns are enough to feed the top-5 formulas. */}
        <Route path="/audit" element={<AuditTable />} />
        {/* Additive, not a replacement for Alerts/Activity (Stan's ask, 19
            Sep, explicit: "no deleting anything, just create a new tab"). */}
        <Route path="/action-items" element={<ActionItems />} />
      </Route>

      {/* Anything else: a page that says so, not a blank one. */}
      <Route path="*" element={<><DemoModeBadge /><NotFound /></>} />
    </Routes>
  );
}
