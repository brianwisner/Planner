/**
 * SVG Wall Diagram Renderer
 * Draws a scaled diagram of the shear wall showing:
 *   - Wall outline
 *   - Openings (with hatching)
 *   - Full-height segments (color-coded by status)
 *   - Dimension lines
 *   - Force labels
 *   - Hold-down symbols
 */

const DIAGRAM = {
  PADDING: { top: 70, right: 60, bottom: 100, left: 60 },
  MIN_WIDTH: 700,
  WALL_DRAW_HEIGHT: 260,
  COLORS: {
    wall: "#D4C5A9",
    wallStroke: "#5C4033",
    opening: "#FFFFFF",
    openingStroke: "#333333",
    segmentOK: "rgba(76, 175, 80, 0.25)",
    segmentNG: "rgba(244, 67, 54, 0.25)",
    segmentNQ: "rgba(158, 158, 158, 0.20)",
    segmentStrokeOK: "#4CAF50",
    segmentStrokeNG: "#F44336",
    segmentStrokeNQ: "#9E9E9E",
    dimension: "#333333",
    force: "#1565C0",
    holdDown: "#E65100",
    ground: "#795548",
    label: "#212121",
  },
};

/**
 * Create an SVG element with attributes
 */
function svgEl(tag, attrs) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  return el;
}

/**
 * Create an SVG text element
 */
function svgText(x, y, text, attrs = {}) {
  const el = svgEl("text", {
    x,
    y,
    "font-family": "'Segoe UI', Arial, sans-serif",
    "font-size": "11",
    fill: DIAGRAM.COLORS.label,
    "text-anchor": "middle",
    ...attrs,
  });
  el.textContent = text;
  return el;
}

/**
 * Draw a dimension line (horizontal)
 */
function drawDimension(group, x1, x2, y, label, below = true) {
  const tickLen = below ? 6 : -6;
  const textOffset = below ? 16 : -8;

  // Line
  group.appendChild(
    svgEl("line", {
      x1,
      y1: y,
      x2,
      y2: y,
      stroke: DIAGRAM.COLORS.dimension,
      "stroke-width": "1",
    })
  );

  // Left tick
  group.appendChild(
    svgEl("line", {
      x1,
      y1: y - tickLen,
      x2: x1,
      y2: y + tickLen,
      stroke: DIAGRAM.COLORS.dimension,
      "stroke-width": "1",
    })
  );

  // Right tick
  group.appendChild(
    svgEl("line", {
      x1: x2,
      y1: y - tickLen,
      x2: x2,
      y2: y + tickLen,
      stroke: DIAGRAM.COLORS.dimension,
      "stroke-width": "1",
    })
  );

  // Label
  const mid = (x1 + x2) / 2;
  group.appendChild(
    svgText(mid, y + textOffset, label, {
      "font-size": "10",
      fill: DIAGRAM.COLORS.dimension,
    })
  );
}

/**
 * Draw a hold-down triangle symbol
 */
function drawHoldDown(group, x, y, force, side) {
  const size = 10;
  const dir = side === "left" ? 1 : -1;

  // Triangle pointing down
  const points = `${x},${y} ${x - size * dir},${y + size * 1.5} ${x + size * dir},${y + size * 1.5}`;
  group.appendChild(
    svgEl("polygon", {
      points,
      fill: DIAGRAM.COLORS.holdDown,
      stroke: DIAGRAM.COLORS.holdDown,
      "stroke-width": "1",
      opacity: "0.8",
    })
  );

  // Force label
  if (force !== null && force !== undefined) {
    const textX = x + (side === "left" ? -16 : 16);
    group.appendChild(
      svgText(textX, y + size * 1.5 + 14, `${force}`, {
        "font-size": "9",
        fill: DIAGRAM.COLORS.holdDown,
        "font-weight": "bold",
      })
    );
    group.appendChild(
      svgText(textX, y + size * 1.5 + 24, "lbs", {
        "font-size": "8",
        fill: DIAGRAM.COLORS.holdDown,
      })
    );
  }
}

/**
 * Render the complete wall diagram
 *
 * @param {HTMLElement} container - Container element for the SVG
 * @param {Object} config - Wall configuration (wallLength, wallHeight, openings)
 * @param {Object|null} results - Analysis results from analyzeShearWall()
 */
