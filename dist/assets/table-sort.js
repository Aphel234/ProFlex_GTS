(() => {
  "use strict";

  const configs = {
    workshopsTable: { skip: new Set([0, 11, 13]) },
    participantsTable: { skip: new Set([0, 11]) },
  };
  const sortState = new Map();
  let applying = false;

  function cellValue(cell) {
    if (!cell) return "";
    const control = cell.querySelector("input, select, textarea");
    if (control) {
      if (control.tagName === "SELECT") {
        const selected = control.options?.[control.selectedIndex];
        return (selected?.textContent || control.value || "").trim();
      }
      return String(control.value || "").trim();
    }
    return String(cell.textContent || "").trim();
  }

  function compareValues(a, b) {
    const an = Number(String(a).replace(",", "."));
    const bn = Number(String(b).replace(",", "."));
    const aNumeric = a !== "" && Number.isFinite(an);
    const bNumeric = b !== "" && Number.isFinite(bn);
    if (aNumeric && bNumeric) return an - bn;
    return String(a).localeCompare(String(b), "de", { numeric: true, sensitivity: "base" });
  }

  function updateRowNumbers(table) {
    [...(table.tBodies?.[0]?.rows || [])].forEach((row, index) => {
      const numberCell = row.querySelector(".row-number");
      const value = String(index + 1);
      if (numberCell && numberCell.textContent !== value) numberCell.textContent = value;
    });
  }

  function applySort(table) {
    const state = sortState.get(table.id);
    const tbody = table.tBodies?.[0];
    if (!state || !tbody) return;
    const rows = [...tbody.rows].filter((row) => row.dataset.index !== undefined);
    if (!rows.length) return;
    const sorted = [...rows].sort((ra, rb) => {
      const cmp = compareValues(cellValue(ra.cells[state.column]), cellValue(rb.cells[state.column]));
      if (cmp) return state.direction === "asc" ? cmp : -cmp;
      return Number(ra.dataset.index) - Number(rb.dataset.index);
    });
    const changed = sorted.some((row, index) => row !== rows[index]);
    if (changed) {
      applying = true;
      sorted.forEach((row) => tbody.appendChild(row));
      applying = false;
    }
    updateRowNumbers(table);
  }

  function enhance(table) {
    const config = configs[table.id];
    if (!config) return;
    const headers = [...(table.tHead?.rows?.[0]?.cells || [])];
    headers.forEach((th, index) => {
      if (config.skip.has(index)) return;
      if (!th.dataset.sortReady) {
        const label = th.textContent.trim();
        th.textContent = "";
        const button = document.createElement("button");
        button.type = "button";
        button.className = "sort-header-button";
        button.dataset.sortColumn = String(index);
        button.innerHTML = `<span>${label}</span><span class="sort-indicator" aria-hidden="true">↕</span>`;
        button.setAttribute("aria-label", `${label} sortieren`);
        th.appendChild(button);
        th.dataset.sortReady = "1";
      }
      const button = th.querySelector("[data-sort-column]");
      const state = sortState.get(table.id);
      const indicator = button?.querySelector(".sort-indicator");
      const indicatorText = state?.column === index ? (state.direction === "asc" ? "▲" : "▼") : "↕";
      if (indicator && indicator.textContent !== indicatorText) indicator.textContent = indicatorText;
      const ariaSort = state?.column === index ? (state.direction === "asc" ? "ascending" : "descending") : "none";
      if (button && button.getAttribute("aria-sort") !== ariaSort) button.setAttribute("aria-sort", ariaSort);
    });
    applySort(table);
  }

  function bindTable(table) {
    table.addEventListener("click", (event) => {
      const button = event.target.closest("[data-sort-column]");
      if (!button) return;
      const column = Number(button.dataset.sortColumn);
      const current = sortState.get(table.id);
      const direction = current?.column === column && current.direction === "asc" ? "desc" : "asc";
      sortState.set(table.id, { column, direction });
      enhance(table);
    });

    const observer = new MutationObserver(() => {
      if (applying) return;
      queueMicrotask(() => enhance(table));
    });
    observer.observe(table, { childList: true, subtree: true });
    enhance(table);
  }

  window.addEventListener("DOMContentLoaded", () => {
    Object.keys(configs).forEach((id) => {
      const table = document.getElementById(id);
      if (table) bindTable(table);
    });
  });
})();
