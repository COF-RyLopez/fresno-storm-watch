# Calcite reference for this repo (generated, verified)

Companion to `SKILL.md`. Everything here was extracted from shipped files, not typed from memory:

- **Properties / methods**: the component registry in `https://js.arcgis.com/calcite-components/5.1.1/index.js`
  (the exact build the app loads via `https://js.arcgis.com/5.1/`). camelCase JS property; the HTML attribute is the
  kebab-case form (`iconStart` -> `icon-start`). A trailing `*` = property-only (object/array/function or read-only):
  set it from JS, there is no attribute.
- **CSS variables**: names listed on the component's docs page (developers.arcgis.com, which documents 5.2) **and**
  present in that component's 5.1.1 shipped chunk. Deprecated docs entries are omitted. Docs-only (5.2) names are omitted.
- Events and slots are in `SKILL.md`; full prose lives at
  `https://developers.arcgis.com/calcite-design-system/components/<name>/`.

## Properties and methods (Calcite 5.1.1)

- **calcite-shell**: contentBehind
- **calcite-shell-panel**: collapsed, displayMode, height, heightScale, layout, position, resizable, width, widthScale  
  methods: updateSize()
- **calcite-panel**: beforeClose*, closable, closed, collapsed, collapseDirection, collapsible, description, disabled, heading, headingLevel, icon, iconFlipRtl, loading, menuFlipPlacements*, menuOpen, menuPlacement, overlayPositioning, scale, topLayerDisabled  
  methods: scrollContentTo, setFocus()
- **calcite-flow**: customItemSelectors  
  methods: back, setFocus()
- **calcite-flow-item**: beforeBack*, beforeClose*, closable, closed, collapsed, collapseDirection, collapsible, description, disabled, heading, headingLevel, icon, iconFlipRtl, loading, menuOpen, overlayPositioning, scale, selected, showBackButton, topLayerDisabled  
  methods: scrollContentTo, setFocus()
- **calcite-block**: addToItems*, collapsible, description, disabled, dragDisabled, dragHandle, expanded, heading, headingLevel, iconEnd, iconFlipRtl, iconStart, label, loading, menuFlipPlacements*, menuPlacement, moveToItems*, open, overlayPositioning, scale, setPosition, setSize, sortDisabled, sortHandleOpen, status, topLayerDisabled  
  methods: setFocus()
- **calcite-block-group**: canPull*, canPut*, disabled, dragEnabled, group, label, loading, scale, sortDisabled  
  methods: setFocus, emitOrderChangeEvent()
- **calcite-action**: active, activeDescendant, alignment, appearance, aria*, compact, disabled, dragHandle, form, icon, iconFlipRtl, indicator, label, loading, overflowDisabled, scale, selectionAppearance, text, textEnabled, type, width  
  methods: setFocus()
- **calcite-action-bar**: actionsEndGroupLabel, actionsStartGroupLabel, expandDisabled, expanded, expandPosition, floating, layout, overflowActionsDisabled, overlayPositioning, position, scale, selectionAppearance  
  methods: overflowActions, setFocus()
- **calcite-action-group**: columns, expanded, label, layout, menuFlipPlacements*, menuOpen, menuPlacement, overflowActionsDisabled, overlayPositioning, scale, selectedActions*, selectionMode, topLayerDisabled  
  methods: setFocus()
- **calcite-action-menu**: appearance, expanded, flipPlacements*, label, open, overlayPositioning, placement, scale, topLayerDisabled  
  methods: setFocus()
- **calcite-list**: canPull*, canPut*, disabled, displayMode, dragEnabled, filteredData*, filteredItems*, filterEnabled, filterLabel, filterPlaceholder, filterPredicate*, filterProps*, filterText, group, interactionMode, label, loading, numberingSystem, scale, selectedItems*, selectionAppearance, selectionMode, sortDisabled  
  methods: setFocus, emitOrderChangeEvent()
