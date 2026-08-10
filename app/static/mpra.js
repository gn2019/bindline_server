import * as UTILS from './utils.js';
import { showToast, showToasts } from './toast.js';
import {
    createAllMutantsTraces,
    showGlobalLoading,
    hideGlobalLoading,
    getAllMutantsPlotLayout,
    createBindingSiteBarTraces,
} from './plot_utils.js';

function handleError(error) {
    hideGlobalLoading();
    showToasts(error);
    console.error(error);
}

// Shared nucleotide styling, used everywhere a variant/mutation needs to be
// drawn: color by Alt (mutant) base, shape by Ref (reference) base. Kept as
// one source of truth so the MPRA track, the combined plot, and the
// correlation-points floating window all look identical.
const NUCLEOTIDE_COLORS = { A: 'green', C: 'blue', G: 'orange', T: 'red', '-': 'gray' };
const NUCLEOTIDE_SHAPES = { A: 'square', C: 'circle', G: 'triangle-up', T: 'diamond' };

/** Populate the "existing score file" dropdown, reusing the same /list-files/score endpoint. */
function loadExistingScoreFiles() {
    fetch('/list-files/score')
        .then(response => response.json())
        .then(files => {
            const dropdown = UTILS.getElementByIdOrThrow('mpra-existing-score');
            dropdown.innerHTML = '<option value="">-- Select a protein score file --</option>';
            files.forEach(file => dropdown.append(new Option(file.filename, file.id)));
        })
        .catch(handleError);
}

/** Step 1: load and parse the MPRA CSV/TSV file. */
async function loadMpraData() {
    const fileInput = UTILS.getElementByIdOrThrow('mpra-csv');
    const file = fileInput.files[0];
    if (!file) {
        showToast('error', 'Please choose an MPRA CSV/TSV file first.');
        return;
    }

    showGlobalLoading();
    const formData = new FormData();
    formData.append('mpra_csv', file);
    const seqName = UTILS.getElementByIdOrThrow('mpra-seq-name').value.trim();
    if (seqName) formData.append('seq_name', seqName);

    await fetch('/mpra/parse', { method: 'POST', body: formData })
        .then(response => response.json())
        .then(data => {
            hideGlobalLoading();
            if (data.error) {
                showToasts(data);
                return;
            }
            const div = UTILS.getElementByIdOrThrow('mpra-combined-plot');
            div.mpraData = data;
            // prepare MPRA traces for the combined plot
            const mpraTraces = createMpraExperimentalTraces(div.mpraData.ref_sequence, div.mpraData.variants).map(t => (t.yaxis = 'y2', t));
            div._mpraTraces = mpraTraces;
            div.sequence_str = div.mpraData.ref_sequence;
            // Unhide the results wrapper *before* creating the plot: Plotly
            // measures the container's width at Plotly.newPlot() time, and
            // an ancestor with display:none (the 'd-none' class) reports a
            // width of 0, which is why the plot used to render far narrower
            // than the page until a later resize/redraw happened to fix it.
            UTILS.getElementByIdOrThrow('mpra-results').classList.remove('d-none');
            updateCombinedPlot();
        })
        .catch(handleError);
}

/** Build MPRA experimental scatter traces: color by Alt, shape by Ref, lines colored by significance. */
function createMpraExperimentalTraces(refSequence, variants) {
    const nucleotideColors = NUCLEOTIDE_COLORS;
    const nucleotideShapes = NUCLEOTIDE_SHAPES;

    const markerTraces = [];
    const lineTraces = [];

    variants.forEach(v => {
        if (v.value === null || v.value === undefined) return;
        const refShape = nucleotideShapes[v.ref] || 'circle';
        const color = nucleotideColors[v.alt] || 'gray';

        markerTraces.push({
            x: [v.position],
            y: [v.value],
            mode: 'markers',
            marker: { color, symbol: refShape, size: 10, opacity: 0.7 },
            showlegend: false,
            hovertemplate: `pos ${v.position}: ${v.ref}>${v.alt} = ${v.value}` +
                (v.p_value !== null && v.p_value !== undefined ? ` (p=${v.p_value})` : '') + '<extra></extra>',
        });

        const isSignificant = v.p_value !== null && v.p_value !== undefined ? v.p_value < 0.05 : null;
        const lineColor = isSignificant === null ? 'gray' : (isSignificant ? 'green' : 'red');
        lineTraces.push({
            x: [v.position, v.position],
            y: [0, v.value],
            mode: 'lines',
            line: { color: lineColor, width: 1 },
            opacity: 0.5,
            showlegend: false,
            hoverinfo: 'skip',
        });
    });

    // Legend helpers, matching the style used for the "All Mutants" plot.
    // _legendKind/_legendKey identify what a legend entry *means* (not just
    // its label text), so the combined plot can recognize when this and the
    // predicted-effect legend are showing the same A/C/G/T mapping and only
    // keep one - even though their trace names differ ("Alt" vs "Mutant").
    // Names are short (just "A", "< 0.05", ...) because each group now has
    // its own titled sub-legend (see LEGEND_KIND_TO_ID in updateCombinedPlot),
    // so the "Ref nucleotide:" / "P-Value" style prefixes would be redundant.
    const shapeTraces = Object.keys(nucleotideShapes).map(nuc => ({
        x: [null], y: [null], mode: 'markers',
        marker: { symbol: nucleotideShapes[nuc], color: 'rgba(0,0,0,0)', opacity: 1, size: 12, line: { color: 'black', width: 2 } },
        name: nuc,
        _legendEntry: true, _legendKind: 'ref-shape', _legendKey: nuc,
    }));
    const colorTraces = ['A', 'C', 'G', 'T'].map(nuc => ({
        x: [null], y: [null], mode: 'markers',
        marker: { symbol: 'circle', color: nucleotideColors[nuc], size: 12 },
        name: nuc,
        _legendEntry: true, _legendKind: 'nt-color', _legendKey: nuc,
    }));
    const sigTraces = [
        { x: [null], y: [null], mode: 'lines', line: { color: 'green' }, name: '< 0.05', _legendEntry: true, _legendKind: 'pvalue', _legendKey: 'lt' },
        { x: [null], y: [null], mode: 'lines', line: { color: 'red' }, name: '>= 0.05', _legendEntry: true, _legendKind: 'pvalue', _legendKey: 'gte' },
    ];

    return [...lineTraces, ...markerTraces, ...shapeTraces, ...colorTraces, ...sigTraces];
}

