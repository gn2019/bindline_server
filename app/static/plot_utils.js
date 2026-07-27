import * as UTILS from './utils.js';
import { showToast, showToasts } from './toast.js';
import { addSequenceRow, getRefRow, setFirstAsRef, getSequenceRows, isCheckedRow, } from './sequences_table.js';
import { importQueryData, } from './samples.js';

// Load existing E-Score files into dropdown and enable searchable multi-selection
function loadExistingFiles() {
    fetch('/list-files/score')
        .then(response => response.json())
        .then(files => {
            const scoreDropdown = $('#existing_score'); // Use jQuery selector for Select2
            scoreDropdown.empty(); // Clear previous options

            // Populate options
            files.forEach(file => {
                scoreDropdown.append(new Option(file.filename, file.id, false, false));
            });

            // Initialize Select2 for searchable dropdown
            scoreDropdown.select2({
                placeholder: "Select Score files",
                allowClear: true,
                dropdownPosition: "below",

                // Dropdown item
                templateResult: function (fileOption) {
                    if (!fileOption.id || fileOption.loading) {
                        return fileOption.text;
                    }
                    return showScoreFile(files.find(f => f.id == fileOption.id));
                },

                // Selected item (collapsed box)
                templateSelection: (file) => file.text
            });
        });

    fetch('/list-files/fasta')
        .then(response => response.json())
        .then(files => {
            const fastaDropdown = UTILS.getElementByIdOrThrow('existing_fasta');
            fastaDropdown.innerHTML = ''; // Clear previous options
            files.forEach(file => {
                fastaDropdown.append(new Option(file, file, false, false));
            });
        });

    fetch('/list-files/pfam')
        .then(response => response.json())
        .then(pfams => {
            const pfamDropdown = $('#pfam-select'); // Use jQuery selector for Select2
            pfamDropdown.empty(); // Clear previous options

            // Populate options
            for (const pfam of pfams) {
                pfamDropdown.append(new Option(pfam.name, pfam.id, false, false));
            }

            // Initialize Select2 for searchable dropdown
            pfamDropdown.select2({
                placeholder: "Select Protein Families",
                allowClear: true,
                dropdownPosition: "below",
            });
        });
}


function handleSelect2Paste() {
    const select = $(this);
    const input = select.data('select2').$container.find('.select2-search__field')[0];

    if (input._bulkPasteAttached) return;
    input._bulkPasteAttached = true;
    // build lookup once per select
    const optionMap = new Map(
        select.find('option').toArray().map(o => [o.text, o.value])
    );

    input.addEventListener('paste', function (e) {
        const text = e.clipboardData.getData('text');
        if (!text.includes('\n')) return;

        e.preventDefault();

        const values = text.split(/\r?\n/).map(v => v.trim()).filter(Boolean);
        const selected = new Set(select.val() || []);

        for (const v of values) {
            if (optionMap.has(v)) {
                selected.add(optionMap.get(v));
            }
        }
        select.val([...selected]).trigger('change');
    });
}


function showScoreFile(file) {
    // Build metadata elements only if the field exists
    let metaParts = [];

    if (file.dataset) {
        metaParts.push(`<span>Dataset: ${file.dataset}</span>`);
    }

    if (file.publication) {
        metaParts.push(`<span>Publication: ${file.publication}</span>`);
    }

    if (file.notes) {
        metaParts.push(`<span>${file.notes}</span>`);
    }

    // Join metadata fields horizontally with gaps
    const metaHtml = metaParts.length
        ? `<div class="small text-muted d-flex gap-3 flex-wrap">${metaParts.join('')}</div>`
        : "";

    // Final item template
    return $(`
        <div class="d-flex flex-column">
            <strong>${file.filename}</strong>
            ${metaHtml}
        </div>
    `);
}

async function loadSequences() {
    const fastaSource = getActiveTab('fasta-tabs');
    let formData = new FormData();
    if (fastaSource === 'fasta-upload') {
        const fastaFile = UTILS.getElementByIdOrThrow('fasta').files[0];
        if (!fastaFile) {
            throw new Error("Please upload a DNA FASTA file first.");
        }
        formData.append('fasta', fastaFile);
    } else if (fastaSource === 'fasta-existing') {
        const existingFastaSelect = UTILS.getElementByIdOrThrow('existing_fasta');
        if (!existingFastaSelect.value) {
            throw new Error("Please select a DNA FASTA file first.");
        }
        formData.append('existing_fasta', existingFastaSelect.value);
    } else {
        throw new Error("Select or upload a FASTA file.");
    }

    await fetch('/sequences', {
        method: 'POST',
        body: formData
    })
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                showToast('error', data.error);
                return;
            }

            const sequenceTbody = UTILS.getElementByIdOrThrow('sequence-tbody');
            sequenceTbody.innerHTML = ''; // Clear previous rows

            Object.keys(data.sequences).forEach(seqName => {
                addSequenceRow(seqName, data.sequences[seqName]);
            });
        })
        .catch(handleError);
}


async function uploadAndPlot() {
    showGlobalLoading(); // Show loading animation before request

    const formData = new FormData(UTILS.getElementByIdOrThrow('upload-form'));
    try {
        // if no rows of sequences, load them
        if (!$('#sequence-tbody tr').length) {
            await loadSequences();
            await new Promise(requestAnimationFrame); // Wait for the UI to update
        }
        let selectedSequences = gatherSelectedSequences();
        const refName = getReferenceName(); // Now this will run after sequences are loaded

        formData.delete("fasta"); // remove fasta from formData, as sequences are already gathered
        appendSequencesAndOptions(formData, selectedSequences, refName);
        validateConditions(formData, selectedSequences);
    } catch (error) {
        handleError(error)
        return;
    }
    formData.forEach((value, key) => console.log(key, value));


    await fetch('/upload', {method: 'POST', body: formData})
        .then(response => response.json())
        .then(plotData => {
            if (plotData.error || plotData.warning) {
                return handleError(plotData);
            } else {
                return handlePlotData(plotData);
            }
        })
        .catch(handleError);
}


