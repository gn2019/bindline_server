// Load existing E-Score files into dropdown and enable searchable multi-selection
function loadExistingFiles() {
    fetch('/list-files/escore')
        .then(response => response.json())
        .then(files => {
            const escoreDropdown = $('#existing_escore'); // Use jQuery selector for Select2
            escoreDropdown.empty(); // Clear previous options

            // Populate options
            files.forEach(file => {
                escoreDropdown.append(new Option(file, file, false, false));
            });

            // Initialize Select2 for searchable dropdown
            escoreDropdown.select2({
                placeholder: "Select E-Score files",
                allowClear: true
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

async function loadSequences() {
    const fastaFile = document.getElementById('fasta').files[0];
    const existingFastaSelect = document.getElementById('existing_fasta');

    let formData = new FormData();
    if (fastaFile) {
        formData.append('fasta', fastaFile);
    } else if (existingFastaSelect.value) {
        formData.append('existing_fasta', existingFastaSelect.value);
    } else {
        alert("Please select a FASTA file first.");
        return;
    }

    await fetch('/sequences', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            alert(data.error);
            return;
        }

        const sequenceTbody = document.getElementById('sequence-tbody');
        sequenceTbody.innerHTML = ''; // Clear previous rows

        Object.keys(data.sequences).forEach(seqName => {
            addSequenceRow(seqName, data.sequences[seqName]);
        });
    })
    .catch(error => {
        console.error('Error:', error);
    });
}

function setAsRef(row) {
    if (!isCheckedRow(row)) {
        return;
    }
    // remove ref class from other rows
    document.querySelectorAll('#sequence-tbody tr').forEach(row => {
        unsetAsRefInner(row);
    });
    setAsRefInner(row);
}

function getFirstCheckedRow() {
    const rows = document.querySelectorAll('#sequence-tbody tr');
    for (let row of rows) {
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
    if (row) { setAsRef(row) }
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
    sequenceInput.cols = 120;
    sequenceInput.value = value;
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
    // if no rows of sequences, load them
    if (!$('#sequence-tbody tr').length) {
        await loadSequences();
        await new Promise(requestAnimationFrame); // Wait for the UI to update
        console.log('loaded');
    }
    let selectedSequences = gatherSelectedSequences();
    if (Object.keys(selectedSequences).length === 0) {
        alert('Please select at least one sequence.');
        hideGlobalLoading();
        return;
    }

    const refName = getReferenceName(); // Now this will run after sequences are loaded
    if (!refName) return;

    try {
        appendSequencesAndOptions(formData, selectedSequences, refName);
    } catch (error) {
        alert(error);
        return;
    }
    if (!validateConditions(selectedSequences)) return;
    formData.forEach((value, key) => console.log(key, value));


    await fetch('/upload', { method: 'POST', body: formData })
        .then(response => response.json())
        .then(plotData => handlePlotData(plotData))
        .catch(handleError);
}


/** Helper function to gather all selected sequences */
function gatherSelectedSequences() {
    const selectedSequences = {};
    document.querySelectorAll('#sequence-tbody tr').forEach(row => {
        if (isCheckedRow(row)) {
            const name = row.cells[1].querySelector('input').value;
            selectedSequences[name] = row.cells[2].querySelector('textarea').value;
        }
    });
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
        alert('No reference sequence selected.');
        return null;
    }
    return refRow.querySelector('input[type="text"]').value;
}

/** Append sequences, options, and thresholds to formData */
function appendSequencesAndOptions(formData, selectedSequences, refName) {
    formData.append('sequences', JSON.stringify(selectedSequences));
    formData.append('ref_name', refName);
    formData.append('show_diff_only', document.getElementById('show-diff-only').checked);
    formData.append('search_significant_mutations', document.getElementById('search-significant-mutations').checked);
    formData.append('search_binding_sites', document.getElementById('search-binding-sites').checked);

    appendThresholds(formData);
    appendEScoreFiles(formData);
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

/** Append selected E-Score files to formData */
function appendEScoreFiles(formData) {
    const searchBindingSites = document.getElementById('search-binding-sites').checked;
    if (!searchBindingSites) {
        const selectedFiles = Array.from(document.getElementById('existing_escore').selectedOptions).map(option => option.value);
        const uploadedFile = document.getElementById('e_score').files[0];

        if (!uploadedFile && selectedFiles.length === 0) {
            throw new Error('Please select at least one E-Score file.');
        }

        selectedFiles.forEach((file, index) => formData.append(`e_score_${index}`, file));
    }
}

/** Validate preconditions and alert user if conditions are not met */
function validateConditions(selectedSequences) {
    const searchSignificantMutations = document.getElementById('search-significant-mutations').checked;
    if (searchSignificantMutations && Object.keys(selectedSequences).length !== 1) {
        alert('Please select only one sequence for searching significant mutations.');
        return false;
    }

    const thresholdsEnabled = [
        'enable_ranks_threshold',
        'enable_escore_threshold',
        'enable_zscore_threshold',
        'enable_iscore_threshold'
    ].some(id => document.getElementById(id).checked);

    if ((searchSignificantMutations || document.getElementById('search-binding-sites').checked) && !thresholdsEnabled) {
        alert('Please enable at least one threshold.');
        return false;
    }

    return true;
}


/** Handle plot data and render plots */
async function handlePlotData(plotData) {
    hideGlobalLoading();

    if (plotData.error) {
        alert(plotData.error);
        return;
    }
    console.log(plotData); // TODO: remove

    const plotComponents = {
        bindline: { id: 'bindline-plot', traceFunc: createTraces, layoutFunc: getBindlinePlotLayout },
        bindingSites: { id: 'binding-sites-plot', checkFunc: plotData => plotData.binding_sites, traceFunc: createBindingSiteTraces, layoutFunc: getBindingSitesPlotLayout },
        allMutants: { id: 'all-mutants-plot', checkFunc: plotData => plotData.mutants_effect, traceFunc: createAllMutantsTraces, layoutFunc: getAllMutantsPlotLayout }
    };
    // leave only the plots that are checked
    for (const [key, component] of Object.entries(plotComponents)) {
        const tabNavigation = document.getElementById(component.id.replace('-plot', '-tab-nav'));
        if (component.checkFunc && !component.checkFunc(plotData)) {
            delete plotComponents[key];
            tabNavigation.style.display = 'none';
        } else {
            tabNavigation.style.display = 'block';
        }
    }


    function toggleLoading(divId, show) {
        const spinner = document.getElementById(`${divId}-loading`);
        console.log(spinner, spinner.id, show, spinner.style.display);
        if (spinner) {
            spinner.style.display = show ? 'block' : 'none';
        }
    }

    function plotComponent(component) {
        const div = document.getElementById(component.id);
        div.innerHTML = '';
        toggleLoading(component.id, true); // Show spinner

        // Use setTimeout to break out of the current execution cycle and allow UI to refresh
        setTimeout(async () => {
            const [traces, metadata] = component.traceFunc(plotData);
            const layout = component.layoutFunc(metadata);

            await Plotly.newPlot(div, traces, layout);

            toggleLoading(component.id, false); // Hide spinner

            div.sequence_str = plotData.sequence_strs[plotData.ref_name];
            div.on('plotly_afterplot', () => set_x_ticks(div));

            component.div = div;
            component.traces = traces;
            component.metadata = metadata;
            component.layout = layout;
        }, 0);
    }

    // Run all plots asynchronously without blocking UI updates
    Object.values(plotComponents).forEach(plotComponent);

    // Since plotting is now separate, syncing should run after a slight delay
    setTimeout(() => {
        syncPlots(Object.values(plotComponents).map(component => component.div));
    }, 500);
}


/** Handle and log errors */
function handleError(error) {
    hideGlobalLoading();
    console.error('Error:', error);
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
                legendgroup: `${seqName} (${fileName})`,
                type: 'scatter',
                line: {color: colorPalette[seqIndex % colorPalette.length]}
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
                text: alignedScores.map((_, i) => getKmerSeqFromAlignedSeq(alignedSeq, k, i)), // Tooltip showing sequence segment, TODO: 8 is hardcoded
                // tooltip should be the text variable
                hovertemplate: "%{text}<extra></extra>",  // Customize hover tooltip
                marker: {color: colorPalette[seqIndex % colorPalette.length], size: 10, symbol: 'circle'}
            };
            traces.push(highlightTrace);
        });

        const maxScore = plotData.max_scores[fileName];
        const maxScoreLine = {
            x: [0, Math.max(...Object.values(fileScores).map(s => s.length))],
            y: [maxScore, maxScore],
            mode: 'lines',
            name: `Max Score (${fileName})`,
            line: { dash: 'dash', color: colorPalette[0] }
        };
        traces.push(maxScoreLine);
    });
    return [traces, null];
}

