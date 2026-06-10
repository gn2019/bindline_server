import {showToasts} from "./toast.js";

let sortColumn = null;
let sortDirection = 1; // 1=asc, -1=desc
let lastRows = [];
let lastStatsMode = false;

function sortRows(rows) {
    if (!sortColumn) return rows;

    return [...rows].sort((a, b) => {
        let av = a[sortColumn];
        let bv = b[sortColumn];

        if (typeof av === "string") {
            return sortDirection * av.localeCompare(bv);
        }

        return sortDirection * (av - bv);
    });
}

function setSort(column) {
    if (sortColumn === column) {
        sortDirection *= -1;
    } else {
        sortColumn = column;
        sortDirection = 1;
    }

    renderTable(sortRows(lastRows), lastStatsMode);
}

function arrow(column) {
    if (sortColumn !== column) return '';
    return sortDirection > 0 ? ' ▲' : ' ▼';
}

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

let currentData = [];

const proteinSelect = document.getElementById('existing_score');
const filterInput = document.getElementById('filterInput');
const thead = document.querySelector('#scoreTable thead');
const tbody = document.querySelector('#scoreTable tbody');

const iupac = {
    A: "A",
    C: "C",
    G: "G",
    T: "T",
    R: "[AG]",
    Y: "[CT]",
    S: "[GC]",
    W: "[AT]",
    K: "[GT]",
    M: "[AC]",
    B: "[CGT]",
    D: "[AGT]",
    H: "[ACT]",
    V: "[ACG]",
    N: "[ACGT]"
};

const iupacSets = {
    A: ['A'],
    C: ['C'],
    G: ['G'],
    T: ['T'],
    R: ['A','G'],
    Y: ['C','T'],
    S: ['G','C'],
    W: ['A','T'],
    K: ['G','T'],
    M: ['A','C'],
    B: ['C','G','T'],
    D: ['A','G','T'],
    H: ['A','C','T'],
    V: ['A','C','G'],
    N: ['A','C','G','T']
};

function patternToRegex(pattern) {
    pattern = pattern.toUpperCase();

    let regex = "^.*";

    for (const c of pattern) {
        if (!(c in iupac))
            return null;

        regex += iupac[c];
    }

    regex += ".*$";

    return new RegExp(regex);
}

function renderTable(rows, statsMode = false) {
    thead.innerHTML = !statsMode ? `<tr>
        <th data-sort="kmer">${rows.length ? rows[0].kmer.length + '-mer' : 'kmer'}${arrow('kmer')}</th>
        <th data-sort="score">score${arrow('score')}</th>
    </tr>` : `<tr>
        <th data-sort="kmer">${rows.length ? rows[0].kmer.length + '-mer' : 'kmer'}${arrow('kmer')}</th>
        <th data-sort="min">min${arrow('min')}</th>
        <th data-sort="max">max${arrow('max')}</th>
        <th data-sort="mean">mean${arrow('mean')}</th>
        <th data-sort="median">median${arrow('median')}</th>
    </tr>`

    thead.querySelectorAll('th[data-sort]').forEach(th => {
        th.style.cursor = 'pointer';
        th.addEventListener('click', () => {
            setSort(th.dataset.sort);
        });
    });

    tbody.innerHTML = rows.map(r => !statsMode ? `<tr>
            <td>${r.kmer}</td>
            <td>${r.score}</td>
        </tr>` : `<tr>
            <td>${r.kmer}</td>
            <td>${r.min.toFixed(3)}</td>
            <td>${r.max.toFixed(3)}</td>
            <td>${r.mean.toFixed(3)}</td>
            <td>${r.median.toFixed(3)}</td>
        </tr>`).join('');

    const link = document.createElement('a');
    link.onclick = downloadCsv;
    link.className = "data-btn";
    link.innerHTML = '<i class="fa fa-download"></i> Download CSV';
    document.getElementById('downloadCsvBtn').replaceChildren(link);
}

function downloadCsv() {
    if (!lastRows.length) return;

    const statsMode = lastStatsMode;

    let headers;
    let lines;

    const rows = sortRows(lastRows);

    if (!statsMode) {
        headers = ['kmer', 'score'];
        lines = rows.map(r => [r.kmer, r.score]);
    } else {
        headers = ['kmer', 'min', 'max', 'mean', 'median'];
        lines = rows.map(r => [r.kmer, r.min, r.max, r.mean, r.median]);
    }

    const csv = [
        headers.join(','),
        ...lines.map(row => row.join(','))
    ].join('\n');

    const blob = new Blob([csv], {type: 'text/csv'});
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;

    const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, '-');

    const protein =
    a.download = `scores_${timestamp}.csv`;

    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    URL.revokeObjectURL(url);
}

let currentScores = {};
let currentRows = [];
let mer = 8;

function calcPosibilities(pattern) {
    let possibilities = 1;
    for (const c of pattern) {
        possibilities *= iupacSets[c].length;
    }
    return possibilities;
}

function expandKmer(pattern) {
    if (calcPosibilities(pattern) > 100000) {
        showToasts({error: "Pattern too degenerate"});
        return;
    }

    let kmers = [''];
    for (const c of pattern) {
        const bases = iupacSets[c] || [c];
        const next = [];
        for (const prefix of kmers) {
            for (const b of bases) {
                next.push(prefix + b);
            }
        }
        kmers = next;
    }
    return kmers;
}

function applyFilter() {
    const pattern = filterInput.value.trim().toUpperCase();

    let rows = [];

    // -----------------------------
    // normal mode
    // -----------------------------
    if (!pattern || pattern.length <= mer) {
        const regex = pattern ? patternToRegex(pattern) : null;

        rows = !regex
            ? currentRows
            : currentRows.filter(r => regex.test(r.kmer));
    }

    // -----------------------------
    // long pattern → sliding windows
    // -----------------------------
    else {
        const windowSize = mer;
        const newEntries = expandKmer(pattern);
        const result = [];
        for (const newEntry of newEntries) {
            const values = [];
            for (let i = 0; i <= pattern.length - windowSize; i++) {
                const window = newEntry.slice(i, i + windowSize);
                const score = currentScores[window];
                if (score !== undefined) {
                    values.push(score);
                }
            }

            values.sort((a, b) => a - b);
            const min = values[0];
            const max = values[values.length - 1];
            const mean = values.reduce((a, b) => a + b, 0) / values.length;
            const mid = Math.floor(values.length / 2);
            const median =
                values.length % 2
                    ? values[mid]
                    : (values[mid - 1] + values[mid]) / 2;

            result.push({kmer: newEntry, min, max, mean, median});
        }
        rows = result;
    }
    lastRows = rows;
    lastStatsMode = pattern.length > mer;

    renderTable(sortRows(rows), lastStatsMode);
}

$('#existing_score').on('change', async function () {
    const protein = $(this).val();
    const fileType = $('input[name="file_type"]:checked').val(); // if you have it

    if (!protein) return;

    const res = await fetch(`/get_score_files/${protein}/${fileType}`);
    const data = await res.json();
    if (data.error) {
        showToasts(data);
        return;
    }

    mer = data.mer;
    currentRows = data.scores;
    currentScores = {};
    for (const item of data.scores) {
        currentScores[item.kmer] = item.score;
    }

    filterInput.disabled = false;
    applyFilter();
});

let filterTimeout;

filterInput.addEventListener('input', () => {
    clearTimeout(filterTimeout);

    filterTimeout = setTimeout(() => {
        applyFilter();
    }, 100);
});
// Call this function on page load to initialize file lists
loadExistingFiles()