/** Helper function to gather all selected sequences */
function gatherSelectedSequences() {
    const selectedSequences = {};
    getSequenceRows().forEach(row => {
        if (isCheckedRow(row)) {
            const name = row.querySelector('[data-role="sequence-name"]').value;
            selectedSequences[name] = row.querySelector('[data-role="sequence-value"]').value;
        }
    });
    if (Object.keys(selectedSequences).length === 0) {
        throw new Error('Please select at least one sequence.');
    }
    return selectedSequences;
}

/** Helper function to get the reference name */
function getReferenceName() {
    let refRow = getRefRow();
    if (!refRow) {
        setFirstAsRef();
        refRow = getRefRow();
    }
    if (!refRow) {
        throw new Error('No reference sequence selected.');
    }
    return refRow.querySelector('input[type="text"]').value;
}

/** Append sequences, options, and thresholds to formData */
function appendSequencesAndOptions(formData, selectedSequences, refName) {
    formData.append('sequences', JSON.stringify(selectedSequences));
    formData.append('ref_name', refName);
    formData.append('show_diff_only', UTILS.getElementByIdOrThrow('show-diff-only').checked);
    formData.append('search_significant_mutations', UTILS.getElementByIdOrThrow('search-significant-mutations').checked);

    appendThresholds(formData);
    appendScoreFiles(formData);
    appendPfams(formData);
}

/** Append thresholds to formData */
function appendThresholds(formData) {
    const thresholds = {
        enable_ranks_threshold: 'ranks_threshold_input',
        enable_escore_threshold: 'escore_threshold_input',
        enable_zscore_threshold: 'zscore_threshold_input',
        enable_iscore_threshold: 'iscore_threshold_input'
    };

    for (const [checkboxId, inputId] of Object.entries(thresholds)) {
        if (UTILS.getElementByIdOrThrow(checkboxId).checked) {
            formData.append(inputId, UTILS.getElementByIdOrThrow(inputId).value);
        }
    }
}


function getActiveTab(containerId) {
    const activeTab = document.querySelector(`#${containerId} div.active`);
    return activeTab ? activeTab.id : null;
}


/** Append selected E-Score files to formData */
function appendScoreFiles(formData) {
    // get the active tab name in score_source
    const scoreSource = getActiveTab('score-tabs');
    if (scoreSource === 'score-existing') {
        const selectedFiles = Array.from(UTILS.getElementByIdOrThrow('existing_score').selectedOptions).map(option => option.value);
        if (selectedFiles.length === 0) {
            throw new Error('Please select at least one protein score file.');
        }
        selectedFiles.forEach((file, index) => formData.append(`score_${index}`, file));
        formData.delete("score");  // remove the uploaded file entry
        return;
    }
    if (scoreSource === 'score-upload') {
        const uploadedFile = UTILS.getElementByIdOrThrow('score').files;
        if (uploadedFile.length === 0) {
            throw new Error('Please upload at least one protein score file.');
        }
        return;
    }
    if (scoreSource === 'score-search') {
        formData.append('search_binding_sites', true);
        return;
    }
    throw new Error('Select protein files, upload files, or search across all proteins.');
}


function appendPfams(formData) {
    // get the active tab name in score_source
    const scoreSource = getActiveTab('score-tabs');
    if (scoreSource === 'score-upload') {
        const selectedPfams = Array.from(UTILS.getElementByIdOrThrow('pfam-select').selectedOptions).map(option => option.value);
        // add list of the pfams to formData
        selectedPfams.forEach((pfam, index) => formData.append(`pfam_${index}`, pfam));
    }
}


/** Validate preconditions and alert user if conditions are not met */
function validateConditions(formData, selectedSequences) {
    const searchBindingSites = formData.get('search_binding_sites', 'false') === 'true';
    const searchSignificantMutations = formData.get('search_significant_mutations') === 'true';
    if (searchSignificantMutations && Object.keys(selectedSequences).length !== 1) {
        throw new Error('Please select only one sequence for searching significant mutations.');
    }

    const thresholdsEnabled = [
        'enable_ranks_threshold',
        'enable_escore_threshold',
        'enable_zscore_threshold',
        'enable_iscore_threshold'
    ].some(id => UTILS.getElementByIdOrThrow(id).checked);

    if ((searchSignificantMutations || searchBindingSites) && !thresholdsEnabled) {
        throw new Error('Please enable at least one threshold, to filter the data for binding sites only.');
    }
}


/** Handle plot data and render plots */
async function handlePlotData(plotData) {
    showToasts(plotData);
    hideGlobalLoading();

    if (plotData.error) {
        return;
    }
    // console.log(plotData);

    const plotComponents = {
        bindline: {
            id: 'bindline-plot',
            traceFunc: createTraces,
            layoutFunc: getBindlinePlotLayout,
            callbackFunc: (component) => {
                isolateOnLegendClick(component.div);
                highlightSequenceOnHover(component.div);
            }
        },
        bindingSites: {
            id: 'binding-sites-plot',
            checkFunc: plotData => plotData.binding_sites,
            traceFunc: createBindingSiteTraces,
            layoutFunc: getBindingSitesPlotLayout,
            callbackFunc: (component) => {
                groupPfamOnClick(component.div);
            }
        },
        allMutants: {
            id: 'all-mutants-plot',
            checkFunc: plotData => plotData.mutants_effect,
            traceFunc: createAllMutantsTraces,
            layoutFunc: getAllMutantsPlotLayout
        }
    };
    // leave only the plots that are checked
    for (const [key, component] of Object.entries(plotComponents)) {
        const tabNavigation = UTILS.getElementByIdOrThrow(component.id.replace('-plot', '-tab-nav'));
        if (component.checkFunc && !component.checkFunc(plotData)) {
            UTILS.getElementByIdOrThrow(component.id).innerHTML = '';  // remove plot
            delete plotComponents[key];
            tabNavigation.classList.add('d-none');
        } else {
            tabNavigation.classList.remove('d-none');
        }
    }


    function toggleLoading(divId, show) {
        const spinner = UTILS.getElementByIdOrThrow(`${divId}-loading`);
        if (spinner) {
            spinner.style.display = show ? 'block' : 'none';
        }
    }

    function plotComponent(component) {
        const div = UTILS.getElementByIdOrThrow(component.id);
        div.removeAllListeners?.();
        div.innerHTML = '';
        toggleLoading(component.id, true); // Show spinner
        toggleInfoPopover(component.id.replace('-plot', '-container'), false); // hide popover
        togglePlotRelatedElements(component.id.replace('-plot', '-container'), false);

        // Use setTimeout to break out of the current execution cycle and allow UI to refresh
        setTimeout(async () => {
            const [traces, metadata] = component.traceFunc(plotData);
            const layout = component.layoutFunc(metadata);

            await Plotly.newPlot(div, traces, layout, {responsive: true});

            Plotly.Plots.resize(component.id);
            toggleLoading(component.id, false); // Hide spinner
            toggleInfoPopover(component.id.replace('-plot', '-container'), true); // show popover
            togglePlotRelatedElements(component.id.replace('-plot', '-container'), true);

            div.sequence_str = plotData.sequence_strs[plotData.ref_name];
            div.on('plotly_afterplot', () => setXTicks(div));
            setXTicks(div);

            component.div = div;
            component.traces = traces;
            component.metadata = metadata;
            component.layout = layout;

            if (component.callbackFunc) {
                component.callbackFunc(component);
            }
        }, 0);
    }

    // Run all plots asynchronously without blocking UI updates
    Object.values(plotComponents).forEach(plotComponent);

    addDownloadButton(plotData.export_url);

    // Since plotting is now separate, syncing should run after a slight delay
    setTimeout(() => {
        syncPlots(Object.values(plotComponents).map(component => component.div));
    }, 500);
}