function createBindingSiteTraces(plotData) {
    const bindingSiteTraces = [];
    const colorPalettes = getColorPalettes(); // Get color palettes for consistent coloring
    const yLabels = []; // Store unique y-axis labels

    Object.entries(plotData.binding_sites).forEach(([fileName, fileBindingSites], fileIndex) => {
        const colorPalette = colorPalettes[fileIndex % colorPalettes.length];

        Object.entries(fileBindingSites).forEach(([seqName, bindingSites], seqIndex) => {
            const yLabel = `${seqName} (${fileName})`; // Create the y-axis label
            if (!yLabels.includes(yLabel)) {
                yLabels.push(yLabel); // Add label to y-axis categories
            }

            bindingSites.forEach(range => {
                const [start, end, seq, bsStart, bsEnd, isAdded] = range;

                // Add the binding site trace
                bindingSiteTraces.push({
                    x: [start, end],
                    y: [yLabel, yLabel], // Use categorical label directly
                    mode: 'lines',
                    line: {
                        color: isAdded ? `rgba(${hexToRGB(colorPalette[seqIndex % colorPalette.length])}, 0.5)` : 'rgba(211, 211, 211, 0.5)',
                        width: 10
                    },
                    name: yLabel,
                    legendgroup: yLabel,
                    hovertemplate: `${seq} (${bsStart}-${bsEnd})<extra></extra>`, // Tooltip
                    showlegend: false // Show the legend only for the first trace of a file/sequence
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
                        // disable hover for gaps
                        hoverinfo: 'skip'
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
                        hovertemplate: `${ins}<extra></extra>`,
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
        xaxis: { title: 'Position' },
        yaxis: { title: 'Score' },
        hovermode: 'closest',
        showlegend: true,
    };
}

function createAllMutantsTraces(plotData) {
    const nucleotideColors = { "A": "green", "C": "blue", "G": "orange", "T": "red" };
    // Shape mapping for reference nucleotides
    const nucleotideShapes = { "A": "square", "C": "circle", "G": "triangle-up", "T": "diamond" };
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
                marker: { color: nucleotideColors[nuc], symbol: nucleotideShapes[refNuc], size: 4, alpha: 0.8 },
                name: `${nuc} at ${position}`,
                showlegend: false,
            });

            // Add vertical line to zero
            lines.push({
                x: [parseInt(position), parseInt(position)],
                y: [0, effect],
                mode: "lines",
                line: { color: "black", width: 1, alpha: 0.5 },
                showlegend: false,
                hoverinfo: "skip",  // Prevents tooltips from appearing
                hovertemplate: null,  // no tooltip
            });
        });
    });

    // add legend of the ref symbols and the colors
    const shapeTraces = Object.keys(nucleotideShapes).map(nucleotide => ({
        x: [null], y: [null], mode: "markers",
        marker: { symbol: nucleotideShapes[nucleotide], color: "rgba(0,0,0,0)", opacity: 1, size: 12,
                  line: { color: "black", width: 2 }},
        name: `Ref nucleotide: ${nucleotide}`
    }));
    const colorTraces = Object.keys(nucleotideColors).map(nucleotide => ({
        x: [null], y: [null], mode: "markers",
        marker: { symbol: "circle", color: nucleotideColors[nucleotide], size: 12 },
        name: `Mutant nucleotide: ${nucleotide}`
    }));

    // Combine all traces
    const finalTraces = [...lines, ...traces, ...shapeTraces, ...colorTraces];
    return [finalTraces, null];
}

function getAllMutantsPlotLayout() {
    const layout = {
        xaxis: { title: "Position", tickmode: "linear" },
        yaxis: { title: "Effect (ΔScore)" },
        template: "plotly_white"
    };
    return layout;
    return {
        xaxis: { title: 'Position' },
        yaxis: { title: 'Score' },
        hovermode: 'closest',
        showlegend: true,
    };
}

function getBindingSitesPlotLayout(yLabels) {
    const baseHeight = 300; // Minimum height for axes and margins when there are no labels
    const labelHeight = 30; // Height allocated per label
    return {
        xaxis: { title: 'Position' },
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
        // TODO: makes problems with the annotations
        // height: baseHeight + labelHeight * yLabels.length, // Adjust height based on number of labels
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
                    Plotly.relayout(plot, { 'xaxis.range': xRange })
                        .catch(error => {
                            console.error(`Error syncing plot ${plot.id}:`, error);
                        });
                }
            });
        } catch (error) {
            console.error('Error during syncing process:', error);
        } finally {
            isSyncing = false;
        }
    };

    // Attach the same sync handler to all plots
    plots.forEach(plot => {
        plot.on('plotly_afterplot', () => syncRange(plot));
    });
}