function getMpraPlotLayout(seqName) {
    return {
        xaxis: { title: { text: 'Position' }, tickmode: 'linear' },
        yaxis: { title: { text: 'Value' } },
        title: { text: `MPRA - ${seqName}` },
        template: 'plotly_white',
    };
}

// Note: MPRA traces are now rendered as part of the combined plot via updateCombinedPlot().

/** Step 2: compare the MPRA data against one selected protein's predicted effect. */
function getMpraScoreFile() {
    const activeTab = document.querySelector('#mpra-score-tabs div.active');
    if (activeTab && activeTab.id === 'mpra-score-upload') {
        const uploadInput = UTILS.getElementByIdOrThrow('mpra-score-upload-input');
        if (!uploadInput.files.length) {
            throw new Error('Please upload a protein score file.');
        }
        return { uploaded: uploadInput.files[0] };
    }
    const existingSelect = UTILS.getElementByIdOrThrow('mpra-existing-score');
    if (!existingSelect.value) {
        throw new Error('Please select or upload a protein score file.');
    }
    return { existingId: existingSelect.value };
}

function getMpraData() {
    const div = UTILS.getElementByIdOrThrow('mpra-combined-plot');
    return div.mpraData;
}

function getMpraFileType(radioName) {
    return document.querySelector(`input[name="${radioName}"]:checked`).value;
}

async function compareSingleProtein() {
    const mpraData = getMpraData();
    if (!mpraData) {
        showToast('error', 'Please load MPRA data first.');
        return;
    }

    let scoreFile;
    try {
        scoreFile = getMpraScoreFile();
    } catch (error) {
        handleError(error);
        return;
    }

    showGlobalLoading();
    const fileType = getMpraFileType('mpra_file_type');
    const formData = new FormData();
    formData.append('ref_name', mpraData.seq_name);
    formData.append('ref_sequence', mpraData.ref_sequence);
    formData.append('file_type', fileType);
    if (scoreFile.uploaded) {
        formData.append('score', scoreFile.uploaded);
    } else {
        formData.append('score_0', scoreFile.existingId);
    }

    // Include scan parameters for correlation computation
    formData.append('variants', JSON.stringify(mpraData.variants));
    formData.append('window_size', UTILS.getElementByIdOrThrow('mpra-window-size').value);
    formData.append('corr_threshold', UTILS.getElementByIdOrThrow('mpra-corr-threshold').value);
    formData.append('var_threshold', UTILS.getElementByIdOrThrow('mpra-var-threshold').value);
    formData.append('alpha', UTILS.getElementByIdOrThrow('mpra-alpha').value);

    await fetch('/mpra/single', { method: 'POST', body: formData })
        .then(response => response.json())
        .then(data => {
            hideGlobalLoading();
            if (data.error) {
                showToasts(data);
                return;
            }
            renderSinglePlot(data, fileType);
        })
        .catch(handleError);
}

// escore/zscore/iscore (the values of the mpra_file_type / mpra_scan_file_type
// radios) -> the single-letter label used in the 4th axis title.
const SCORE_TYPE_LABELS = { escore: 'E', zscore: 'Z', iscore: 'I' };