function addDownloadButton(exportUrl) {
    if (!exportUrl) {
        return;
    }
    // write export path as a title
    const exportPathDiv = UTILS.getElementByIdOrThrow('export-div');
    // make a clickable link to the export path
    const link = document.createElement('a');
    link.href = exportUrl;
    link.target = "_blank";
    link.className = "data-btn";
    link.innerHTML = '<i class="fa fa-download"></i> Download Data';
    exportPathDiv.replaceChildren(link);
    exportPathDiv.classList.remove('d-none');
}


export function groupPfamOnClick(plotDiv) {
    plotDiv.on('plotly_click', (e) => {
        const clicked = plotDiv.data[e.points[0].curveNumber];
        if (!clicked?.pfam) return;

        const traceIndices = [];
        const yUpdates = [];
        const nameUpdates = [];
        const legendUpdates = [];

        plotDiv.data.forEach((t, i) => {
            if (t.pfam !== clicked.pfam) return;

            const newY = (t.y[0] === t.pfam) ? t.file : t.pfam;

            traceIndices.push(i);
            yUpdates.push(Array(t.x.length).fill(newY));

            // match original semantics exactly
            nameUpdates.push(t.name ? newY : undefined);
            legendUpdates.push(t.legendgroup ? newY : undefined);
        });

        if (!traceIndices.length) return;

        Plotly.restyle(plotDiv, {
            y: yUpdates,
            name: nameUpdates,
            legendgroup: legendUpdates,
        }, traceIndices);

        relayoutBindingSitesPlot(plotDiv);
    });
}


function relayoutBindingSitesPlot(plotDiv) {
    const byPfams = new Map();
    plotDiv.data.forEach(t => {
        if (isVisible(t) && t.name) {
            if (!byPfams.has(t.pfamName)) {
                byPfams.set(t.pfamName, {"pfamTraces": new Set(), "fileTraces": new Set()});
            }
            const placeToAdd = t.pfam === t.name ? "pfamTraces" : "fileTraces";
            byPfams.get(t.pfamName)[placeToAdd].add(t.name);
        }
    });

    const yLabels = [];
    for (const pfamTraces of byPfams.values()) {
        yLabels.push(
            ...Array.from(pfamTraces.fileTraces),
            ...Array.from(pfamTraces.pfamTraces),
        );
    }
    Plotly.relayout(plotDiv, getBindingSitesPlotLayout(yLabels));
}


function groupPfams() {
    const shouldGroupPfams = arePfamsGrouped();
    const plotDiv = UTILS.getElementByIdOrThrow('binding-sites-plot');

    const traceIndices = [];
    const yUpdates = [];
    const nameUpdates = [];
    const legendUpdates = [];

    plotDiv.data.forEach((t, i) => {
        if (!t.pfam) return;

        const nowOnPfam = t.y[0] === t.pfam;
        if (nowOnPfam === shouldGroupPfams) return;

        const newY = shouldGroupPfams ? t.pfam : t.file;

        traceIndices.push(i);
        yUpdates.push(Array(t.x.length).fill(newY));
        nameUpdates.push(t.name ? newY : undefined);
        legendUpdates.push(t.legendgroup ? newY : undefined);
    });

    if (!traceIndices.length) return;

    Plotly.restyle(plotDiv, {
        y: yUpdates,
        name: nameUpdates,
        legendgroup: legendUpdates,
    }, traceIndices);

    relayoutBindingSitesPlot(plotDiv);
}


function isolateOnLegendClick(plotDiv) {
    plotDiv.on('plotly_legendclick', (e) => {
        const trace = plotDiv.data[e.curveNumber];

        if (trace.isMetaProtein) {
            toggleProtein(plotDiv, trace.protein);
            return false;
        }

        if (trace.isMetaSequence) {
            toggleSequence(plotDiv, trace.sequence);
            setTimeout(() => enforceLegendRules(plotDiv), 0);
            return false;
        }

        setTimeout(() => enforceLegendRules(plotDiv, trace), 0);
        return true;
    });
}


function enforceLegendRules(plotDiv, trace = null) {
    const data = plotDiv.data;

    // Track which proteins still have visible sequences
    const proteinHasVisibleSeq = {};

    // Pass 1 — detect visible sequences per protein
    data.forEach(seqTrace => {
        if (seqTrace.isMaxScore || seqTrace.isMetaProtein) return;
        if ((seqTrace === trace && !isVisible(seqTrace)) || (seqTrace !== trace && isVisible(seqTrace))) {
            proteinHasVisibleSeq[seqTrace.protein] = true;
        }
    });
    let isMaxVisible = false;
    for (const metaMaxScoreTrace of data) {
        if (metaMaxScoreTrace.isMaxScore && metaMaxScoreTrace.isMetaSequence) {
            isMaxVisible = isVisible(metaMaxScoreTrace);
            break;
        }
    }
    if (isMaxVisible) {
        data.forEach((maxScoreTrace, i) => {
            if (!maxScoreTrace.isMaxScore || maxScoreTrace.isMetaSequence) return;
            const shouldShow = proteinHasVisibleSeq[maxScoreTrace.protein];
            Plotly.restyle(plotDiv, {visible: !!shouldShow}, [i]);
        });
    }
}


