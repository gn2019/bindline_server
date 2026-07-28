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
            updateCombinedPlot();
            UTILS.getElementByIdOrThrow('mpra-results').classList.remove('d-none');
        })
        .catch(handleError);
}

/** Build MPRA experimental scatter traces: color by Alt, shape by Ref, lines colored by significance. */
function createMpraExperimentalTraces(refSequence, variants) {
    const nucleotideColors = { A: 'green', C: 'blue', G: 'orange', T: 'red', '-': 'gray' };
    const nucleotideShapes = { A: 'square', C: 'circle', G: 'triangle-up', T: 'diamond' };

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

    // Legend helpers, matching the style used for the "All Mutants" plot
    const shapeTraces = Object.keys(nucleotideShapes).map(nuc => ({
        x: [null], y: [null], mode: 'markers',
        marker: { symbol: nucleotideShapes[nuc], color: 'rgba(0,0,0,0)', opacity: 1, size: 12, line: { color: 'black', width: 2 } },
        name: `Ref nucleotide: ${nuc}`,
    }));
    const colorTraces = ['A', 'C', 'G', 'T'].map(nuc => ({
        x: [null], y: [null], mode: 'markers',
        marker: { symbol: 'circle', color: nucleotideColors[nuc], size: 12 },
        name: `Alt nucleotide: ${nuc}`,
    }));
    const sigTraces = [
        { x: [null], y: [null], mode: 'lines', line: { color: 'green' }, name: 'P-Value < 0.05' },
        { x: [null], y: [null], mode: 'lines', line: { color: 'red' }, name: 'P-Value >= 0.05' },
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
    const formData = new FormData();
    formData.append('ref_name', mpraData.seq_name);
    formData.append('ref_sequence', mpraData.ref_sequence);
    formData.append('file_type', getMpraFileType('mpra_file_type'));
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
            renderSinglePlot(data);
        })
        .catch(handleError);
}

function renderSinglePlot(plotData) {
    // Add predicted-effect traces to the combined plot (bottom panel)
    const combinedDiv = UTILS.getElementByIdOrThrow('mpra-combined-plot');
    const [traces] = createAllMutantsTraces(plotData);
    // assign to bottom y-axis
    const singleTraces = traces.map(t => (t.yaxis = 'y4', t));
    combinedDiv._singleTraces = singleTraces;
    combinedDiv._singleTitle = `Predicted Effect\n${plotData.score_file}`;

    // Use correlation from backend if available
    if (plotData.correlation_positions && plotData.correlation_values) {
        combinedDiv._corrTraces = [{
            x: plotData.correlation_positions,
            y: plotData.correlation_values,
            mode: 'lines',
            line: { color: 'purple', width: 2 },
            name: 'MPRA-Protein Correlation',
            yaxis: 'y3',
            hovertemplate: 'pos %{x}: r=%{y:.3f}<extra></extra>',
        }];
    } else {
        combinedDiv._corrTraces = [];
    }

    updateCombinedPlot();
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

    const traces = [...scan, ...mpra, ...corr, ...single];

    const layout = {
        template: 'plotly_white',
        uirevision: 'static',
        margin: { t: 90, b: 40, l: 50, r: 20 },
        xaxis: { title: { text: 'Position' }, fixedrange: false },
        yaxis: {
            domain: [0.72, 0.96], title: { text: 'Binding site hits' },
            showticklabels: false, showgrid: false, zeroline: false,
            range: [-0.6, scanNumLevels - 0.4],
        },
        yaxis2: { domain: [0.36, 0.68], title: { text: 'MPRA' }, showticklabels: true },
        yaxis3: { domain: [0.305, 0.3595], title: { text: 'Corr.' }, showticklabels: true, showgrid: false, tickvals: [-1, 0, 1] },
        yaxis4: { domain: [0.02, 0.3], title: { text: div._singleTitle?.replace('\n', '<br>') || 'Predicted Effect' }, showticklabels: true },
        legend: { orientation: 'h', x: 0.5, xanchor: 'center', y: 1.16, title: { text: 'PFAM' } },
        height: div.style && div.style.height ? parseInt(div.style.height) : 640,
    };

    // If plot doesn't exist yet, use newPlot, otherwise react
    if (!div._initialized) {
        Plotly.newPlot(div, traces, layout, { responsive: true });
        div._initialized = true;
    } else {
        Plotly.react(div, traces, layout, { responsive: true });
    }
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
        UTILS.getElementByIdOrThrow('mpra-scan-tbody').innerHTML = '';
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

    // Map displayed filename back to its numeric file id (from scanData.file_meta)
    const fileNameToId = {};
    Object.entries(scanData.file_meta).forEach(([id, meta]) => { fileNameToId[meta.filename] = id; });

    // store mappings for interaction
    combinedDiv._fileNameToId = fileNameToId;
    combinedDiv._lastScanData = scanData;

    // Render before attaching handlers to ensure Plotly has initialized the div
    updateCombinedPlot();

    // Attach handlers once. They read combinedDiv._lastScanData/_fileNameToId dynamically so
    // reattachment on every render is not needed and causes duplicates.
    if (!combinedDiv._handlersAttached) {
        // helper to attach handlers when Plotly has initialized the div
        const attachHandlers = () => {
            if (combinedDiv._handlersAttached) return;
            combinedDiv._lastClick = { key: null, time: 0 };

            // Hover: highlight the hit window this inset belongs to
            combinedDiv.on('plotly_hover', (e) => {
                const data = e.points[0]?.data;
                if (!data || data.fileId === undefined) return;
                const shape = [{
                    type: 'rect', xref: 'x', yref: 'paper', x0: data.windowStart, x1: data.windowEnd, y0: 0, y1: 1,
                    fillcolor: 'rgba(200,200,200,0.25)', line: {width: 0}, layer: 'below'
                }];
                Plotly.relayout(combinedDiv, {shapes: shape});
            });

            combinedDiv.on('plotly_unhover', () => {
                Plotly.relayout(combinedDiv, {shapes: []});
            });

            // Click-to-select: use native DOM click count (e.event.detail) to distinguish single vs double click
            combinedDiv.on('plotly_click', (e) => {
                const data = e.points[0]?.data;
                if (!data || data.fileId === undefined) return;
                loadHitDetail(data.fileId);
            });

            combinedDiv._handlersAttached = true;
        };

        if (typeof combinedDiv.on === 'function') {
            attachHandlers();
        } else {
            // Plotly may not have attached helper methods yet; retry shortly
            setTimeout(() => {
            if (typeof combinedDiv.on === 'function') attachHandlers();
            else console.warn('Plotly event helpers not available; event handlers not attached.');
            }, 50);
        }
    }
}

