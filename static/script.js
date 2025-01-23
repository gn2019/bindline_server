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



// Add a new row to the table with optional name and sequence values
function addSequenceRow(name = '', sequence = '') {
    const sequenceTbody = document.getElementById('sequence-tbody');

    const row = document.createElement('tr');

    // Plot checkbox
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
    row.appendChild(plotCell);

    // Sequence Name input
    const nameCell = document.createElement('td');
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = name;
    nameCell.appendChild(nameInput);
    row.appendChild(nameCell);

    // Sequence input
    const sequenceCell = document.createElement('td');
    const sequenceInput = document.createElement('textarea');
    sequenceInput.rows = 2;
    sequenceInput.cols = 120;
    sequenceInput.value = sequence;
    sequenceCell.appendChild(sequenceInput);
    row.appendChild(sequenceCell);

    // Actions (Delete Row)
    const actionsCell = document.createElement('td');
    const deleteButton = document.createElement('button');
    // trash icon
    deleteButton.innerHTML = '<i class="fas fa-trash"></i>';
    // no background, no border
    deleteButton.style.backgroundColor = 'transparent';
    deleteButton.style.border = 'none';
    deleteButton.addEventListener('click', (event) => {
        event.preventDefault();
        sequenceTbody.removeChild(row);
        if (isRefRow(row)) {
            setFirstAsRef();
        }
    });
    actionsCell.appendChild(deleteButton);

    const setRefButton = document.createElement('button');
    setRefButton.innerText = 'Set as Ref';
    setRefButton.addEventListener('click', (event) => {
        event.preventDefault();
        setAsRef(row);
    });
    actionsCell.appendChild(setRefButton);

    row.appendChild(actionsCell);

    // Append the row to the table body
    sequenceTbody.appendChild(row);

    setFirstAsRef();
}