function renderSinglePlot(plotData, fileType) {
    // Add predicted-effect traces to the combined plot (bottom panel)
    const combinedDiv = UTILS.getElementByIdOrThrow('mpra-combined-plot');
    const [traces] = createAllMutantsTraces(plotData);
    // assign to bottom y-axis
    const singleTraces = traces.map(t => (t.yaxis = 'y4', t));
    combinedDiv._singleTraces = singleTraces;
    // Two lines: "Predicted {E/Z/I}-Score Effect" then the protein name, so
    // the axis title stays short and predictable regardless of file name.
    const scoreLabel = SCORE_TYPE_LABELS[fileType];
    const titleLine1 = scoreLabel ? `Predicted ${scoreLabel}-Score Effect` : 'Predicted Effect';
    combinedDiv._singleTitle = `${titleLine1}\n${plotData.score_file}`;

    // Use correlation from backend if available. windowSize/_isCorrLine let
    // attachCombinedPlotHandlers() recognize a hover on this trace and look
    // up which MPRA/predicted-effect points fed that window's correlation
    // value (see showCorrelationWindowPoints()).
    if (plotData.correlation_positions && plotData.correlation_values) {
        const windowSize = parseInt(UTILS.getElementByIdOrThrow('mpra-window-size').value, 10) || 1;
        combinedDiv._corrTraces = [{
            x: plotData.correlation_positions,
            y: plotData.correlation_values,
            mode: 'lines',
            line: { color: 'purple', width: 2 },
            name: 'MPRA vs. Protein',
            yaxis: 'y3',
            hoverinfo: 'none',
            _legendEntry: true, _legendKind: 'corr', _legendKey: 'corr',
            _isCorrLine: true,
            windowSize,
        }];
    } else {
        combinedDiv._corrTraces = [];
    }

    // Keep the raw per-position/per-base predicted effect (mutants_effect)
    // around so the correlation-points tooltip can pair it up against the
    // MPRA values on demand (on Corr.-line hover), without re-fetching from
    // the server.
    combinedDiv._lastCorrPointsData = {
        mutantsEffect: plotData.mutants_effect,
        scoreFile: plotData.score_file,
        scoreLabel: scoreLabel,
    };
    // A tooltip from hovering the previous comparison's Corr. line could
    // still be showing - hide it rather than leave it displaying stale data.
    hideCorrelationTooltip();

    updateCombinedPlot();
}

/** Pair every MPRA variant with a value against its predicted effect (mutants_effect),
 * dropping variants with no MPRA value, a non-ACGT ref/alt, or no matching predicted entry. */
function collectCorrelationPoints(variants, mutantsEffect) {
    const points = [];
    (variants || []).forEach(v => {
        if (v.value === null || v.value === undefined) return;
        if (!NUCLEOTIDE_SHAPES[v.ref] || !NUCLEOTIDE_COLORS[v.alt] || v.alt === '-') return;
        const predicted = mutantsEffect?.[v.position]?.[v.alt];
        if (predicted === null || predicted === undefined) return;
        points.push({ position: v.position, ref: v.ref, alt: v.alt, mpra: v.value, predicted, p_value: v.p_value });
    });
    return points;
}

/** Build scatter traces for the correlation-points tooltip: one trace per (Ref, Alt)
 * combo present in the data, colored by Alt and shaped by Ref - the same scheme used
 * for the MPRA track and the "All Mutants" plot. The tooltip only ever shows points
 * that are already relevant (a hovered window's points, or all of them), so unlike an
 * in-place highlight there's no need for a dimmed/highlighted style distinction. */
function buildCorrelationScatterTraces(points) {
    const groups = {};
    points.forEach(p => {
        const key = `${p.ref}>${p.alt}`;
        (groups[key] = groups[key] || []).push(p);
    });

    return Object.entries(groups).map(([key, pts]) => {
        const [ref, alt] = key.split('>');
        return {
            x: pts.map(p => p.mpra),
            y: pts.map(p => p.predicted),
            mode: 'markers',
            marker: {
                color: NUCLEOTIDE_COLORS[alt], symbol: NUCLEOTIDE_SHAPES[ref],
                size: 8, opacity: 0.9,
            },
            name: key,
            showlegend: false,
        };
    });
}

/** Compact layout for the tooltip-sized scatter: no legend/axis titles (no room for
 * them at ~120x110px) - just the dots and the window's calculated score as the title.
 * `score` is the exact backend-computed value for this window (the same number shown
 * on hover over the Corr. line itself: score = (1-alpha)*r + alpha*|sign_score|, from
 * windowed_effect_correlation() in bindline_utils.py) - not a Pearson r recomputed
 * client-side, which would disagree with it (see showCorrelationWindowPoints()). */
function getCorrPointsLayout(score) {
    const scoreText = score === null || score === undefined ? 'n/a' : score.toFixed(2);
    return {
        title: { text: `score = ${scoreText}`, font: { size: 10 } },
        xaxis: { showticklabels: false, zeroline: true, showgrid: false },
        yaxis: { showticklabels: false, zeroline: true, showgrid: false },
        margin: { t: 16, b: 4, l: 4, r: 4 },
        template: 'plotly_white',
        showlegend: false,
    };
}

