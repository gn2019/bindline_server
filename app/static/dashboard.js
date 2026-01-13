'use strict';
function toggleAll(type) {
    const boxes = document.querySelectorAll("." + type + "-box");
    const master = document.getElementById("checkAll" + type.charAt(0).toUpperCase() + type.slice(1));
    boxes.forEach(b => b.checked = master.checked);
}