function syncPlofts(plot1, plot2) {  // TODO: remove
    let isSyncing = false;
    plot1.on('plotly_afterplot', eventData => {
        if (isSyncing) return;
        isSyncing = true;
        console.log('syncing bindline->bindingSites');
        Plotly.relayout(plot2, {'xaxis.range': plot1.layout.xaxis.range})
            .finally(() => isSyncing = false);
    });
    plot2.on('plotly_afterplot', eventData => {
        if (isSyncing) return;
        isSyncing = true;
        console.log('syncing bindingSites->bindline');
        Plotly.relayout(plot1, {'xaxis.range': plot2.layout.xaxis.range})
            .finally(() => isSyncing = false);
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
function set_x_ticks(plotDiv) {
    if (isSettingTicks[plotDiv.id]) return; // Avoid recursive calls
    isSettingTicks[plotDiv.id] = true; // Set the flag to indicate we're inside the function

    // x-axis range of the plot
    let [xStart, xEnd] = plotDiv.layout.xaxis.range;
    xStart = Math.max(0, Math.ceil(xStart));
    xEnd = Math.min(plotDiv.sequence_str.length, Math.floor(xEnd + 1));

    if (xEnd - xStart < 200) {
        console.log(`Setting letters to x-axis for ${plotDiv.id}`)
        const annotations = [];
        const sequence = plotDiv.sequence_str.substring(xStart, xEnd);
        for (let i = 0; i < xEnd - xStart; i++) {
            annotations.push({
                x: xStart + i,
                y: -0.15,
                xref: 'x',
                yref: 'paper',
                text: sequence[i],
                showarrow: false,
                font: { family: 'Courier New, monospace', size: 16, color: 'black' }
            });
        }
        Plotly.relayout(plotDiv, { annotations: annotations })
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
    const slider = document.getElementById(sliderId);
    const input = document.getElementById(inputId);

    checkbox.addEventListener('change', function () {
        const isEnabled = checkbox.checked;
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

    loadingDiv.style.display = "block"; // Show loading message
    window.scrollTo({ top: 0, behavior: "smooth" }); // Scroll to top smoothly

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
    if (loadingDiv) loadingDiv.style.display = "none"; // Hide message
}


document.addEventListener("DOMContentLoaded", function () {
    const viewModeRadio = document.querySelectorAll('input[name="view-option"]');
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
                plotStacked.style.display = "none";
                plotTabs.style.display = "block";
            } else if (this.id === 'view-stacked') {
                // Move plots back to stacked view
                plotDivs.forEach(plotDiv => {
                    stackedContainer.appendChild(plotDiv);
                });
                plotTabs.style.display = "none";
                plotStacked.style.display = "block";
            }
        });
    });
});


// Call this function on page load to initialize file lists
loadExistingFiles();
document.getElementById('load-sequences').addEventListener('click', () => loadSequences());
document.getElementById('add-sequence-row').addEventListener('click', () => addSequenceRow());
// Handle uploading and plotting data from multiple E-Score files
document.getElementById('upload-and-plot').addEventListener('click', () => uploadAndPlot());

// apply hideThresholds on page load and on change of radio buttons
hideThresholds();
document.querySelectorAll('input[name="file_type"]').forEach(radio => {
    radio.addEventListener('change', hideThresholds);
});

// Apply functionality to both sliders and inputs
for (let threshold of ['escore', 'zscore', 'iscore', 'ranks']) {
    toggleSliderAndInput(`enable_${threshold}_threshold`, `${threshold}_threshold_slider`, `${threshold}_threshold_input`);
    syncSliderAndInput(`${threshold}_threshold_slider`, `${threshold}_threshold_input`);
}

async function updloadAndPlot() {
    showGlobalLoading(); // Show loading animation before request

    const formData = new FormData(document.getElementById('upload-form'));
    formData.append('sequences', JSON.stringify({
        "WT":"AAAGCTGCTCTCAGTTTTTCAAGTCACACACACACACACACACACACACTCACACACACGGGTGGGGGAGTGTCTGTCATGGACACAGCTGTGTCAGTGTGGTTGCTCAGAGATCTGAGTTGCTCTAGCACTAGGTGCAGTTTATTTCACAGCCCTAAAGAGATTTACGGCTGTTTTTTCTTCATTGGGGCCAAACATGGGGCCTGATAGGGAGGGCGTTGCACCAAAGGCAACAGAGACTACCATGAAAGTCCCTACAAACCTAACCTGAGCAGAGGACTGAAGAATGCAGAAAGGGACACTCAGGTAACAGACCATGGGACATAACAGCCATCTGTTGCTGGCCTTGGGTCTGATAAGGTCTCAGGGGCTGAAGGTGTAGGTTCAAAACACCTGGATCTTCGGAGCTCTGAGAGTACTTCATGCTATCACCACAAGCAAGGGGTCAGTTTTCTGCATGTCCTTGCTTGTCATGTGCCTAGGAATCCCACAGCCAGCTCATCCACTAAGCAGGGATAAGTTGACTCTGGGGCACCTGGAGGACCTGTTCTAGACCTCCACGTCCTAGCTCCGTTATTTCCATCACCTGCAGGATTGCACACTGTCACCCCCCCCCCAACACCCCCAGACGACGCGTCTTGCGTCTCAGGGGCACACCACTGGCTTCTGTGTCGCCCACTCCTCTCCACTCCCCACAGGCTCATCCGGACGATCCACGTGCAGCTCGACCGGGGGTTGGCGCCGCACCTCGAGCCCGGCGCGTCTGGCCGGAGCTTTCTGGGGACCCGAACCCCCCAACCCCCGCGAGAGGGCGGCATCTGGCGACCGCGGGTCGGGCAGGGGGGCGTCCTAAAGTCCCCTGCGGTGCAGAGACGTTGCGGCCGGCTGCCACACAAAGGCGGCGGCGGGAAGGCGGGGCGGGGCGGGCCGGGGGGCGGGGGAGGCAGGAAGGGGCGGGGGCGGCGGCGGCGATAAAGCCCCCGCGCGGCCCGGCCGGCTA",
    }));
    formData.append('ref_name', "WT");
    formData.append('file_type', 'zscore');
    formData.append('show_diff_only', 'false');
    formData.append('search_significant_mutations', 'true');
    formData.append('search_binding_sites', 'false');
    formData.append('ranks_threshold_input', '99');
    formData.append('e_score_0', "IRF1_Normalized_7mers_1111111.txt");
    formData.forEach((value, key) => console.log(key, value));

    await fetch('/upload', { method: 'POST', body: formData })
        .then(response => response.json())
        .then(plotData => handlePlotData(plotData))
        .catch(handleError);
}


// uploadAndPlot();