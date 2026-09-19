import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// MODAL (extracted from Inventory.jsx, TASK-60)
//
// Lifted out unchanged so the bulk edit flow can use the same shell rather than
// grow a second one. Two dialogs that look almost alike is the state this repo
// has been burnt by before in the arithmetic: the copies drift, and then the
// difference reads as a bug in whichever one you are not looking at.
// ─────────────────────────────────────────────────────────────────────────────

export default function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return createPortal(
    <div
      className="inv-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 1000, padding: "5vh 20px 20px" }}
    >
      <div
        className="inv-modal"
        style={{
          background: "var(--modal-bg)", border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)", padding: "28px 30px",
          width: wide ? 680 : 460, maxWidth: "100%", maxHeight: "88vh", overflowY: "auto",
          boxShadow: "var(--shadow-md)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: "var(--text-lg)" }}>{title}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}>
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}

export function ModalBtn({ label, onClick, primary, type = "button", disabled }) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} style={{
      padding: "8px 20px", borderRadius: "var(--radius)", fontSize: "var(--text-sm)", fontWeight: 600,
      border: "1px solid var(--border)",
      background: primary ? "var(--blue-strong)" : "var(--surface)",
      color: primary ? "#fff" : "var(--text-primary)",
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.5 : 1,
    }}>
      {label}
    </button>
  );
}

