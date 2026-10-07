(function (root) {
  "use strict";
  if (typeof document === "undefined") return;

  const FILTERS = [
    { id: "page3ResultFilter", label: "Result" },
    { id: "page3SubjectFilter", label: "Subject" },
    { id: "page3RangeFilter", label: "Mark Range" }
  ];
  const selectedById = new Map();
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function valuesFor(select) {
    return [...select.options]
      .filter(option => option.value && !option.dataset.multiCombined)
      .map(option => ({ value: option.value, label: option.textContent.trim() }));
  }

  function summaryText(selected, options) {
    if (!selected.size) return "All";
    const labels = options.filter(option => selected.has(option.value)).map(option => option.label);
    return labels.length <= 2 ? labels.join(", ") : `${labels.length} selected`;
  }

  function syncHiddenSelect(select, selected) {
    [...select.options].filter(option => option.dataset.multiCombined).forEach(option => option.remove());
    const values = [...selected];
    if (!values.length) select.value = "";
    else if (values.length === 1 && [...select.options].some(option => option.value === values[0])) select.value = values[0];
    else {
      const combined = document.createElement("option");
      combined.value = values.join("|");
      combined.textContent = values.join(", ");
      combined.dataset.multiCombined = "true";
      select.appendChild(combined);
      select.value = combined.value;
    }
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function bindOptionRow(row, input) {
    row.addEventListener("click", event => {
      if (event.target === input) return;
      input.checked = !input.checked;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  function renderControl(select, wrapper, selected) {
    const options = valuesFor(select);
    const validValues = new Set(options.map(option => option.value));
    [...selected].forEach(value => { if (!validValues.has(value)) selected.delete(value); });
    const summary = wrapper.querySelector("summary span");
    if (summary) summary.textContent = summaryText(selected, options);
    const menu = wrapper.querySelector(".page3-multi-menu");
    if (!menu) return;
    menu.innerHTML = `
      <div class="page3-multi-option page3-multi-all" role="option"><input type="checkbox" ${selected.size ? "" : "checked"}><span>All</span></div>
      ${options.map(option => `<div class="page3-multi-option" role="option"><input type="checkbox" value="${escapeHtml(option.value)}" ${selected.has(option.value) ? "checked" : ""}><span>${escapeHtml(option.label)}</span></div>`).join("")}`;

    const allRow = menu.querySelector(".page3-multi-all");
    if (!allRow) return;
    const allBox = allRow.querySelector("input");
    bindOptionRow(allRow, allBox);
    allBox.addEventListener("change", () => {
      if (!allBox.checked) return;
      selected.clear();
      renderControl(select, wrapper, selected);
      syncHiddenSelect(select, selected);
    });

    menu.querySelectorAll(".page3-multi-option:not(.page3-multi-all)").forEach(row => {
      const input = row.querySelector("input");
      bindOptionRow(row, input);
      input.addEventListener("change", () => {
        if (input.checked) selected.add(input.value); else selected.delete(input.value);
        if (summary) summary.textContent = summaryText(selected, options);
        allBox.checked = selected.size === 0;
        syncHiddenSelect(select, selected);
      });
    });
  }

  function enhanceFilter({ id, label }) {
    const select = document.getElementById(id);
    if (!select || select.dataset.multiEnhanced) return;
    select.dataset.multiEnhanced = "true";
    select.classList.add("page3-multi-source");
    const selected = selectedById.get(id) || new Set();
    selectedById.set(id, selected);

    const wrapper = document.createElement("details");
    wrapper.className = "page3-multi";
    wrapper.dataset.for = id;
    wrapper.innerHTML = `<summary aria-label="${escapeHtml(label)} multi-select"><span>All</span><b>⌄</b></summary><div class="page3-multi-menu"></div>`;
    select.insertAdjacentElement("afterend", wrapper);
    renderControl(select, wrapper, selected);

    new MutationObserver(() => renderControl(select, wrapper, selected)).observe(select, { childList: true });
  }

  function enhanceAll() { FILTERS.forEach(enhanceFilter); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", enhanceAll, { once: true });
  else enhanceAll();
  new MutationObserver(enhanceAll).observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener("click", event => {
    document.querySelectorAll("details.page3-multi[open]").forEach(details => {
      if (!details.contains(event.target)) details.removeAttribute("open");
    });
  });

  root.ResultAnalyticsFilterUI = { enhanceAll, enhanceFilter };
})(typeof globalThis !== "undefined" ? globalThis : this);