/** Position the tooltip near a point on screen (mouse cursor or a button), offset so
 * it doesn't sit directly under it, and flipped to whichever side keeps it on-screen. */
function positionTooltip(win, x, y) {
    if (x === undefined || y === undefined) return;
    const offset = 14;
    const width = win.offsetWidth || 120;
    const height = win.offsetHeight || 110;
    let left = x + offset;
    let top = y + offset;
    if (left + width > window.innerWidth) left = x - offset - width;
    if (top + height > window.innerHeight) top = y - offset - height;
    win.style.left = `${Math.max(0, left)}px`;
    win.style.top = `${Math.max(0, top)}px`;
    win.style.right = 'auto';
}

function hideCorrelationTooltip() {
    UTILS.getElementByIdOrThrow('mpra-corr-window').classList.add('d-none');
}

/** Draw `points` into the tooltip at (x, y) and reveal it. `score` is the backend's
 * precomputed value for this window - see getCorrPointsLayout(). */
function renderCorrelationTooltip(points, title, score, x, y) {
    if (!points.length) {
        hideCorrelationTooltip();
        return;
    }
    const traces = buildCorrelationScatterTraces(points);
    const layout = getCorrPointsLayout(score);

    const win = UTILS.getElementByIdOrThrow('mpra-corr-window');
    positionTooltip(win, x, y);
    win.classList.remove('d-none');
    UTILS.getElementByIdOrThrow('mpra-corr-window-title').textContent = title;

    const plotDiv = UTILS.getElementByIdOrThrow('mpra-corr-scatter-plot');
    // staticPlot: this tooltip is a read-only preview - nothing inside it needs its
    // own hover/zoom/pan, so skip the overhead of Plotly wiring that up.
    Plotly.react(plotDiv, traces, layout, { staticPlot: true, responsive: true });
}

/** Hovering a point on the combined plot's "Corr." line previews *only* that
 * window's MPRA-vs-predicted-effect points (not the full set with some points
 * dimmed), positioned right next to the cursor like a native tooltip. `score`
 * is that window's y-value on the Corr. line itself (plotData.correlation_values
 * from /mpra/single) - the actual backend-calculated score, passed straight
 * through rather than recomputed here. */
function showCorrelationWindowPoints(windowStart, windowEnd, score, clientX, clientY) {
    const mpraData = getMpraData();
    const combinedDiv = UTILS.getElementByIdOrThrow('mpra-combined-plot');
    const corrData = combinedDiv._lastCorrPointsData;
    if (!mpraData || !corrData) return;

    const allPoints = collectCorrelationPoints(mpraData.variants, corrData.mutantsEffect);
    const windowPoints = allPoints.filter(p => p.position >= windowStart && p.position < windowEnd);
    renderCorrelationTooltip(windowPoints, `pos ${windowStart}-${windowEnd - 1}`, score, clientX, clientY);
}

/** Stable identity for a binding-site hit bar trace (createBindingSiteBarTraces
 * gives each one fileId/windowStart/windowEnd), used to track which one is
 * "selected" (clicked) across re-renders. */
function hitKey(t) {
    return `${t.fileId}:${t.windowStart}:${t.windowEnd}`;
}

/** Build a `rect` shape outlining the selected hit bar (if any), in plain data
 * coordinates (x0/x1 = the bar's real start/end, y0/y1 = its packed row band).
 * This replaced an earlier attempt that fudged an extra scatter trace with a
 * wider black line "behind" the bar: that required converting a pixel padding
 * into data units by hand, using the axis scale *at the moment of the click* -
 * so it drifted out of sync the instant the user zoomed or panned afterward.
 * A shape avoids that entirely: Plotly recomputes shapes from their data
 * coordinates on every redraw (zoom, pan, resize, ...), and `line.width` is
 * still a true screen-pixel stroke, so the border simply stays correct. */
function getSelectionShape(div) {
    const key = div._selectedHitKey;
    if (!key) return null;
    const bar = (div._scanTraces || []).find(t => t.fileId !== undefined && hitKey(t) === key);
    if (!bar) return null;
    const level = bar.y[0];
    return {
        type: 'rect', xref: 'x', yref: 'y',
        x0: bar.x[0], x1: bar.x[1], y0: level - 0.4, y1: level + 0.4,
        line: { color: 'black', width: 3 },
        fillcolor: 'rgba(0,0,0,1)',
        layer: 'below',
    };
}

/** Redraw the plot's shapes: the persistent selection outline (if a hit is
 * selected) plus an optional transient one (the hover-highlight rectangle).
 * Centralizing this means the hover handlers just describe what to show on
 * top, without needing to remember the selection border every time. */
