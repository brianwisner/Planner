/**
 * Segmented Shear Wall Analysis Engine
 * Per AWC SDPWS-2021, Section 4.3
 *
 * Analyzes individual full-height wall segments between openings.
 */

/**
 * Identify full-height shear wall segments between openings.
 *
 * @param {number} wallLength - Total wall length (ft)
 * @param {number} wallHeight - Wall height (ft)
 * @param {Array} openings - Array of { x, width, height, sillHeight }
 *        x = distance from left edge of wall to left edge of opening (ft)
 * @returns {Array} segments - Array of { start, end, width } (ft)
 */
function identifySegments(wallLength, wallHeight, openings) {
  if (!openings || openings.length === 0) {
    return [{ start: 0, end: wallLength, width: wallLength }];
  }

  // Sort openings by x position
  const sorted = [...openings].sort((a, b) => a.x - b.x);

  const segments = [];
  let cursor = 0;

  for (const opening of sorted) {
    const openingStart = opening.x;
    const openingEnd = opening.x + opening.width;

    // Segment before this opening
    if (openingStart > cursor + 0.001) {
      const w = openingStart - cursor;
      segments.push({
        start: cursor,
        end: openingStart,
        width: parseFloat(w.toFixed(4)),
      });
    }
    cursor = Math.max(cursor, openingEnd);
  }

  // Segment after last opening
  if (wallLength > cursor + 0.001) {
    const w = wallLength - cursor;
    segments.push({
      start: cursor,
      end: wallLength,
      width: parseFloat(w.toFixed(4)),
    });
  }

  return segments;
}

/**
 * Calculate aspect ratio for a segment.
 * Per SDPWS 4.3.4, aspect ratio = h / bs
 *
 * @param {number} h - Wall height (ft)
 * @param {number} bs - Segment width (ft)
 * @returns {number} aspect ratio
 */
function calcAspectRatio(h, bs) {
  if (bs <= 0) return Infinity;
  return h / bs;
}

/**
 * Get aspect ratio adjustment factor per SDPWS 4.3.4.
 *
 * - h/bs ≤ 2.0 : factor = 1.0 (no reduction)
 * - 2.0 < h/bs ≤ 3.5 : factor = 2bs/h (seismic and wind)
 * - h/bs > 3.5 : segment does not qualify
 *
 * @param {number} aspectRatio - h/bs
 * @returns {{ factor: number, qualifies: boolean, note: string }}
 */
function getAspectRatioFactor(aspectRatio) {
  if (aspectRatio <= 2.0) {
    return { factor: 1.0, qualifies: true, note: "h/bs \u2264 2:1 \u2014 No reduction" };
  } else if (aspectRatio <= 3.5) {
    const factor = 2.0 / aspectRatio;
    return {
      factor: parseFloat(factor.toFixed(4)),
      qualifies: true,
      note: `h/bs = ${aspectRatio.toFixed(2)}:1 > 2:1 \u2014 Factor = 2bs/h = ${factor.toFixed(3)}`,
    };
  } else {
    return {
      factor: 0,
      qualifies: false,
      note: "h/bs > 3.5:1 \u2014 Segment does not qualify (SDPWS 4.3.4)",
    };
  }
}

/**
 * Main analysis function for segmented shear walls.
 *
 * @param {Object} config
 * @param {number} config.wallLength - ft
 * @param {number} config.wallHeight - ft
 * @param {Array}  config.openings - [{ x, width, height, sillHeight }]
 * @param {string} config.loadType - "wind" or "seismic"
 * @param {string} config.designMethod - "ASD" or "LRFD"
 * @param {number} config.appliedLoad - Total lateral load (lbs)
 * @param {number} config.nominalCapacity - Nominal unit shear capacity from table (plf)
 * @param {number} config.sheathingSides - 1 or 2
 * @param {number} config.deadLoad - Dead load on top of wall (plf), 0 if none
 * @returns {Object} analysis results
 */