- **calcite-list-item**: active, addToItems*, bordered, closable, closed, description, disabled, displayMode, dragDisabled, dragHandle, expanded, filterHidden, iconEnd, iconFlipRtl, iconStart, interactionMode, label, metadata*, moveToItems*, open, scale, selected, selectionAppearance, selectionMode, setPosition, setSize, sortDisabled, sortHandleOpen, topLayerDisabled, unavailable, value  
  methods: setFocus()
- **calcite-list-item-group**: disabled, filterHidden, heading, scale
- **calcite-notice**: appearance, closable, icon, iconFlipRtl, kind, open, scale, width  
  methods: setFocus()
- **calcite-alert**: active, autoClose, autoCloseDuration, embedded, icon, iconFlipRtl, kind, label, numberingSystem, open, openAlertCount, placement, queue, scale, topLayerDisabled  
  methods: setFocus()
- **calcite-dialog**: beforeClose*, closeDisabled, description, dragEnabled, embedded, escapeDisabled, focusTrapDisabled, focusTrapOptions*, fullscreenDisabled, heading, headingLevel, icon, iconFlipRtl, kind, loading, menuOpen, modal, open, outsideCloseDisabled, overlayPositioning, placement, resizable, scale, topLayerDisabled, width, widthScale  
  methods: scrollContentTo, setFocus, updateFocusTrapElements, updateSize()
- **calcite-sheet**: beforeClose*, displayMode, embedded, escapeDisabled, focusTrapDisabled, focusTrapOptions*, height, heightScale, label, messages*, open, opened, outsideCloseDisabled, position, resizable, topLayerDisabled, width, widthScale  
  methods: setFocus, updateFocusTrapElements, updateSize()
- **calcite-popover**: autoClose, closable, flipDisabled, flipPlacements*, focusTrapDisabled, focusTrapOptions*, heading, headingLevel, label, offsetDistance, offsetSkidding, open, overlayPositioning, placement, pointerDisabled, referenceElement, scale, topLayerDisabled, triggerDisabled  
  methods: reposition, setFocus, updateFocusTrapElements()
- **calcite-tooltip**: closeOnClick, label, offsetDistance, offsetSkidding, open, overlayPositioning, placement, pointerDisabled, referenceElement, scale, topLayerDisabled  
  methods: reposition()
- **calcite-chip**: appearance, closable, closed, closeOnDelete, disabled, icon, iconFlipRtl, interactive, kind, label, parentChipGroup*, scale, selected, selectionMode, value  
  methods: setFocus()
- **calcite-chip-group**: disabled, label, scale, selectedItems*, selectionMode  
  methods: setFocus()
- **calcite-button**: alignment, appearance, disabled, download, form, href, iconEnd, iconFlipRtl, iconStart, kind, label, loading, name, rel, round, scale, splitChild, target, type, width  
  methods: setFocus()
- **calcite-link**: disabled, download, href, iconEnd, iconFlipRtl, iconStart, rel, target  
  methods: setFocus()
- **calcite-fab**: appearance, disabled, icon, iconFlipRtl, kind, label, loading, scale, text, textEnabled  
  methods: setFocus()
- **calcite-input**: accept, alignment, autocomplete, clearable, disabled, editingEnabled, files*, form, groupSeparator, icon, iconFlipRtl, label, labelText, loading, localeFormat, max, maxLength, min, minLength, multiple, name, numberButtonType, numberingSystem, pattern, placeholder, prefixText, readOnly, required, scale, status, step, suffixText, type, validationIcon, validationMessage, validity*, value  
  methods: selectText, setFocus()
- **calcite-input-text**: alignment, autocomplete, clearable, disabled, editingEnabled, form, icon, iconFlipRtl, label, labelText, loading, maxLength, minLength, name, pattern, placeholder, prefixText, readOnly, required, scale, status, suffixText, validationIcon, validationMessage, validity*, value  
  methods: selectText, setFocus()