function renderScanTable(scanData, fileNameToId) {
    const tbody = UTILS.getElementByIdOrThrow('mpra-scan-tbody');
    tbody.innerHTML = '';

    // Invert pfam_map (name -> [filenames]) to filename -> pfam names
    const filenameToPfams = {};
    Object.entries(scanData.pfam_map || {}).forEach(([pfamName, filenames]) => {
        filenames.forEach(fn => {
            filenameToPfams[fn] = filenameToPfams[fn] || [];
            filenameToPfams[fn].push(pfamName);
        });
    });

    const rows = [];
    scanData.hits.forEach(hit => {
        const fileName = scanData.file_meta[hit.file_id]?.filename || `file_${hit.file_id}`;
        hit.positions.forEach((pos, i) => {
            rows.push({
                fileName,
                fileId: hit.file_id,
                pfams: (filenameToPfams[fileName] || []).join(', ') || fileName,
                start: pos,
                end: pos + scanData.window_size - 1,
                score: hit.scores[i],
            });
        });
    });
    rows.sort((a, b) => b.score - a.score);

    rows.forEach(row => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${row.fileName}</td>
            <td>${row.pfams}</td>
            <td>${row.start}-${row.end}</td>
            <td>${row.score.toFixed(3)}</td>
            <td><button class="btn btn-outline-primary btn-sm view-hit-btn">View</button></td>
        `;
        tr.querySelector('.view-hit-btn').addEventListener('click', () => loadHitDetail(row.fileId));
        tbody.appendChild(tr);
    });
}

async function loadHitDetail(fileId) {
    const mpraData = getMpraData();
    showGlobalLoading(false);
    const formData = new FormData();
    formData.append('ref_name', mpraData.seq_name);
    formData.append('ref_sequence', mpraData.ref_sequence);
    formData.append('file_type', getMpraFileType('mpra_scan_file_type'));
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
            renderSinglePlot(data);
            UTILS.getElementByIdOrThrow('mpra-combined-plot').scrollIntoView({ behavior: 'smooth', block: 'center' });
        })
        .catch(handleError);
}

loadExistingScoreFiles();
UTILS.getElementByIdOrThrow('mpra-load-btn').addEventListener('click', loadMpraData);
UTILS.getElementByIdOrThrow('mpra-compare-btn').addEventListener('click', compareSingleProtein);
UTILS.getElementByIdOrThrow('mpra-scan-btn').addEventListener('click', scanLibrary);

function initTooltips() {
    const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    tooltipTriggerList.map(function (el) {
        return new bootstrap.Tooltip(el);
    });
}

initTooltips();