function analyzeShearWall(config) {
  const {
    wallLength,
    wallHeight,
    openings,
    loadType,
    designMethod,
    appliedLoad,
    nominalCapacity,
    sheathingSides,
    deadLoad,
  } = config;

  // Identify full-height segments
  const rawSegments = identifySegments(wallLength, wallHeight, openings);

  // Design capacity per SDPWS
  // ASD: vs = vs_nominal / 2.0
  // LRFD: vs = vs_nominal * 0.80
  let designCapacityBase;
  if (designMethod === "ASD") {
    designCapacityBase = nominalCapacity / 2.0;
  } else {
    designCapacityBase = nominalCapacity * 0.8;
  }

  // Apply sheathing sides multiplier
  const designCapacityBothSides = designCapacityBase * sheathingSides;

  // Analyze each segment
  const segments = rawSegments.map((seg, i) => {
    const ar = calcAspectRatio(wallHeight, seg.width);
    const arInfo = getAspectRatioFactor(ar);
    const adjustedCapacity = designCapacityBothSides * arInfo.factor;

    return {
      id: i + 1,
      start: seg.start,
      end: seg.end,
      width: seg.width,
      aspectRatio: ar,
      arFactor: arInfo.factor,
      arQualifies: arInfo.qualifies,
      arNote: arInfo.note,
      adjustedCapacity: parseFloat(adjustedCapacity.toFixed(1)),
    };
  });

  // Qualifying segments
  const qualifiedSegments = segments.filter((s) => s.arQualifies);
  const totalQualifiedLength = qualifiedSegments.reduce(
    (sum, s) => sum + s.width,
    0
  );

  // Total wall capacity (lbs)
  // Sum of (adjusted capacity * segment width) for qualifying segments
  const totalWallCapacity = qualifiedSegments.reduce(
    (sum, s) => sum + s.adjustedCapacity * s.width,
    0
  );

  // Unit shear demand in each qualifying segment
  // Shear distributes to segments in proportion to their (width * arFactor)
  // For segments with the same construction, this is proportional to adjusted capacity * width
  const totalEffectiveLength = qualifiedSegments.reduce(
    (sum, s) => sum + s.width * s.arFactor,
    0
  );

  segments.forEach((seg) => {
    if (seg.arQualifies && totalEffectiveLength > 0) {
      // Proportion of total load carried by this segment
      const proportion =
        (seg.width * seg.arFactor) / totalEffectiveLength;
      const segmentShear = appliedLoad * proportion;
      seg.unitShearDemand = parseFloat(
        (segmentShear / seg.width).toFixed(1)
      );
      seg.segmentForce = parseFloat(segmentShear.toFixed(1));
      seg.dcr = parseFloat(
        (seg.unitShearDemand / seg.adjustedCapacity).toFixed(3)
      );
      seg.status = seg.dcr <= 1.0 ? "OK" : "NG";

      // Hold-down forces per SDPWS 4.3.6.1
      // Overturning: V_seg * h
      // Resisting arm: bs
      // T = V_seg * h / bs
      const tension = (segmentShear * wallHeight) / seg.width;
      // Dead load offset: w_DL * bs / 2 acts at center, resisting moment = w_DL * bs * bs / 2
      // Net tension = (V_seg * h - 0.6*w_DL * bs * bs / 2) / bs   [0.6 factor for ASD load combo]
      const dlFactor = designMethod === "ASD" ? 0.6 : 0.9;
      const dlResist =
        (dlFactor * deadLoad * seg.width * seg.width) / (2 * seg.width);
      const netTension = Math.max(0, tension - dlResist);
      seg.holdDownTension = parseFloat(netTension.toFixed(0));
      seg.holdDownCompression = parseFloat(
        (tension + dlResist).toFixed(0)
      );
      seg.grossTension = parseFloat(tension.toFixed(0));
    } else {
      seg.unitShearDemand = null;
      seg.segmentForce = null;
      seg.dcr = null;
      seg.status = "N/Q";
      seg.holdDownTension = null;
      seg.holdDownCompression = null;
      seg.grossTension = null;
    }
  });

  // Overall check
  const overallDCR =
    totalWallCapacity > 0 ? appliedLoad / totalWallCapacity : Infinity;
  const overallStatus = overallDCR <= 1.0 ? "OK" : "NG";

  // Uniform unit shear demand (for reference)
  const uniformUnitShear =
    totalQualifiedLength > 0
      ? parseFloat((appliedLoad / totalQualifiedLength).toFixed(1))
      : null;

  return {
    segments,
    qualifiedSegments: qualifiedSegments.length,
    totalSegments: segments.length,
    totalQualifiedLength: parseFloat(totalQualifiedLength.toFixed(2)),
    totalWallCapacity: parseFloat(totalWallCapacity.toFixed(0)),
    appliedLoad,
    overallDCR: parseFloat(overallDCR.toFixed(3)),
    overallStatus,
    uniformUnitShear,
    designCapacityBase: parseFloat(designCapacityBase.toFixed(1)),
    nominalCapacity,
    loadType,
    designMethod,
    wallHeight,
    wallLength,
  };
}

/**
 * Validate openings don't overlap or exceed wall bounds.
 *
 * @param {number} wallLength
 * @param {number} wallHeight
 * @param {Array} openings
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateOpenings(wallLength, wallHeight, openings) {
  const errors = [];

  for (let i = 0; i < openings.length; i++) {
    const o = openings[i];
    const label = `Opening ${i + 1}`;

    if (o.x < 0) {
      errors.push(`${label}: Position cannot be negative.`);
    }
    if (o.x + o.width > wallLength + 0.01) {
      errors.push(
        `${label}: Extends beyond the right edge of the wall (${(o.x + o.width).toFixed(2)} ft > ${wallLength} ft).`
      );
    }
    if (o.sillHeight + o.height > wallHeight + 0.01) {
      errors.push(
        `${label}: Top of opening exceeds wall height (${(o.sillHeight + o.height).toFixed(2)} ft > ${wallHeight} ft).`
      );
    }
    if (o.width <= 0) {
      errors.push(`${label}: Width must be positive.`);
    }
    if (o.height <= 0) {
      errors.push(`${label}: Height must be positive.`);
    }
  }

  // Check for overlaps
  const sorted = [...openings]
    .map((o, i) => ({ ...o, idx: i }))
    .sort((a, b) => a.x - b.x);

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (curr.x < prev.x + prev.width - 0.01) {
      errors.push(
        `Opening ${prev.idx + 1} and Opening ${curr.idx + 1} overlap horizontally.`
      );
    }
  }

  return { valid: errors.length === 0, errors };
}