- **calcite-input-number**: alignment, autocomplete, clearable, disabled, editingEnabled, form, groupSeparator, icon, iconFlipRtl, integer, label, labelText, loading, localeFormat, max, maxLength, min, minLength, name, numberButtonType, numberingSystem, placeholder, prefixText, readOnly, required, scale, status, step, suffixText, validationIcon, validationMessage, validity*, value  
  methods: selectText, setFocus()
- **calcite-text-area**: columns, disabled, form, groupSeparator, label, labelText, limitText, loading, maxLength, minLength, name, numberingSystem, placeholder, readOnly, required, resize, rows, scale, status, validationIcon, validationMessage, validity*, value, wrap  
  methods: selectText, setFocus()
- **calcite-select**: disabled, form, label, labelText, name, required, scale, selectedOption*, status, validationIcon, validationMessage, validity*, value, width  
  methods: setFocus()
- **calcite-option**: disabled, label, selected, value
- **calcite-combobox**: allowCustomValues, clearDisabled, disabled, filteredItems*, filterProps*, filterText, flipPlacements*, form, label, labelText, maxItems, name, open, overlayPositioning, placeholder, placeholderIcon, placeholderIconFlipRtl, placement, readOnly, required, scale, selectAllEnabled, selectedItems*, selectionAppearance, selectionDisplay, selectionMode, status, topLayerDisabled, validationIcon, validationMessage, validity*, value  
  methods: reposition, setFocus()
- **calcite-combobox-item**: active, ancestors*, description, disabled, filterDisabled, filterTextMatchPattern, guid, heading, icon, iconFlipRtl, indeterminate, itemHidden, label, metadata*, scale, selected, selectionAppearance, selectionMode, shortHeading, value  
  methods: toggleSelection()
- **calcite-segmented-control**: appearance, disabled, form, labelText, layout, name, required, scale, selectedItem*, status, validationIcon, validationMessage, validity*, value, width  
  methods: setFocus()
- **calcite-segmented-control-item**: appearance, checked, iconEnd, iconFlipRtl, iconStart, layout, scale, value
- **calcite-switch**: checked, disabled, form, label, labelTextEnd, labelTextStart, name, scale, value  
  methods: setFocus()
- **calcite-checkbox**: checked, disabled, form, hovered, indeterminate, label, labelText, name, required, scale, status, validity*, value  
  methods: setFocus()
- **calcite-radio-button-group**: disabled, labelText, layout, name, required, scale, selectedItem*, status, validationIcon, validationMessage  
  methods: setFocus()
- **calcite-radio-button**: checked, disabled, focused, form, hovered, label, labelText, name, required, scale, status, validationMessage, validity*, value  
  methods: emitCheckedChange, setFocus, setValidity()
- **calcite-slider**: disabled, fillPlacement, form, groupSeparator, hasHistogram, histogram*, histogramStops*, labelFormatter*, labelHandles, labelText, labelTicks, max, maxLabel, maxValue, min, minLabel, minValue, mirrored, name, numberingSystem, pageStep, precise, required, scale, snap, status, step, ticks, validationIcon, validationMessage, validity*, value  
  methods: setFocus()
- **calcite-label**: alignment, for, layout, scale
- **calcite-loader**: complete, inline, label, messages*, scale, text, type, value
- **calcite-progress**: label, reversed, text, type, value
- **calcite-tabs**: bordered, layout, position, scale
- **calcite-tab-nav**: bordered, layout, position, scale, selectedTitle*, storageId, syncId
- **calcite-tab-title**: bordered, closable, closed, disabled, iconEnd, iconFlipRtl, iconStart, layout, position, scale, selected, tab  
  methods: activateTab, getTabIdentifier, getTabIndex()
- **calcite-tab**: scale, selected, tab  
  methods: getTabIndex()
