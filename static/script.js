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

function loadSequences() {
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

    fetch('/sequences', {
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

function uploadAndPlot() {
    const formData = new FormData(document.getElementById('upload-form'));
    const selectedSequences = gatherSelectedSequences();
    if (Object.keys(selectedSequences).length === 0) {
        loadSequences();
        return;
    }

    const refName = getReferenceName();
    if (!refName) return;

    try {
        appendSequencesAndOptions(formData, selectedSequences, refName);
    } catch (error) {
        alert(error);
        return;
    }
    if (!validateConditions(selectedSequences)) return;

    fetch('/upload', { method: 'POST', body: formData })
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
    let refRow = getRefRow()
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
function handlePlotData(plotData) {
    if (plotData.error) {
        alert(plotData.error);
        return;
    }

    const bindlinePlotDiv = document.getElementById('bindline-plot');
    const bindingSitesPlotDiv = document.getElementById('binding-sites-plot');
    const traces = createTraces(plotData);
    const [bindingSiteTraces, yLabels] = createBindingSiteTraces(plotData);

    // Render plots
    Plotly.newPlot(bindlinePlotDiv, traces, getBindlinePlotLayout());
    Plotly.newPlot(bindingSitesPlotDiv, bindingSiteTraces, getBindingSitesPlotLayout(yLabels));

    syncPlots(bindlinePlotDiv, bindingSitesPlotDiv);

    for (let plotDiv of [bindlinePlotDiv, bindingSitesPlotDiv]) {
        plotDiv.sequence_str = plotData.sequence_strs[plotData.ref_name];
        plotDiv.on('plotly_afterplot', eventData => set_x_ticks(plotDiv));
    }
}

/** Handle and log errors */
function handleError(error) {
    console.error('Error:', error);
}

/** Create traces for bindline plot */
function createTraces(plotData) {
    const traces = [];
    const colorPalettes = getColorPalettes();

    Object.entries(plotData.aligned_scores).forEach(([fileName, fileScores], fileIndex) => {
        const colorPalette = colorPalettes[fileIndex % colorPalettes.length];

        Object.entries(fileScores).forEach(([seqName, alignedScores], seqIndex) => {
            const trace = {
                x: Array.from({length: alignedScores.length}, (_, i) => i),
                y: alignedScores,
                mode: 'lines',
                name: `${seqName} (${fileName})`,
                legendgroup: `${seqName} (${fileName})`,
                type: 'scatter',
                line: {color: colorPalette[seqIndex % colorPalette.length]}
            };
            traces.push(trace);

            // Highlight the highest values
            const highestVals = plotData.highest_values[fileName]?.[seqName];
            if (!highestVals) return;

            const alignedSeq = plotData.aligned_seqs[seqName];
            const k = alignedSeq.length - alignedScores.length + 1;
            const highlightTrace = {
                x: Array.from({length: alignedScores.length}, (_, i) => i),
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
    return traces;
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
                const [start, end, seq, isAdded] = range;

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
                    hovertemplate: `${seq} (${start}-${end})<extra></extra>`, // Tooltip
                    showlegend: false // Show the legend only for the first trace of a file/sequence
                });

                // Add gaps in the range
                get_gaps(seq).forEach(gap => {
                    bindingSiteTraces.push({
                        x: [start + gap[0] - 0.25, start + gap[1] + 0.25],
                        y: [yLabel, yLabel],
                        mode: 'lines',
                        line: {
                            color: 'rgba(0, 0, 0, 0.5)', // Black color for gaps with transparency
                            width: 6
                        },
                        showlegend: false
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

function syncPlots(plot1, plot2) {
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
            kmer += aligned_seq[i];
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