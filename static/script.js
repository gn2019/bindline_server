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

// Add a new row to the table with optional name and sequence values
function addSequenceRow(name = '', sequence = '') {
    const sequenceTbody = document.getElementById('sequence-tbody');

    const row = document.createElement('tr');

    // Plot checkbox
    const plotCell = document.createElement('td');
    const plotCheckbox = document.createElement('input');
    plotCheckbox.type = 'checkbox';
    plotCheckbox.checked = true; // Default to checked
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
    deleteButton.textContent = 'Delete';
    deleteButton.addEventListener('click', () => {
        sequenceTbody.removeChild(row);
    });
    actionsCell.appendChild(deleteButton);
    row.appendChild(actionsCell);

    // Append the row to the table body
    sequenceTbody.appendChild(row);
}

function uploadAndPlot() {
    const formData = new FormData(document.getElementById('upload-form'));
    const selectedSequences = {};

    // Gather all checked sequences for plotting
    document.querySelectorAll('#sequence-tbody tr').forEach(row => {
        const plotCheckbox = row.querySelector('input[type="checkbox"]');
        if (plotCheckbox.checked) {
            const name = row.cells[1].querySelector('input').value;
            selectedSequences[name] = row.cells[2].querySelector('textarea').value;
        }
    });

    if (Object.keys(selectedSequences).length === 0) {
        loadSequences();
        return;
    }

    // Append selected sequences as JSON
    formData.append('sequences', JSON.stringify(selectedSequences));

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

        // Clear previous plot data
        const plotDiv = document.getElementById('plot');
        plotDiv.innerHTML = '';
        const traces = [];

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
                    type: 'scatter',
                    line: { color: colorPalette[seqIndex % colorPalette.length] }
                };
                traces.push(trace);

                // Highlight the highest values
                const highestVals = plotData.highest_values[fileName]?.[seqName];
                const sequence_str = plotData.sequence_strs[plotData.ref_name];
                // k is the difference between the length of alignedScores and sequence_str
                const k = sequence_str.length - alignedScores.length + 1;
                const alignedSeq = getAlignedSeq(plotData.sequence_strs[seqName], alignedScores);
                if (highestVals) {
                    const highlightTrace = {
                        x: Array.from({ length: alignedScores.length }, (_, i) => i),
                        y: highestVals,
                        mode: 'markers',
                        showlegend: false,  // Hide max score line from legend
                        text: alignedScores.map((_, i) => getKmerSeqFromAlignedSeq(alignedSeq, k, i)), // Tooltip showing sequence segment, TODO: 8 is hardcoded
                        hovertemplate: "%{text}<extra></extra>",  // Customize hover tooltip
                        marker: { color: colorPalette[seqIndex % colorPalette.length], size: 10, symbol: 'circle' }
                    };
                    traces.push(highlightTrace);
                }

                // Add short horizontal lines for non-None values in highest_values
                const highestValuesExp = plotData.highest_values[fileName];

                let highestValues = highestValuesExp?.[seqName];
                // get not null indexes
                const highestValuesIdx = highestValues.map((value, index) => value !== null ? index : null).filter(index => index !== null);
                const groupedRanges = splitRanges(highestValuesIdx, k);
                groupedRanges.forEach(group => {
                    group.forEach(index => {
                        const [kmerSeq, kmerLength] = getKmerFromAlignedSeq(alignedSeq, k, index);
                        const highestValueSegment = {
                            x: [index - 0.25, index + kmerLength - 0.75],
                            y: [segmentY, segmentY],  // Stack segments vertically with unique y-positions
                            mode: 'lines',
                            line: { color: colorPalette[seqIndex % colorPalette.length], width: 20 },
                            showlegend: true,
                            name: `Binding Site ${index}-${index + kmerLength - 1} ${seqName} (${fileName})`,
                            // hover all the sequence in the segment
                            text: Array.from({ length: k }, (_, i) => kmerSeq
                                + " (" + index.toString() + "-" + (index + kmerLength - 1).toString() + ")"), // Tooltip showing sequence segment
                            hovertemplate: "%{text}<extra></extra>",  // Customize hover tooltip
                            visible: false  // Start hidden for toggle functionality
                        };
                        traces.push(highestValueSegment);
                        // wherever the aligned seq is '-' add a gap
                        alignedSeq.split('').forEach((char, i) => {
                            if (char === '-' && i >= index && i < index + kmerLength) {
                                const gap = {
                                    x: [i - 0.25, i + 0.25],
                                    y: [segmentY, segmentY],  // Stack segments vertically with unique y-positions
                                    mode: 'lines',
                                    line: { color: 'black', width: 10 },
                                    name: `Binding Site ${index} Gap ${seqName} (${fileName})`,
                                    hovertemplate: "<extra></extra>",  // Customize hover tooltip
                                    showlegend: false,
                                    visible: false  // Start hidden for toggle functionality
                                };
                                traces.push(gap);
                            }
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
        Plotly.newPlot(plotDiv, traces, {
            xaxis: {
                title: 'Position'
            },
            yaxis: {
                title: 'Score'
            },
            showlegend: true
        });

        plotDiv.sequence_str = plotData.sequence_strs[plotData.ref_name];

        // Zoom event handling
        const set_x_ticks = eventData => set_x_ticks_inner(eventData, plotDiv);

        plotDiv.on('plotly_relayout', set_x_ticks);
        plotDiv.on('plotly_doubleclick', set_x_ticks);
        plotDiv.on('plotly_autosize', set_x_ticks);
        // General event listener on the document to capture pointer events
        document.addEventListener('click', function(eventData) {
            // Get the parent button element
            const button = eventData.target.closest('.modebar-btn');
            if (button) {
                // Get the tooltip text or class attribute to identify the button type
                const buttonType = button.getAttribute('data-title') || button.getAttribute('class');
                if (buttonType.includes('Reset axes') || buttonType.includes('Autoscale')) {
                    set_x_ticks(null);
                }
            }
        }, true);
        set_x_ticks(null);
    })
    .catch(error => {
        //log stacktrace
        console.log(error);
        console.error('Error:', error);
    });
}

function toggleView() {
    const plotDiv = document.getElementById('plot');
    const traces = plotDiv.data;
    const showHighestOnly = traces.some(trace => trace.visible === true && trace.name && trace.name.startsWith('Binding Site'));

    traces.forEach(trace => {
        if (trace.name && trace.name.startsWith('Binding Site')) {
            trace.visible = !showHighestOnly;  // Toggle visibility of highest values
        } else {
            trace.visible = showHighestOnly;  // Toggle visibility of scores
        }
    });
    // Capture the current x-axis range before updating
    const currentXRange = Plotly.d3.select('#plot').node().layout.xaxis.range;
    const visibleYValues = [];
    traces.forEach(trace => {
        if (trace.visible) {
            trace.x.forEach((xValue, index) => {
                if (xValue >= currentXRange[0] && xValue <= currentXRange[1]) {
                    visibleYValues.push(trace.y[index]);
                }
            });
        }
    });
    // Calculate the min and max of visible y-values to set y-axis range
    const minY = Math.min(...visibleYValues);
    const maxY = Math.max(...visibleYValues);

    // Update the plot with the same x-axis range
    Plotly.react(plotDiv, traces, {
        xaxis: { title: 'Position', range: currentXRange },  // Use the current x-axis range
        yaxis: { visible: showHighestOnly, range: showHighestOnly ? [] : [minY - 1, maxY + 1] }
    });
    set_x_ticks_inner(null, plotDiv);
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

function splitRanges(indices, k) {
    // Convert indices to ranges (i.e., (index, index + k - 1)) along with the left limit (index)
    const ranges = indices.map(index => [index, index + k - 1]);

    // Sort ranges by their starting value
    ranges.sort((a, b) => a[0] - b[0]);

    // Initialize groups array
    let groups = [];

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

    // Include the left limit (start index) in each group
    return groups.map(group => group.map(range => range[0]));
}

function getAlignedSeq(seq, aligned_scores) {
    let cur = seq.length - aligned_scores.length + 1;
    let aligned_seq = seq.substring(0, cur);
    for (let i = 0; i < aligned_scores.length; i++) {
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
document.getElementById('toggle-view').addEventListener('click', () => toggleView());
// Handle uploading and plotting data from multiple E-Score files
document.getElementById('upload-and-plot').addEventListener('click', () => uploadAndPlot());
