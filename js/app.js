/**
 * Segmented Shear Wall Analyzer - UI Controller
 * Manages form interactions, cascading dropdowns, and results display.
 */

document.addEventListener("DOMContentLoaded", () => {
  // ── Element References ──
  const wallLengthInput = document.getElementById("wallLength");
  const wallHeightInput = document.getElementById("wallHeight");
  const numOpeningsInput = document.getElementById("numOpenings");
  const openingsContainer = document.getElementById("openingsContainer");
  const panelTypeSelect = document.getElementById("panelType");
  const panelThicknessSelect = document.getElementById("panelThickness");
  const nailSizeSelect = document.getElementById("nailSize");
  const edgeSpacingSelect = document.getElementById("edgeSpacing");
  const penetrationDisplay = document.getElementById("penetrationDisplay");
  const sheathingSidesSelect = document.getElementById("sheathingSides");
  const loadTypeSelect = document.getElementById("loadType");
  const designMethodSelect = document.getElementById("designMethod");
  const appliedLoadInput = document.getElementById("appliedLoad");
  const deadLoadInput = document.getElementById("deadLoad");
  const analyzeBtn = document.getElementById("analyzeBtn");
  const clearBtn = document.getElementById("clearBtn");
  const diagramContainer = document.getElementById("diagramContainer");
  const resultsSection = document.getElementById("resultsSection");
  const errorsContainer = document.getElementById("errorsContainer");
  const capacityInfoDisplay = document.getElementById("capacityInfo");

  // ── State ──
  let currentResults = null;

  // ── Initialize Cascading Dropdowns ──
  function populateThicknesses() {
    const panelType = panelTypeSelect.value;
    const thicknesses = getThicknesses(panelType);
    panelThicknessSelect.innerHTML =
      '<option value="">Select thickness...</option>';
    thicknesses.forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t;
      panelThicknessSelect.appendChild(opt);
    });
    populateNailSizes();
  }

  function populateNailSizes() {
    const panelType = panelTypeSelect.value;
    const thickness = panelThicknessSelect.value;
    nailSizeSelect.innerHTML = '<option value="">Select nail size...</option>';
    if (!thickness) {
      populateEdgeSpacings();
      return;
    }
    const nails = getNailSizes(panelType, thickness);
    nails.forEach((n) => {
      const opt = document.createElement("option");
      opt.value = n;
      opt.textContent = n;
      nailSizeSelect.appendChild(opt);
    });
    populateEdgeSpacings();
  }

  function populateEdgeSpacings() {
    const panelType = panelTypeSelect.value;
    const thickness = panelThicknessSelect.value;
    const nailSize = nailSizeSelect.value;
    edgeSpacingSelect.innerHTML =
      '<option value="">Select spacing...</option>';
    penetrationDisplay.textContent = "—";
    updateCapacityInfo();
    if (!thickness || !nailSize) return;

    const spacings = getEdgeSpacings(panelType, thickness, nailSize);
    spacings.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s;
      opt.textContent = `${s}" o.c.`;
      edgeSpacingSelect.appendChild(opt);
    });

    const pen = lookupPenetration(panelType, thickness, nailSize);
    if (pen) penetrationDisplay.textContent = pen;
  }

  function updateCapacityInfo() {
    const panelType = panelTypeSelect.value;
    const thickness = panelThicknessSelect.value;
    const nailSize = nailSizeSelect.value;
    const spacing = parseInt(edgeSpacingSelect.value);

    if (!thickness || !nailSize || !spacing) {
      capacityInfoDisplay.innerHTML = "";
      return;
    }

    const cap = lookupCapacity(panelType, thickness, nailSize, spacing);
    if (!cap) {
      capacityInfoDisplay.innerHTML = "";
      return;
    }

    const designMethod = designMethodSelect.value;
    const sides = parseInt(sheathingSidesSelect.value);
    const loadType = loadTypeSelect.value;

    const nominal = loadType === "wind" ? cap.wind : cap.seismic;
    let design;
    if (designMethod === "ASD") {
      design = nominal / 2.0;
    } else {
      design = nominal * 0.8;
    }
    const adjusted = design * sides;

    capacityInfoDisplay.innerHTML = `
      <div class="capacity-detail">
        <span class="cap-label">Nominal (${loadType}):</span>
        <span class="cap-value">${nominal} plf</span>
      </div>
      <div class="capacity-detail">
        <span class="cap-label">${designMethod} Design:</span>
        <span class="cap-value">${design.toFixed(0)} plf</span>
      </div>
      ${
        sides === 2
          ? `<div class="capacity-detail">
        <span class="cap-label">Both sides:</span>
        <span class="cap-value">${adjusted.toFixed(0)} plf</span>
      </div>`
          : ""
      }
    `;
  }

  // ── Opening Rows ──
  function generateOpeningRows() {
    const count = parseInt(numOpeningsInput.value) || 0;
    openingsContainer.innerHTML = "";

    if (count === 0) {
      openingsContainer.innerHTML =
        '<p class="no-openings">No openings — wall is a single full-height segment.</p>';
      updateDiagram();
      return;
    }

    const table = document.createElement("table");
    table.className = "openings-table";
    table.innerHTML = `
      <thead>
        <tr>
          <th>#</th>
          <th>X Position (ft)</th>
          <th>Width (ft)</th>
          <th>Height (ft)</th>
          <th>Sill Height (ft)</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;

    const tbody = table.querySelector("tbody");
    const wallLen = parseFloat(wallLengthInput.value) || 20;
    const wallHt = parseFloat(wallHeightInput.value) || 8;

    for (let i = 0; i < count; i++) {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td class="row-num">${i + 1}</td>
        <td><input type="number" class="opening-input opening-x" data-idx="${i}" step="0.5" min="0" max="${wallLen}" value="${((i + 1) * wallLen / (count + 1) - 2).toFixed(1)}" /></td>
        <td><input type="number" class="opening-input opening-w" data-idx="${i}" step="0.5" min="0.5" max="${wallLen}" value="4" /></td>
        <td><input type="number" class="opening-input opening-h" data-idx="${i}" step="0.5" min="0.5" max="${wallHt}" value="${(wallHt * 0.5).toFixed(1)}" /></td>
        <td><input type="number" class="opening-input opening-sill" data-idx="${i}" step="0.5" min="0" max="${wallHt}" value="${(wallHt * 0.25).toFixed(1)}" /></td>
      `;
      tbody.appendChild(row);
    }

    openingsContainer.appendChild(table);

    // Attach live-update listeners
    openingsContainer.querySelectorAll(".opening-input").forEach((input) => {
      input.addEventListener("input", updateDiagram);
    });

    updateDiagram();
  }

  // ── Collect Opening Data ──
  function getOpenings() {
    const rows = openingsContainer.querySelectorAll("tbody tr");
    const openings = [];
    rows.forEach((row) => {
      const x = parseFloat(row.querySelector(".opening-x").value) || 0;
      const width = parseFloat(row.querySelector(".opening-w").value) || 0;
      const height = parseFloat(row.querySelector(".opening-h").value) || 0;
      const sillHeight =
        parseFloat(row.querySelector(".opening-sill").value) || 0;
      openings.push({ x, width, height, sillHeight });
    });
    return openings;
  }

  // ── Live Diagram Update ──
  function clearResults() {
    currentResults = null;
    resultsSection.innerHTML = "";
    resultsSection.classList.remove("visible");
    errorsContainer.innerHTML = "";
    errorsContainer.classList.remove("visible");
  }

  function updateDiagram() {
    // Geometry changed — stale results no longer match the diagram
    clearResults();

    const wallLength = parseFloat(wallLengthInput.value) || 0;
    const wallHeight = parseFloat(wallHeightInput.value) || 0;
    const openings = getOpenings();

    renderDiagram(
      diagramContainer,
      { wallLength, wallHeight, openings },
      null
    );
  }

  // ── Run Analysis ──
  function runAnalysis() {
    errorsContainer.innerHTML = "";
    errorsContainer.classList.remove("visible");

    const wallLength = parseFloat(wallLengthInput.value);
    const wallHeight = parseFloat(wallHeightInput.value);
    const openings = getOpenings();

    // Validate basic inputs
    const errors = [];
    if (!wallLength || wallLength <= 0)
      errors.push("Wall length must be a positive number.");
    if (!wallHeight || wallHeight <= 0)
      errors.push("Wall height must be a positive number.");

    const panelType = panelTypeSelect.value;
    const thickness = panelThicknessSelect.value;
    const nailSize = nailSizeSelect.value;
    const spacing = parseInt(edgeSpacingSelect.value);
    if (!thickness) errors.push("Select a panel thickness.");
    if (!nailSize) errors.push("Select a nail size.");
    if (!spacing) errors.push("Select an edge nail spacing.");

    const loadType = loadTypeSelect.value;
    const designMethod = designMethodSelect.value;
    const appliedLoad = parseFloat(appliedLoadInput.value);
    const deadLoad = parseFloat(deadLoadInput.value) || 0;
    const sides = parseInt(sheathingSidesSelect.value);

    if (!appliedLoad || appliedLoad <= 0)
      errors.push("Applied lateral load must be a positive number.");

    // Validate openings
    if (openings.length > 0) {
      const openingValidation = validateOpenings(
        wallLength,
        wallHeight,
        openings
      );
      if (!openingValidation.valid) {
        errors.push(...openingValidation.errors);
      }
    }

    if (errors.length > 0) {
      showErrors(errors);
      return;
    }

    // Look up capacity
    const cap = lookupCapacity(panelType, thickness, nailSize, spacing);
    if (!cap) {
      showErrors(["Could not find capacity for the selected configuration."]);
      return;
    }

    const nominalCapacity = loadType === "wind" ? cap.wind : cap.seismic;

    // Run analysis
    const config = {
      wallLength,
      wallHeight,
      openings,
      loadType,
      designMethod,
      appliedLoad,
      nominalCapacity,
      sheathingSides: sides,
      deadLoad,
    };

    currentResults = analyzeShearWall(config);
    displayResults(currentResults, config);

    // Update diagram with results
    renderDiagram(diagramContainer, config, currentResults);

    // Scroll to results
    resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ── Display Results ──
  function displayResults(results, config) {
    resultsSection.innerHTML = "";
    resultsSection.classList.add("visible");

    // Summary card
    const summaryHTML = `
      <div class="results-card summary-card ${results.overallStatus === "OK" ? "status-ok" : "status-ng"}">
        <h3>Analysis Summary</h3>
        <div class="summary-grid">
          <div class="summary-item">
            <span class="summary-label">Overall Status</span>
            <span class="summary-value status-badge ${results.overallStatus === "OK" ? "badge-ok" : "badge-ng"}">${results.overallStatus}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Overall DCR</span>
            <span class="summary-value ${results.overallDCR <= 1 ? "text-ok" : "text-ng"}">${results.overallDCR.toFixed(3)}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Applied Load</span>
            <span class="summary-value">${results.appliedLoad.toLocaleString()} lbs</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Wall Capacity</span>
            <span class="summary-value">${results.totalWallCapacity.toLocaleString()} lbs</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Qualified Segments</span>
            <span class="summary-value">${results.qualifiedSegments} of ${results.totalSegments}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Total Qualified Length</span>
            <span class="summary-value">${results.totalQualifiedLength} ft</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Design Method</span>
            <span class="summary-value">${results.designMethod}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Load Type</span>
            <span class="summary-value">${results.loadType.charAt(0).toUpperCase() + results.loadType.slice(1)}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Nominal Unit Shear</span>
            <span class="summary-value">${results.nominalCapacity} plf</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">${results.designMethod} Unit Shear Capacity</span>
            <span class="summary-value">${results.designCapacityBase} plf</span>
          </div>
        </div>
      </div>
    `;

    // Segment detail table
    let segTableRows = "";
    results.segments.forEach((seg) => {
      const statusClass = !seg.arQualifies
        ? "row-nq"
        : seg.status === "OK"
          ? "row-ok"
          : "row-ng";
      segTableRows += `
        <tr class="${statusClass}">
          <td>${seg.id}</td>
          <td>${seg.start.toFixed(2)} – ${seg.end.toFixed(2)}</td>
          <td>${seg.width.toFixed(2)}</td>
          <td>${seg.aspectRatio === Infinity ? "∞" : seg.aspectRatio.toFixed(2)}:1</td>
          <td>${seg.arFactor.toFixed(3)}</td>
          <td>${seg.arQualifies ? seg.adjustedCapacity.toFixed(0) : "—"}</td>
          <td>${seg.unitShearDemand !== null ? seg.unitShearDemand.toFixed(0) : "—"}</td>
          <td>${seg.dcr !== null ? seg.dcr.toFixed(3) : "—"}</td>
          <td><span class="status-badge ${!seg.arQualifies ? "badge-nq" : seg.status === "OK" ? "badge-ok" : "badge-ng"}">${seg.status}</span></td>
        </tr>
      `;
    });

    const segTableHTML = `
      <div class="results-card">
        <h3>Segment Analysis <span class="ref-tag">SDPWS 4.3</span></h3>
        <div class="table-scroll">
          <table class="results-table">
            <thead>
              <tr>
                <th>Seg</th>
                <th>Location (ft)</th>
                <th>Width b<sub>s</sub> (ft)</th>
                <th>h/b<sub>s</sub></th>
                <th>AR Factor</th>
                <th>Capacity (plf)</th>
                <th>Demand (plf)</th>
                <th>DCR</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>${segTableRows}</tbody>
          </table>
        </div>
      </div>
    `;

    // Hold-down table
    let hdRows = "";
    results.segments.forEach((seg) => {
      if (!seg.arQualifies) return;
      hdRows += `
        <tr>
          <td>${seg.id}</td>
          <td>${seg.width.toFixed(2)}</td>
          <td>${seg.segmentForce.toLocaleString()}</td>
          <td>${seg.grossTension.toLocaleString()}</td>
          <td>${seg.holdDownTension.toLocaleString()}</td>
          <td>${seg.holdDownCompression.toLocaleString()}</td>
        </tr>
      `;
    });

    const hdTableHTML = `
      <div class="results-card">
        <h3>Hold-Down Forces <span class="ref-tag">SDPWS 4.3.6.1</span></h3>
        ${config.deadLoad > 0 ? `<p class="hd-note">Dead load offset: ${config.deadLoad} plf (factor = ${config.designMethod === "ASD" ? "0.6" : "0.9"} per load combinations)</p>` : '<p class="hd-note">No dead load offset applied. Tension values are gross overturning forces.</p>'}
        <div class="table-scroll">
          <table class="results-table">
            <thead>
              <tr>
                <th>Seg</th>
                <th>Width (ft)</th>
                <th>Seg Shear (lbs)</th>
                <th>Gross OT (lbs)</th>
                <th>Net Tension (lbs)</th>
                <th>Compression (lbs)</th>
              </tr>
            </thead>
            <tbody>${hdRows}</tbody>
          </table>
        </div>
      </div>
    `;

    // Aspect ratio notes
    const arNotes = results.segments
      .filter((s) => s.aspectRatio > 2.0 || !s.arQualifies)
      .map(
        (s) =>
          `<li><strong>Segment ${s.id}:</strong> ${s.arNote}</li>`
      )
      .join("");

    const arHTML = arNotes
      ? `
      <div class="results-card notes-card">
        <h3>Aspect Ratio Notes <span class="ref-tag">SDPWS 4.3.4</span></h3>
        <ul class="ar-notes">${arNotes}</ul>
      </div>
    `
      : "";

    resultsSection.innerHTML =
      summaryHTML + segTableHTML + hdTableHTML + arHTML;
  }

  // ── Show Errors ──
  function showErrors(errors) {
    errorsContainer.innerHTML = `
      <div class="error-box">
        <strong>Input Errors:</strong>
        <ul>${errors.map((e) => `<li>${e}</li>`).join("")}</ul>
      </div>
    `;
    errorsContainer.classList.add("visible");
  }

  // ── Clear All ──
  function clearAll() {
    wallLengthInput.value = "20";
    wallHeightInput.value = "8";
    numOpeningsInput.value = "0";
    appliedLoadInput.value = "";
    deadLoadInput.value = "0";
    panelTypeSelect.selectedIndex = 0;
    sheathingSidesSelect.selectedIndex = 0;
    loadTypeSelect.selectedIndex = 0;
    designMethodSelect.selectedIndex = 0;
    currentResults = null;
    resultsSection.innerHTML = "";
    resultsSection.classList.remove("visible");
    errorsContainer.innerHTML = "";
    errorsContainer.classList.remove("visible");
    capacityInfoDisplay.innerHTML = "";
    populateThicknesses();
    generateOpeningRows();
  }

  // ── Event Listeners ──
  panelTypeSelect.addEventListener("change", populateThicknesses);
  panelThicknessSelect.addEventListener("change", populateNailSizes);
  nailSizeSelect.addEventListener("change", populateEdgeSpacings);
  edgeSpacingSelect.addEventListener("change", updateCapacityInfo);
  sheathingSidesSelect.addEventListener("change", updateCapacityInfo);
  loadTypeSelect.addEventListener("change", updateCapacityInfo);
  designMethodSelect.addEventListener("change", updateCapacityInfo);
  numOpeningsInput.addEventListener("change", generateOpeningRows);
  wallLengthInput.addEventListener("input", updateDiagram);
  wallHeightInput.addEventListener("input", updateDiagram);
  analyzeBtn.addEventListener("click", runAnalysis);
  clearBtn.addEventListener("click", clearAll);

  // ── Initialize ──
  populateThicknesses();
  generateOpeningRows();
});