function isVisible(trace) {
    return trace.visible !== false && trace.visible !== "legendonly";
}

function areThereVisibleIndices(plotDiv, indices) {
    return indices.some(i => isVisible(plotDiv.data[i]));
}


function toggleProtein(plotDiv, protein) {
    const indices = [];
    plotDiv.data.forEach((trace, i) => {
        if (trace.protein === protein && !trace.isMetaProtein) {
            indices.push(i);
        }
    });
    const shouldDim = areThereVisibleIndices(plotDiv, indices);
    // find the meta-protein trace and dim it if should
    for (const [i, trace] of plotDiv.data.entries()) {
        if (trace.protein === protein && trace.isMetaProtein) {
            indices.push(i);
        }
    }
    Plotly.restyle(plotDiv, {visible: shouldDim ? "legendonly" : true}, indices);
}


function toggleSequence(plotDiv, sequence) {
    const indices = [];
    plotDiv.data.forEach((trace, i) => {
        if (trace.sequence === sequence && !trace.isMetaSequence) {
            indices.push(i);
        }
    });
    const shouldDim = areThereVisibleIndices(plotDiv, indices);
    for (const [i, trace] of plotDiv.data.entries()) {
        if (trace.sequence === sequence && trace.isMetaSequence) {
            indices.push(i);
        }
    }
    Plotly.restyle(plotDiv, {visible: shouldDim ? "legendonly" : true}, indices);
}


/** Handle and log errors */
function handleError(error) {
    hideGlobalLoading();
    showToasts(error);
    console.error(error);
}


/** Create traces for bindline plot */
function createTraces(plotData) {
    const traces = [];
    const colorPalettes = getColorPalettes();
    let globalLastPosition = 0;

    Object.entries(plotData.aligned_scores).forEach(([fileName, fileScores], fileIndex) => {
        const colorPalette = colorPalettes[fileIndex % colorPalettes.length];
        let lastPosition = 0;

        Object.entries(fileScores).forEach(([seqName, alignedScores], seqIndex) => {
            const alignedSeq = plotData.aligned_seqs[seqName];
            lastPosition = Math.max(lastPosition, plotData.aligned_positions[seqName][alignedScores.length - 1]);
            const trace = {
                x: plotData.aligned_positions[seqName],
                y: alignedScores,
                mode: 'lines',
                name: `${seqName} (${fileName})`,
                type: 'scatter',
                line: {color: colorPalette[seqIndex % colorPalette.length]},
                legendgroup: `${seqName} (${fileName})`,
                legendrank: 4,
                protein: fileName,
                sequence: seqName,
                isMetaProtein: false,
                isMetaSequence: false,
                k: alignedSeq.length - alignedScores.length + 1,
                alignedSeq: alignedSeq,
            };
            traces.push(trace);

            // Highlight the highest values
            const highestVals = plotData.highest_values?.[fileName]?.[seqName];
            if (!highestVals) return;

            const k = alignedSeq.length - alignedScores.length + 1;
            const highlightTrace = {
                x: plotData.aligned_positions[seqName],
                y: highestVals,
                mode: 'markers',
                showlegend: false,  // Hide max score line from legend
                legendgroup: `${seqName} (${fileName})`,
                text: alignedScores.map((_, i) => getKmerSeqFromAlignedSeq(alignedSeq, k, i)), // Tooltip showing sequence segment
                // tooltip should be the text variable
                hovertemplate: "%{text}<extra></extra>",  // Customize hover tooltip
                marker: {color: colorPalette[seqIndex % colorPalette.length], size: 10, symbol: 'circle'},
                protein: fileName,
                sequence: seqName,
                isMetaProtein: false,
                isMetaSequence: false,
                k: k,
                alignedSeq: alignedSeq,
            };
            traces.push(highlightTrace);
        });
        globalLastPosition = Math.max(globalLastPosition, lastPosition);

        const maxScore = plotData.max_scores[fileName];
        const maxScoreLine = {
            x: [0, lastPosition],
            y: [maxScore, maxScore],
            mode: 'lines',
            name: 'Maximal Score',
            showlegend: false,
            line: {dash: 'dash', color: colorPalette[0]},
            protein: fileName,
            isMaxScore: true,
            sequence: null,
        };
        traces.push(maxScoreLine);

        // if more than one protein, add a meta-protein trace
        if (Object.keys(plotData.aligned_scores).length > 1) {
            traces.push({
                x: [null],
                y: [null],
                mode: "lines",
                name: `Protein: ${fileName}`,
                line: {color: colorPalette[0]},
                protein: fileName,
                isMetaProtein: true,
                showlegend: true,
                legendrank: 0,
            });
        }
    });
    // add the horizontal threshold shiny line if exists
    if (plotData.threshold !== undefined && plotData.threshold !== null) {
        traces.push({
            x: [0, globalLastPosition],
            y: [plotData.threshold, plotData.threshold],
            mode: "lines",
            name: 'Threshold',
            line: {dash: 'dot', color: 'red'},
            showlegend: false,
            hovertemplate: `Threshold: ${plotData.threshold}<extra></extra>`,
        });
    }
    // if more than one protein, add a separator trace
    if (Object.keys(plotData.aligned_scores).length > 1) {
        traces.push({
            x: [null],
            y: [null],
            mode: "lines",
            name: "────────────",
            showlegend: true,
            hoverinfo: "skip",
            legendrank: 1,     // place it between ranks
            line: {color: "rgba(0,0,0,0)"}
        });
    }
    // collect sequences that have lines
    const sequencesWithLines = [];
    const sequencesWithMultipleLines = [];
    Object.keys(plotData.aligned_seqs).forEach((seqName) => {
        const numLines = traces.filter(trace => trace.name && trace.sequence === seqName && !trace.isMetaSequence).length;
        if (numLines > 0) {
            sequencesWithLines.push(seqName);
            if (numLines > 1) {
                sequencesWithMultipleLines.push(seqName);
            }
        }
    });
    const shouldShowMetaSequences = sequencesWithLines.length > 1 && sequencesWithMultipleLines.length > 0;
    if (shouldShowMetaSequences) {
        sequencesWithLines.forEach((seqName) => {
            traces.push({
                x: [null],
                y: [null],
                mode: "lines",
                name: `Sequence: ${seqName}`,
                sequence: seqName,
                isMetaSequence: true,
                line: {color: 'black'},
                showlegend: true,
                legendrank: 2,
            });
        });
    }
    // one more for the max-score
    traces.push({
        x: [null],
        y: [null],
        mode: "lines",
        name: `Maximal Score`,
        line: {dash: 'dash', color: 'black'},
        isMaxScore: true,
        isMetaSequence: true,
        sequence: null,
        showlegend: true,
        legendrank: 2,
    });
    traces.push({
        x: [null],
        y: [null],
        mode: "lines",
        name: "────────────",
        showlegend: true,
        hoverinfo: "skip",
        legendrank: 3,     // place it between ranks
        line: {color: "rgba(0,0,0,0)"}
    });
    return [traces, null];
}