function uploadAndPlot() {
    const formData = new FormData(document.getElementById('upload-form'));
    const selectedSequences = {};

    // Gather all checked sequences for plotting
    document.querySelectorAll('#sequence-tbody tr').forEach(row => {
        if (isCheckedRow(row)) {
            const name = row.cells[1].querySelector('input').value;
            selectedSequences[name] = row.cells[2].querySelector('textarea').value;
        }
    });

    if (Object.keys(selectedSequences).length === 0) {
        loadSequences();
        return;
    }

    // get refName by row with ref class
    let refRow = document.querySelector('#sequence-tbody tr.ref');
    if (!refRow) {
        // get the first row with checked checkbox
        document.querySelectorAll('#sequence-tbody tr').forEach(row => {
            if (isCheckedRow(row)) {
                refRow = row;
                setAsRefInner(row);
            }
        });
    }
    const refName = refRow.querySelector('input[type="text"]').value;

    // Append selected sequences as JSON
    formData.append('sequences', JSON.stringify(selectedSequences));
    formData.append('ref_name', refName);

    
    // if checkbox is checked show only diff
    const showDiffOnly = document.getElementById('show-diff-only').checked;
    formData.append('show_diff_only', showDiffOnly);

    const searchSignificantMutations = document.getElementById('search-significant-mutations').checked;
    // if true then should be only one sequence
    if (searchSignificantMutations && Object.keys(selectedSequences).length !== 1) {
        alert("Please select only one sequence for searching significant mutations.");
        return;
    }
    formData.append('search_significant_mutations', searchSignificantMutations);

    // if checkbox is checked, don't use E-Score files
    const searchBindingSites = document.getElementById('search-binding-sites').checked;
    formData.append('search_binding_sites', searchBindingSites);
    if (!searchBindingSites) {
        // Gather and append all selected E-Score files
        const existingEscoreSelect = document.getElementById('existing_escore');
        const selectedEscoreFiles = Array.from(existingEscoreSelect.selectedOptions);
        const escoreFile = document.getElementById('e_score').files[0];
        if (!escoreFile && selectedEscoreFiles.length === 0) {
            alert("Please select at least one E-Score file.");
            return;
        }

        selectedEscoreFiles.forEach((option, index) => {
            const file = option.value;
            formData.append(`e_score_${index}`, file);
        });
    }

    // Append the text box values
    const enableRanksThreshold = document.getElementById('enable_ranks_threshold').checked;
    if (enableRanksThreshold) {
        const ranksThreshold = document.getElementById('ranks_threshold_input').value;
        formData.append('ranks_threshold_input', ranksThreshold);
    }
    const enableEScoreThreshold = document.getElementById('enable_escore_threshold').checked;
    if (enableEScoreThreshold) {
        const escoreThreshold = document.getElementById('escore_threshold_input').value;
        formData.append('escore_threshold_input', escoreThreshold);
    }
    const enableZScoreThreshold = document.getElementById('enable_zscore_threshold').checked;
    if (enableZScoreThreshold) {
        const zscoreThreshold = document.getElementById('zscore_threshold_input').value;
        formData.append('zscore_threshold_input', zscoreThreshold);
    }
    const enableIScoreThreshold = document.getElementById('enable_iscore_threshold').checked;
    if (enableIScoreThreshold) {
        const iscoreThreshold = document.getElementById('iscore_threshold_input').value;
        formData.append('iscore_threshold_input', iscoreThreshold);
    }

    // if searchBindingSites or searchSignificantMutations are checked, then at least one of the thresholds should be enabled
    if ((searchBindingSites || searchSignificantMutations) &&
        !enableRanksThreshold && !enableEScoreThreshold && !enableZScoreThreshold && !enableIScoreThreshold) {
        alert("Please enable at least one of the thresholds.");
        return;
    }

    // Fetch call to upload files and plot data
    fetch('/upload', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(plotData => {
        if (plotData.error) {
            alert(plotData.error);
            return;
        }
        console.log(plotData)

        // Clear previous plot data
        const bindlinePlotDiv = document.getElementById('bindline-plot');
        const bindingSitesPlotDiv = document.getElementById('binding-sites-plot');
        const traces = [];
        const bindingSiteTraces = [];

        // Define a palette for each file, using distinct colors
        const fileColorPalettes = [
            ['#1f77b4', '#aec7e8', '#0e42ff', '#3182bd', '#6baed6', '#9ecae1'],
            ['#ff7f0e', '#ffbb78', '#e6550d', '#fd8d3c', '#fdae6b', '#fdd0a2'],
            ['#2ca02c', '#98df8a', '#31a354', '#74c476', '#a1d99b', '#c7e9c0'],
            ['#9467bd', '#c5b0d5', '#756bb1', '#9e9ac8', '#bcbddc', '#dadaeb'],
            ['#d62728', '#ff9896', '#e41a1c', '#fb6a4a', '#fc9272', '#fcbba1'],
            ['#8c564b', '#c49c94', '#8b4513', '#a0522d', '#cd853f', '#deb887'],
            ['#e377c2', '#f7b6d2', '#ff69b4', '#ffb6c1', '#f4a582', '#e78ac3'],
            ['#7f7f7f', '#c7c7c7', '#525252', '#969696', '#bdbdbd', '#d9d9d9'],
        ];
        let fileIndex = 0;
        let segmentY = 1;  // Initial y-position for stacking

        // Loop through each E-Score file and sequence
        for (const [fileName, fileScores] of Object.entries(plotData.aligned_scores)) {
            const colorPalette = fileColorPalettes[fileIndex % fileColorPalettes.length];
            let seqIndex = 0;

            for (const [seqName, alignedScores] of Object.entries(fileScores)) {
                // Create a trace for each sequence in each file
                const trace = {
                    x: Array.from({ length: alignedScores.length }, (_, i) => i),
                    y: alignedScores,
                    mode: 'lines',
                    name: `${seqName} (${fileName})`,
                    legendgroup: `${seqName} (${fileName})`,
                    type: 'scatter',
                    line: { color: colorPalette[seqIndex % colorPalette.length] }
                };
                traces.push(trace);

                // Highlight the highest values
                const highestVals = plotData.highest_values[fileName]?.[seqName];
                const sequence_str = plotData.sequence_strs[plotData.ref_name];
                // k is the difference between the length of alignedScores and sequence_str
                const alignedSeq = plotData.aligned_seqs[seqName];
                const k = alignedSeq.length - alignedScores.length + 1;
                if (highestVals) {
                    const highlightTrace = {
                        x: Array.from({ length: alignedScores.length }, (_, i) => i),
                        y: highestVals,
                        mode: 'markers',
                        showlegend: false,  // Hide max score line from legend
                        legendgroup: `${seqName} (${fileName})`,
                        text: alignedScores.map((_, i) => getKmerSeqFromAlignedSeq(alignedSeq, k, i)), // Tooltip showing sequence segment, TODO: 8 is hardcoded
                        // tooltip should be the text variable
                        hovertemplate: "%{text}<extra></extra>",  // Customize hover tooltip
                        marker: { color: colorPalette[seqIndex % colorPalette.length], size: 10, symbol: 'circle' }
                    };
                    traces.push(highlightTrace);
                }

                const bindingSites = plotData.binding_sites[fileName]?.[seqName];
                const groupedRanges = splitRanges(bindingSites);
                groupedRanges.forEach(group => {
                    group.forEach(range => {
                        const isFirst = range === group[0];
                        const [start, end, seq, isAdded] = range;
                        let line_design;
                            if (!isAdded) {
                                line_design = { color: '#D3D3D3' , width: 20, dash: 'dash', opacity: 0.9 };
                            } else {
                                line_design = { color: colorPalette[seqIndex % colorPalette.length], width: 20 };
                            }
                        const bindingSite = {
                            x: [start, end],
                            y: [segmentY, segmentY],  // Stack segments vertically with unique y-positions
                            mode: 'lines',
                            line: line_design,
                            showlegend: isFirst,
                            name: `${seqName} (${fileName})`,
                            legendgroup: `Binding Sites ${seqName} (${fileName})`,
                            // sequence in the segment, substring of the aligned sequence from start to end
                            hovertemplate: `${seq} (${start}-${end})<extra></extra>`,  // Customize hover tooltip
                        };
                        bindingSiteTraces.push(bindingSite);
                        let gaps = get_gaps(seq);
                        gaps.forEach(gap => {
                            const gapLine = {
                                x: [start + gap[0] - 0.25, start + gap[1] + 0.25],
                                y: [segmentY, segmentY],  // Stack segments vertically with unique y-positions
                                mode: 'lines',
                                line: { color: 'black', width: 10 },
                                name: `${seqName} ${start}-${end} Gap ${gap[0]}-${gap[1]} (${fileName})`,
                                legendgroup: `Binding Sites ${seqName} (${fileName})`,
                                showlegend: false,
                            };
                            bindingSiteTraces.push(gapLine);
                        });
                    });
                    segmentY += 1;
                });
                segmentY += 2;  // Add padding between sequences
                seqIndex++;
            }

            // Add max score line for each file
            const maxScore = plotData.max_scores[fileName];
            const maxScoreLine = {
                x: [0, Math.max(...Object.values(fileScores).map(s => s.length))],
                y: [maxScore, maxScore],
                mode: 'lines',
                name: `Max Score (${fileName})`,
                line: { dash: 'dash', color: colorPalette[0] }
            };
            traces.push(maxScoreLine);

            fileIndex++;
        }

        // Plot all traces
        Plotly.newPlot(bindlinePlotDiv, traces, {
            xaxis: {
                title: 'Position'
            },
            yaxis: {
                title: 'Score'
            },
            hovermode: 'closest', // Tooltips only show when cursor is near a point
            showlegend: true
        });
        // Plot binding sites
        Plotly.newPlot(bindingSitesPlotDiv, bindingSiteTraces, {
            xaxis: {
                title: 'Position'
            },
            yaxis: {
                title: 'Binding Site'
            },
            hovermode: 'closest', // Tooltips only show when cursor is near a point
            showlegend: true
        });

        const set_x_ticks = eventData => {
            set_x_ticks_inner(eventData, bindlinePlotDiv);
            set_x_ticks_inner(eventData, bindingSitesPlotDiv);
        }

        for (let plotDiv of [bindlinePlotDiv, bindingSitesPlotDiv]) {
            plotDiv.sequence_str = plotData.sequence_strs[plotData.ref_name];
            // Zoom event handling
            // plotDiv.on('plotly_afterplot', set_x_ticks);
        }
        set_x_ticks(null);

        let isSyncing = false;
        const syncPlots = (sourcePlot, targetPlot) => {
            sourcePlot.on('plotly_afterplot', () => {
                // avoid infinite recursion
                if (isSyncing) return; // Avoid recursion if already syncing
                isSyncing = true; // Set the flag

                // Sync the x-axis range between plots
                Plotly.relayout(targetPlot, {'xaxis.range': sourcePlot.layout.xaxis.range})
                .then(() => {
                    isSyncing = false; // Reset the flag after relayout is complete
                })
                .catch(() => {
                    isSyncing = false; // Reset the flag in case of an error
                });
            })
        };
        syncPlots(bindlinePlotDiv, bindingSitesPlotDiv);
        syncPlots(bindingSitesPlotDiv, bindlinePlotDiv);
    })
    .catch(error => {
        //log stacktrace
        console.log(error);
        console.error('Error:', error);
    });
}

function get_gaps(aligned_seq) {
    let gaps = [];
    let start = -1;
    let end = -1;
    for (let i = 0; i < aligned_seq.length; i++) {
        if (aligned_seq[i] === '-') {
            if (start === -1) {
                start = i;
            }
            end = i;
        } else {
            if (start !== -1) {
                gaps.push([start, end]);
                start = -1;
                end = -1;
            }
        }
    }
    return gaps;
}

function set_x_ticks_inner(eventData, plotDiv) {
    const xStart = eventData == null ? 0 : Math.ceil(eventData['xaxis.range[0]']);
    const xRange = eventData == null ? plotDiv.sequence_str.length : eventData['xaxis.range[1]'] - eventData['xaxis.range[0]'] + 1;
    if (xRange < 200) {
        const annotations = [];
        const sequence = plotDiv.sequence_str.substring(xStart, xStart + xRange);
        for (let i = 0; i < xRange; i++) {
            annotations.push({
                x: xStart + i,
                y: -0.15,
                xref: 'x',
                yref: 'paper',
                text: sequence[i],
                showarrow: false,
                font: {
                    family: 'Courier New, monospace',
                    size: 16,
                    color: 'black'
                }
            });
        }
        Plotly.relayout(plotDiv, {annotations: annotations});
    }
}

function splitRanges(ranges) { //TODO: indices, k) {
    // Convert indices to ranges (i.e., (index, index + k - 1)) along with the left limit (index)
    // const ranges = indices.map(index => [index, index + k - 1]);
    //
    // // Sort ranges by their starting value
    // ranges.sort((a, b) => a[0] - b[0]);
    // Initialize groups array
    let groups = [];
    console.log(ranges)
    // Iterate through each range and place it in the first non-colliding group
    ranges.forEach(range => {
        let placed = false;
        for (let group of groups) {
            // Check if the range collides with any range in the current group
            const collides = group.some(existingRange =>
                (range[0] <= existingRange[1] && range[1] >= existingRange[0])
            );
            if (!collides) {
                group.push(range);
                placed = true;
                break;
            }
        }

        // If no group is found, create a new group
        if (!placed) {
            groups.push([range]);
        }
    });
    return groups;
}

function getAlignedSeq(seq, aligned_scores) {
    let cur = seq.length - aligned_scores.length + 1;
    let aligned_seq = seq.substring(0, cur);
    for (let i = 0; i < aligned_scores.length - 1; i++) {
        if (aligned_scores[i] !== null) {
            aligned_seq += seq[cur];
            cur++;
        } else {
            aligned_seq += '-';
        }
    }
    return aligned_seq;
}

function getKmerFromAlignedSeq(aligned_seq, k, start = 0) {
    // get substring of length k from aligned_seq, without any gaps
    let kmer = '';
    let length = 0;
    let count = 0;
    for (let i = start; i < aligned_seq.length; i++) {
        length++;
        if (aligned_seq[i] !== '-') {
            kmer += aligned_seq[i];
            count++;
            if (count === k) {
                break;
            }
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


// Call this function on page load to initialize file lists
loadExistingFiles();
document.getElementById('load-sequences').addEventListener('click', () => loadSequences());
document.getElementById('add-sequence-row').addEventListener('click', () => addSequenceRow());
// Handle uploading and plotting data from multiple E-Score files
document.getElementById('upload-and-plot').addEventListener('click', () => uploadAndPlot());

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

// apply hideThresholds on page load and on change of radio buttons
hideThresholds();
document.querySelectorAll('input[name="file_type"]').forEach(radio => {
    radio.addEventListener('change', hideThresholds);
});

// Apply functionality to both sliders and inputs
toggleSliderAndInput('enable_escore_threshold', 'escore_threshold_slider', 'escore_threshold_input');
toggleSliderAndInput('enable_zscore_threshold', 'zscore_threshold_slider', 'zscore_threshold_input');
toggleSliderAndInput('enable_iscore_threshold', 'iscore_threshold_slider', 'iscore_threshold_input');
toggleSliderAndInput('enable_ranks_threshold', 'ranks_threshold_slider', 'ranks_threshold_input');

syncSliderAndInput('escore_threshold_slider', 'escore_threshold_input');
syncSliderAndInput('zscore_threshold_slider', 'zscore_threshold_input');
syncSliderAndInput('iscore_threshold_slider', 'iscore_threshold_input');
syncSliderAndInput('ranks_threshold_slider', 'ranks_threshold_input');
