// Enable modal on ALL images in help page, EXCEPT the modal image itself
document.addEventListener("DOMContentLoaded", function () {
    const modal = document.getElementById("imageModal");
    const modalImgId = "modalImage";

    // Select all images except the modal image and images with class "no-zoom"
    const imgs = document.querySelectorAll(`img:not(#${modalImgId}):not(.no-zoom)`);

    imgs.forEach(img => {
        img.style.cursor = "zoom-in";

        img.addEventListener("click", function (ev) {
            // If modal is already open, do nothing
            if (modal.classList.contains('show')) return;

            // Show clicked image in modal
            const modalImg = document.getElementById(modalImgId);
            modalImg.src = this.src;
            new bootstrap.Modal(modal).show();
        });
    });

    // Optional: close modal when user clicks the large image (toggle behavior)
    const modalImg = document.getElementById(modalImgId);
    modalImg.style.cursor = "zoom-out";
    modalImg.addEventListener("click", function (e) {
        // stop propagation so underlying page handlers aren't triggered
        e.stopPropagation();
        // hide modal on image click
        const bsModal = bootstrap.Modal.getInstance(modal);
        if (bsModal) bsModal.hide();
    });
});
