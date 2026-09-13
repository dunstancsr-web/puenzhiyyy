import React from "react";

// ─────────────────────────────────────────────────────────────────────────────
// CONTROL TOWER ICON (TASK-79)
//
// Drawn rather than borrowed, because neither lucide icon says it on its own.
//
//   lighthouse   reads as coast, rescue, a warning. The tapered tower and the
//                lamp at the top are right; the maritime association is not.
//   radio-tower  reads as broadcast, transmission, signal. The arcs are the
//                half that says "watching and talking to everything", but a
//                bare mast has no place anyone sits.
//
// A control tower is the union: a structure with a CABIN, which is where the
// people are, and SIGNAL, which is what reaches out from it. The cabin is the
// element doing the identifying work, because a wide glass box on a narrow
// shaft is the silhouette of an airport tower and of nothing else. Drop it and
// this is a radio mast; keep it and the arcs stop meaning "radio" and start
// meaning "this tower is in contact with the floor".
//
// Built on lucide's grid and conventions so it sits with its neighbours: 24x24
// viewBox, 2px strokes, round caps and joins, currentColor. The beacon is the
// one filled element, which is what makes it read as lit rather than drawn.
// ─────────────────────────────────────────────────────────────────────────────

export default function TowerIcon({ size = 24, color = "currentColor", strokeWidth = 2, ...rest }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {/* Light at the top, on a short mast. Filled, because every other
          element is an outline and the one solid mark reads as lit. */}
      <circle cx="12" cy="2.3" r="1.05" fill={color} stroke="none" />
      <path d="M12 3.6v1.9" />

      {/* The cabin: WIDE, shallow, and overhanging the shaft. This is the
          element carrying the whole identification. A wide glass box on a
          narrow stem is the silhouette of an airport tower and of nothing
          else; without it the drawing is a radio mast, and with it the arcs
          stop meaning "radio" and start meaning "in contact with the floor". */}
      <rect x="6.4" y="5.5" width="11.2" height="4.2" rx="1.3" />

      {/* Signal, placed OUTSIDE the cabin at cabin height. A first version put
          short arcs either side of the beacon, which put two small curves
          beside a dot: it read as ears on a face, and the whole icon became a
          chess rook. Moved out here they can only be read as radiating. */}
      <path d="M4.4 5.4a3.4 3.4 0 0 0 0 4.6" />
      <path d="M19.6 5.4a3.4 3.4 0 0 1 0 4.6" />

      {/* Tapered legs, one brace and a ground line, so the base reads as a
          structure rather than a post. */}
      <path d="M10.3 9.9 8.9 21" />
      <path d="M13.7 9.9 15.1 21" />
      <path d="M9.7 16.3h4.6" />
      <path d="M6.5 21h11" />
    </svg>
  );
}
