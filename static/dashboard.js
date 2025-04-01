function handleDelete(event, form) {
    event.preventDefault(); // Prevent default form submission

    fetch(form.action, {
        method: 'POST',
        headers: {
            'X-Requested-With': 'XMLHttpRequest'
        }
    })
    .then(response => response.json())
    .then(result => {
        if (result.error) {
            alert(result.error);
        } else {
            location.reload();
        }
    })
    .catch(error => console.error('Error:', error));
}


function redirectToIndex() {
    window.location.href = '/';
}