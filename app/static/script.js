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
            const fastaDropdown = document.getElementById('existing_fasta');
            fastaDropdown.innerHTML = ''; // Clear previous options
            files.forEach(file => {
                fastaDropdown.append(new Option(file, file, false, false));
            });
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
        const fastaFile = document.getElementById('fasta').files[0];
        if (!fastaFile) {
            throw new Error("Please upload a DNA FASTA file first.");
        }
        formData.append('fasta', fastaFile);
    } else if (fastaSource === 'fasta-existing') {
        const existingFastaSelect = document.getElementById('existing_fasta');
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

            const sequenceTbody = document.getElementById('sequence-tbody');
            sequenceTbody.innerHTML = ''; // Clear previous rows

            Object.keys(data.sequences).forEach(seqName => {
                addSequenceRow(seqName, data.sequences[seqName]);
            });
        })
        .catch(handleError);
}

function getSequenceRows() {
    return document.querySelectorAll('#sequence-tbody tr');
}

function setAsRef(row) {
    if (!isCheckedRow(row)) {
        return;
    }
    // remove ref class from other rows
    getSequenceRows().forEach(row => {
        unsetAsRefInner(row);
    });
    setAsRefInner(row);
}

function getFirstCheckedRow() {
    for (let row of getSequenceRows()) {
        if (isCheckedRow(row)) {
            return row;
        }
    }
}

function getRefRow() {
    return document.querySelector('#sequence-tbody tr.ref');
}

function setFirstAsRef() {
    const row = getFirstCheckedRow();
    if (row) {
        setAsRef(row)
    }
}

function isRefRow(row) {
    return row.classList.contains('ref');
}

function isCheckedRow(row) {
    return row.querySelector('input[type="checkbox"]').checked;
}

function setAsRefInner(row) {
    row.classList.add('ref');
}

function unsetAsRefInner(row) {
    row.classList.remove('ref');
}

function createCheckboxTd(row) {
    const plotCell = document.createElement('td');
    const plotCheckbox = document.createElement('input');
    plotCheckbox.type = 'checkbox';
    plotCheckbox.checked = true; // Default to checked
    // when pressed, if is unchecked and is ref, find the first row with checked checkbox and set it as ref
    plotCheckbox.addEventListener('click', (event) => {
        if (!isCheckedRow(row) && isRefRow(row)) {
            setFirstAsRef();
        }
    });
    plotCell.appendChild(plotCheckbox);
    return plotCell;
}

function createInputTd(value) {
    const cell = document.createElement('td');
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value;
    cell.appendChild(input);
    return cell;
}

function createTextAreaTd(value) {
    const cell = document.createElement('td');
    const sequenceInput = document.createElement('textarea');
    sequenceInput.rows = 2;
    sequenceInput.value = value;

    // responsive behavior
    sequenceInput.style.width = '100%';
    sequenceInput.style.resize = 'vertical';
    sequenceInput.style.boxSizing = 'border-box';

    cell.appendChild(sequenceInput);
    return cell;
}

function createActionsTd(row) {
    const cell = document.createElement('td');

    const deleteButton = document.createElement('button');
    deleteButton.innerHTML = '<i class="fas fa-trash"></i>';
    deleteButton.style.backgroundColor = 'transparent';
    deleteButton.style.border = 'none';
    deleteButton.addEventListener('click', (event) => {
        event.preventDefault();
        document.getElementById('sequence-tbody').removeChild(row);
        if (isRefRow(row)) {
            setFirstAsRef();
        }
    });
    cell.appendChild(deleteButton);

    const setRefButton = document.createElement('button');
    setRefButton.className = 'set-ref-button';
    setRefButton.innerText = 'Set as Ref';
    setRefButton.addEventListener('click', (event) => {
        event.preventDefault();
        setAsRef(row);
    });
    cell.appendChild(setRefButton);

    return cell;
}

// Add a new row to the table with optional name and sequence values
function addSequenceRow(name = '', sequence = '') {
    const row = document.createElement('tr');
    row.appendChild(createCheckboxTd(row));
    row.appendChild(createInputTd(name));
    row.appendChild(createTextAreaTd(sequence));
    row.appendChild(createActionsTd(row));

    const sequenceTbody = document.getElementById('sequence-tbody');
    sequenceTbody.appendChild(row);
    // if no ref, set first as ref
    if (!getRefRow()) {
        setFirstAsRef();
    }
}

