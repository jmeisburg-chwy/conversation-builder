const key = (value) => String(value || "").trim().toLocaleLowerCase();

export function filterTaxonomyChoices(options = [], query = "") {
  const needle = key(query);
  return options.filter((value) => !needle || key(value).includes(needle));
}

export function taxonomyAddProposal(options = [], query = "") {
  const value = String(query || "").replace(/\s+/g, " ").trim();
  if (!value || options.some((option) => key(option) === key(value))) return null;
  return { value, label: `Add “${value}”` };
}

export function createTaxonomyCombobox({
  documentRef,
  input,
  listbox,
  removeButton,
  label,
  getValue,
  getOptions,
  canRemove = () => false,
  onCommit = () => {},
  onRemove = () => {},
  onAnnounce = () => {},
}) {
  const document = documentRef;
  if (!document || !input || !listbox) {
    throw new TypeError("createTaxonomyCombobox requires documentRef, input, and listbox.");
  }
  const accessibleLabel = String(label || "Taxonomy").trim() || "Taxonomy";
  const listboxId = listbox.id || input.getAttribute("aria-controls");
  if (!listboxId) throw new TypeError("createTaxonomyCombobox requires a stable listbox id.");
  const optionIdPrefix = `${input.id || listboxId}Option`;
  let query = String(getValue() || "").trim();
  let isOpen = false;
  let isFiltering = false;
  let activeIndex = -1;
  let entries = [];

  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", listboxId);
  input.setAttribute("aria-expanded", "false");
  listbox.setAttribute("role", "listbox");
  if (!listbox.getAttribute("aria-labelledby") && !listbox.getAttribute("aria-label")) {
    listbox.setAttribute("aria-label", `${accessibleLabel} options`);
  }
  const removeLabel = `Remove custom ${accessibleLabel}`;
  if (removeButton) {
    removeButton.setAttribute("aria-label", removeLabel);
    removeButton.dataset.tooltip = removeLabel;
  }

  const setActiveIndex = (index) => {
    activeIndex = index >= 0 && index < entries.length ? index : -1;
  };

  const select = (entry) => {
    if (!entry) return;
    const announcement = onCommit(entry.value, { added: entry.added });
    query = String(getValue() || "").trim();
    isOpen = false;
    isFiltering = false;
    activeIndex = -1;
    input.focus();
    renderOptions({ preserveQuery: true });
    onAnnounce(String(announcement || ""));
  };

  const renderOptions = ({ preserveQuery = false } = {}) => {
    if (!preserveQuery) query = String(getValue() || "").trim();
    const options = getOptions();
    const matches = filterTaxonomyChoices(options, isFiltering ? query : "");
    const proposal = isFiltering ? taxonomyAddProposal(options, query) : null;
    entries = [
      ...matches.map((value) => ({ value, label: value, added: false })),
      ...(proposal ? [{ ...proposal, added: true }] : []),
    ];
    if (activeIndex >= entries.length) activeIndex = -1;

    input.value = query;
    input.setAttribute("aria-expanded", String(isOpen));
    if (activeIndex >= 0) input.setAttribute("aria-activedescendant", `${optionIdPrefix}-${activeIndex}`);
    else input.removeAttribute("aria-activedescendant");
    listbox.hidden = !isOpen;
    listbox.innerHTML = "";
    if (isOpen && !matches.length) {
      const empty = document.createElement("div");
      empty.className = "taxonomy-combobox-empty";
      empty.textContent = "No results found";
      listbox.append(empty);
    }
    entries.forEach((entry, index) => {
      const option = document.createElement("div");
      option.id = `${optionIdPrefix}-${index}`;
      option.className = "taxonomy-combobox-option";
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(index === activeIndex));
      option.textContent = entry.label;
      option.addEventListener("pointerdown", (event) => event.preventDefault());
      option.addEventListener("click", () => select(entry));
      listbox.append(option);
    });
    if (removeButton) removeButton.hidden = !canRemove();
  };

  const announceOptions = () => {
    onAnnounce(
      `${entries.length} ${entries.length === 1 ? "option" : "options"} available.`
    );
  };

  const openCombobox = ({ preserveQuery = false } = {}) => {
    isFiltering = false;
    isOpen = true;
    renderOptions({ preserveQuery });
    announceOptions();
  };

  const closeCombobox = ({ announce = true } = {}) => {
    query = String(getValue() || "").trim();
    isOpen = false;
    isFiltering = false;
    activeIndex = -1;
    renderOptions({ preserveQuery: true });
    if (announce) onAnnounce("");
  };

  const onFocus = () => openCombobox({ preserveQuery: true });
  const onClick = () => {
    if (!isOpen) openCombobox({ preserveQuery: true });
  };
  const onInput = () => {
    query = input.value;
    isOpen = true;
    isFiltering = true;
    activeIndex = -1;
    renderOptions({ preserveQuery: true });
    announceOptions();
  };
  const onKeyDown = (event) => {
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      isOpen = true;
      if (entries.length) {
        if (event.key === "Home") setActiveIndex(0);
        else if (event.key === "End") setActiveIndex(entries.length - 1);
        else if (event.key === "ArrowDown") {
          setActiveIndex(activeIndex < entries.length - 1 ? activeIndex + 1 : 0);
        } else {
          setActiveIndex(activeIndex > 0 ? activeIndex - 1 : entries.length - 1);
        }
      }
      renderOptions({ preserveQuery: true });
      announceOptions();
      return;
    }
    if (event.key === "Enter" && isOpen && activeIndex >= 0) {
      event.preventDefault();
      select(entries[activeIndex]);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeCombobox();
    }
  };
  const onBlur = () => closeCombobox();
  const onRemoveClick = () => {
    if (!canRemove()) return;
    const announcement = onRemove();
    query = String(getValue() || "").trim();
    activeIndex = -1;
    isFiltering = false;
    input.focus();
    closeCombobox({ announce: false });
    onAnnounce(String(announcement || ""));
  };

  input.addEventListener("focus", onFocus);
  input.addEventListener("click", onClick);
  input.addEventListener("input", onInput);
  input.addEventListener("keydown", onKeyDown);
  input.addEventListener("blur", onBlur);
  removeButton?.addEventListener("click", onRemoveClick);

  return {
    render: () => {
      isFiltering = false;
      renderOptions();
    },
    open: () => openCombobox(),
    close: () => closeCombobox(),
    destroy() {
      input.removeEventListener("focus", onFocus);
      input.removeEventListener("click", onClick);
      input.removeEventListener("input", onInput);
      input.removeEventListener("keydown", onKeyDown);
      input.removeEventListener("blur", onBlur);
      removeButton?.removeEventListener("click", onRemoveClick);
      isOpen = false;
      activeIndex = -1;
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
      listbox.hidden = true;
      listbox.innerHTML = "";
    },
  };
}
