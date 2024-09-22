// Load existing E-Score files into dropdown
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
    let fastaFile;
    const existingFastaSelect = document.getElementById('existing_fasta');

    if (existingFastaSelect.value) {
        // Use the selected existing FASTA file
        fastaFile = existingFastaSelect.value;
    } else {
        // Use the uploaded file
        fastaFile = document.getElementById('fasta').files[0];
        if (!fastaFile) {
            alert("Please select a FASTA file first.");
            return;
        }
    }

    let formData = new FormData();
    if (existingFastaSelect.value) {
        formData.append('existing_fasta', existingFastaSelect.value);
    } else {
        formData.append('fasta', fastaFile);
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
    // type of big box with multiple lines
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

    plotCheckbox.addEventListener('change', function (event) {
        const plotDiv = document.getElementById('plot');
        const sequenceName = nameInput.value;
        const traceIndex = plotDiv.data.findIndex(trace => trace.name === sequenceName);
        if (traceIndex === -1) {
            return;
        }
        const currentVisibility = plotDiv.data[traceIndex].visible;
        Plotly.restyle(plotDiv, { visible: !currentVisibility }, [traceIndex]);
    });
}

// Event listener for adding a new row
document.getElementById('add-sequence-row').addEventListener('click', function () {
    addSequenceRow();
});

// Event listener for uploading and plotting sequences
document.getElementById('upload-and-plot').addEventListener('click', function () {
    const eScoreFile = document.getElementById('e_score').files[0] || document.getElementById('existing_escore').value;
    const fileType = document.querySelector('input[name="file_type"]:checked').value;
    let sequenceRows = document.getElementById('sequence-tbody').querySelectorAll('tr');
    let sequencesData = {};

    // if no sequenceRows, call load sequences button, and then upload and plot without another action needed
    if (sequenceRows.length === 0) {
        loadSequences();
        return;
    }

    sequenceRows.forEach(row => {
        const plotCheckbox = row.querySelector('input[type="checkbox"]');
        const nameInput = row.querySelector('td:nth-child(2) input');
        const sequenceInput = row.querySelector('td:nth-child(3) textarea');

        if (plotCheckbox.checked) { // Only include sequences marked for plotting
            sequencesData[nameInput.value] = sequenceInput.value;
        }
    });

    let formData = new FormData();
    formData.append('e_score', eScoreFile);
    formData.append('file_type', fileType);
    formData.append('sequences', JSON.stringify(sequencesData));

    fetch('/upload', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            alert(data.error);
            return;
        }

        // Prepare data for plotting
        const plotData = [];
        const colors = ['blue', 'green', 'red', 'purple', 'orange'];
        let colorIndex = 0;

        Object.keys(data.aligned_scores).forEach((name) => {
            const scores = data.aligned_scores[name];
            const trace = {
                x: Array.from(Array(scores.length).keys()),
                y: scores,
                mode: 'lines',
                line: {
                    color: colors[colorIndex % colors.length]
                },
                name: name,
                visible: true
            };
            plotData.push(trace);
            colorIndex++;
        });

        const maxScoreTrace = {
            x: [0, data.sequence_str.length],
            y: [data.max_score, data.max_score],
            type: 'scatter',
            mode: 'lines',
            line: { dash: 'dash', color: 'red' },
            name: 'Max Score',
            visible: false
        };

        plotData.push(maxScoreTrace);

        Plotly.newPlot('plot', plotData, {
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
            const xRange = eventData == null ? data.sequence_str.length : eventData['xaxis.range[1]'] - eventData['xaxis.range[0]'] + 1;
            if (xRange < 200) {
                const annotations = [];
                const sequence = data.sequence_str.substring(xStart, xStart + xRange);
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

        const plotDiv = document.getElementById('plot');
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

document.getElementById('add-line').addEventListener('click', function () {
    const plotDiv = document.getElementById('plot');
    const currentVisibility = plotDiv.data[plotDiv.data.length - 1].visible;
    Plotly.restyle(plotDiv, { visible: !currentVisibility }, [plotDiv.data.length - 1]);
});

document.getElementById('upload-form').addEventListener('submit', function(event) {
    event.preventDefault();  // Prevent the default form submission
    // Proceed with your fetch request
});
