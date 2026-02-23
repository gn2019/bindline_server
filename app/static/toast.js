import * as UTILS from './utils.js';

export function showToast(type, message, delay = 100000000000) {
    const toastContainer = UTILS.getElementByIdOrThrow("toastContainer");

    let bgClass = "text-bg-primary";
    if (type === "error") bgClass = "text-bg-danger";
    if (type === "warning") bgClass = "text-bg-warning";
    if (type === "success") bgClass = "text-bg-success";

    const toastEl = document.createElement("div");
    toastEl.className = `toast align-items-center ${bgClass} border-0`;
    toastEl.setAttribute("role", "alert");
    toastEl.setAttribute("aria-live", "assertive");
    toastEl.setAttribute("aria-atomic", "true");

    toastEl.innerHTML = `
        <div class="d-flex">
            <div class="toast-body">${message}</div>
            <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
        </div>
    `;

    toastContainer.appendChild(toastEl);

    const toast = new bootstrap.Toast(toastEl, { delay });
    toast.show();

    toastEl.addEventListener("hidden.bs.toast", () => {
        toastEl.remove();
    });
}

export function showToasts(toasts) {
    console.log(toasts);
    if (Array.isArray(toasts.error)) {
        toasts.error.forEach(msg => showToast("error", msg));
    } else if (typeof toasts.error === "string") {
        showToast("error", toasts.error);
    }
    if (Array.isArray(toasts.warning)) {
        toasts.warning.forEach(msg => showToast("warning", msg));
    } else if (typeof toasts.warning === "string") {
        showToast("warning", toasts.warning);
    }
    if (Array.isArray(toasts.success)) {
        toasts.success.forEach(msg => showToast("success", msg));
    } else if (typeof toasts.success === "string") {
        showToast("success", toasts.success);
    }
    // if toasts is an error object itself, show it as an error toast
    if (toasts instanceof Error) {
        showToast("error", toasts.message);
    }
}
