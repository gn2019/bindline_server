'use strict';
import * as UTILS from './utils.js';

function toggleAll(type) {
    const boxes = document.querySelectorAll("." + type + "-box");
    const master = UTILS.getElementByIdOrThrow("checkAll" + type.charAt(0).toUpperCase() + type.slice(1));
    boxes.forEach(b => b.checked = master.checked);
}
