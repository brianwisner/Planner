/**
 * SDPWS Table 4.3A - Nominal Unit Shear Capacities (plf)
 * for Wood-Frame Shear Walls with Wood Structural Panels
 * Applied Directly to Framing
 *
 * Reference: AWC SDPWS-2021, Table 4.3A
 *
 * Values are NOMINAL capacities. For design:
 *   ASD: Divide by Ω (2.0)
 *   LRFD: Multiply by φ (0.80)
 *
 * Assumptions:
 *   - Framing species: Douglas-Fir-Larch or Southern Pine (SG ≥ 0.42)
 *   - Panel applied directly to framing (no gypsum backing)
 *   - Field nail spacing = 12" OC unless noted
 *   - Blocked shear walls
 */

const SDPWS_TABLE_4_3A = {
  "Structural I": [
    {
      panelThickness: '3/8"',
      nailSize: "6d common",
      nailDiameter: 0.113,
      nailLength: 2.0,
      penetration: '1-1/4"',
      capacities: {
        6: { seismic: 400, wind: 560 },
        4: { seismic: 600, wind: 840 },
        3: { seismic: 780, wind: 1090 },
        2: { seismic: 1020, wind: 1430 },
      },
    },
    {
      panelThickness: '3/8"',
      nailSize: "8d common",
      nailDiameter: 0.131,
      nailLength: 2.5,
      penetration: '1-3/8"',
      capacities: {
        6: { seismic: 460, wind: 645 },
        4: { seismic: 680, wind: 955 },
        3: { seismic: 900, wind: 1260 },
        2: { seismic: 1170, wind: 1640 },
      },
    },
    {
      panelThickness: '7/16"',
      nailSize: "8d common",
      nailDiameter: 0.131,
      nailLength: 2.5,
      penetration: '1-3/8"',
      capacities: {
        6: { seismic: 460, wind: 645 },
        4: { seismic: 680, wind: 955 },
        3: { seismic: 900, wind: 1260 },
        2: { seismic: 1170, wind: 1640 },
      },
    },
    {
      panelThickness: '15/32"',
      nailSize: "8d common",
      nailDiameter: 0.131,
      nailLength: 2.5,
      penetration: '1-3/8"',
      capacities: {
        6: { seismic: 460, wind: 645 },
        4: { seismic: 680, wind: 955 },
        3: { seismic: 900, wind: 1260 },
        2: { seismic: 1170, wind: 1640 },
      },
    },
    {
      panelThickness: '15/32"',
      nailSize: "10d common",
      nailDiameter: 0.148,
      nailLength: 3.0,
      penetration: '1-1/2"',
      capacities: {
        6: { seismic: 510, wind: 715 },
        4: { seismic: 760, wind: 1065 },
        3: { seismic: 1000, wind: 1400 },
        2: { seismic: 1310, wind: 1835 },
      },
    },
    {
      panelThickness: '19/32"',
      nailSize: "10d common",
      nailDiameter: 0.148,
      nailLength: 3.0,
      penetration: '1-1/2"',
      capacities: {
        6: { seismic: 510, wind: 715 },
        4: { seismic: 760, wind: 1065 },
        3: { seismic: 1000, wind: 1400 },
        2: { seismic: 1310, wind: 1835 },
      },
    },
  ],

  "Rated Sheathing": [
    {
      panelThickness: '5/16"',
      nailSize: "6d common",
      nailDiameter: 0.113,
      nailLength: 2.0,
      penetration: '1-1/4"',
      capacities: {
        6: { seismic: 280, wind: 390 },
        4: { seismic: 400, wind: 560 },
        3: { seismic: 520, wind: 730 },
        2: { seismic: 700, wind: 980 },
      },
    },
    {
      panelThickness: '3/8"',
      nailSize: "6d common",
      nailDiameter: 0.113,
      nailLength: 2.0,
      penetration: '1-1/4"',
      capacities: {
        6: { seismic: 340, wind: 475 },
        4: { seismic: 510, wind: 715 },
        3: { seismic: 665, wind: 930 },
        2: { seismic: 870, wind: 1220 },
      },
    },
    {
      panelThickness: '3/8"',
      nailSize: "8d common",
      nailDiameter: 0.131,
      nailLength: 2.5,
      penetration: '1-3/8"',
      capacities: {
        6: { seismic: 380, wind: 530 },
        4: { seismic: 560, wind: 785 },
        3: { seismic: 740, wind: 1035 },
        2: { seismic: 960, wind: 1345 },
      },
    },
    {
      panelThickness: '7/16"',
      nailSize: "8d common",
      nailDiameter: 0.131,
      nailLength: 2.5,
      penetration: '1-3/8"',
      capacities: {
        6: { seismic: 400, wind: 560 },
        4: { seismic: 600, wind: 840 },
        3: { seismic: 780, wind: 1090 },
        2: { seismic: 1020, wind: 1430 },
      },
    },
    {
      panelThickness: '15/32"',
      nailSize: "8d common",
      nailDiameter: 0.131,
      nailLength: 2.5,
      penetration: '1-3/8"',
      capacities: {
        6: { seismic: 400, wind: 560 },
        4: { seismic: 600, wind: 840 },
        3: { seismic: 780, wind: 1090 },
        2: { seismic: 1020, wind: 1430 },
      },
    },
    {
      panelThickness: '15/32"',
      nailSize: "10d common",
      nailDiameter: 0.148,
      nailLength: 3.0,
      penetration: '1-1/2"',
      capacities: {
        6: { seismic: 440, wind: 615 },
        4: { seismic: 660, wind: 925 },
        3: { seismic: 870, wind: 1220 },
        2: { seismic: 1140, wind: 1595 },
      },
    },
    {
      panelThickness: '19/32"',
      nailSize: "10d common",
      nailDiameter: 0.148,
      nailLength: 3.0,
      penetration: '1-1/2"',
      capacities: {
        6: { seismic: 440, wind: 615 },
        4: { seismic: 660, wind: 925 },
        3: { seismic: 870, wind: 1220 },
        2: { seismic: 1140, wind: 1595 },
      },
    },
  ],
};

