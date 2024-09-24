// Load existing E-Score files into dropdown and enable multiple selection
function loadExistingFiles() {
    fetch('/list-files/escore')
        .then(response => response.json())
        .then(files => {
            const escoreDropdown = document.getElementById('existing_escore');
            escoreDropdown.innerHTML = ''; // Clear previous options
            files.forEach(file => {
                const option = document.createElement('option');
                option.value = file;
                option.textContent = file;
                escoreDropdown.appendChild(option);
            });
        });

    fetch('/list-files/fasta')
        .then(response => response.json())
        .then(files => {
            const fastaDropdown = document.getElementById('existing_fasta');
            fastaDropdown.innerHTML = ''; // Clear previous options
            files.forEach(file => {
                const option = document.createElement('option');
                option.value = file;
                option.textContent = file;
                fastaDropdown.appendChild(option);
            });
        });
}

// Call this function on page load to initialize file lists
loadExistingFiles();

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

document.getElementById('load-sequences').addEventListener('click', loadSequences);

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

// Handle uploading and plotting data from multiple E-Score files
document.getElementById('upload-and-plot').addEventListener('click', () => {
    const formData = new FormData(document.getElementById('upload-form'));
    const selectedSequences = {};

    // Gather all checked sequences for plotting
    document.querySelectorAll('#sequence-tbody tr').forEach(row => {
        const plotCheckbox = row.querySelector('input[type="checkbox"]');
        if (plotCheckbox.checked) {
            const name = row.cells[1].querySelector('input').value;
            const sequence = row.cells[2].querySelector('textarea').value;
            selectedSequences[name] = sequence;
        }
    });

    if (Object.keys(selectedSequences).length === 0) {
        loadSequences();
        return;
    }

    // Append selected sequences as JSON
    formData.append('sequences', JSON.stringify(selectedSequences));

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
            ['#1f77b4', '#aec7e8', '#0e42ff', '#3182bd', '#6baed6', '#9ecae1'], // Palette for File 1
            ['#ff7f0e', '#ffbb78', '#e6550d', '#fd8d3c', '#fdae6b', '#fdd0a2'], // Palette for File 2
            ['#2ca02c', '#98df8a', '#31a354', '#74c476', '#a1d99b', '#c7e9c0']  // Palette for File 3
            ['#9467bd', '#c5b0d5', '#756bb1', '#9e9ac8', '#bcbddc', '#dadaeb'], // Palette for File 4
            ['#d62728', '#ff9896', '#e41a1c', '#fb6a4a', '#fc9272', '#fcbba1'], // Palette for File 5
            ['#8c564b', '#c49c94', '#8b4513', '#a0522d', '#cd853f', '#deb887'], // Palette for File 6
            ['#e377c2', '#f7b6d2', '#ff69b4', '#ffb6c1', '#f4a582', '#e78ac3'], // Palette for File 7
            ['#7f7f7f', '#c7c7c7', '#525252', '#969696', '#bdbdbd', '#d9d9d9'], // Palette for File 8
            // Add more palettes as needed
        ];
        let fileIndex = 0;

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
                    name: `${seqName} (${fileName})`,  // Include file name in trace label
                    type: 'scatter',
                    line: { color: colorPalette[seqIndex % colorPalette.length] }  // Use distinct color from palette
                };
                traces.push(trace);
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
            // title: 'Sequence Alignment Scores',
            xaxis: {
                title: 'Position'
            },
            yaxis: {
                title: 'Score'
            },
            showlegend: true
        });

        // Zoom event handling
        const set_x_ticks = function(eventData) {
            const xStart = eventData == null ? 0 : Math.ceil(eventData['xaxis.range[0]']);
            const xRange = eventData == null ? plotData.sequence_str.length : eventData['xaxis.range[1]'] - eventData['xaxis.range[0]'] + 1;
            if (xRange < 200) {
                const annotations = [];
                const sequence = plotData.sequence_str.substring(xStart, xStart + xRange);
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
                Plotly.relayout(plotDiv, { annotations: annotations });
            }
        }

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
        console.error('Error:', error);
    });
});

document.getElementById('add-sequence-row').addEventListener('click', () => {
    addSequenceRow();
});
