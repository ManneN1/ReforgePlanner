(() => {
  "use strict";

  const requiredNamespaces = [
    "model",
    "items",
    "optimizer",
    "combinations",
    "persistence",
    "modal",
  ];
  const missingNamespaces = requiredNamespaces.filter(
    (name) => !globalThis.ReforgePlanner?.[name],
  );
  if (missingNamespaces.length) {
    throw new Error(
      `Reforge Planner failed to start: missing module${missingNamespaces.length === 1 ? "" : "s"} ${missingNamespaces.join(", ")}.`,
    );
  }


      const {
        STATS,
        MAIN_STAT,
        TOTAL_STATS,
        MAX_GEMS,
        SLOTS,
        LAB_SLOTS,
        number: n,
        formatCount,
        blankItem,
        createDefaultState: defaults,
        normalizeFixedItems: fixedSlotItems,
        normalizeCandidate,
      } = ReforgePlanner.model;
      const {
        clearItem: clearSlotItem,
        enforceWeaponRules: enforceWeaponRulesForItems,
        createItemRepository,
      } = ReforgePlanner.items;
      const itemRepository = createItemRepository({ itemDb: ITEM_DB });
      const fillFromId = itemRepository.fillLocal;
      const fillFromIdWithFallback = itemRepository.fillWithFallback;
      const enforceWeaponRules = () =>
        enforceWeaponRulesForItems(state.items, ITEM_DB);
      const {
        equipmentBonuses: calculateEquipmentBonuses,
        optimize,
        compareOptimizedResults: compareResultsByWeights,
      } = ReforgePlanner.optimizer;
      const equipmentBonuses = (item) =>
        calculateEquipmentBonuses(item, {
          itemDb: ITEM_DB,
          gemDb: GEM_DB,
          enchantDb: ENCHANT_DB,
        });
      const compareOptimizedResults = (left, right) =>
        compareResultsByWeights(left, right, state.weights);
      const calculate = (inputItems = state.items, showProgress = true) =>
        optimize(
          inputItems,
          state,
          { itemDb: ITEM_DB, gemDb: GEM_DB, enchantDb: ENCHANT_DB },
          showProgress
            ? ({ item, totalItems, states }) => {
                $("#status").textContent =
                  `Optimizing item ${item}/${totalItems} · ${formatCount(states)} states`;
              }
            : null,
        );
      const combinationEngine = ReforgePlanner.combinations;
      const candidateIsUsable = combinationEngine.candidateIsUsable;
      const countCandidateRange = (
        items,
        count,
        method,
        rules = state.comboRules || [],
      ) =>
        combinationEngine.countCandidateRange(items, count, method, {
          rules,
          baseItems: state.items,
          itemDb: ITEM_DB,
        });
      const iterateCandidateRange = (
        items,
        count,
        method,
        rules = state.comboRules || [],
      ) =>
        combinationEngine.iterateCandidateRange(items, count, method, {
          rules,
          baseItems: state.items,
          itemDb: ITEM_DB,
        });
      const comboGearVariants = (combo) =>
        combinationEngine.comboGearVariants(combo, state.items, ITEM_DB);
      const {
        serializeSetup,
        parseSetup,
        serializeGearCsv,
        parseGearCsv,
        saveCurrentSetup,
        loadCurrentSetup,
      } = ReforgePlanner.persistence;
      const serialize = () => serializeSetup(state);
      const csv = () => serializeGearCsv(state.items);
      const parseCsv = (text) =>
        parseGearCsv(text, { fillLocal: fillFromId });
      const persistCurrentSetup = () => {
        try {
          saveCurrentSetup(state);
        } catch (error) {
          console.warn("Could not save the current Reforge Planner setup.", error);
        }
      };
      const scheduleCurrentSetupSave = () => {
        clearTimeout(currentSetupSaveTimer);
        currentSetupSaveTimer = setTimeout(persistCurrentSetup, 150);
      };
      let state = defaults(),
        currentSetupSaveTimer = null,
        lastResult = null,
        comboStopRequested = false,
        comboRunResults = [],
        comboSort = { key: null, direction: null };
      const $ = (s) => document.querySelector(s),
        el = (tag, attrs = {}, html = "") => {
          const x = document.createElement(tag);
          Object.assign(x, attrs);
          x.innerHTML = html;
          return x;
        };
      const SOCKET_COLORS = Object.freeze([
        [1, "Meta"],
        [2, "Red"],
        [3, "Blue"],
        [4, "Yellow"],
        [5, "Green"],
        [6, "Orange"],
        [7, "Purple"],
        [8, "Prismatic"],
      ]);
      const socketColorInfo = (value) =>
        SOCKET_COLORS.find(([id]) => id === Number(value)) || SOCKET_COLORS.at(-1);
      const gemColorClass = (record) =>
        `gem-color-${socketColorInfo(record?.c)[1].toLowerCase()}`;
      const applySelectedGemColor = (select) => {
        [...select.classList]
          .filter((name) => name.startsWith("gem-color-"))
          .forEach((name) => select.classList.remove(name));
        const record = GEM_DB[String(select.value)];
        if (record) select.classList.add(gemColorClass(record));
      };
      const appendGemOptions = (select, selectedGemId) => {
        select.append(el("option", { value: "" }, "No gem"));
        Object.entries(GEM_DB)
          .sort((a, b) => a[1].n.localeCompare(b[1].n))
          .forEach(([gemId, record]) =>
            select.append(
              el(
                "option",
                {
                  value: gemId,
                  selected: String(selectedGemId || "") === gemId,
                  className: gemColorClass(record),
                },
                record.n,
              ),
            ),
          );
        applySelectedGemColor(select);
      };
      const applyKnownSocketColor = (gemSelect, nativeColor) => {
        if (!nativeColor) return;
        const [, color] = socketColorInfo(nativeColor);
        gemSelect.classList.add("known-socket", `socket-border-${color.toLowerCase()}`);
        gemSelect.title = `${color} socket`;
      };

      function configureIntegerField(
        input,
        label,
        { min = 0, max = null, optional = false } = {},
      ) {
        input.step = 1;
        input.min = min;
        if (max != null) input.max = max;
        const validate = () => {
          const raw = input.value.trim(),
            value = Number(raw);
          let message = "";
          if (!raw && optional) message = "";
          else if (!raw) message = `${label} is required.`;
          else if (!Number.isInteger(value))
            message = `${label} must be a whole number.`;
          else if (value < min)
            message = `${label} cannot be less than ${min}.`;
          else if (max != null && value > max)
            message = `${label} cannot be greater than ${max}.`;
          input.setCustomValidity(message);
          input.title = message || input.dataset.validTitle;
          return !message;
        };
        input.dataset.validTitle = input.title || "";
        input.addEventListener("input", validate);
        input.addEventListener("change", validate);
        validate();
        return input;
      }
      function reportInvalidWithin(root) {
        const invalid = [...document.querySelectorAll(`${root} :invalid`)].find(
          (field) => !field.disabled,
        );
        if (!invalid) return true;
        invalid.reportValidity();
        invalid.scrollIntoView({ behavior: "smooth", block: "center" });
        return false;
      }
      function esc(s) {
        return String(s).replace(
          /[&<>"']/g,
          (c) =>
            ({
              "&": "&amp;",
              "<": "&lt;",
              ">": "&gt;",
              '"': "&quot;",
              "'": "&#39;",
            })[c],
        );
      }
      function renderWeights() {
        const box = $("#weights");
        box.innerHTML = "";
        TOTAL_STATS.forEach((s) => {
          const l = el("label", {}, `<span>${s}</span>`);
          const i = el("input", {
            type: "number",
            value: state.weights[s],
            step: "any",
            title:
              s === MAIN_STAT
                ? "Used when ranking Combination Lab results; Main Stat cannot be reforged"
                : "",
          });
          i.oninput = () => (state.weights[s] = n(i.value));
          l.append(i);
          box.append(l);
        });
      }
      function renderBaseline() {
        const box = $("#baseline");
        box.innerHTML = "";
        TOTAL_STATS.forEach((s) => {
          const l = el("label", {}, `<span>${s}</span>`);
          const i = el("input", {
            type: "number",
            min: 0,
            value: state.baseline[s],
          });
          configureIntegerField(i, s);
          i.oninput = () => (state.baseline[s] = Math.max(0, n(i.value)));
          l.append(i);
          box.append(l);
        });
      }
      function renderCaps() {
        const box = $("#caps");
        box.innerHTML = "";
        state.caps.forEach((cap, ci) => {
          if (cap.stat === "None") {
            const baseRule = cap.rules.find((rule) => rule.method !== "new");
            cap.rules = [baseRule || { method: "atleast", value: 0, after: 0 }];
          }
          const c = el("div", { className: "cap" });
          c.innerHTML = `<div class="cap-top"><span class="cap-title">Breakpoint Stat ${ci + 1}</span><button type="button" class="secondary add-rule" ${cap.stat === "None" ? "disabled" : ""}>+ Breakpoint</button></div>`;
          const sel = el("select", { className: "cap-stat" });
          ["None", ...STATS].forEach((s) =>
            sel.append(el("option", { value: s, selected: s === cap.stat }, s)),
          );
          sel.onchange = () => {
            cap.stat = sel.value;
            if (cap.stat === "None")
              cap.rules = [{ method: "atleast", value: 0, after: 0 }];
            renderCaps();
          };
          c.append(sel);
          const rules = el("div");
          cap.rules.forEach((r, ri) => {
            const row = el("div", {
              className: "rule " + (r.method === "new" ? "new" : ""),
            });
            const methodField = el("label", { className: "rule-field" }),
              methodLabel = el("span", {}, "Rule");
            methodField.append(methodLabel);
            if (r.method === "new") {
              methodField.append(
                el(
                  "div",
                  { className: "rule-method-static" },
                  "Weight breakpoint",
                ),
              );
            } else {
              const ms = el("select", { disabled: cap.stat === "None" });
              [
                ["atleast", "At least"],
                ["atmost", "At most"],
                ["exactly", "Exactly"],
              ].forEach(([v, t]) =>
                ms.append(
                  el("option", { value: v, selected: v === r.method }, t),
                ),
              );
              ms.onchange = () => (r.method = ms.value);
              methodField.append(ms);
            }
            const valueField = el("label", { className: "rule-field" }),
              valueLabel = el("span", {}, "Value"),
              val = el("input", {
                type: "number",
                min: 0,
                value: r.value,
                disabled: cap.stat === "None",
                title:
                  r.method === "new"
                    ? "Stat value where this new weight begins"
                    : "Required stat value",
              });
            configureIntegerField(val, "Breakpoint value");
            val.oninput = () => (r.value = Math.max(0, n(val.value)));
            valueField.append(valueLabel, val);
            const afterField = el("label", {
                className: "rule-field after-field",
              }),
              afterLabel = el("span", {}, "Weight after"),
              after = el("input", {
                type: "number",
                value: r.after,
                step: "any",
                disabled: cap.stat === "None",
                title: "Weight after breakpoint",
              });
            after.oninput = () => (r.after = n(after.value));
            afterField.append(afterLabel, after);
            const del = el(
              "button",
              {
                className: "icon-btn",
                type: "button",
                title: "Remove",
                ariaLabel: `Remove breakpoint ${ri + 1}`,
                disabled: cap.stat === "None",
              },
              "×",
            );
            del.onclick = () => {
              cap.rules.splice(ri, 1);
              renderCaps();
            };
            row.append(methodField, valueField, afterField, del);
            rules.append(row);
          });
          c.querySelector(".add-rule").onclick = () => {
            cap.rules.push({ method: "atleast", value: 0, after: 0 });
            renderCaps();
          };
          c.append(rules);
          c.append(
            el(
              "div",
              { className: "cap-help" },
              cap.stat === "None"
                ? "Select a stat before adding a cap point."
                : "Each breakpoint combines its rule and stat value with the weight used after that breakpoint.",
            ),
          );
          box.append(c);
        });
      }






      const ITEM_EDITOR_COLUMNS = [
        "Slot",
        "Item ID",
        "Name",
        "Main Stat",
        ...STATS,
        "Variant",
        "Gems",
        "Enchant",
      ];

      function renderItemEditorHeader(target, { includeActions = false } = {}) {
        const labels = includeActions
          ? [...ITEM_EDITOR_COLUMNS, '<span class="visually-hidden">Actions</span>']
          : ITEM_EDITOR_COLUMNS;
        target.innerHTML = labels
          .map((label) => `<th scope="col">${label}</th>`)
          .join("");
      }

      function appendItemEditorCell(row, control, className = "") {
        const cell = el("td", className ? { className } : {});
        cell.append(control);
        row.append(cell);
        return cell;
      }

      function createItemEditorNameInput(item, {
        className = "item-name",
        disabled = false,
        disabledValue = "",
      } = {}) {
        const input = el("input", {
          value: disabled && disabledValue ? disabledValue : item.name || "",
          className,
          disabled,
          ariaLabel: "Item name",
        });
        input.oninput = () => {
          item.name = input.value;
          updateComboEstimate();
        };
        return input;
      }

      function createItemEditorStatInput(item, stat, {
        disabled = false,
        title = "",
      } = {}) {
        const isMainStat = stat === "Main Stat";
        const input = el("input", {
          type: "number",
          min: 0,
          value: isMainStat ? item.mainStat || "" : item.stats?.[stat] || "",
          placeholder: "0",
          disabled,
          title: title || (isMainStat ? "Non-reforgeable primary stat" : `${stat} stat`),
        });
        configureIntegerField(input, stat, { max: 9999, optional: true });
        input.oninput = () => {
          const value = Math.max(0, n(input.value));
          if (isMainStat) item.mainStat = value;
          else {
            item.stats ??= {};
            item.stats[stat] = value;
          }
          updateComboEstimate();
        };
        return input;
      }

      function renderGear() {
        state.items = fixedSlotItems(state.items);
        const main = state.items.find((item) => item.slot === "Main hand"),
          mainIsTwoHanded = Boolean(main?.twoHanded) ||
            Boolean(main?.id && ITEM_DB[String(main.id)]?.h === 4),
          h = $("#gearHead");
        renderItemEditorHeader(h);
        const b = $("#gearBody");
        b.innerHTML = "";
        state.items.forEach((item) => {
          const offhandDisabled = item.slot === "Off hand" && mainIsTwoHanded,
            tr = el("tr", { className: offhandDisabled ? "is-disabled" : "" });
          const slotCell = el("td", {
            className: "gear-slot",
            title: offhandDisabled
              ? "Unavailable with a two-handed main-hand weapon"
              : item.slot,
          });
          if (item.slot === "Main hand") {
            const knownTwoHanded =
                item.id && ITEM_DB[String(item.id)]?.h === 4,
              weaponType = el("select", {
                title: knownTwoHanded
                  ? "This item is identified as a two-handed weapon"
                  : "Choose two-handed for a manually entered weapon",
              });
            weaponType.append(
              el(
                "option",
                {
                  value: "one",
                  selected: !item.twoHanded && !knownTwoHanded,
                },
                "Main Hand",
              ),
              el(
                "option",
                {
                  value: "two",
                  selected: Boolean(item.twoHanded || knownTwoHanded),
                },
                "Main Hand (2H)",
              ),
            );
            weaponType.onchange = () => {
              item.twoHanded = weaponType.value === "two";
              enforceWeaponRules();
              renderGear();
              updateComboEstimate();
            };
            weaponType.disabled = Boolean(knownTwoHanded);
            slotCell.append(weaponType);
          } else slotCell.textContent = item.slot;
          tr.append(slotCell);
          const idTd = el("td");
          const id = el("input", {
            type: "number",
            min: 1,
            value: item.id || "",
            placeholder: "ID",
            title: offhandDisabled
              ? "Disabled because Main Hand is two-handed"
              : "Press Enter or leave the field to look up",
            disabled: offhandDisabled,
          });
          configureIntegerField(id, "Item ID", {
            min: 1,
            max: 999999,
            optional: true,
          });
          const lookup = async () => {
            if (!id.value) {
              clearSlotItem(item);
              renderGear();
              return;
            }
            if (!id.checkValidity()) {
              id.reportValidity();
              return;
            }
            $("#status").textContent =
              `Looking up item ${id.value}${item.randomEnchantId ? ` variant ${item.randomEnchantId}` : ""}…`;
            $("#status").className = "status";
            try {
              const source = await fillFromIdWithFallback(
                item,
                id.value,
                item.randomEnchantId,
              );
              enforceWeaponRules();
              renderGear();
              $("#status").textContent =
                `Loaded ${item.name} (${item.id})${source === "wowhead" ? " from Wowhead" : ""}.`;
              $("#status").className = "status good";
            } catch (e) {
              $("#status").textContent =
                `Item ${id.value} lookup failed: ${e.message}. You can enter it manually.`;
              $("#status").className = "status error";
            }
          };
          id.onchange = lookup;
          id.onkeydown = (e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              lookup();
            }
          };
          idTd.append(id);
          tr.append(idTd);
          appendItemEditorCell(
            tr,
            createItemEditorNameInput(item, {
              disabled: offhandDisabled,
              disabledValue: "Unavailable with two-handed weapon",
            }),
          );
          appendItemEditorCell(
            tr,
            createItemEditorStatInput(item, "Main Stat", {
              disabled: offhandDisabled,
            }),
          );
          STATS.forEach((stat) =>
            appendItemEditorCell(
              tr,
              createItemEditorStatInput(item, stat, {
                disabled: offhandDisabled,
              }),
            ),
          );
          const variantTd = el("td"),
            baseRecord = item.id && ITEM_DB[String(item.id)],
            variants = baseRecord?.v || [],
            variant = el("select", {
              disabled: offhandDisabled || !variants.length,
              title: variants.length
                ? "Item suffix or prefix"
                : "This item has no variants",
            });
          variant.append(
            el(
              "option",
              { value: "", selected: !item.randomEnchantId },
              variants.length ? "Base Item" : "Not Applicable",
            ),
          );
          variants.forEach((v) =>
            variant.append(
              el(
                "option",
                {
                  value: String(v.id),
                  selected: String(v.id) === String(item.randomEnchantId),
                },
                v.n,
              ),
            ),
          );
          variant.onchange = async () => {
            item.randomEnchantId = variant.value;
            await lookup();
          };
          variantTd.append(variant);
          tr.append(variantTd);
          const gemsTd = el("td"),
            fixedSocketCount = Math.min(
              MAX_GEMS,
              (baseRecord?.g || 0) + (item.slot === "Waist" ? 1 : 0),
            ),
            socketCount = Math.max(
              fixedSocketCount,
              (item.gemIds || []).length,
            );
          for (let socket = 0; socket < socketCount; socket++) {
            const socketRow = el("div", { className: "gear-socket" }),
              gem = el("select", {
                disabled: offhandDisabled,
                title:
                  item.slot === "Waist" && socket === fixedSocketCount - 1
                    ? "Ebonsteel Belt Buckle socket"
                    : `Gem socket ${socket + 1}`,
              });
            appendGemOptions(gem, item.gemIds?.[socket]);
            gem.onchange = () => {
              item.gemIds ??= [];
              item.gemIds[socket] = gem.value ? Number(gem.value) : 0;
              applySelectedGemColor(gem);
            };
            const nativeColor = baseRecord
              ? (baseRecord.k?.[socket] ||
                (item.slot === "Waist" && socket === fixedSocketCount - 1 ? 8 : 0))
              : 0;
            applyKnownSocketColor(gem, nativeColor);
            socketRow.append(gem);
            if (!baseRecord && socket >= fixedSocketCount) {
              const removeGem = el(
                "button",
                {
                  className: "icon-btn",
                  type: "button",
                  title: "Remove Custom Gem Socket",
                  ariaLabel: `Remove custom gem socket ${socket + 1}`,
                  disabled: offhandDisabled,
                },
                "×",
              );
              removeGem.onclick = () => {
                item.gemIds.splice(socket, 1);
                renderGear();
              };
              socketRow.append(removeGem);
            }
            gemsTd.append(socketRow);
          }
          if (!baseRecord && socketCount < MAX_GEMS) {
            const addGem = el(
              "button",
              {
                className: "secondary",
                type: "button",
                disabled: offhandDisabled,
              },
              "+ Gem",
            );
            addGem.onclick = () => {
              item.gemIds ??= [];
              while (item.gemIds.length < fixedSocketCount)
                item.gemIds.push(0);
              item.gemIds.push(0);
              renderGear();
            };
            gemsTd.append(addGem);
          }
          tr.append(gemsTd);
          const enchantsTd = el("td");
          const enchantSlot =
            item.slot === "Neck"
              ? null
              : item.slot === "Finger 2"
                ? "Finger 1"
                : item.slot === "Trinket 2"
                  ? "Trinket 1"
                  : item.slot === "Off hand"
                    ? "Main hand"
                    : item.slot;
          const availableEnchants = Object.entries(ENCHANT_DB)
            .filter(
              ([, record]) =>
                enchantSlot && !record.a && record.t === enchantSlot,
            )
            .sort((a, b) => a[1].n.localeCompare(b[1].n));
          const enchant = el("select", {
              disabled: offhandDisabled || !enchantSlot,
            }),
            currentEnchantId = enchantSlot
              ? String(item.enchantIds?.[0] || "")
              : "",
            currentAlias = ENCHANT_DB[currentEnchantId],
            choices = currentAlias?.a
              ? [[currentEnchantId, currentAlias], ...availableEnchants]
              : availableEnchants;
          enchant.append(
            el(
              "option",
              { value: "" },
              enchantSlot ? "No Enchant" : "Not Applicable",
            ),
          );
          choices.forEach(([enchantId, record]) =>
            enchant.append(
              el(
                "option",
                {
                  value: enchantId,
                  selected: currentEnchantId === enchantId,
                },
                record.n,
              ),
            ),
          );
          enchant.onchange = () =>
            (item.enchantIds = enchant.value ? [Number(enchant.value)] : []);
          enchantsTd.append(enchant);
          tr.append(enchantsTd);
          b.append(tr);
        });
      }
      function blankCandidate() {
        return { ...blankItem("Head"), slot: "Head", name: "Candidate item" };
      }
      function renderCandidates() {
        state.candidates ??= [];
        const body = $("#candidateBody");
        renderItemEditorHeader($("#candidateHead"), { includeActions: true });
        body.innerHTML = "";
        if (!state.candidates.length) {
          const emptyRow = el("tr", { className: "item-editor-empty" }),
            emptyCell = el("td", { colSpan: ITEM_EDITOR_COLUMNS.length + 1 });
          emptyCell.append(
            el(
              "div",
              { className: "item-editor-empty-message" },
              "No candidates added yet. Use Add Candidate to create one.",
            ),
          );
          emptyRow.append(emptyCell);
          body.append(emptyRow);
        }
        state.candidates.forEach((item, index) => {
          item.gemIds = [...(item.gemIds || [])].slice(0, MAX_GEMS);
          if (item.slot === "Finger 1" || item.slot === "Finger 2")
            item.slot = "Finger";
          const knownRecord = item.id && ITEM_DB[String(item.id)],
            knownTwoHanded = knownRecord?.h === 4,
            isTwoHanded = knownTwoHanded || Boolean(item.twoHanded),
            tr = el("tr"),
            slotTd = el("td"),
            slot = el("select");
          slot.disabled = Boolean(knownRecord?.t);
          slot.title = knownRecord?.t
            ? "Clear the Item ID to choose a different item type"
            : "Choose the candidate item type";
          [...SLOTS.filter((s) => !s.startsWith("Finger ")), "Finger"].forEach(
            (s) =>
              slot.append(
                el(
                  "option",
                  {
                    value: s,
                    selected:
                      s === item.slot && !(s === "Main hand" && isTwoHanded),
                  },
                  s,
                ),
              ),
          );
          slot.append(
            el(
              "option",
              {
                value: "Main hand (2H)",
                selected: item.slot === "Main hand" && isTwoHanded,
              },
              "Main hand (2H)",
            ),
          );
          slot.onchange = () => {
            item.twoHanded = slot.value === "Main hand (2H)";
            item.slot = item.twoHanded ? "Main hand" : slot.value;
            renderCandidates();
          };
          slotTd.append(slot);
          tr.append(slotTd);
          const idTd = el("td"),
            id = el("input", {
              type: "number",
              min: 1,
              value: item.id || "",
              placeholder: "Item ID",
            });
          configureIntegerField(id, "Item ID", {
            min: 1,
            max: 999999,
            optional: true,
          });
          const lookup = async () => {
            if (!id.value) {
              item.id = "";
              item.randomEnchantId = "";
              item.twoHanded = false;
              renderCandidates();
              return;
            }
            if (!id.checkValidity()) {
              id.reportValidity();
              return;
            }
            try {
              await fillFromIdWithFallback(
                item,
                id.value,
                item.randomEnchantId,
              );
              const record = ITEM_DB[String(item.id)];
              if (record?.t)
                item.slot = record.t.startsWith("Finger") ? "Finger" : record.t;
              renderCandidates();
              $("#status").textContent = `Loaded candidate ${item.name}.`;
              $("#status").className = "status good";
            } catch (e) {
              $("#status").textContent =
                `Candidate ${id.value} lookup failed: ${e.message}.`;
              $("#status").className = "status error";
            }
          };
          id.onchange = lookup;
          id.onkeydown = (e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              lookup();
            }
          };
          idTd.append(id);
          tr.append(idTd);
          appendItemEditorCell(
            tr,
            createItemEditorNameInput(item, { className: "item-name" }),
          );
          appendItemEditorCell(
            tr,
            createItemEditorStatInput(item, "Main Stat"),
          );
          STATS.forEach((stat) =>
            appendItemEditorCell(tr, createItemEditorStatInput(item, stat)),
          );
          const variantTd = el("td"),
            record = item.id && ITEM_DB[String(item.id)],
            variants = record?.v || [],
            variant = el("select", {
              disabled: !variants.length,
              title: variants.length
                ? "Item suffix or prefix"
                : "This item has no variants",
            });
          variant.append(
            el(
              "option",
              { value: "", selected: !item.randomEnchantId },
              variants.length ? "Base Item" : "Not Applicable",
            ),
          );
          variants.forEach((v) =>
            variant.append(
              el(
                "option",
                {
                  value: String(v.id),
                  selected: String(v.id) === String(item.randomEnchantId),
                },
                v.n,
              ),
            ),
          );
          variant.onchange = async () => {
            item.randomEnchantId = variant.value;
            await lookup();
          };
          variantTd.append(variant);
          tr.append(variantTd);
          const gemsTd = el("td"),
            fixedSocketCount = Math.min(
              MAX_GEMS,
              (record?.g || 0) + (item.slot === "Waist" ? 1 : 0),
            ),
            socketCount = Math.max(
              fixedSocketCount,
              (item.gemIds || []).length,
            );
          for (let socket = 0; socket < socketCount; socket++) {
            const socketRow = el("div", { className: "candidate-socket" }),
              gem = el("select", {
                title:
                  item.slot === "Waist" && socket === fixedSocketCount - 1
                    ? "Ebonsteel Belt Buckle socket"
                    : `Gem socket ${socket + 1}`,
              });
            appendGemOptions(gem, item.gemIds?.[socket]);
            gem.onchange = () => {
              item.gemIds ??= [];
              item.gemIds[socket] = gem.value ? Number(gem.value) : 0;
              applySelectedGemColor(gem);
            };
            const nativeColor = record
              ? (record.k?.[socket] ||
                (item.slot === "Waist" && socket === fixedSocketCount - 1 ? 8 : 0))
              : 0;
            applyKnownSocketColor(gem, nativeColor);
            socketRow.append(gem);
            if (!record && socket >= fixedSocketCount) {
              const removeGem = el(
                "button",
                {
                  className: "icon-btn",
                  type: "button",
                  title: "Remove custom gem socket",
                },
                "×",
              );
              removeGem.onclick = () => {
                item.gemIds.splice(socket, 1);
                renderCandidates();
              };
              socketRow.append(removeGem);
            }
            gemsTd.append(socketRow);
          }
          if (!record && socketCount < MAX_GEMS) {
            const addGem = el(
              "button",
              { className: "secondary", type: "button" },
              "+ Gem",
            );
            addGem.onclick = () => {
              item.gemIds ??= [];
              while (item.gemIds.length < fixedSocketCount)
                item.gemIds.push(0);
              item.gemIds.push(0);
              renderCandidates();
            };
            gemsTd.append(addGem);
          }
          tr.append(gemsTd);
          const enchantsTd = el("td"),
            enchantSlot =
              item.slot === "Neck"
                ? null
                : item.slot === "Finger"
                  ? "Finger 1"
                  : item.slot === "Finger 2"
                    ? "Finger 1"
                    : item.slot === "Trinket 2"
                      ? "Trinket 1"
                      : item.slot === "Off hand"
                        ? "Main hand"
                        : item.slot,
            availableEnchants = Object.entries(ENCHANT_DB)
              .filter(
                ([, enchantRecord]) =>
                  enchantSlot &&
                  !enchantRecord.a &&
                  enchantRecord.t === enchantSlot,
              )
              .sort((a, b) => a[1].n.localeCompare(b[1].n));
          const enchant = el("select", { disabled: !enchantSlot }),
            currentEnchantId = enchantSlot
              ? String(item.enchantIds?.[0] || "")
              : "",
            currentAlias = ENCHANT_DB[currentEnchantId],
            choices = currentAlias?.a
              ? [[currentEnchantId, currentAlias], ...availableEnchants]
              : availableEnchants;
          enchant.append(
            el(
              "option",
              { value: "" },
              enchantSlot ? "No Enchant" : "Not Applicable",
            ),
          );
          choices.forEach(([enchantId, enchantRecord]) =>
            enchant.append(
              el(
                "option",
                {
                  value: enchantId,
                  selected: currentEnchantId === enchantId,
                },
                enchantRecord.n,
              ),
            ),
          );
          enchant.onchange = () =>
            (item.enchantIds = enchant.value ? [Number(enchant.value)] : []);
          enchantsTd.append(enchant);
          tr.append(enchantsTd);
          const delTd = el("td"),
            del = el(
              "button",
              {
                className: "icon-btn",
                type: "button",
                title: "Remove candidate",
                ariaLabel: `Remove candidate ${index + 1}`,
              },
              "×",
            );
          del.onclick = () => {
            state.candidates.splice(index, 1);
            renderCandidates();
          };
          delTd.append(del);
          tr.append(delTd);
          body.append(tr);
        });
        updateComboEstimate();
      }
      function renderComboRules() {
        state.comboRules ??= [];
        const box = $("#comboRules");
        box.innerHTML = "";
        state.comboRules.forEach((rule, index) => {
          rule.slots = (rule.slots || []).filter((slot) =>
            LAB_SLOTS.includes(slot),
          );
          const row = el("div", { className: "candidate-rule" }),
            maximum = el("input", {
              type: "number",
              min: 0,
              value: rule.max,
              title: "Maximum candidates from the selected slots",
            }),
            slots = el("details", { className: "rule-slots" }),
            summary = el("summary", { className: "secondary" }),
            options = el("div", { className: "rule-slot-options" }),
            error = el("div", { className: "rule-error" });
          configureIntegerField(maximum, "Maximum candidate count");
          const validateRule = () => {
            let message = "";
            maximum.setCustomValidity("");
            if (!rule.slots.length)
              message = "Select at least one slot for this rule.";
            else if (!maximum.checkValidity())
              message = maximum.validationMessage;
            row.classList.toggle("invalid", Boolean(message));
            slots.classList.toggle("invalid", !rule.slots.length);
            error.textContent = message;
            return !message;
          };
          row.validateRule = validateRule;
          const updateSummary = () => {
            summary.textContent = rule.slots.length
              ? `${rule.slots.length} slot${rule.slots.length === 1 ? "" : "s"} selected ▾`
              : "Select slots ▾";
          };
          updateSummary();
          LAB_SLOTS.forEach((slotName) => {
            const checkbox = el("input", {
                type: "checkbox",
                checked: rule.slots.includes(slotName),
              }),
              label = el("label", {}, `<span>${slotName}</span>`);
            checkbox.onchange = () => {
              rule.slots = checkbox.checked
                ? [...new Set([...rule.slots, slotName])]
                : rule.slots.filter((slot) => slot !== slotName);
              updateSummary();
              validateRule();
              updateComboEstimate();
            };
            label.prepend(checkbox);
            options.append(label);
          });
          slots.append(summary, options);
          maximum.oninput = () => {
            rule.max = Math.max(0, Math.floor(n(maximum.value)));
            validateRule();
            updateComboEstimate();
          };
          const remove = el(
            "button",
            {
              className: "icon-btn",
              type: "button",
              title: "Remove Rule",
              ariaLabel: `Remove combination rule ${index + 1}`,
            },
            "×",
          );
          remove.onclick = () => {
            state.comboRules.splice(index, 1);
            renderComboRules();
            updateComboEstimate();
          };
          row.append(
            el("span", {}, "No more than"),
            maximum,
            el("span", {}, "candidates from"),
            slots,
            el("span", {}, "at once"),
            remove,
            error,
          );
          box.append(row);
          validateRule();
        });
        updateComboEstimate();
      }
      function validateComboRules(report = false) {
        const rows = [...document.querySelectorAll(".candidate-rule")],
          invalid = rows.find((row) => !row.validateRule());
        if (!invalid) return true;
        if (report) {
          const field = invalid.querySelector("input:invalid");
          if (field) field.reportValidity();
          else invalid.querySelector("summary")?.focus();
          invalid.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        return false;
      }
      function combinationWorkerSource() {
        return `
          const STATS = ${JSON.stringify(STATS)};
          const MAIN_STAT = ${JSON.stringify(MAIN_STAT)};
          const TOTAL_STATS = ${JSON.stringify(TOTAL_STATS)};
          const ITEM_DB = ${JSON.stringify(ITEM_DB)};
          const GEM_DB = ${JSON.stringify(GEM_DB)};
          const ENCHANT_DB = ${JSON.stringify(ENCHANT_DB)};
          let state;
          ${ReforgePlanner.model.number.toString()}
          ${ReforgePlanner.optimizer.equipmentBonuses.toString()}
          ${ReforgePlanner.optimizer.capScore.toString()}
          ${ReforgePlanner.optimizer.capAllows.toString()}
          ${ReforgePlanner.optimizer.optionsFor.toString()}
          ${ReforgePlanner.optimizer.optimize.toString()}
          ${ReforgePlanner.optimizer.compareOptimizedResults.toString()}
          self.onmessage = async ({ data }) => {
            try {
              state = data.state;
              const results = [];
              for (const gear of data.gears)
                results.push(await optimize(
                  gear,
                  state,
                  { itemDb: ITEM_DB, gemDb: GEM_DB, enchantDb: ENCHANT_DB },
                ));
              const result = results.sort((left, right) =>
                compareOptimizedResults(left, right, state.weights),
              )[0];
              self.postMessage({ result });
            } catch (error) {
              self.postMessage({ error: error?.message || String(error) });
            }
          };
        `;
      }
      async function runCombinationWorkers(iterator, total, onProgress) {
        if (typeof Worker === "undefined")
          throw Error("This browser does not support background workers.");
        const maximumWorkers = Math.max(
            1,
            Math.min(4, (navigator.hardwareConcurrency || 2) - 1),
          ),
          workerCount = Math.min(
            maximumWorkers,
            total > BigInt(maximumWorkers) ? maximumWorkers : Number(total),
          ),
          workerState = {
            weights: structuredClone(state.weights),
            baseline: structuredClone(state.baseline),
            caps: structuredClone(state.caps),
          },
          url = URL.createObjectURL(
            new Blob([combinationWorkerSource()], {
              type: "text/javascript",
            }),
          ),
          workers = Array.from({ length: workerCount }, () => new Worker(url)),
          records = [];
        let processed = 0n,
          remainingWorkers = workers.length,
          settled = false;
        const stopWorkers = () => {
          workers.forEach((worker) => worker.terminate());
          URL.revokeObjectURL(url);
        };
        return new Promise((resolve, reject) => {
          const finishWorker = (worker) => {
            worker.terminate();
            remainingWorkers--;
            if (!remainingWorkers && !settled) {
              settled = true;
              URL.revokeObjectURL(url);
              resolve({ records, processed });
            }
          };
          const fail = (message) => {
            if (settled) return;
            settled = true;
            stopWorkers();
            reject(Error(message));
          };
          const dispatch = (worker) => {
            if (comboStopRequested) {
              finishWorker(worker);
              return;
            }
            let next = iterator.next();
            while (!next.done) {
              const combo = next.value,
                gears = comboGearVariants(combo);
              if (gears.length) {
                worker.currentCombo = combo;
                worker.postMessage({ gears, state: workerState });
                return;
              }
              processed++;
              onProgress(processed);
              next = iterator.next();
            }
            finishWorker(worker);
          };
          workers.forEach((worker) => {
            worker.onmessage = ({ data }) => {
              if (data.error) {
                fail(data.error);
                return;
              }
              records.push({ combo: worker.currentCombo, result: data.result });
              processed++;
              onProgress(processed);
              dispatch(worker);
            };
            worker.onerror = (event) =>
              fail(event.message || "Combination worker failed");
            dispatch(worker);
          });
        });
      }
      function updateComboEstimate() {
        if (!validateComboRules(false)) {
          $("#comboEstimate").textContent =
            "Fix invalid Combination Rules to calculate X/N.";
          return;
        }
        const count = Math.max(
          1,
          Math.floor(n($("#comboCount")?.value || state.comboCount || 1)),
        );
        state.comboCount = count;
        const method =
          $("#comboMethod")?.value || state.comboMethod || "exactly";
        state.comboMethod = method;
        const valid = (state.candidates || []).filter(candidateIsUsable);
        if (!valid.length && method !== "atmost") {
          $("#comboEstimate").textContent = "Add candidates to begin.";
          return;
        }
        const total = countCandidateRange(valid, count, method);
        $("#comboEstimate").textContent =
          `${formatCount(total)} valid combination${total === 1n ? "" : "s"}.`;
      }
      function capSummary(caps) {
        const active = caps.filter((c) => c.stat !== "None");
        if (!active.length) return "No breakpoints";
        return active
          .map((c) => {
            const hard = c.rules
              .filter((x) => x.method !== "new")
              .map(
                (x) =>
                  `${x.method === "atleast" ? "≥" : x.method === "atmost" ? "≤" : "="}${x.value}`,
              )
              .join(", ");
            return `${c.stat} ${hard || "target"}: ${c.value} ${c.met ? "✓" : "✕"}`;
          })
          .join(" · ");
      }
      function resultSummaryHtml(r) {
        const changes = r.picked.filter((choice) => choice.src).length;
        return `<div class="metric"><span>Equipped Slots</span><b>${r.equippedCount}</b><small>${r.items.length} contain reforgable stats</small></div><div class="metric"><span>Reforges</span><b>${changes}</b></div><div class="metric"><span>Breakpoints</span><b class="${r.allCapsMet ? "metric-good" : "metric-bad"}">${r.allCapsMet ? "Met" : "Not Met"}</b><small>${esc(capSummary(r.capResults))}</small></div>`;
      }
      function showResults(r) {
        lastResult = r;
        $("#results").style.display = "block";
        $("#resultsBody").hidden = false;
        $("#toggleResults").textContent = "Minimize ▴";
        $("#toggleResults").setAttribute("aria-expanded", "true");
        $("#summary").innerHTML = resultSummaryHtml(r);
        $("#statDelta").innerHTML = TOTAL_STATS.map((s) => {
          const d = r.totals[s] - r.base[s];
          return `<tr><td>${s}</td><td>${r.base[s]}</td><td class="${d > 0 ? "plus" : d < 0 ? "minus" : ""}">${d >= 0 ? "+" : ""}${d}</td><td>${r.totals[s]}</td></tr>`;
        }).join("");
        $("#resultBody").innerHTML = r.items
          .map((item, i) => {
            const o = r.picked[i];
            return `<tr><td>${esc(item.name || `Item ${i + 1}`)}</td><td>${o.src ? `${o.src} <span class="arrow">→</span> ${o.dst}` : "No reforge"}</td><td>${o.amount || "—"}</td></tr>`;
          })
          .join("");
        $("#results").scrollIntoView({ behavior: "smooth", block: "start" });
      }
      function restoreSetupJson(text) {
        const x = parseSetup(text);
        state = {
          weights: { ...defaults().weights, ...x.weights },
          baseline: { ...defaults().baseline, ...x.baseline },
          caps: x.caps,
          items: fixedSlotItems(x.items),
          candidates: (x.candidates || []).map(normalizeCandidate),
          comboRules: x.comboRules || [],
          comboCount: x.comboCount || 1,
          comboMethod: x.comboMethod || "exactly",
        };
        enforceWeaponRules();
        renderWeights();
        renderBaseline();
        renderCaps();
        renderGear();
        $("#comboCount").value = state.comboCount || 1;
        $("#comboMethod").value = state.comboMethod || "exactly";
        renderCandidates();
        renderComboRules();
        scheduleCurrentSetupSave();
      }
      function renderComboResults(records, total, stopped = false) {
        const compareRecords = (left, right) =>
          compareOptimizedResults(left.result, right.result);
        const defaultOrder = records.slice().sort(compareRecords),
          defaultRank = new Map(
            defaultOrder.map((record, index) => [record, index + 1]),
          ),
          sortValue = (record, key) => {
            if (key === "rank") return defaultRank.get(record);
            if (key === "candidates")
              return record.combo
                .map((item) => `${item.slot}: ${item.name}`)
                .join(" | ");
            if (key === "caps")
              return (
                Number(record.result.allCapsMet) * 100 +
                record.result.capResults.filter(
                  (cap) => cap.stat !== "None" && cap.met,
                ).length
              );
            return n(record.result.totals[key]);
          };
        comboRunResults = defaultOrder.slice();
        if (comboSort.key) {
          const direction = comboSort.direction === "desc" ? -1 : 1;
          comboRunResults.sort((left, right) => {
            const a = sortValue(left, comboSort.key),
              b = sortValue(right, comboSort.key),
              comparison =
                typeof a === "string"
                  ? a.localeCompare(b)
                  : n(a) === n(b)
                    ? 0
                    : n(a) < n(b)
                      ? -1
                      : 1;
            return comparison * direction || compareRecords(left, right);
          });
        }
        $("#comboResults").style.display = "block";
        $("#comboSummary").textContent =
          `${formatCount(records.length)} optimized results from ${formatCount(total)} processed combinations${stopped ? " before stopping" : ""}. Default ranking: breakpoint success, then all stats by configured weight.`;
        $("#comboBody").innerHTML = comboRunResults
          .map((record, index) => {
            const result = record.result,
              statRows = TOTAL_STATS.map((stat) => {
                const change = result.totals[stat] - result.base[stat];
                return `<tr><td>${stat}</td><td>${result.base[stat]}</td><td class="${change > 0 ? "plus" : change < 0 ? "minus" : ""}">${change >= 0 ? "+" : ""}${change}</td><td>${result.totals[stat]}</td></tr>`;
              }).join(""),
              reforgeRows = result.items
                .map((item, itemIndex) => {
                  const choice = result.picked[itemIndex],
                    recommendation = choice.src
                      ? `${choice.src} <span class="arrow">→</span> ${choice.dst}`
                      : "No reforge";
                  return `<tr><td>${esc(item.name || `Item ${itemIndex + 1}`)}</td><td>${recommendation}</td><td>${choice.amount || "—"}</td></tr>`;
                })
                .join("");
            let displayedRing = 0;
            const equippedCandidates = record.combo.length
              ? record.combo
                  .map((item) => {
                    const slotName =
                      item.slot === "Finger"
                        ? record.combo.fingerSlots?.[displayedRing++] ||
                          "Finger"
                        : item.slot;
                    return `${esc(slotName)}: ${esc(item.name)}`;
                  })
                  .join("<br>")
              : "Base set (no candidates)";
            const originalRank = defaultRank.get(record),
              detailId = `combo-detail-${originalRank}`;
            return `<tr class="combo-main-row" tabindex="0" role="button" aria-expanded="false" aria-controls="${detailId}" aria-label="Toggle details for original result ${originalRank}" data-detail-id="${detailId}"><td>${originalRank}</td><td>${equippedCandidates}</td><td class="${result.allCapsMet ? "cap-ok" : "cap-bad"}">${esc(capSummary(result.capResults))}</td>${TOTAL_STATS.map((stat) => `<td>${result.totals[stat]}</td>`).join("")}</tr><tr class="combo-detail-row" id="${detailId}" hidden><td colspan="${TOTAL_STATS.length + 3}"><div class="summary">${resultSummaryHtml(result)}</div><div class="result-detail-grid"><section><h3 class="section-title">Final Stats</h3><div class="final-stats"><table aria-label="Final stats for original result ${originalRank}"><thead><tr><th scope="col">Stat</th><th scope="col">Before</th><th scope="col">Change</th><th scope="col">Final</th></tr></thead><tbody>${statRows}</tbody></table></div></section><section><h3 class="section-title">Per-Item Reforges</h3><div class="result-table-wrap"><table class="result-table" aria-label="Per-item reforges for original result ${originalRank}"><thead><tr><th scope="col">Item</th><th scope="col">Recommendation</th><th scope="col">Amount</th></tr></thead><tbody>${reforgeRows}</tbody></table></div></section></div></td></tr>`;
          })
          .join("");
        document.querySelectorAll(".combo-sort").forEach((button) => {
          const active = comboSort.key === button.dataset.sort;
          button.querySelector(".sort-indicator").textContent = active
            ? comboSort.direction === "desc"
              ? "▾"
              : "▴"
            : "";
          button.closest("th").setAttribute(
            "aria-sort",
            active
              ? comboSort.direction === "desc"
                ? "descending"
                : "ascending"
              : "none",
          );
          button.title = active
            ? `Sorted ${comboSort.direction === "desc" ? "highest to lowest" : "lowest to highest"}; click again`
            : "Click to sort highest to lowest";
          button.onclick = () => {
            if (comboSort.key !== button.dataset.sort)
              comboSort = { key: button.dataset.sort, direction: "desc" };
            else if (comboSort.direction === "desc")
              comboSort.direction = "asc";
            else comboSort = { key: null, direction: null };
            renderComboResults(records, total, stopped);
          };
        });
        document.querySelectorAll(".combo-main-row").forEach((row) => {
          const toggleDetails = () => {
            const detail = document.getElementById(row.dataset.detailId),
              opening = detail.hidden;
            detail.hidden = !opening;
            row.setAttribute("aria-expanded", String(opening));
          };
          row.onclick = toggleDetails;
          row.onkeydown = (event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            toggleDetails();
          };
        });
      }
      $("#addCandidate").onclick = () => {
        state.candidates ??= [];
        state.candidates.push(blankCandidate());
        renderCandidates();
      };
      $("#addComboRule").onclick = () => {
        state.comboRules ??= [];
        state.comboRules.push({ max: 1, slots: [] });
        renderComboRules();
      };
      $("#comboCount").oninput = () => updateComboEstimate();
      $("#comboMethod").onchange = () => updateComboEstimate();
      $("#stopCombos").onclick = () => {
        comboStopRequested = true;
        $("#stopCombos").disabled = true;
        $("#comboProgress").textContent += " · stopping…";
      };
      $("#runCombos").onclick = async () => {
        const runButton = $("#runCombos"),
          stopButton = $("#stopCombos"),
          spinner = $("#comboSpinner"),
          progress = $("#comboProgress"),
          count = Math.max(1, Math.floor(n($("#comboCount").value))),
          method = $("#comboMethod").value;
        if (!reportInvalidWithin("#comboLab") || !validateComboRules(true)) {
          $("#status").textContent =
            "Fix the highlighted Combination Lab fields before comparing.";
          $("#status").className = "status error";
          return;
        }
        state.comboCount = count;
        state.comboMethod = method;
        const total = countCandidateRange(
          state.candidates || [],
          count,
          method,
        );
        if (total === 0n) {
          $("#status").textContent =
            "No slot-valid combinations match that candidate count.";
          $("#status").className = "status error";
          return;
        }
        comboStopRequested = false;
        comboRunResults = [];
        comboSort = { key: null, direction: null };
        runButton.disabled = true;
        stopButton.disabled = false;
        spinner.hidden = false;
        $("#comboResults").style.display = "none";
        progress.textContent = `0 / ${formatCount(total)} combinations finished`;
        let processed = 0n;
        try {
          const run = await runCombinationWorkers(
            iterateCandidateRange(state.candidates || [], count, method),
            total,
            (finished) => {
              progress.textContent = `${formatCount(finished)} / ${formatCount(total)} combinations finished`;
            },
          );
          comboRunResults = run.records;
          processed = run.processed;
          renderComboResults(comboRunResults, total, comboStopRequested);
          $("#status").textContent = comboStopRequested
            ? `Combination run stopped after ${formatCount(processed)} of ${formatCount(total)}.`
            : `Processed all ${formatCount(total)} combinations.`;
          $("#status").className = comboStopRequested
            ? "status"
            : "status good";
        } catch (e) {
          $("#status").textContent =
            `Combination comparison failed: ${e.message}`;
          $("#status").className = "status error";
          if (comboRunResults.length)
            renderComboResults(comboRunResults, total, true);
        } finally {
          runButton.disabled = false;
          stopButton.disabled = true;
          spinner.hidden = true;
        }
      };
      $("#calculate").onclick = async () => {
        const btn = $("#calculate"),
          status = $("#status");
        if (!reportInvalidWithin(".grid")) {
          status.textContent =
            "Fix the highlighted settings or gear fields before optimizing.";
          status.className = "status error";
          return;
        }
        btn.disabled = true;
        status.className = "status";
        try {
          lastResult = await calculate();
          showResults(lastResult);
          status.textContent = "Optimization complete.";
          status.className = "status good";
        } catch (e) {
          status.textContent = e.message;
          status.className = "status error";
        } finally {
          btn.disabled = false;
        }
      };
      $("#resetWeights").onclick = () => {
        state.weights = Object.fromEntries(TOTAL_STATS.map((s) => [s, 0]));
        renderWeights();
      };
      const modal = $("#modal"),
        setupDialog = ReforgePlanner.modal.createModalController(modal),
        setupDialogTitle = $("#setupDialogTitle"),
        setupDialogDescription = $("#setupDialogDescription"),
        dataBox = $("#dataBox"),
        copyDataButton = $("#copyData"),
        importDataButton = $("#importData");
      $("#openImport").onclick = () => {
        setupDialogTitle.textContent = "Import JSON";
        setupDialogDescription.textContent =
          "Paste a Reforge Planner setup JSON export to restore the whole setup.";
        dataBox.value = "";
        dataBox.readOnly = false;
        copyDataButton.hidden = true;
        importDataButton.hidden = false;
        setupDialog.open(dataBox);
      };
      $("#exportJson").onclick = () => {
        setupDialogTitle.textContent = "Export JSON";
        setupDialogDescription.textContent =
          "Copy this JSON to save or transfer the complete Reforge Planner setup.";
        dataBox.value = serialize();
        dataBox.readOnly = true;
        copyDataButton.hidden = false;
        importDataButton.hidden = true;
        setupDialog.open(dataBox);
        dataBox.select();
      };
      $("#closeModal").onclick = setupDialog.close;
      copyDataButton.onclick = () =>
        navigator.clipboard.writeText(dataBox.value);
      importDataButton.onclick = () => {
        try {
          restoreSetupJson(dataBox.value.trim());
          setupDialog.close();
          $("#status").textContent = "JSON import complete.";
          $("#status").className = "status good";
        } catch (e) {
          alert("Import failed: " + e.message);
        }
      };
      const wowheadModal = $("#wowheadModal"),
        wowheadDialog =
          ReforgePlanner.modal.createModalController(wowheadModal);
      $("#openWowhead").onclick = () => {
        wowheadDialog.open($("#wowheadLink"));
      };
      const closeWowhead = wowheadDialog.close;
      $("#closeWowhead").onclick = closeWowhead;
      $("#cancelWowhead").onclick = closeWowhead;
      $("#importWowhead").onclick = async () => {
        const button = $("#importWowhead");
        button.disabled = true;
        try {
          const importText = $("#wowheadLink").value.trim();
          if (importText.startsWith("{")) {
            restoreSetupJson(importText);
            closeWowhead();
            $("#status").textContent =
              "Reforge Planner setup imported from JSON.";
            $("#status").className = "status good";
            return;
          }
          const parsed = parseWowheadGearPlanner(importText),
            missing = [],
            items = fixedSlotItems();
          $("#status").textContent =
            `Resolving ${parsed.items.length} Wowhead item IDs and variants…`;
          await Promise.all(
            parsed.items.map(async (source) => {
              const item = items.find((item) => item.slot === source.slotName);
              if (!item) return;
              item.id = String(source.itemId);
              item.randomEnchantId =
                source.randomEnchantId == null
                  ? ""
                  : String(source.randomEnchantId);
              item.gemIds = (source.gemIds || []).slice(0, MAX_GEMS);
              item.enchantIds = (source.enchantIds || []).slice(0, 1);
              try {
                await fillFromIdWithFallback(
                  item,
                  source.itemId,
                  item.randomEnchantId,
                );
              } catch {
                item.name = `Unknown item ${source.itemId}${item.randomEnchantId ? ` (${item.randomEnchantId})` : ""}`;
                missing.push(source.itemId);
              }
            }),
          );
          state.items = items;
          enforceWeaponRules();
          renderGear();
          scheduleCurrentSetupSave();
          closeWowhead();
          const warnings = [];
          if (missing.length)
            warnings.push(
              `${missing.length} items or variants could not be resolved`,
            );
          $("#status").textContent =
            `Imported ${parsed.items.length} items with encoded variants, gems, and enchants${warnings.length ? `; ${warnings.join("; ")}` : ""}.`;
          $("#status").className = warnings.length
            ? "status error"
            : "status good";
        } catch (e) {
          alert("Wowhead import failed: " + e.message);
        } finally {
          button.disabled = false;
        }
      };
      $("#copyResults").onclick = () => {
        if (!lastResult) return;
        const t = lastResult.items
          .map((i, k) => {
            const o = lastResult.picked[k];
            return `${i.name}: ${o.src ? `${o.src} -> ${o.dst} (${o.amount})` : "No reforge"}`;
          })
          .join("\n");
        navigator.clipboard.writeText(t);
      };
      $("#toggleResults").onclick = () => {
        const body = $("#resultsBody"),
          collapsed = !body.hidden;
        body.hidden = collapsed;
        $("#toggleResults").textContent = collapsed ? "Expand ▾" : "Minimize ▴";
        $("#toggleResults").setAttribute("aria-expanded", String(!collapsed));
      };
      configureIntegerField($("#comboCount"), "Candidate count", { min: 1 });
      let restoredCurrentSetup = false;
      try {
        const savedSetup = loadCurrentSetup();
        if (savedSetup) {
          restoreSetupJson(savedSetup);
          restoredCurrentSetup = true;
        }
      } catch (error) {
        console.warn("Ignoring an invalid saved Reforge Planner setup.", error);
      }
      if (!restoredCurrentSetup) {
        renderWeights();
        renderBaseline();
        renderCaps();
        renderGear();
        $("#comboCount").value = state.comboCount || 1;
        $("#comboMethod").value = state.comboMethod || "exactly";
        renderCandidates();
        renderComboRules();
        scheduleCurrentSetupSave();
      }
      ["input", "change", "click"].forEach((eventName) =>
        document.addEventListener(eventName, scheduleCurrentSetupSave),
      );
      window.addEventListener("pagehide", persistCurrentSetup);

      const footerYear = document.getElementById("footerYear");
      if (footerYear) {
        const startYear = 2026;
        const currentYear = new Date().getFullYear();
        footerYear.textContent =
          currentYear > startYear
            ? `${startYear}–${currentYear}`
            : String(startYear);
      }
})();