async function uploadAndPlot() {
    showGlobalLoading(); // Show loading animation before request

    const formData = new FormData(document.getElementById('upload-form'));
    try {
        // if no rows of sequences, load them
        if (!$('#sequence-tbody tr').length) {
            await loadSequences();
            await new Promise(requestAnimationFrame); // Wait for the UI to update
        }
        let selectedSequences = gatherSelectedSequences();
        const refName = getReferenceName(); // Now this will run after sequences are loaded

        appendSequencesAndOptions(formData, selectedSequences, refName);
        validateConditions(formData, selectedSequences);
    } catch (error) {
        handleError(error)
        return;
    }
    formData.forEach((value, key) => console.log(key, value));


    await fetch('/upload', {method: 'POST', body: formData})
        .then(response => response.json())
        .then(plotData => handlePlotData(plotData))
        .catch(handleError);
}


/** Helper function to gather all selected sequences */
function gatherSelectedSequences() {
    const selectedSequences = {};
    getSequenceRows().forEach(row => {
        if (isCheckedRow(row)) {
            const name = row.cells[1].querySelector('input').value;
            selectedSequences[name] = row.cells[2].querySelector('textarea').value;
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
    formData.append('show_diff_only', document.getElementById('show-diff-only').checked);
    formData.append('search_significant_mutations', document.getElementById('search-significant-mutations').checked);

    appendThresholds(formData);
    appendScoreFiles(formData);
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
        if (document.getElementById(checkboxId).checked) {
            formData.append(inputId, document.getElementById(inputId).value);
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
        const selectedFiles = Array.from(document.getElementById('existing_score').selectedOptions).map(option => option.value);
        if (selectedFiles.length === 0) {
            throw new Error('Please select at least one protein score file.');
        }
        selectedFiles.forEach((file, index) => formData.append(`score_${index}`, file));
        formData.delete("score");  // remove the uploaded file entry
        return;
    }
    if (scoreSource === 'score-upload') {
        const uploadedFile = document.getElementById('score').files;
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
    ].some(id => document.getElementById(id).checked);

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
                handleLegendClick(component.div);
                highlightSequenceOnHover(component.div);
            }
        },
        bindingSites: {
            id: 'binding-sites-plot',
            checkFunc: plotData => plotData.binding_sites,
            traceFunc: createBindingSiteTraces,
            layoutFunc: getBindingSitesPlotLayout
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
        const tabNavigation = document.getElementById(component.id.replace('-plot', '-tab-nav'));
        if (component.checkFunc && !component.checkFunc(plotData)) {
            document.getElementById(component.id).innerHTML = '';  // remove plot
            delete plotComponents[key];
            tabNavigation.classList.add('d-none');
        } else {
            tabNavigation.classList.remove('d-none');
        }
    }


    function toggleLoading(divId, show) {
        const spinner = document.getElementById(`${divId}-loading`);
        if (spinner) {
            spinner.style.display = show ? 'block' : 'none';
        }
    }

    function plotComponent(component) {
        const div = document.getElementById(component.id);
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

    // Since plotting is now separate, syncing should run after a slight delay
    setTimeout(() => {
        syncPlots(Object.values(plotComponents).map(component => component.div));
    }, 500);
}

function handleLegendClick(plotDiv) {
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
    showToast('error', error.message);
    console.error(error);
}


/** Create traces for bindline plot */
function createTraces(plotData) {
    const traces = [];
    const colorPalettes = getColorPalettes();

    Object.entries(plotData.aligned_scores).forEach(([fileName, fileScores], fileIndex) => {
        const colorPalette = colorPalettes[fileIndex % colorPalettes.length];

        Object.entries(fileScores).forEach(([seqName, alignedScores], seqIndex) => {
            const alignedSeq = plotData.aligned_seqs[seqName];
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
                k: k,
                alignedSeq: alignedSeq,
            };
            traces.push(highlightTrace);
        });

        const maxScore = plotData.max_scores[fileName];
        const maxScoreLine = {
            x: [0, Math.max(...Object.values(fileScores).map(s => s.length))],
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
            x: [0, Math.max(...Object.values(plotData.aligned_positions).flat())],
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
    Object.keys(plotData.aligned_seqs).forEach((seqName) => {
        if (traces.some(trace => trace.sequence === seqName && !trace.isMetaSequence)) {
            sequencesWithLines.push(seqName);
        }
    });
    if (sequencesWithLines.length > 1) {
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

function createBindingSiteTraces(plotData) {
    const bindingSiteTraces = [];
    const colorPalettes = getColorPalettes(); // Get color palettes for consistent coloring
    const yLabels = []; // Store unique y-axis labels

    const scoreFilesNum = Object.keys(plotData.binding_sites).length;
    Object.entries(plotData.binding_sites).reverse().forEach(([fileName, fileBindingSites], fileIndex) => {
        const colorPalette = colorPalettes[(scoreFilesNum - 1 - fileIndex) % colorPalettes.length];
        const seqsNum = Object.keys(fileBindingSites).length;
        Object.entries(fileBindingSites).reverse().forEach(([seqName, bindingSites], seqIndex) => {
            const yLabel = `${seqName} (${fileName})`; // Create the y-axis label
            if (!yLabels.includes(yLabel)) {
                yLabels.push(yLabel); // Add label to y-axis categories
            }

            bindingSites.forEach(range => {
                const [start, end, seq, bsStart, bsEnd, isAdded] = range;
                const color = isAdded ? `rgba(${hexToRGB(colorPalette[(seqsNum - 1 - seqIndex) % colorPalette.length])}, 0.5)` : 'rgba(211, 211, 211, 0.5)';

                // Add the binding site trace
                bindingSiteTraces.push({
                    x: [start, end],
                    y: [yLabel, yLabel], // Use categorical label directly
                    mode: 'lines',
                    line: {
                        color: color,
                        width: 10
                    },
                    name: yLabel,
                    legendgroup: yLabel,
                    hovertemplate: `${seq} (${bsStart}-${bsEnd})<extra></extra>`, // Tooltip
                    showlegend: false // Show the legend only for the first trace of a file/sequence
                });
                // x values are all the integers from start to end
                const xs = [
                    ...(Number.isInteger(start) ? [] : [start]),
                    ...Array.from({ length: Math.floor(end) - Math.ceil(start) + 1 },(_, i) => Math.ceil(start) + i),
                    ...(Number.isInteger(end) ? [] : [end])
                ];
                bindingSiteTraces.push({
                    x: xs,
                    y: Array(xs.length).fill(yLabel),
                    mode: "markers",
                    marker: {
                        color: color,
                        size: 15,
                        opacity: 0   // fully invisible
                    },
                    hovertemplate: `${seq} (${bsStart}-${bsEnd})<extra></extra>`,
                    showlegend: false
                });

                const gaps = plotData.gaps[fileName][seqName];
                gaps.forEach(gap => {
                    const [gapStart, gapEnd] = gap;
                    bindingSiteTraces.push({
                        x: [gapStart - 0.25, gapEnd + 0.25],
                        y: [yLabel, yLabel],
                        mode: 'lines',
                        line: {
                            color: 'rgba(0, 0, 0, 0.5)', // Black color for gaps with transparency
                            width: 6
                        },
                        showlegend: false,
                        // hoverinfo: 'skip',  // disable hover for gaps
                        hovertemplate: `deletion (${gapStart}-${gapEnd})<extra></extra>`,
                    });
                });

                const insertions = plotData.insertions[fileName][seqName];
                insertions.forEach(insertion => {
                    // add annotation for insertion
                    const [pos, ins] = insertion;
                    bindingSiteTraces.push({
                        x: [pos],
                        y: [yLabel],
                        mode: 'markers',
                        marker: {
                            symbol: 'triangle-up',
                            size: 10,
                            color: 'rgba(0, 0, 0, 0.5)',
                        },
                        showlegend: false,
                        hovertemplate: `${ins} insertion<extra></extra>`,
                    });
                });
            });
        });
    });

    return [bindingSiteTraces, yLabels];
}

// Helper function to convert a hex color to RGB
function hexToRGB(hex) {
    const bigint = parseInt(hex.replace('#', ''), 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `${r}, ${g}, ${b}`;
}


function getBindlinePlotLayout() {
    return {
        xaxis: {title: {text: 'Position'}},
        yaxis: {title: {text: 'Score'}},
        hovermode: 'closest',
        showlegend: true,
    };
}

function createAllMutantsTraces(plotData) {
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

function getAllMutantsPlotLayout() {
    const layout = {
        xaxis: {title: {text: "Position"}, tickmode: "linear"},
        yaxis: {title: {text: "Effect (ΔScore)"}},
        template: "plotly_white"
    };
    return layout;
    return {
        xaxis: {title: {text: 'Position'}},
        yaxis: {title: {text: 'Score'}},
        hovermode: 'closest',
        showlegend: true,
    };
}

function getBindingSitesPlotLayout(yLabels) {
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
    // Attach the same sync handler to all plots
    plots.forEach(plot => {
        plot.on('plotly_afterplot', () => syncRange(plot));
    });
}


function getColorPalettes() {
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

function get_gaps(aligned_seq) {
    const gaps = [];
    let start = -1;

    for (let i = 0; i <= aligned_seq.length; i++) {
        if (aligned_seq[i] === '-') {
            if (start === -1) start = i;
        } else if (start !== -1) {
            gaps.push([start, i - 1]);
            start = -1;
        }
    }
    return gaps;
}

let isSettingTicks = {}; // Flag to prevent recursion
let prevRange = [0, 0]; // Flag to prevent self-calls
function setXTicks(plotDiv) {
    if (isSettingTicks[plotDiv.id]) return; // Avoid recursive calls
    isSettingTicks[plotDiv.id] = true; // Set the flag to indicate we're inside the function

    // x-axis range of the plot
    let [xStart, xEnd] = plotDiv.layout.xaxis.range;
    if (xStart === prevRange[0] && xEnd === prevRange[1]) {
        isSettingTicks[plotDiv.id] = false; // Reset the flag before returning
        return; // No change in range
    } else {
        prevRange[0] = xStart;
        prevRange[1] = xEnd;
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

function splitRanges(ranges) {
    const groups = [];
    for (const range of ranges) {
        let placed = false;
        for (const group of groups) {
            if (!group.some(([start, end]) => range[0] <= end && range[1] >= start)) {
                group.push(range);
                placed = true;
                break;
            }
        }
        if (!placed) groups.push([range]);
    }
    return groups;
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
    const checkbox = document.getElementById(checkboxId);
    const label = document.querySelector(`label[for="${checkboxId}"]`);
    const slider = document.getElementById(sliderId);
    const input = document.getElementById(inputId);

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
    const slider = document.getElementById(sliderId);
    const input = document.getElementById(inputId);

    slider.addEventListener('input', function () {
        input.value = slider.value; // Update input when slider changes
    });
}

function hideThresholds() {
    // get current file_type radio checked
    const fileType = document.querySelector('input[name="file_type"]:checked').value;
    const scores = ['escore', 'zscore', 'iscore'];

    for (let score in scores) {
        let thresholdDiv = document.getElementById(`${scores[score]}_threshold`);
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
    const stackedContainer = document.getElementById("stacked-container");
    const plotTabs = document.getElementById("plot-tabs");
    const plotStacked = document.getElementById("plot-stacked");

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
                    const tabContent = document.getElementById(tabId);
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
    const container = document.getElementById(containerId);
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
    const container = document.getElementById(containerId);
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
    const notice = document.getElementById("cookieNotice");
    const okBtn = document.getElementById("cookieOk");

    if (!localStorage.getItem("cookieNoticeSeen")) {
    notice.style.display = "block";
}

    okBtn.addEventListener("click", () => {
    localStorage.setItem("cookieNoticeSeen", "yes");
    notice.remove();
});
}


function animateAllMutants(centerOnWT) {
    const plot = document.getElementById('all-mutants-plot');

    const newY = plot.data.map(trace => {
        if (trace.delta === undefined) return trace.y;

        const ref = centerOnWT ? trace.wt : 0;
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
    Plotly.restyle(plot, {visible: centerOnWT ? true : 'legendonly'}, [wtIndex]);
    // change y axis label
    Plotly.relayout(plot, {
        'yaxis.title.text': centerOnWT ? 'Score' : 'Effect (ΔScore)'
    });
}

let isCenteredOnWT = false;
document.getElementById('toggle-wt-center')
    .addEventListener('change', () => {
        isCenteredOnWT = !isCenteredOnWT;
        animateAllMutants(isCenteredOnWT);
    });

// Call this function on page load to initialize file lists
loadExistingFiles();
document.getElementById('load-sequences').addEventListener('click', loadSequences);
document.getElementById('add-sequence-row').addEventListener('click', () => addSequenceRow(name = `seq_${Math.floor(Math.random() * 99999999)}`));
// Handle uploading and plotting data from multiple E-Score files
document.getElementById('upload-and-plot').addEventListener('click', uploadAndPlot);
// Manage tab change
document.addEventListener("DOMContentLoaded", manageModeViews);
// Show cookies notice
document.addEventListener("DOMContentLoaded", showCookiesNotice);
// Verify the plots take the right width when tab is changed
document.addEventListener("shown.bs.tab", e => resizePlotsInTab(e.target.hash));

// apply hideThresholds on page load and on change of radio buttons
hideThresholds();
// show tooltips where defined
initTooltips();
getRadio("file_type").forEach(radio => {
    radio.addEventListener('change', hideThresholds);
});

// Apply functionality to both sliders and inputs
for (let threshold of ['escore', 'zscore', 'iscore', 'ranks']) {
    toggleSliderAndInput(`enable_${threshold}_threshold`, `${threshold}_threshold_slider`, `${threshold}_threshold_input`);
    syncSliderAndInput(`${threshold}_threshold_slider`, `${threshold}_threshold_input`);
}