function setPlotShapes(div, hoverShape) {
    const selectionShape = getSelectionShape(div);
    const shapes = [];
    if (selectionShape) shapes.push(selectionShape);
    if (hoverShape) shapes.push(hoverShape);
    Plotly.relayout(div, { shapes });
}

// Combined plot update: top = binding-site hit insets (yaxis + dynamic xaxisN/yaxisN),
// middle = MPRA (yaxis2), bottom = predicted effect (yaxis3)
function updateCombinedPlot() {
    const div = UTILS.getElementByIdOrThrow('mpra-combined-plot');
    const scan = div._scanTraces || []; // packed horizontal-bar traces (from createBindingSiteBarTraces)
    const scanNumLevels = div._scanNumLevels || 1;
    const mpra = div._mpraTraces || [];
    const corr = div._corrTraces || [];
    const single = div._singleTraces || [];

    // Ensure corr traces use MPRA y-axis (yaxis3) so they between MPRA and sample
    corr.forEach(t => t.yaxis = 'y3');

    // Pin every trace to its own (x, y) axis pair - xaxis/xaxis2/xaxis3/xaxis4
    // below all share the same range via `matches: 'x'` - so each stacked
    // panel is an independent subplot. Previously every trace referenced
    // the single shared 'xaxis' object while spanning four different
    // y-axis domains; Plotly could only draw that one axis's ticks and
    // "Position" title once, at whichever panel boundary it picked, which
    // is why it ended up overlapping the Corr. panel instead of sitting
    // under the bottom-most panel.
    scan.forEach(t => t.xaxis = 'x');
    mpra.forEach(t => t.xaxis = 'x2');
    corr.forEach(t => t.xaxis = 'x3');
    single.forEach(t => t.xaxis = 'x4');

    const traces = [...scan, ...mpra, ...corr, ...single];

    // --- Legend routing -----------------------------------------------
    // PFAM group entries (from the binding-site scan) go into the top
    // legend. Every other legend-worthy trace is split into its own
    // titled sub-legend by what it means (_legendKind) - ref shapes, alt
    // colors, p-value lines, and correlation - instead of being crammed
    // into one long horizontal legend. Traces are marked with
    // `_legendEntry`/`_legendKind`/`_legendKey` at creation time so this
    // routing survives across renders even though the underlying trace
    // arrays are cached on the div.
    const LEGEND_KIND_TO_ID = { 'ref-shape': 'legend2', 'nt-color': 'legend3', 'pvalue': 'legend4', 'corr': 'legend5' };
    // Reset first, since a trace object can be re-used across multiple
    // updateCombinedPlot() calls and may have been hidden as a duplicate
    // on a previous render.
    traces.forEach(t => {
        if (!t._legendEntry) return;
        t.showlegend = true;
        const isPfamEntry = t.legendgroup && t.legendgroup.startsWith('pfam-');
        t.legend = isPfamEntry ? 'legend' : (LEGEND_KIND_TO_ID[t._legendKind] || 'legend2');
    });
    // Collapse duplicate legend entries by semantic meaning (kind+key), not
    // literal name - e.g. the MPRA "Alt" color legend and the
    // predicted-effect "Mutant nucleotide" color legend encode the exact
    // same A/C/G/T mapping and should never both appear, even though their
    // trace names differ.
    const seenLegendKeys = { legend: new Set(), legend2: new Set(), legend3: new Set(), legend4: new Set(), legend5: new Set() };
    traces.forEach(t => {
        if (!t._legendEntry) return;
        const bucket = seenLegendKeys[t.legend];
        const key = t._legendKind ? `${t._legendKind}:${t._legendKey}` : t.name;
        if (bucket.has(key)) {
            t.showlegend = false;
        } else {
            bucket.add(key);
        }
    });

    // --- Axis layout -----------------------------------------------
    // Only allocate vertical space to sections that actually have data;
    // empty sections are hidden and their space is reclaimed by the rest.
    // Weights are relative units, not fractions - a weight of 1 is worth
    // AXIS_UNIT_HEIGHT px, so a section keeps roughly the same pixel
    // height whether it's alone or stacked with others.
    const AXIS_UNIT_HEIGHT = 40;
    const marginTop = 90, marginBottom = 200;

    // Binding site hits doesn't get a fixed weight like the other panels -
    // it's sized by how many packed rows it actually has (ROW_HEIGHT_PX per
    // row), capped at the MPRA panel's height so a hit map with lots of
    // overlapping windows can grow up to - but never past - as tall as MPRA.
    const MPRA_WEIGHT = 6;
    const ROW_HEIGHT_PX = 18;
    const bindingWeight = Math.min(MPRA_WEIGHT, (scanNumLevels * ROW_HEIGHT_PX) / AXIS_UNIT_HEIGHT);

    const sectionDefs = [
        {
            hasData: scan.length > 0, weight: bindingWeight, axisName: 'yaxis', xAxisName: 'xaxis', title: 'Binding site hits',
            extra: { showticklabels: false, showgrid: false, zeroline: false, range: [-0.6, scanNumLevels - 0.4] },
        },
        {
            hasData: mpra.length > 0, weight: MPRA_WEIGHT, axisName: 'yaxis2', xAxisName: 'xaxis2', title: 'MPRA',
            extra: { showticklabels: true },
        },
        {
            hasData: corr.length > 0, weight: 1, axisName: 'yaxis3', xAxisName: 'xaxis3', title: 'Corr.',
            // Fix the range to the correlation's own bounds - without this,
            // Plotly autoranges to fit the data, which rarely reaches -1/1,
            // so those tickvals fall outside the visible range and never
            // actually get drawn even though they're listed.
            extra: { showticklabels: true, showgrid: false, tickvals: [-1, 0, 1], range: [-1, 1] },
        },
        {
            hasData: single.length > 0, weight: 6, axisName: 'yaxis4', xAxisName: 'xaxis4',
            title: div._singleTitle?.replace('\n', '<br>') || 'Predicted Effect',
            extra: { showticklabels: true },
        },
    ];

    const visibleSections = sectionDefs.filter(s => s.hasData);
    const totalWeight = visibleSections.reduce((sum, s) => sum + s.weight, 0) || 1;
    const innerAreaPx = totalWeight * AXIS_UNIT_HEIGHT; // plotting area height, excludes margins
    const plotHeight = marginTop + marginBottom + innerAreaPx;

    // Panel padding/gaps and legend offsets are all expressed in fixed
    // pixels then converted to paper-fraction using innerAreaPx, so they
    // stay a constant number of pixels no matter how tall the figure gets -
    // a fixed *fraction* (e.g. y: -0.22) grows in lockstep with the plot,
    // which is what made the whitespace above the legends balloon.
    const px = (n) => n / innerAreaPx;
    const topY = 1 - px(15), bottomY = px(8), gap = px(22);
    const totalGap = gap * Math.max(visibleSections.length - 1, 0);
    const availableHeight = Math.max(topY - bottomY - totalGap, 0);

    // Which visible section is bottom-most decides which x-axis actually
    // shows tick labels and the "Position" title - every other panel's
    // x-axis is drawn (so its gridlines line up) but hidden.
    const bottomSection = visibleSections[visibleSections.length - 1];

    const axisLayout = {};
    let cursor = topY;
    sectionDefs.forEach(s => {
        if (!s.hasData) {
            // Hide empty axes entirely rather than leaving a blank gap.
            axisLayout[s.axisName] = { visible: false, domain: [0, 0], showticklabels: false, anchor: s.xAxisName.replace('axis', '') };
            axisLayout[s.xAxisName] = {
                visible: false, domain: [0, 1], anchor: s.axisName.replace('axis', ''),
                matches: s.xAxisName === 'xaxis' ? undefined : 'x',
            };
            return;
        }
        const height = availableHeight * (s.weight / totalWeight);
        const top = cursor;
        const bottom = cursor - height;
        // Anchor each y-axis to its own same-numbered x-axis explicitly
        // (e.g. yaxis3 <-> xaxis3) rather than relying on Plotly's implicit
        // pairing defaults, which is what let the single shared x-axis
        // drift to an unpredictable panel boundary before.
        // automargin lets Plotly grow the left margin as needed to fit the
        // title (which can be 2 lines, e.g. the Predicted Effect axis) -
        // without it, a multi-line title can overlap the tick labels.
        axisLayout[s.axisName] = {
            domain: [bottom, top], title: { text: s.title }, anchor: s.xAxisName.replace('axis', ''),
            automargin: true, ...s.extra,
        };
        const isBottom = s === bottomSection;
        axisLayout[s.xAxisName] = {
            domain: [0, 1],
            anchor: s.axisName.replace('axis', ''), // e.g. 'yaxis3' -> 'y3'
            matches: s.xAxisName === 'xaxis' ? undefined : 'x',
            showticklabels: isBottom,
            ticks: isBottom ? 'outside' : '',
            title: isBottom ? { text: 'Position' } : undefined,
            fixedrange: false,
        };
        cursor = bottom - gap;
    });

    const layout = {
        template: 'plotly_white',
        uirevision: 'static',
        margin: { t: marginTop, b: marginBottom, l: 50, r: 20 },
        ...axisLayout,
        // Top legend: PFAM groups only, horizontal, a fixed 35px above the
        // top axis.
        legend: { orientation: 'h', x: 0.5, xanchor: 'center', y: 1 + px(35), title: { text: 'PFAM' } },
        // Bottom legends: four small titled sub-legends in a 2x2 grid
        // (Ref/Alt on one row, P-Value/Correlation on the next), a fixed
        // 65px/130px below the bottom axis. Each row only has two groups
        // sharing the width, so a 4-item group (Ref, Alt) has room to lay
        // out horizontally without colliding into its neighbor - which is
        // what happened when all four were packed onto a single row.
        legend2: { orientation: 'h', x: 0.05, xanchor: 'left', y: -px(65), yanchor: 'top', title: { text: 'Ref', font: { weight: 'bold' } } },
        legend3: { orientation: 'h', x: 0.55, xanchor: 'left', y: -px(65), yanchor: 'top', title: { text: 'Alt', font: { weight: 'bold' } } },
        legend4: { orientation: 'h', x: 0.05, xanchor: 'left', y: -px(130), yanchor: 'top', title: { text: 'P-Value', font: { weight: 'bold' } } },
        legend5: { orientation: 'h', x: 0.55, xanchor: 'left', y: -px(130), yanchor: 'top', title: { text: 'Correlation', font: { weight: 'bold' } } },
        height: plotHeight,
    };

    // Plotly.react was keeping traces pinned to whichever legend ('legend'
    // vs 'legend2') they were first drawn into, so nucleotide entries that
    // moved from the top PFAM legend to the bottom legend on a later render
    // stayed stuck at the top. Plotly.redraw forces a full recomputation
    // (including legend membership) from the current div.data/div.layout,
    // but - unlike Plotly.newPlot - without destroying and recreating the
    // plot instance, so it doesn't reset the x-axis zoom/pan and doesn't
    // discard the hover/click listeners attached below.
    // Plotly.redraw() re-renders the SVG at the new layout.height but does
    // not resize the container <div> itself, so a plot that grows taller
    // across renders (e.g. once the predicted-effect panel gets added)
    // overflows its box and visually overlaps whatever comes after it in
    // the page. Set the div's own height explicitly so normal page flow
    // (and the height of #mpra-combined-container around it) grows with it.
    div.style.height = `${plotHeight}px`;

    if (!div._initialized) {
        Plotly.newPlot(div, traces, layout, { responsive: true }).then(() => {
            attachCombinedPlotHandlers(div);
            setPlotShapes(div, null); // no-op today (nothing can be selected yet), kept for symmetry
        });
        div._initialized = true;
    } else {
        div.data = traces;
        // Merge into the existing xaxis object (rather than replacing it
        // outright) so a user's current zoom/pan range isn't clobbered.
        Object.assign(div.layout.xaxis, layout.xaxis);
        Object.keys(layout).forEach(key => {
            if (key !== 'xaxis') div.layout[key] = layout[key];
        });
        Plotly.redraw(div);
        // Re-apply the selection outline every time: Plotly.redraw() doesn't
        // touch div.layout.shapes on its own, but the bar this shape traces
        // out is rebuilt fresh above (traces array), so keep it in lockstep.
        setPlotShapes(div, null);
    }
}