function shouldShowByPfams(pfamMap, numSequences) {
    // We want grouping in 2 cases:
    // 1. >1 pfams, >1 files, >1 per pfam
    // 2. >1 seqs, 1 pfam, >1 files, >1 per pfam
    const numPfams = Object.keys(pfamMap).length;
    if (numPfams > 1 || (numSequences > 1 && numPfams <= 1)) {
        const pfamFiles = Object.values(pfamMap);
        return pfamFiles.some(f => f.length > 1) && new Set(pfamFiles.flat()).size > 1;
    }
    return false;
}


export function createBindingSiteTraces(plotData) {
    const bindingSiteTraces = [];
    const colorPalettes = getColorPalettes(); // Get color palettes for consistent coloring
    const yLabels = []; // Store unique y-axis labels

    let pfamMap;
    if (shouldShowByPfams(plotData.pfam_map, Object.keys(plotData.sequence_strs).length)) {
        pfamMap = plotData.pfam_map;
    } else {
        pfamMap = new Map();
        Object.keys(plotData.binding_sites).forEach(fileName => {
            pfamMap[fileName] = [fileName];
        });
        document.querySelector('#toggle-group-pfam-div').classList.remove('show-with-plot');
    }

    const pfamNum = Object.keys(pfamMap).length;
    Object.entries(pfamMap).forEach(([pfamName, fileNames], pfamIndex) => {
        const colorPalette = colorPalettes[(pfamNum - 1 - pfamIndex) % colorPalettes.length];
        for (const fileName of fileNames) {
            const fileBindingSites = plotData.binding_sites[fileName];
            const seqsNum = Object.keys(fileBindingSites).length;
            Object.entries(fileBindingSites).reverse().forEach(([seqName, bindingSites], seqIndex) => {
                const fileYLabel = `${seqName} (${fileName})`;
                // Create the y-axis label
                const pfamYLabel = fileName === pfamName ? undefined
                    : `${seqName} (${pfamName}) [${fileNames.length} file${fileNames.length > 1 ? 's': ''}]`;
                const curYLabel = pfamYLabel || fileYLabel;

                if (!yLabels.includes(curYLabel)) {
                    yLabels.push(curYLabel); // Add label to y-axis categories
                }

                bindingSites.forEach(range => {
                    const [start, end, seq, bsStart, bsEnd, isAdded] = range;
                    const color = isAdded ? `rgba(${hexToRGB(colorPalette[(seqsNum - 1 - seqIndex) % colorPalette.length])}, 0.5)` : 'rgba(211, 211, 211, 0.5)';

                    // Add the binding site trace
                    bindingSiteTraces.push({
                        x: [start, end],
                        y: [curYLabel, curYLabel], // Use categorical label directly
                        mode: 'lines',
                        line: {color: color, width: 10},
                        name: curYLabel,
                        legendgroup: curYLabel,
                        hovertemplate: `${seq} (${bsStart}-${bsEnd})<extra></extra>`, // Tooltip
                        showlegend: false,
                        pfam: pfamYLabel,
                        file: fileYLabel,
                        pfamName: pfamName,
                        fileName: fileName,
                    });
                    // x values are all the integers from start to end
                    const xs = [
                        ...(Number.isInteger(start) ? [] : [start]),
                        ...Array.from({ length: Math.floor(end) - Math.ceil(start) + 1 },(_, i) => Math.ceil(start) + i),
                        ...(Number.isInteger(end) ? [] : [end])
                    ];
                    bindingSiteTraces.push({
                        x: xs,
                        y: Array(xs.length).fill(curYLabel),
                        mode: "markers",
                        marker: {color: color, size: 15, opacity: 0},  // fully invisible
                        hovertemplate: `${seq} (${bsStart}-${bsEnd})<extra></extra>`,
                        showlegend: false,
                        pfam: pfamYLabel,
                        file: fileYLabel,
                        fileName: fileName,
                    });

                    const gaps = plotData.gaps[fileName][seqName];
                    gaps.forEach(gap => {
                        const [gapStart, gapEnd] = gap;
                        bindingSiteTraces.push({
                            x: [gapStart - 0.25, gapEnd + 0.25],
                            y: [curYLabel, curYLabel],
                            mode: 'lines',
                            line: {color: 'rgba(0, 0, 0, 0.5)', width: 6},  // Black color for gaps with transparency
                            showlegend: false,
                            // hoverinfo: 'skip',  // disable hover for gaps
                            hovertemplate: `deletion (${gapStart}-${gapEnd})<extra></extra>`,
                            pfam: pfamYLabel,
                            file: fileYLabel,
                        });
                    });
                    const insertions = plotData.insertions[fileName][seqName];
                    insertions.forEach(insertion => {
                        // add annotation for insertion
                        const [pos, ins] = insertion;
                        bindingSiteTraces.push({
                            x: [pos],
                            y: [curYLabel],
                            mode: 'markers',
                            marker: {symbol: 'triangle-up', size: 10, color: 'rgba(0, 0, 0, 0.5)',},
                            showlegend: false,
                            hovertemplate: `${ins} insertion<extra></extra>`,
                            pfam: pfamYLabel,
                            file: fileYLabel,
                        });
                    });
                });
            });
        }
    });

    return [bindingSiteTraces, yLabels];
}