- **calcite-table**: bordered, caption, currentPage, groupSeparator, interactionMode, layout, numbered, numberingSystem, pageSize, scale, selectedItems*, selectionDisplay, selectionMode, striped
- **calcite-table-row**: alignment, bodyRowCount, cellCount, disabled, interactionMode, itemHidden, lastVisibleRow, numbered, positionAll, positionSection, positionSectionLocalized, readCellContentsToAT, rowType, scale, selected, selectedRowCount, selectedRowCountLocalized, selectionMode
- **calcite-table-header**: alignment, bodyRowCount, colSpan, description, heading, interactionMode, lastCell, numberCell, parentRowAlignment, parentRowIsSelected, parentRowType, positionInRow, rowSpan, scale, selectedRowCount, selectedRowCountLocalized, selectionCell, selectionMode  
  methods: setFocus()
- **calcite-table-cell**: alignment, colSpan, disabled, interactionMode, lastCell, numberCell, parentRowAlignment, parentRowIsSelected, parentRowPositionLocalized, parentRowType, positionInRow, readCellContentsToAT, rowSpan, scale, selectionCell  
  methods: setFocus()
- **calcite-meter**: appearance, disabled, fillType, form, groupSeparator, high, label, low, max, messages*, min, name, numberingSystem, rangeLabels, rangeLabelType, scale, unitLabel, value, valueLabel, valueLabelType
- **calcite-accordion**: appearance, iconPosition, iconType, scale, selectionMode
- **calcite-accordion-item**: accordionParent*, appearance, description, expanded, heading, headingLevel, iconEnd, iconFlipRtl, iconPosition, iconStart, iconType, scale  
  methods: setFocus()
- **calcite-card**: disabled, label, loading, scale, selectable, selected, selectionMode, thumbnailPosition  
  methods: setFocus()
- **calcite-card-group**: disabled, label, scale, selectedItems*, selectionMode  
  methods: setFocus()
- **calcite-tile**: active, alignment, description, disabled, embed, heading, headingLevel, href, icon, iconFlipRtl, interactive, label, layout, scale, selected, selectionAppearance, selectionMode  
  methods: setFocus()
- **calcite-navigation**: label, navigationAction, scale  
  methods: setFocus()
- **calcite-navigation-logo**: active, description, heading, headingLevel, href, icon, iconFlipRtl, label, rel, scale, target, thumbnail  
  methods: setFocus()
- **calcite-menu**: label, layout  
  methods: setFocus()
- **calcite-menu-item**: active, breadcrumb, href, iconEnd, iconFlipRtl, iconStart, isTopLevelItem, label, layout, open, rel, target, text, topLevelMenuLayout  
  methods: setFocus()
- **calcite-dropdown**: closeOnSelectDisabled, disabled, flipPlacements*, maxItems, offsetDistance, offsetSkidding, open, overlayPositioning, placement, referenceElement, scale, selectedItems*, topLayerDisabled, type, width, widthScale  
  methods: reposition, setFocus()
- **calcite-dropdown-group**: groupTitle, position, scale, selectionMode
- **calcite-dropdown-item**: activeDescendant, disabled, href, iconEnd, iconFlipRtl, iconStart, label, rel, scale, selected, selectionMode, target  
  methods: activateItem, setFocus()
- **calcite-icon**: flipRtl, icon, preload, scale, textLabel

(`messageOverrides*` exists on most components and is omitted above.)

## Component CSS variables (documented and present in 5.1.1)