function renderDiagram(container, config, results) {
  container.innerHTML = "";

  const { wallLength, wallHeight, openings } = config;

  if (!wallLength || !wallHeight || wallLength <= 0 || wallHeight <= 0) {
    container.innerHTML =
      '<p class="diagram-placeholder">Enter wall dimensions to see diagram</p>';
    return;
  }

  const P = DIAGRAM.PADDING;
  const containerWidth = Math.max(container.clientWidth || DIAGRAM.MIN_WIDTH, DIAGRAM.MIN_WIDTH);
  const drawWidth = containerWidth - P.left - P.right;
  const drawHeight = DIAGRAM.WALL_DRAW_HEIGHT;
  const svgHeight = drawHeight + P.top + P.bottom;

  const scale = drawWidth / wallLength;
  const scaleY = drawHeight / wallHeight;

  const svg = svgEl("svg", {
    width: containerWidth,
    height: svgHeight,
    viewBox: `0 0 ${containerWidth} ${svgHeight}`,
    class: "wall-diagram-svg",
  });

  // Defs for patterns
  const defs = svgEl("defs", {});

  // Hatch pattern for openings
  const hatch = svgEl("pattern", {
    id: "opening-hatch",
    width: "8",
    height: "8",
    patternUnits: "userSpaceOnUse",
    patternTransform: "rotate(45)",
  });
  hatch.appendChild(
    svgEl("line", {
      x1: "0",
      y1: "0",
      x2: "0",
      y2: "8",
      stroke: "#E0E0E0",
      "stroke-width": "1",
    })
  );
  defs.appendChild(hatch);
  svg.appendChild(defs);

  // Main group translated to drawing origin
  const mainGroup = svgEl("g", {
    transform: `translate(${P.left}, ${P.top})`,
  });

  // Ground line
  mainGroup.appendChild(
    svgEl("line", {
      x1: -20,
      y1: drawHeight + 1,
      x2: drawWidth + 20,
      y2: drawHeight + 1,
      stroke: DIAGRAM.COLORS.ground,
      "stroke-width": "3",
    })
  );

  // Ground hatching
  for (let gx = -20; gx < drawWidth + 20; gx += 12) {
    mainGroup.appendChild(
      svgEl("line", {
        x1: gx,
        y1: drawHeight + 2,
        x2: gx - 8,
        y2: drawHeight + 12,
        stroke: DIAGRAM.COLORS.ground,
        "stroke-width": "1",
        opacity: "0.5",
      })
    );
  }

  // Wall rectangle (background)
  mainGroup.appendChild(
    svgEl("rect", {
      x: 0,
      y: 0,
      width: drawWidth,
      height: drawHeight,
      fill: DIAGRAM.COLORS.wall,
      stroke: DIAGRAM.COLORS.wallStroke,
      "stroke-width": "2",
    })
  );

  // Draw segments (background highlighting)
  if (results && results.segments) {
    results.segments.forEach((seg) => {
      const sx = seg.start * scale;
      const sw = seg.width * scale;
      let fillColor, strokeColor;
      if (!seg.arQualifies) {
        fillColor = DIAGRAM.COLORS.segmentNQ;
        strokeColor = DIAGRAM.COLORS.segmentStrokeNQ;
      } else if (seg.status === "OK") {
        fillColor = DIAGRAM.COLORS.segmentOK;
        strokeColor = DIAGRAM.COLORS.segmentStrokeOK;
      } else {
        fillColor = DIAGRAM.COLORS.segmentNG;
        strokeColor = DIAGRAM.COLORS.segmentStrokeNG;
      }

      mainGroup.appendChild(
        svgEl("rect", {
          x: sx + 1,
          y: 1,
          width: sw - 2,
          height: drawHeight - 2,
          fill: fillColor,
          stroke: strokeColor,
          "stroke-width": "2",
          "stroke-dasharray": seg.arQualifies ? "none" : "6,3",
          rx: "2",
        })
      );

      // Segment label
      const centerX = sx + sw / 2;
      mainGroup.appendChild(
        svgText(centerX, drawHeight / 2 - 10, `Seg ${seg.id}`, {
          "font-size": "12",
          "font-weight": "bold",
          fill: strokeColor,
        })
      );

      if (seg.arQualifies && seg.unitShearDemand !== null) {
        mainGroup.appendChild(
          svgText(centerX, drawHeight / 2 + 6, `v=${seg.unitShearDemand} plf`, {
            "font-size": "10",
            fill: DIAGRAM.COLORS.force,
          })
        );
        mainGroup.appendChild(
          svgText(
            centerX,
            drawHeight / 2 + 20,
            `DCR=${seg.dcr.toFixed(2)}`,
            {
              "font-size": "10",
              "font-weight": "bold",
              fill: seg.dcr <= 1.0 ? DIAGRAM.COLORS.segmentStrokeOK : DIAGRAM.COLORS.segmentStrokeNG,
            }
          )
        );
      } else if (!seg.arQualifies) {
        mainGroup.appendChild(
          svgText(centerX, drawHeight / 2 + 6, "N/Q", {
            "font-size": "10",
            fill: DIAGRAM.COLORS.segmentStrokeNQ,
            "font-style": "italic",
          })
        );
      }
    });
  }

  // Draw openings
  if (openings && openings.length > 0) {
    openings.forEach((o, i) => {
      const ox = o.x * scale;
      const ow = o.width * scale;
      const oh = o.height * scaleY;
      const sill = o.sillHeight * scaleY;
      const oy = drawHeight - sill - oh;

      // Opening rectangle
      mainGroup.appendChild(
        svgEl("rect", {
          x: ox,
          y: oy,
          width: ow,
          height: oh,
          fill: DIAGRAM.COLORS.opening,
          stroke: DIAGRAM.COLORS.openingStroke,
          "stroke-width": "1.5",
        })
      );

      // Cross lines (X) to denote opening
      mainGroup.appendChild(
        svgEl("line", {
          x1: ox,
          y1: oy,
          x2: ox + ow,
          y2: oy + oh,
          stroke: DIAGRAM.COLORS.openingStroke,
          "stroke-width": "0.75",
          opacity: "0.3",
        })
      );
      mainGroup.appendChild(
        svgEl("line", {
          x1: ox + ow,
          y1: oy,
          x2: ox,
          y2: oy + oh,
          stroke: DIAGRAM.COLORS.openingStroke,
          "stroke-width": "0.75",
          opacity: "0.3",
        })
      );

      // Opening label
      mainGroup.appendChild(
        svgText(ox + ow / 2, oy + oh / 2 + 4, `${o.width}' × ${o.height}'`, {
          "font-size": "10",
          fill: "#555",
        })
      );
    });
  }

  // Draw hold-down symbols if results available
  if (results && results.segments) {
    results.segments.forEach((seg) => {
      if (!seg.arQualifies || seg.holdDownTension === null) return;

      const leftX = seg.start * scale;
      const rightX = seg.end * scale;

      drawHoldDown(mainGroup, leftX + 6, drawHeight - 5, seg.holdDownTension, "left");
      drawHoldDown(mainGroup, rightX - 6, drawHeight - 5, seg.holdDownTension, "right");
    });
  }

  // Dimension lines - Total wall length at bottom
  const dimGroup = svgEl("g", {});
  drawDimension(dimGroup, 0, drawWidth, drawHeight + 30, `${wallLength} ft (Total)`, true);

  // Segment dimensions
  if (results && results.segments) {
    results.segments.forEach((seg) => {
      const sx = seg.start * scale;
      const sw = seg.width * scale;
      drawDimension(
        dimGroup,
        sx,
        sx + sw,
        drawHeight + 50,
        `${seg.width.toFixed(2)} ft`,
        true
      );
    });
  }

  // Opening dimensions
  if (openings && openings.length > 0) {
    openings.forEach((o) => {
      const ox = o.x * scale;
      const ow = o.width * scale;
      drawDimension(dimGroup, ox, ox + ow, drawHeight + 50, `${o.width} ft`, true);
    });
  }

  mainGroup.appendChild(dimGroup);

  // Wall height dimension (vertical, left side)
  const vDimGroup = svgEl("g", {});
  // Vertical line
  vDimGroup.appendChild(
    svgEl("line", {
      x1: -20,
      y1: 0,
      x2: -20,
      y2: drawHeight,
      stroke: DIAGRAM.COLORS.dimension,
      "stroke-width": "1",
    })
  );
  // Top tick
  vDimGroup.appendChild(
    svgEl("line", {
      x1: -26,
      y1: 0,
      x2: -14,
      y2: 0,
      stroke: DIAGRAM.COLORS.dimension,
      "stroke-width": "1",
    })
  );
  // Bottom tick
  vDimGroup.appendChild(
    svgEl("line", {
      x1: -26,
      y1: drawHeight,
      x2: -14,
      y2: drawHeight,
      stroke: DIAGRAM.COLORS.dimension,
      "stroke-width": "1",
    })
  );
  // Label (rotated)
  const heightLabel = svgText(-35, drawHeight / 2, `${wallHeight} ft`, {
    "font-size": "10",
    fill: DIAGRAM.COLORS.dimension,
    transform: `rotate(-90, -35, ${drawHeight / 2})`,
  });
  vDimGroup.appendChild(heightLabel);
  mainGroup.appendChild(vDimGroup);

  // Applied load arrow at top
  if (results && results.appliedLoad > 0) {
    const arrowGroup = svgEl("g", {});
    const arrowLen = Math.min(80, drawWidth * 0.15);

    // Arrow line
    arrowGroup.appendChild(
      svgEl("line", {
        x1: -10,
        y1: -20,
        x2: arrowLen,
        y2: -20,
        stroke: DIAGRAM.COLORS.force,
        "stroke-width": "2.5",
        "marker-end": "url(#arrowhead)",
      })
    );

    // Arrowhead def
    const marker = svgEl("marker", {
      id: "arrowhead",
      markerWidth: "10",
      markerHeight: "7",
      refX: "9",
      refY: "3.5",
      orient: "auto",
    });
    marker.appendChild(
      svgEl("polygon", {
        points: "0 0, 10 3.5, 0 7",
        fill: DIAGRAM.COLORS.force,
      })
    );
    defs.appendChild(marker);

    // Force label
    arrowGroup.appendChild(
      svgText(arrowLen / 2, -28, `V = ${results.appliedLoad.toLocaleString()} lbs`, {
        "font-size": "12",
        "font-weight": "bold",
        fill: DIAGRAM.COLORS.force,
      })
    );

    mainGroup.appendChild(arrowGroup);
  }

  // Title
  svg.appendChild(
    svgText(containerWidth / 2, 18, "Segmented Shear Wall Diagram", {
      "font-size": "14",
      "font-weight": "bold",
      fill: "#333",
    })
  );

  svg.appendChild(mainGroup);
  container.appendChild(svg);
}
