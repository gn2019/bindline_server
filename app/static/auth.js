document.addEventListener("DOMContentLoaded", function () {
    // Get the modal elements
    const loginModal = document.getElementById("loginModal");
    const registerModal = document.getElementById("registerModal");

    // Get URLs from data attributes
    const loginUrl = loginModal.getAttribute("data-url-login");
    const registerUrl = registerModal.getAttribute("data-url-register");

    // Handle login form submission
    document.getElementById("loginForm").addEventListener("submit", function (event) {
        event.preventDefault();
        const formData = new FormData(this);

        fetch(loginUrl, {
            method: "POST",
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                bootstrap.Modal.getInstance(loginModal).hide();  // Close modal
                location.reload();
            } else {
                showToast("error", "Invalid credentials.");
            }
        });
    });

    // Handle register form submission
    document.getElementById("registerForm").addEventListener("submit", function (event) {
        event.preventDefault();
        const formData = new FormData(this);

        fetch(registerUrl, {
            method: "POST",
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                bootstrap.Modal.getInstance(registerModal).hide();  // Close modal
                location.reload();
            } else {
                showToast("error", "Registration failed: " + data.message);
            }
        });
    });
});
