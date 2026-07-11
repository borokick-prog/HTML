document.addEventListener('submit', function (e) {
  const form = e.target.closest('form[data-confirm]');
  if (form && !window.confirm(form.getAttribute('data-confirm'))) {
    e.preventDefault();
  }
});

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

document.addEventListener('DOMContentLoaded', function () {
  const slugInput = document.querySelector('input[data-slug-source]');
  if (!slugInput) return;

  const sourceInput = document.getElementById(slugInput.dataset.slugSource);
  if (!sourceInput) return;

  let slugTouched = false;
  slugInput.addEventListener('input', function () { slugTouched = true; });
  sourceInput.addEventListener('input', function () {
    if (!slugTouched) slugInput.value = slugify(sourceInput.value);
  });
});