/** Attach the combined plot's hover/click handlers. Called once, right after
 * the initial Plotly.newPlot() - Plotly.redraw() (used for later updates)
 * does not tear down the plot's event system, so these stay attached. */
function attachCombinedPlotHandlers(div) {
    // Tracks whether the currently-hovered point is on the Corr. line, so
    // plotly_unhover only bothers hiding the correlation-points tooltip when
    // it's actually relevant, rather than on every unhover anywhere in the
    // combined plot.
    let hoveringCorrLine = false;

    // Hover: highlight the hit window this inset belongs to; hovering a point
    // on the Corr. line instead pops up a tooltip of that window's
    // MPRA-vs-predicted-effect points, right next to the cursor.
    div.on('plotly_hover', (e) => {
        const point = e.points[0];
        const data = point?.data;
        if (!data) return;

        if (data._isCorrLine) {
            hoveringCorrLine = true;
            const windowStart = point.x;
            const windowEnd = windowStart + (data.windowSize || 1) - 1;
            setPlotShapes(div, {
                type: 'rect', xref: 'x', yref: 'paper', x0: windowStart, x1: windowEnd, y0: 0, y1: 1,
                fillcolor: 'rgba(128,0,128,0.12)', line: {width: 0}, layer: 'below'
            });
            // point.y is this window's actual score (same value the Corr. line's
            // own hover label shows); e.event is the native mouse event that
            // triggered this hover - its screen position places the tooltip next
            // to the cursor.
            showCorrelationWindowPoints(windowStart, windowEnd, point.y, e.event?.clientX, e.event?.clientY);
            return;
        }
        hoveringCorrLine = false;

        if (data.fileId === undefined) return;
        setPlotShapes(div, {
            type: 'rect', xref: 'x', yref: 'paper', x0: data.windowStart, x1: data.windowEnd, y0: 0, y1: 1,
            fillcolor: 'rgba(200,200,200,0.25)', line: {width: 0}, layer: 'below'
        });
    });

    div.on('plotly_unhover', () => {
        setPlotShapes(div, null);
        if (hoveringCorrLine) {
            hoveringCorrLine = false;
            hideCorrelationTooltip();
        }
    });

    // Click-to-select: mark the clicked hit with a black outline immediately
    // (updateCombinedPlot(), rather than waiting on loadHitDetail()'s fetch),
    // then load its protein comparison as before.
    div.on('plotly_click', (e) => {
        const data = e.points[0]?.data;
        if (!data || data.fileId === undefined) return;
        div._selectedHitKey = hitKey(data);
        updateCombinedPlot();
        loadHitDetail(data.fileId);
    });
}


