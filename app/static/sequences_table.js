'use strict';
import * as UTILS from "./utils.js";

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
    return row.querySelector('[data-role="plot-checkbox"]').checked;
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
    plotCheckbox.setAttribute('data-role', 'plot-checkbox');
    plotCheckbox.checked = true; // Default to checked
    // when pressed, if is unchecked and is ref, find the first row with checked checkbox and set it as ref
    plotCheckbox.addEventListener('click', () => {
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
    input.setAttribute('data-role', 'sequence-name');
    input.value = value;
    cell.appendChild(input);
    return cell;
}

function createTextAreaTd(value) {
    const cell = document.createElement('td');
    const sequenceInput = document.createElement('textarea');
    sequenceInput.setAttribute('data-role', 'sequence-value');
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
    deleteButton.setAttribute('data-role', 'actions-delete');
    deleteButton.style.backgroundColor = 'transparent';
    deleteButton.style.border = 'none';
    deleteButton.addEventListener('click', (event) => {
        event.preventDefault();
        UTILS.getElementByIdOrThrow('sequence-tbody').removeChild(row);
        if (isRefRow(row)) {
            setFirstAsRef();
        }
    });
    cell.appendChild(deleteButton);

    const setRefButton = document.createElement('button');
    setRefButton.setAttribute('data-role', 'actions-setRef');
    setRefButton.className = 'set-ref-button';
    setRefButton.innerText = 'Set as Ref';
    setRefButton.addEventListener('click', (event) => {
        event.preventDefault();
        setAsRef(row);
    });
    cell.appendChild(setRefButton);

    return cell;
}

function getRowBySequenceName(name) {
    for (let row of getSequenceRows()) {
        const rowName = row.querySelector('[data-role="sequence-name"]').value;
        if (rowName === name) {
            return row;
        }
    }
    return null;
}

// Add a new row to the table with optional name and sequence values
function addSequenceRow(name = '', sequence = '') {
    const row = document.createElement('tr');
    row.appendChild(createCheckboxTd(row));
    row.appendChild(createInputTd(name));
    row.appendChild(createTextAreaTd(sequence));
    row.appendChild(createActionsTd(row));

    const sequenceTbody = UTILS.getElementByIdOrThrow('sequence-tbody');
    sequenceTbody.appendChild(row);
    // if no ref, set first as ref
    if (!getRefRow()) {
        setFirstAsRef();
    }
}

function setSequences(sequences) {
    removeAllSequenceRows();
    for (const [name, value] of Object.entries(sequences)) {
        addSequenceRow(name, value);
    }
}

function removeAllSequenceRows() {
    const sequenceTbody = UTILS.getElementByIdOrThrow('sequence-tbody');
    sequenceTbody.innerHTML = '';
}




export {
    isRefRow,
    getRefRow,
    setAsRef,
    setFirstAsRef,
    isCheckedRow,
    getSequenceRows,
    setSequences,
    removeAllSequenceRows,
    addSequenceRow,
    getRowBySequenceName,
};