/**
 * Helper: Get unique panel thicknesses for a panel type
 */
function getThicknesses(panelType) {
  const entries = SDPWS_TABLE_4_3A[panelType] || [];
  const seen = new Set();
  return entries
    .map((e) => e.panelThickness)
    .filter((t) => {
      if (seen.has(t)) return false;
      seen.add(t);
      return true;
    });
}

/**
 * Helper: Get available nail sizes for a panel type + thickness
 */
function getNailSizes(panelType, thickness) {
  const entries = SDPWS_TABLE_4_3A[panelType] || [];
  const seen = new Set();
  return entries
    .filter((e) => e.panelThickness === thickness)
    .map((e) => e.nailSize)
    .filter((n) => {
      if (seen.has(n)) return false;
      seen.add(n);
      return true;
    });
}

/**
 * Helper: Get available edge spacings for a panel type + thickness + nail size
 */
function getEdgeSpacings(panelType, thickness, nailSize) {
  const entry = SDPWS_TABLE_4_3A[panelType]?.find(
    (e) => e.panelThickness === thickness && e.nailSize === nailSize
  );
  if (!entry) return [];
  return Object.keys(entry.capacities)
    .map(Number)
    .sort((a, b) => b - a);
}

/**
 * Look up nominal unit shear capacity from Table 4.3A
 * Returns { seismic, wind } in plf, or null if not found
 */
function lookupCapacity(panelType, thickness, nailSize, edgeSpacing) {
  const entry = SDPWS_TABLE_4_3A[panelType]?.find(
    (e) => e.panelThickness === thickness && e.nailSize === nailSize
  );
  if (!entry) return null;
  return entry.capacities[edgeSpacing] || null;
}

/**
 * Get the penetration for a given configuration
 */
function lookupPenetration(panelType, thickness, nailSize) {
  const entry = SDPWS_TABLE_4_3A[panelType]?.find(
    (e) => e.panelThickness === thickness && e.nailSize === nailSize
  );
  return entry ? entry.penetration : null;
}