- **calcite-shell**: --calcite-shell-border-color
- **calcite-shell-panel**: --calcite-shell-panel-background-color, --calcite-shell-panel-border-color, --calcite-shell-panel-corner-radius, --calcite-shell-panel-height, --calcite-shell-panel-max-height, --calcite-shell-panel-min-height, --calcite-shell-panel-max-width, --calcite-shell-panel-resize-icon-color, --calcite-shell-panel-shadow, --calcite-shell-panel-text-color, --calcite-shell-panel-width, --calcite-shell-panel-z-index
- **calcite-panel**: --calcite-panel-corner-radius, --calcite-panel-heading-text-color, --calcite-panel-icon-color, --calcite-panel-description-text-color, --calcite-panel-border-color, --calcite-panel-background-color, --calcite-panel-content-top-space, --calcite-panel-content-bottom-space, --calcite-panel-header-background-color, --calcite-panel-header-action-background-color, --calcite-panel-header-action-background-color-hover, --calcite-panel-header-action-background-color-press, --calcite-panel-header-action-text-color, --calcite-panel-header-action-text-color-press, --calcite-panel-footer-background-color, --calcite-panel-space, --calcite-panel-header-content-space, --calcite-panel-footer-space
- **calcite-flow**: --calcite-flow-background-color
- **calcite-block**: --calcite-block-border-color, --calcite-block-content-space, --calcite-block-header-background-color-hover, --calcite-block-header-background-color-press, --calcite-block-heading-text-color, --calcite-block-description-text-color, --calcite-block-icon-start-color, --calcite-block-icon-end-color
- **calcite-action**: --calcite-action-background-color-hover, --calcite-action-background-color-press, --calcite-action-background-color, --calcite-action-corner-radius, --calcite-action-indicator-color, --calcite-action-text-color-press, --calcite-action-text-color
- **calcite-action-bar**: --calcite-action-bar-background-color, --calcite-action-bar-corner-radius, --calcite-action-bar-expanded-max-width, --calcite-action-bar-items-space, --calcite-action-bar-shadow
- **calcite-list**: --calcite-list-background-color
- **calcite-list-item**: --calcite-list-background-color-hover, --calcite-list-background-color-press, --calcite-list-background-color, --calcite-list-border-color, --calcite-list-content-text-color, --calcite-list-description-text-color, --calcite-list-icon-color, --calcite-list-label-text-color, --calcite-list-selection-border-color
- **calcite-notice**: --calcite-notice-background-color, --calcite-notice-border-color, --calcite-notice-corner-radius, --calcite-notice-close-background-color, --calcite-notice-close-background-color-hover, --calcite-notice-close-background-color-press, --calcite-notice-close-icon-color-hover, --calcite-notice-close-icon-color, --calcite-notice-title-text-color, --calcite-notice-content-text-color, --calcite-notice-shadow
- **calcite-alert**: --calcite-alert-width, --calcite-alert-background-color, --calcite-alert-corner-radius, --calcite-alert-shadow, --calcite-alert-offset-size
- **calcite-dialog**: --calcite-dialog-scrim-background-color, --calcite-dialog-size-x, --calcite-dialog-min-size-x, --calcite-dialog-max-size-x, --calcite-dialog-size-y, --calcite-dialog-min-size-y, --calcite-dialog-max-size-y, --calcite-dialog-content-space, --calcite-dialog-content-top-space, --calcite-dialog-content-bottom-space, --calcite-dialog-footer-space, --calcite-dialog-border-color, --calcite-dialog-offset-x, --calcite-dialog-offset-y, --calcite-dialog-background-color, --calcite-dialog-icon-color, --calcite-dialog-accent-color, --calcite-dialog-corner-radius, --calcite-dialog-heading-text-color, --calcite-dialog-description-text-color, --calcite-dialog-header-background-color, --calcite-dialog-header-action-background-color, --calcite-dialog-header-action-background-color-hover, --calcite-dialog-header-action-background-color-press, --calcite-dialog-header-action-text-color, --calcite-dialog-header-action-text-color-press, --calcite-dialog-footer-background-color, --calcite-dialog-space, --calcite-dialog-header-content-space, --calcite-dialog-action-menu-border-color
- **calcite-sheet**: --calcite-sheet-background-color, --calcite-sheet-corner-radius, --calcite-sheet-shadow, --calcite-sheet-text-color, --calcite-sheet-resize-background-color, --calcite-sheet-resize-icon-color, --calcite-sheet-scrim-background, --calcite-sheet-width, --calcite-sheet-max-width, --calcite-sheet-min-width, --calcite-sheet-height, --calcite-sheet-max-height, --calcite-sheet-min-height
- **calcite-popover**: --calcite-popover-background-color, --calcite-popover-border-color, --calcite-popover-corner-radius, --calcite-popover-max-size-x, --calcite-popover-text-color
- **calcite-tooltip**: --calcite-tooltip-background-color, --calcite-tooltip-border-color, --calcite-tooltip-corner-radius, --calcite-tooltip-max-size-x, --calcite-tooltip-text-color
- **calcite-chip**: --calcite-chip-background-color, --calcite-chip-border-color, --calcite-chip-close-icon-color, --calcite-chip-corner-radius, --calcite-chip-icon-color, --calcite-chip-select-icon-color-press, --calcite-chip-select-icon-color, --calcite-chip-text-color
- **calcite-button**: --calcite-button-background-color, --calcite-button-border-color, --calcite-button-corner-radius, --calcite-button-icon-color, --calcite-button-loader-color, --calcite-button-text-color, --calcite-button-shadow
- **calcite-link**: --calcite-link-text-color
- **calcite-input**: --calcite-input-prefix-size, --calcite-input-suffix-size, --calcite-input-prefix-text-color, --calcite-input-suffix-text-color, --calcite-input-background-color, --calcite-input-border-color, --calcite-input-corner-radius, --calcite-input-shadow, --calcite-input-icon-color, --calcite-input-text-color, --calcite-input-placeholder-text-color, --calcite-input-actions-background-color, --calcite-input-actions-background-color-hover, --calcite-input-actions-background-color-press, --calcite-input-actions-icon-color, --calcite-input-actions-icon-color-hover, --calcite-input-actions-icon-color-press, --calcite-input-loading-background-color, --calcite-input-loading-fill-color
- **calcite-input-text**: --calcite-input-action-background-color, --calcite-input-action-background-color-hover, --calcite-input-action-background-color-press, --calcite-input-action-icon-color, --calcite-input-action-icon-color-hover, --calcite-input-action-icon-color-press, --calcite-input-loading-background-color, --calcite-input-loading-fill-color, --calcite-input-prefix-size-x, --calcite-input-prefix-text-color, --calcite-input-suffix-size-x, --calcite-input-suffix-text-color, --calcite-input-text-background-color, --calcite-input-text-border-color, --calcite-input-text-corner-radius, --calcite-input-text-icon-color, --calcite-input-text-text-color, --calcite-input-text-text-color-focus
- **calcite-input-number**: --calcite-input-actions-background-color, --calcite-input-actions-background-color-hover, --calcite-input-actions-background-color-press, --calcite-input-actions-icon-color, --calcite-input-actions-icon-color-hover, --calcite-input-actions-icon-color-press, --calcite-input-loading-background-color, --calcite-input-loading-fill-color, --calcite-input-number-background-color, --calcite-input-number-border-color, --calcite-input-number-corner-radius, --calcite-input-number-icon-color, --calcite-input-number-height, --calcite-input-number-placeholder-text-color, --calcite-input-number-text-color, --calcite-input-number-text-color-focus, --calcite-input-prefix-size, --calcite-input-prefix-text-color, --calcite-input-suffix-size, --calcite-input-suffix-text-color
- **calcite-select**: --calcite-select-font-size, --calcite-select-text-color, --calcite-select-border-color, --calcite-select-icon-color, --calcite-select-icon-color-hover, --calcite-select-background-color, --calcite-select-corner-radius, --calcite-select-shadow
- **calcite-combobox**: --calcite-combobox-divider-color, --calcite-combobox-icon-color, --calcite-combobox-icon-color-hover, --calcite-combobox-background-color, --calcite-combobox-input-border-color, --calcite-combobox-input-background-color, --calcite-combobox-input-height, --calcite-combobox-input-text-color
- **calcite-segmented-control**: --calcite-segmented-control-border-color
- **calcite-segmented-control-item**: --calcite-segmented-control-color, --calcite-segmented-control-background-color, --calcite-segmented-control-shadow, --calcite-segmented-control-icon-color
- **calcite-switch**: --calcite-switch-background-color, --calcite-switch-background-color-hover, --calcite-switch-corner-radius, --calcite-switch-handle-background-color
- **calcite-checkbox**: --calcite-checkbox-size, --calcite-checkbox-border-color, --calcite-checkbox-border-color-hover, --calcite-checkbox-border-color-press, --calcite-checkbox-icon-color
- **calcite-slider**: --calcite-slider-text-color, --calcite-slider-track-color, --calcite-slider-track-fill-color, --calcite-slider-handle-fill-color, --calcite-slider-handle-extension-color, --calcite-slider-accent-color, --calcite-slider-tick-color, --calcite-slider-tick-border-color, --calcite-slider-tick-selected-color, --calcite-slider-graph-color
- **calcite-label**: --calcite-label-margin-bottom, --calcite-label-text-color
- **calcite-loader**: --calcite-loader-font-size, --calcite-loader-size, --calcite-loader-spacing, --calcite-loader-progress-color-inline, --calcite-loader-text-spacing, --calcite-loader-text-weight, --calcite-loader-text-color, --calcite-loader-progress-color, --calcite-loader-track-color
- **calcite-tabs**: --calcite-tab-background-color, --calcite-tab-border-color
- **calcite-tab-nav**: --calcite-tab-border-color, --calcite-tab-text-color
- **calcite-tab-title**: --calcite-tab-text-color, --calcite-tab-text-color-press, --calcite-tab-border-color, --calcite-tab-background-color, --calcite-tab-background-color-hover, --calcite-tab-accent-color-press, --calcite-tab-icon-color-start, --calcite-tab-icon-color-start-press, --calcite-tab-icon-color-end, --calcite-tab-icon-color-end-press, --calcite-tab-close-icon-color, --calcite-tab-close-icon-color-press, --calcite-tab-close-icon-background-color, --calcite-tab-close-icon-background-color-press, --calcite-tab-close-icon-background-color-hover
- **calcite-table**: --calcite-table-border-color, --calcite-table-corner-radius, --calcite-table-shadow, --calcite-table-selection-chip-background-color, --calcite-table-selection-chip-border-color, --calcite-table-selection-chip-corner-radius, --calcite-table-selection-chip-shadow, --calcite-table-selection-chip-text-color, --calcite-table-selection-chip-background-color-selected, --calcite-table-selection-chip-border-color-selected, --calcite-table-selection-chip-text-color-selected, --calcite-table-selection-out-of-view-chip-background-color, --calcite-table-selection-out-of-view-chip-border-color, --calcite-table-selection-out-of-view-chip-corner-radius, --calcite-table-selection-out-of-view-chip-icon-color, --calcite-table-selection-out-of-view-chip-shadow, --calcite-table-selection-out-of-view-chip-text-color, --calcite-table-selection-dismiss-button-background-color-active, --calcite-table-selection-dismiss-button-background-color-hover, --calcite-table-selection-dismiss-button-background-color, --calcite-table-selection-dismiss-button-border-color-active, --calcite-table-selection-dismiss-button-border-color-hover, --calcite-table-selection-dismiss-button-border-color, --calcite-table-selection-dismiss-button-corner-radius, --calcite-table-selection-dismiss-button-shadow, --calcite-table-selection-dismiss-button-text-color-active, --calcite-table-selection-dismiss-button-text-color-hover, --calcite-table-selection-dismiss-button-text-color, --calcite-table-pagination-color, --calcite-table-pagination-color-hover, --calcite-table-pagination-color-border-hover, --calcite-table-pagination-color-border-active, --calcite-table-pagination-background-color, --calcite-table-pagination-icon-color-background-hover
- **calcite-table-row**: --calcite-table-row-background-color, --calcite-table-row-background-color-selected, --calcite-table-row-border-color
- **calcite-table-cell**: --calcite-table-cell-background-color, --calcite-table-cell-border-color, --calcite-table-cell-text-color
- **calcite-meter**: --calcite-meter-background-color, --calcite-meter-border-color, --calcite-meter-shadow, --calcite-meter-corner-radius, --calcite-meter-fill-color, --calcite-meter-range-text-color, --calcite-meter-value-text-color
- **calcite-accordion**: --calcite-accordion-border-color, --calcite-accordion-background-color
- **calcite-accordion-item**: --calcite-accordion-border-color, --calcite-accordion-background-color, --calcite-accordion-text-color, --calcite-accordion-text-color-hover, --calcite-accordion-text-color-press, --calcite-accordion-item-content-space, --calcite-accordion-item-end-icon-color, --calcite-accordion-item-icon-color, --calcite-accordion-item-expand-icon-color, --calcite-accordion-item-header-background-color, --calcite-accordion-item-header-background-color-hover, --calcite-accordion-item-header-background-color-press, --calcite-accordion-item-heading-text-color, --calcite-accordion-item-start-icon-color
- **calcite-card**: --calcite-card-accent-color-selected, --calcite-card-background-color, --calcite-card-border-color, --calcite-card-corner-radius, --calcite-card-selection-background-color-hover, --calcite-card-selection-background-color-press, --calcite-card-selection-color-hover, --calcite-card-selection-color, --calcite-card-shadow
- **calcite-navigation**: --calcite-navigation-width, --calcite-navigation-background-color, --calcite-navigation-border-color
- **calcite-dropdown**: --calcite-dropdown-width, --calcite-dropdown-background-color