/** Step 3: scan the whole library for candidate proteins. */
async function scanLibrary() {
    const mpraData = getMpraData();
    if (!mpraData) {
        showToast('error', 'Please load MPRA data first.');
        return;
    }

    showGlobalLoading();
    const formData = new FormData();
    formData.append('ref_sequence', mpraData.ref_sequence);
    formData.append('variants', JSON.stringify(mpraData.variants));
    formData.append('file_type', getMpraFileType('mpra_scan_file_type'));
    formData.append('window_size', UTILS.getElementByIdOrThrow('mpra-window-size').value);
    formData.append('corr_threshold', UTILS.getElementByIdOrThrow('mpra-corr-threshold').value);
    formData.append('var_threshold', UTILS.getElementByIdOrThrow('mpra-var-threshold').value);
    formData.append('alpha', UTILS.getElementByIdOrThrow('mpra-alpha').value);

    await fetch('/mpra/scan', { method: 'POST', body: formData })
        .then(response => response.json())
        .then(data => {
            hideGlobalLoading();
            if (data.error) {
                showToasts(data);
                return;
            }
            renderScanResults(data);
        })
        .catch(handleError);
}

function renderScanResults(scanData) {
    const resultsDiv = UTILS.getElementByIdOrThrow('mpra-scan-results');
    resultsDiv.classList.remove('d-none');

    if (!scanData.hits.length) {
        showToast('warning', 'No proteins passed the thresholds. Try lowering them.');
        return;
    }

    const mpraData = getMpraData();
    const combinedDiv = UTILS.getElementByIdOrThrow('mpra-combined-plot');
    combinedDiv.sequence_str = mpraData.ref_sequence;

    const { traces, numLevels } = createBindingSiteBarTraces(scanData);
    combinedDiv._scanTraces = traces;
    combinedDiv._scanNumLevels = numLevels;
    // clear any previous correlation traces for this file until user selects
    combinedDiv._corrTraces = [];
    // a fresh scan invalidates any previously-selected hit's outline (its bar
    // may no longer exist, or the same fileId/position could now mean a
    // different run)
    combinedDiv._selectedHitKey = null;

    // Map displayed filename back to its numeric file id (from scanData.file_meta)
    const fileNameToId = {};
    Object.entries(scanData.file_meta).forEach(([id, meta]) => { fileNameToId[meta.filename] = id; });

    // store mappings for interaction
    combinedDiv._fileNameToId = fileNameToId;
    combinedDiv._lastScanData = scanData;

    // Render before attaching handlers to ensure Plotly has initialized the div
    updateCombinedPlot();
}