// Helper function to convert a hex color to RGB
export function hexToRGB(hex) {
    const bigint = parseInt(hex.replace('#', ''), 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `${r}, ${g}, ${b}`;
}


export function getBindlinePlotLayout() {
    return {
        xaxis: {title: {text: 'Position'}},
        yaxis: {title: {text: 'Score'}},
        hovermode: 'closest',
        showlegend: true,
    };
}

export function createAllMutantsTraces(plotData) {
    const nucleotideColors = {"A": "green", "C": "blue", "G": "orange", "T": "red"};
    // Shape mapping for reference nucleotides
    const nucleotideShapes = {"A": "square", "C": "circle", "G": "triangle-up", "T": "diamond"};
    // Prepare traces
    let traces = [];
    let lines = [];

    Object.entries(plotData.mutants_effect).forEach(([position, effects]) => {
        let refNuc = plotData.sequence_strs[plotData.ref_name][position]

        Object.entries(effects).forEach(([nuc, effect]) => {
            // Add scatter point
            traces.push({
                x: [parseInt(position)],
                y: [effect],
                mode: "markers",
                marker: {color: nucleotideColors[nuc], symbol: nucleotideShapes[refNuc], size: 10, alpha: 0.8},
                name: `${nuc} at ${position}`,
                showlegend: false,
                delta: effect,
                wt: plotData.ref_effect[position],
            });

            // Add vertical line to zero
            lines.push({
                x: [parseInt(position), parseInt(position)],
                y: [0, effect],
                mode: "lines",
                line: {color: "black", width: 1, alpha: 0.5},
                showlegend: false,
                hoverinfo: "skip",  // Prevents tooltips from appearing
                hovertemplate: null,  // no tooltip
                delta: effect,
                wt: plotData.ref_effect[position],
            });
        });
    });

    // add the WT curve, hidden by default
    const wtTrace = {
        // plotData.ref_effect length
        x: Array.from({length: plotData.ref_effect.length}, (_, i) => i),
        y: plotData.ref_effect,
        mode: 'lines',
        line: { dash: 'dot', color: 'gray' },
        name: plotData.ref_name,
        visible: 'legendonly',
        showlegend: false,
        isWT: true,
    };

    // add legend of the ref symbols and the colors
    const shapeTraces = Object.keys(nucleotideShapes).map(nucleotide => ({
        x: [null], y: [null], mode: "markers",
        marker: {
            symbol: nucleotideShapes[nucleotide], color: "rgba(0,0,0,0)", opacity: 1, size: 12,
            line: {color: "black", width: 2}
        },
        name: `Ref nucleotide: ${nucleotide}`
    }));
    const colorTraces = Object.keys(nucleotideColors).map(nucleotide => ({
        x: [null], y: [null], mode: "markers",
        marker: {symbol: "circle", color: nucleotideColors[nucleotide], size: 12},
        name: `Mutant nucleotide: ${nucleotide}`
    }));

    // Combine all traces
    const finalTraces = [...lines, ...traces, ...shapeTraces, ...colorTraces, wtTrace];
    return [finalTraces, null];
}

export function getAllMutantsPlotLayout() {
    return {
        xaxis: {title: {text: "Position"}, tickmode: "linear"},
        yaxis: {title: {text: "Effect (ΔScore)"}},
        template: "plotly_white"
    };
}

export function getBindingSitesPlotLayout(yLabels) {
    const baseHeight = 200; // Minimum height for axes and margins when there are no labels
    const labelHeight = 30; // Height allocated per label
    return {
        xaxis: {title: {text: 'Position'}},
        yaxis: {
            type: 'category', // Use categorical y-axis
            categoryarray: yLabels, // Explicitly specify the y-axis order
            categoryorder: 'array' // Preserve the order of `yLabels`
        },
        margin: {
            l: 7 * Math.max(...yLabels.map(label => label.length), 10) // Ensure left margin adjusts based on label length
        },
        hovermode: 'closest',
        showlegend: true,
        height: baseHeight + labelHeight * yLabels.length, // Adjust height based on number of labels
    };
}

function syncPlots(plots) {
    let isSyncing = false;

    // Function to sync all plots to the same x-axis range
    const syncRange = (sourcePlot) => {  // TODO: called too many times
        if (isSyncing) return;
        isSyncing = true;

        try {
            const xRange = sourcePlot.layout.xaxis.range;

            // Update all plots with the same x-axis range
            plots.forEach(plot => {
                console.log(`sync ${sourcePlot.id} -> ${plot.id}`);
                if (plot !== sourcePlot) {
                    Plotly.relayout(plot, {'xaxis.range': xRange})
                        .catch((error) => {
                            console.error(error);
                            showToast('warning', 'Failed to sync plots x-axis', 5000);
                        });
                }
            });
        } catch (error) {
            console.error(error);
            showToast('warning', 'Failed to sync plots x-axis', 5000);
        } finally {
            isSyncing = false;
        }
    };

    // if only one plot, return
    if (plots.length < 2) return;
    isSyncing = true; // avoid syncing on initial plot
    // Attach the same sync handler to all plots
    plots.forEach(plot => {
        plot.on('plotly_afterplot', () => syncRange(plot));
    });
    isSyncing = false;
}


export function getColorPalettes() {
    return [
        ['#1f77b4', '#aec7e8', '#0e42ff', '#3182bd', '#6baed6', '#9ecae1'],
        ['#ff7f0e', '#ffbb78', '#e6550d', '#fd8d3c', '#fdae6b', '#fdd0a2'],
        ['#2ca02c', '#98df8a', '#31a354', '#74c476', '#a1d99b', '#c7e9c0'],
        ['#9467bd', '#c5b0d5', '#756bb1', '#9e9ac8', '#bcbddc', '#dadaeb'],
        ['#d62728', '#ff9896', '#e41a1c', '#fb6a4a', '#fc9272', '#fcbba1'],
        ['#8c564b', '#c49c94', '#8b4513', '#a0522d', '#cd853f', '#deb887'],
        ['#e377c2', '#f7b6d2', '#ff69b4', '#ffb6c1', '#f4a582', '#e78ac3'],
        ['#7f7f7f', '#c7c7c7', '#525252', '#969696', '#bdbdbd', '#d9d9d9'],
    ];
}


let isSettingTicks = {}; // Flag to prevent recursion
let prevRange = {}; // Flag to prevent self-calls
function setXTicks(plotDiv) {
    if (isSettingTicks[plotDiv.id]) return; // Avoid recursive calls
    isSettingTicks[plotDiv.id] = true; // Set the flag to indicate we're inside the function

    // x-axis range of the plot
    let [xStart, xEnd] = plotDiv.layout.xaxis.range;
    if (prevRange[plotDiv.id] && xStart === prevRange[plotDiv.id][0] && xEnd === prevRange[plotDiv.id][1]) {
        isSettingTicks[plotDiv.id] = false; // Reset the flag before returning
        return; // No change in range
    } else {
        prevRange[plotDiv.id] = [xStart, xEnd];
    }
    xStart = Math.max(0, Math.ceil(xStart));
    xEnd = Math.min(plotDiv.sequence_str.length, Math.floor(xEnd + 1));

    if (xEnd - xStart < 200) {
        console.log(`Setting letters to x-axis for ${plotDiv.id}`);
        const annotations = [];
        const sequence = plotDiv.sequence_str.substring(xStart, xEnd);
        for (let i = 0; i < xEnd - xStart; i++) {
            annotations.push({
                x: xStart + i,
                y: 0,
                xref: 'x',
                yref: 'paper',
                yshift: -35,
                text: sequence[i],
                showarrow: false,
                font: {family: 'Courier New, monospace', size: 16, color: 'black'}
            });
        }
        Plotly.relayout(plotDiv, {annotations: annotations})
            .finally(() => {
                isSettingTicks[plotDiv.id] = false; // Reset the flag after relayout is complete
            });
    } else {
        isSettingTicks[plotDiv.id] = false; // Ensure the flag is reset if no relayout happens
    }
}


function getKmerFromAlignedSeq(aligned_seq, k, start = 0) {
    // get substring of length k from aligned_seq, without any gaps
    let kmer = '';
    let length = 0;

    for (let i = start; i < aligned_seq.length && kmer.length < k; i++) {
        length++;
        if (aligned_seq[i] !== '-') {
            kmer += aligned_seq[i].toUpperCase();
        }
    }
    return [kmer, length];
}

function getKmerSeqFromAlignedSeq(aligned_seq, k, start = 0) {
    return getKmerFromAlignedSeq(aligned_seq, k, start)[0];
}

function getKmerLengthFromAlignedSeq(aligned_seq, k, start = 0) {
    return getKmerFromAlignedSeq(aligned_seq, k, start)[1];
}

// Function to toggle slider and input enabled/disabled state using the checkbox
function toggleSliderAndInput(checkboxId, sliderId, inputId) {
    const checkbox = UTILS.getElementByIdOrThrow(checkboxId);
    const label = document.querySelector(`label[for="${checkboxId}"]`);
    const slider = UTILS.getElementByIdOrThrow(sliderId);
    const input = UTILS.getElementByIdOrThrow(inputId);

    checkbox.addEventListener('change', function () {
        const isEnabled = checkbox.checked;
        label.classList.remove(isEnabled ? 'btn-light' : 'btn-secondary');
        label.classList.add(isEnabled ? 'btn-secondary' : 'btn-light');
        slider.disabled = !isEnabled;
        input.disabled = !isEnabled;
    });
}

// Function to synchronize slider and input values
function syncSliderAndInput(sliderId, inputId) {
    const slider = UTILS.getElementByIdOrThrow(sliderId);
    const input = UTILS.getElementByIdOrThrow(inputId);

    slider.addEventListener('input', function () {
        input.value = slider.value; // Update input when slider changes
    });
}

function hideThresholds() {
    // get current file_type radio checked
    const fileType = document.querySelector('input[name="file_type"]:checked').value;
    const scores = ['escore', 'zscore', 'iscore'];

    for (let score in scores) {
        let thresholdDiv = UTILS.getElementByIdOrThrow(`${scores[score]}_threshold`);
        if (fileType === scores[score]) {
            thresholdDiv.style.display = "flex";
        } else {
            thresholdDiv.style.display = "none";
        }
    }
}

let loadingInterval;

function showGlobalLoading() {
    const loadingDiv = document.getElementById("global-loading");
    const loadingDots = document.getElementById("loading-dots");
    if (!loadingDiv || !loadingDots) return;

    loadingDiv.classList.remove("d-none"); // Show loading message
    window.scrollTo({top: 0, behavior: "smooth"}); // Scroll to top smoothly

    let dotCount = 0;

    // Animate the dots every 500ms
    loadingInterval = setInterval(() => {
        dotCount = (dotCount + 1) % 4; // Cycle through 0,1,2,3
        loadingDots.textContent = ".".repeat(dotCount); // Update dots
    }, 500);
}

function hideGlobalLoading() {
    clearInterval(loadingInterval); // Stop animation
    const loadingDiv = document.getElementById("global-loading");
    if (loadingDiv) loadingDiv.classList.add("d-none"); // Hide message
}


function getRadio(name) {
    return document.querySelectorAll(`input[name="${name}"]`);
}


function highlightSequenceOnHover(plot) {
    plot.on('plotly_hover', function (event) {
        const point = event.points[0];
        const xVal = point.x;
        const xIndex = point.data.x.indexOf(xVal);
        // end is the trace kmer points after xVal in point.data.x
        const xEnd = point.data.x[xIndex + getKmerLengthFromAlignedSeq(point.data.alignedSeq, point.data.k, xIndex) - 1];

        Plotly.relayout(plot, {
            shapes: [{
                type: 'rect',
                xref: 'x',
                yref: 'paper',
                x0: xVal,
                x1: xEnd,
                y0: 0,
                y1: 1,
                fillcolor: 'rgba(255, 193, 7, 0.25)',  // yellow highlight
                line: {width: 0}
            }]
        });
    });

    plot.on('plotly_unhover', function () {
        Plotly.relayout(plot, {
            shapes: []   // remove highlight
        });
    });
}


function resizePlotsInTab(tabSelector) {
    const targetPane = document.querySelector(tabSelector);
    targetPane?.querySelectorAll(".js-plotly-plot").forEach(p => {
        Plotly.Plots.resize(p);
    });
}

function manageModeViews() {
    const viewModeRadio = getRadio("view-option");
    const stackedContainer = UTILS.getElementByIdOrThrow("stacked-container");
    const plotTabs = UTILS.getElementByIdOrThrow("plot-tabs");
    const plotStacked = UTILS.getElementByIdOrThrow("plot-stacked");

    const plotDivs = document.querySelectorAll(".plot-container");

    // Initialize with stacked view
    plotDivs.forEach(plotDiv => {
        stackedContainer.appendChild(plotDiv);
    })

    // Handle View Mode Switching
    viewModeRadio.forEach(function (radio) {
        radio.addEventListener("change", function () {
            if (this.id === "view-tabbed") {
                // Move plots to tab content
                plotDivs.forEach(plotDiv => {
                    const tabId = plotDiv.id.replace("-container", "-tab");
                    const tabContent = UTILS.getElementByIdOrThrow(tabId);
                    tabContent.appendChild(plotDiv);
                });
                plotStacked.classList.add("d-none");
                plotTabs.classList.remove("d-none");
            } else if (this.id === 'view-stacked') {
                // Move plots back to stacked view
                plotDivs.forEach(plotDiv => {
                    stackedContainer.appendChild(plotDiv);
                });
                plotTabs.classList.add("d-none");
                plotStacked.classList.remove("d-none");
            }
        });
    });
}

function toggleInfoPopover(containerId, show) {
    const container = UTILS.getElementByIdOrThrow(containerId);
    const infoBtn = container.querySelector('.info-button');
    if (!infoBtn) return;
    // Show icon
    if (show) {
        infoBtn.classList.remove('d-none');
        // Initialize popover once
        if (!infoBtn._popoverInstance) {
            infoBtn._popoverInstance = new bootstrap.Popover(infoBtn, {trigger: 'focus', html: true});
        }
    } else {
        infoBtn.classList.add('d-none');
        // Hide popover if visible
        if (infoBtn._popoverInstance) {
            infoBtn._popoverInstance.hide();
        }
    }
}

function togglePlotRelatedElements(containerId, show) {
    const container = UTILS.getElementByIdOrThrow(containerId);
    const elements = container.querySelector('.show-with-plot');
    if (!elements) return;

    if (show) {
        elements.classList.remove('d-none');
    } else {
        elements.classList.add('d-none');
    }
}

function initTooltips() {
    const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    tooltipTriggerList.map(function (el) {
        return new bootstrap.Tooltip(el);
    });
}

function showCookiesNotice() {
    const notice = UTILS.getElementByIdOrThrow("cookieNotice");
    const okBtn = UTILS.getElementByIdOrThrow("cookieOk");

    if (!localStorage.getItem("cookieNoticeSeen")) {
    notice.style.display = "block";
}

    okBtn.addEventListener("click", () => {
    localStorage.setItem("cookieNoticeSeen", "yes");
    notice.remove();
});
}


function animateAllMutants() {
    const shouldCenterOnWT = isCenteredOnWT();
    const plot = UTILS.getElementByIdOrThrow('all-mutants-plot');

    const newY = plot.data.map(trace => {
        if (trace.delta === undefined) return trace.y;

        const ref = shouldCenterOnWT ? trace.wt : 0;
        if (trace.mode === "lines") {
            return [ref, ref + trace.delta];
        } else {  // markers
            return [ref + trace.delta];
        }
    });

    // Build the frame object correctly
    const frame = {
        data: plot.data.map((trace, i) => ({
            y: newY[i]
        }))
    };

    Plotly.animate(
        plot,
        frame,
        {
            transition: { duration: 500, easing: "cubic-in-out" },
            frame: { duration: 500, redraw: false }
        }
    );

    // show to WT curve if centerOnWT
    const wtIndex = plot.data.findIndex(trace => trace.isWT);
    Plotly.restyle(plot, {visible: shouldCenterOnWT ? true : 'legendonly'}, [wtIndex]);
    // change y axis label
    Plotly.relayout(plot, {
        'yaxis.title.text': shouldCenterOnWT ? 'Score' : 'Effect (ΔScore)'
    });
}


function importLocalFile() {
    // open file dialog
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.zip,.json'; // Acceptable file types
    fileInput.click();
    fileInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) return;
        // if json file (by suffix), handlePlotData(content)
        if (file.name.endsWith('.json')) {
            const reader = new FileReader();
            reader.onload = function(e) {
                try {
                    const content = e.target.result;
                    const plotData = JSON.parse(content);
                    handlePlotData(plotData);
                } catch (error) {
                    handleError(new Error('Failed to parse JSON file.'));
                }
            };
            reader.readAsText(file);
        }
        // if zip file, handlePlotData(content of data.json)
        else if (file.name.endsWith('.zip')) {
            const reader = new FileReader();
            reader.onload = function(e) {
                const arrayBuffer = e.target.result;
                JSZip.loadAsync(arrayBuffer).then(function(zip) {
                    return zip.file("query.json").async("string");
                }).then(function(content) {
                    try {
                        const queryData = JSON.parse(content);
                        importQueryData(queryData);
                    } catch (error) {
                        handleError(new Error('Failed to parse JSON from ZIP file.'));
                    }
                }).catch(function() {
                    handleError(new Error('Failed to read query.json from ZIP file.'));
                });
                JSZip.loadAsync(arrayBuffer).then(function(zip) {
                    return zip.file("data.json").async("string");
                }).then(function(content) {
                    try {
                        const plotData = JSON.parse(content);
                        handlePlotData(plotData);
                    } catch (error) {
                        handleError(new Error('Failed to parse JSON from ZIP file.'));
                    }
                }).catch(function() {
                    handleError(new Error('Failed to read data.json from ZIP file.'));
                });
            };
            reader.readAsArrayBuffer(file);
        } else {
            handleError(new Error('Unsupported file type. Please upload a .json or .zip file.'));
        }
    });
}


function isCenteredOnWT() {
    return UTILS.getElementByIdOrThrow('toggle-wt-center').checked;
}


function arePfamsGrouped() {
    return UTILS.getElementByIdOrThrow('toggle-group-pfam').checked;
}