Not in this list = not a supported knob in 5.1.1. In particular these names used in `site/*.css` are
**not** documented or shipped and currently do nothing: `--calcite-action-padding`, `--calcite-button-font-size`,
`--calcite-button-padding-inline`, `--calcite-notice-content-space`, `--calcite-tab-padding`,
`--calcite-color-focus-color`, `--calcite-font-size-small`. (`--calcite-shell-panel-min-width` is read by the
5.1.1 shell-panel but is undocumented; `--calcite-block-header-background-color` is deprecated.)

## Property differences 5.1.1 (loaded) -> 5.2 (documented)

Compared registry-to-registry. `+` exists only in 5.2 (do not use yet), `-` removed in 5.2.

- new component in 5.2: calcite-text
- calcite-accordion-item: -accordionParent
- calcite-action-bar: +expandToggleDisabled +overflowMode
- calcite-action-group: +actions
- calcite-action-menu: +actions
- calcite-autocomplete-item-group: +items
- calcite-block: +expandable +toggleDisplay
- calcite-block-group: +expandMode
- calcite-date-picker-day: -rangeEdge
- calcite-flow-item: +focusTrapEnabled +focusTrapOptions
- calcite-input: +inlineEdit +inlineEditing +inlineEditingBeforeConfirm -editingEnabled
- calcite-input-date-picker: +clearable +placeholder
- calcite-input-number: +inlineEdit +inlineEditing +inlineEditingBeforeConfirm -editingEnabled
- calcite-input-text: +inlineEdit +inlineEditing +inlineEditingBeforeConfirm -editingEnabled
- calcite-input-time-picker: +clearable +placeholder
- calcite-input-time-zone: +label +placeholder
- calcite-menu: +scale
- calcite-menu-item: +scale
- calcite-panel: +focusTrapEnabled +focusTrapOptions
- calcite-sheet: +modalDisabled
- calcite-shell-panel: +shellSizingDataProvider
- calcite-slider: +label
- calcite-switch: +required +validity
- calcite-tab-nav: +lastTabClosable
- calcite-tab-title: +beforeClose
- calcite-table: +stickyHeader
- calcite-table-cell: +reachesBodyEnd
- calcite-table-row: +stickyHeaderEnabled
- calcite-tabs: +lastTabClosable