async function loadHitDetail(fileId) {
    const mpraData = getMpraData();
    showGlobalLoading(false);
    const fileType = getMpraFileType('mpra_scan_file_type');
    const formData = new FormData();
    formData.append('ref_name', mpraData.seq_name);
    formData.append('ref_sequence', mpraData.ref_sequence);
    formData.append('file_type', fileType);
    formData.append('score_0', fileId);

    // Include scan parameters for correlation computation
    formData.append('variants', JSON.stringify(mpraData.variants));
    formData.append('window_size', UTILS.getElementByIdOrThrow('mpra-window-size').value);
    formData.append('corr_threshold', UTILS.getElementByIdOrThrow('mpra-corr-threshold').value);
    formData.append('var_threshold', UTILS.getElementByIdOrThrow('mpra-var-threshold').value);
    formData.append('alpha', UTILS.getElementByIdOrThrow('mpra-alpha').value);

    await fetch('/mpra/single', { method: 'POST', body: formData })
        .then(response => response.json())
        .then(data => {
            hideGlobalLoading();
            if (data.error) {
                showToasts(data);
                return;
            }
            renderSinglePlot(data, fileType);
            UTILS.getElementByIdOrThrow('mpra-combined-plot').scrollIntoView({ behavior: 'smooth', block: 'center' });
        })
        .catch(handleError);
}

loadExistingScoreFiles();
UTILS.getElementByIdOrThrow('mpra-load-btn').addEventListener('click', loadMpraData);
UTILS.getElementByIdOrThrow('mpra-compare-btn').addEventListener('click', compareSingleProtein);
UTILS.getElementByIdOrThrow('mpra-scan-btn').addEventListener('click', scanLibrary);
UTILS.getElementByIdOrThrow('mpra-corr-window-close').addEventListener('click', hideCorrelationTooltip);

function initTooltips() {
    const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    tooltipTriggerList.map(function (el) {
        return new bootstrap.Tooltip(el);
    });
}

initTooltips();

