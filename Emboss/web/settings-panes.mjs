// The Settings dialog, one source for both pages (Paul, 17 Oct 2026, feedback item 9a: Quick Mode's Settings had drifted from the editor's — it still
// offered "Interline Print View", removed from the editor's). The editor's and Quick Mode's <dialog id="settingsDialog"> are both filled from
// SETTINGS_DIALOG_HTML here (mountSettingsDialog), so the sections, options, labels, help text and order cannot differ. Settings that only mean
// something where there is an editor or a document are marked data-scope="editor" and left out of Quick Mode: reading voice and speed (Quick Mode
// no longer reads aloud), the Title field and the explanation bar (Quick Mode has neither), Book details and the document's Braille formatting
// options (they belong to a document being edited), and the live tactile-display connection. Transcriber-only settings carry .fmt-transcriber
// (hidden by the page's own rule unless Transcriber tools is on), on both pages alike. One Emboss (Paul, 4 Nov 2026, EMBOSS-TASKS section P): there is no
// beta lock any more; a new user's Settings are Template and User Interface, and the "Show transcriber tools" switch (User Interface) adds the Advanced Production tab.
// Templates (task X1; Paul, 1 Nov 2026): the first tab is the template picker (web/templates.mjs holds the store and the rules; bindTemplateUi below is the
// one set of controls for both pages). Everything that shapes the braille - the braille code, maths code, layout standard, paragraph, quotation, list and
// table settings, the page size, the volume size and (editor) the document's Braille formatting options - sits in the "Template settings" disclosure under it,
// closed at first, so a user picks a template and is done. What is personal (interface language, appearance, speech, hardware) stays on its own tabs.
// settings.mjs stays the single store. The editor wires these controls in editor.mjs; Quick Mode wires them with bindSettingsDialog below, which
// is the same behaviour for the controls the two pages share (tests/settings_panes.test.mjs checks every control is wired in both).
import { loadSettings, saveSettings, MODE_GEOMETRY, MADE_FOR_PAGE, PAGE_SIZE_PRESETS, fillPageSizeSelect, relaxedEnabled } from '/web/settings.mjs';
import { CODES } from '/Translate/braille-codes.mjs';
import { connectionSupport } from '/format/spooler.mjs';
import { t, getOrderedLocales, getLocale, setLocale } from '/web/i18n.mjs';
import { loadStore, writeStore, allTemplates, activeTemplate, differences, templateLabel, saveAs, saveOver, rename, remove, select, settingsPatch, exportTemplate, exportFileName, importTemplate, DOCUMENT_TEMPLATE_ID } from '/web/templates.mjs';
import { ALL_CONTROLS } from '/format/field-registry.mjs';

export const SETTINGS_DIALOG_HTML = `
    <form method="dialog" class="dialog-body">
      <div class="dialog-head"><h2 data-i18n="settings.title">Settings</h2><button formnovalidate value="close" aria-label="Close" data-i18n-aria="common.close"><svg class="icon" aria-hidden="true" focusable="false"><use href="#icon-xmark"/></svg></button></div>
      <div class="settings-layout">
        <nav class="settings-nav" role="tablist" aria-label="Settings Categories" data-i18n-aria="app.dialog.settings_nav_aria">
          <button type="button" class="tab-btn active" data-tab="tab-rules" role="tab" aria-selected="true"><svg aria-hidden="true" focusable="false" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="vertical-align:-0.125em"><path d="M4 19V5C4 3.89543 4.89543 3 6 3H19.4C19.7314 3 20 3.26863 20 3.6V16.7143" stroke="currentColor" stroke-linecap="round"/><path d="M6 17L20 17" stroke="currentColor" stroke-linecap="round"/><path d="M6 21L20 21" stroke="currentColor" stroke-linecap="round"/><path d="M6 21C4.89543 21 4 20.1046 4 19C4 17.8954 4.89543 17 6 17" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 7L15 7" stroke="currentColor" stroke-linecap="round"/></svg> <span data-i18n="settings.tab_template">Template</span></button>
          <button type="button" class="tab-btn hardware-expert-only" data-tab="tab-hardware" role="tab" aria-selected="false" style="display:none;"><svg aria-hidden="true" focusable="false" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="vertical-align:-0.125em"><path d="M17 13.01L17.01 12.9989" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 17H17M6 10V3.6C6 3.26863 6.26863 3 6.6 3H17.4C17.7314 3 18 3.26863 18 3.6V10M21 20.4V14C21 11.7909 19.2091 10 17 10H7C4.79086 10 3 11.7909 3 14V20.4C3 20.7314 3.26863 21 3.6 21H20.4C20.7314 21 21 20.7314 21 20.4Z" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/></svg> <span data-i18n="settings.tab_embosser">Embosser &amp; Hardware</span></button>
          <button type="button" class="tab-btn" data-tab="tab-display" role="tab" aria-selected="false"><svg aria-hidden="true" focusable="false" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="vertical-align:-0.125em"><path d="M2 21L17 21" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 21L22 21" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 16.4V3.6C2 3.26863 2.26863 3 2.6 3H21.4C21.7314 3 22 3.26863 22 3.6V16.4C22 16.7314 21.7314 17 21.4 17H2.6C2.26863 17 2 16.7314 2 16.4Z" stroke="currentColor" stroke-width="1.5"/></svg> <span data-i18n="settings.tab_interface">User Interface</span></button>
          <button type="button" class="tab-btn fmt-transcriber" data-tab="tab-document" role="tab" aria-selected="false"><svg aria-hidden="true" focusable="false" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="vertical-align:-0.125em"><path d="M6.75469 17.2828L5.32612 7.28284C5.154 6.07798 6.08892 5 7.30602 5H10.694C11.9111 5 12.846 6.07797 12.6739 7.28284L11.2453 17.2828C11.1046 18.2681 10.2607 19 9.26541 19H8.73459C7.73929 19 6.89545 18.2681 6.75469 17.2828Z" stroke="currentColor" stroke-width="1.5"/><path d="M2 12L6 12M22 12L12 12" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/></svg> <span data-i18n="settings.tab_production">Advanced Production</span></button>
        </nav>
        <div class="settings-panels">
          <div id="tab-rules" class="settings-panel active" role="tabpanel">
            <h3 data-i18n="settings.tab_template">Template</h3>
            <p class="fmt-help" id="tplIntro" data-i18n="templates.intro">A template is a named set of braille settings. Choose one and you are ready to go. BANA and UKAAF are built in and cannot be changed; save your own to keep a house style or a job&#39;s settings.</p>
            <div class="field"><label for="tplSelect" data-i18n="templates.label">Template</label>
              <select id="tplSelect" aria-describedby="tplState"></select></div>
            <p id="tplState" class="tpl-state"></p>
            <!-- Paul, 4 Nov 2026 (interface question 3, B): "Made for" beside the template picker - a template setting, shown without opening Template settings -->
            <div class="field"><label for="set-madeFor" data-i18n="settings.made_for_label">Made for</label>
                <select id="set-madeFor" aria-describedby="set-madeForHelp">
                  <option value="paper" data-i18n="settings.made_for_paper">Paper (embossed or printed braille)</option>
                  <option value="monarch" data-i18n="settings.made_for_monarch">APH Monarch (32 × 10)</option>
                  <option value="dotpad" data-i18n="settings.made_for_dotpad">DotPad (20 × 10)</option>
                </select>
                <small id="set-madeForHelp" class="fmt-help" data-i18n="settings.made_for_help">A Monarch or DotPad sets the page size, and its display shows beside the braille.</small></div>
            <div class="tpl-actions" role="group" aria-label="Template actions" data-i18n-aria="templates.actions_aria">
              <button type="button" id="tplRevert" class="pill-btn" data-i18n="templates.revert">Undo changes</button>
              <button type="button" id="tplSave" class="pill-btn" data-i18n="templates.save">Save</button>
              <button type="button" id="tplSaveAs" class="pill-btn" data-i18n="templates.save_as">Save as…</button>
              <button type="button" id="tplRename" class="pill-btn" data-i18n="templates.rename">Rename…</button>
              <button type="button" id="tplDelete" class="pill-btn danger" data-i18n="templates.delete">Delete…</button>
              <button type="button" id="tplExport" class="pill-btn" data-i18n="templates.export">Export…</button>
              <button type="button" id="tplImport" class="pill-btn" data-i18n="templates.import">Import…</button>
            </div>
            <input type="file" id="tplImportFile" accept=".json,application/json" hidden tabindex="-1" aria-hidden="true" />
            <div id="tplAsk" class="tpl-ask" role="group" aria-labelledby="tplAskLabel" hidden>
              <label id="tplAskLabel" for="tplAskName"></label>
              <input type="text" id="tplAskName" maxlength="60" autocomplete="off" aria-describedby="tplAskError" />
              <p id="tplAskError" class="tpl-error" role="alert"></p>
              <div class="tpl-ask-buttons">
                <button type="button" id="tplAskOk" class="pill-btn" data-i18n="templates.ok">OK</button>
                <button type="button" id="tplAskCancel" class="pill-btn" data-i18n="templates.cancel">Cancel</button>
              </div>
            </div>
            <p id="tplStatus" class="tpl-status" role="status" aria-live="polite"></p>
            <details id="tplSettings" class="tpl-details">
              <summary data-i18n="templates.details">Template settings</summary>
              <p class="fmt-help" data-i18n="templates.details_help">The braille code, page size and layout choices that make up the template. Changing one here changes the template you are using; it shows as modified until you save it.</p>
              <div class="field"><label for="set-language" data-i18n="settings.braille_code_label">Braille code</label>
                <select id="set-language">
                  <option value="ueb_g2">English UEB (Grade 2 - Contracted)</option>
                  <option value="ueb_g1">English UEB (Grade 1 - Uncontracted)</option>
                  <option value="welsh_g2">Welsh (Grade 2 - Contracted)</option>
                  <option value="welsh_g1">Welsh (Grade 1 - Uncontracted)</option>
                  <option value="spanish_g1">Spanish (Grade 1)</option>
                  <option value="spanish_g2">Spanish (Grade 2)</option>
                  <option value="french_g1">French (Grade 1)</option>
                  <option value="french_g2">French (Grade 2)</option>
                  <option value="german_g1">German (Grade 1)</option>
                  <option value="german_g2">German (Grade 2)</option>
                  <option value="italian_g1">Italian (Grade 1)</option>
                  <option value="italian_g2">Italian (Grade 2)</option>
                  <option value="gaelic_g1">Gaelic (Grade 1)</option>
                  <option value="gaelic_g2">Gaelic (Grade 2)</option>
                </select></div>
              <div class="field rp-field" id="contractionsField" hidden>
                <!-- Relaxed braille (A91; Paul, 2 Nov 2026: part of the template): one line and a button; the contractions are chosen in a dialog (web/contractions-ui.mjs).
                     Shown only with ?relaxed=1 and a UEB contracted braille code. -->
                <div class="rp-line"><span id="contractionsLine">Contractions: All</span> <button type="button" id="contractionsBtn" class="rp-btn" aria-haspopup="dialog" aria-labelledby="contractionsBtn contractionsLine">Choose…</button></div>
              </div>
              <div class="field"><label for="set-mathCode" data-i18n="settings.math_code_label">Math Braille Code</label>
                <select id="set-mathCode">
                  <option value="auto" data-i18n="settings.math_auto">Follow layout standard (UKAAF → UEB maths, BANA → Nemeth)</option>
                  <option value="ueb" data-i18n="settings.math_ueb">UEB Math (Unified English Braille - UK / AU / NZ / US)</option>
                  <option value="nemeth" data-i18n="settings.math_nemeth">Nemeth Code (US STEM Standard)</option>
                </select></div>
              <div class="field"><label for="set-mode" data-i18n="settings.standard_label">Layout Standard</label>
                <select id="set-mode">
                  <option value="ukaaf" data-i18n="settings.standard_ukaaf">UKAAF (UK Standard)</option>
                  <option value="bana" data-i18n="settings.standard_bana">BANA (US Standard)</option>
                </select></div>
              <div class="field" id="embosserField"><label for="set-embosser" data-i18n="settings.embosser_preset_label">Embosser model</label>
                <select id="set-embosser" aria-describedby="set-embosserHelp">
                  <option value="generic" data-i18n="app.settings.embosser_generic">Generic BRF / standard embosser</option>
                  <option value="custom" data-i18n="app.settings.embosser_custom">Simple one-page braille printer</option>
                  <option value="aph" data-i18n="app.settings.embosser_aph">APH PageBlaster / PixBlaster</option>
                  <option value="viewplus" data-i18n="app.settings.embosser_viewplus">ViewPlus Columbia / Premier</option>
                  <option value="braillo" data-i18n="app.settings.embosser_braillo">Braillo 300 / 600</option>
                  <option value="index" data-i18n="app.settings.embosser_index">Index Basic-D / Everest-D V5</option>
                  <option value="romeo" data-i18n="app.settings.embosser_romeo">Romeo 60 / Enabling Juliet 120</option>
                </select>
                <small id="set-embosserHelp" class="fmt-help" data-i18n="settings.embosser_help">The model decides which tactile graphics the job can have. It does not change the page size or the text.</small></div>
              <div class="field fmt-transcriber"><label for="set-paragraphStyle" data-i18n="settings.paragraph_style_label">Paragraph Style</label>
                <select id="set-paragraphStyle"><option value="indented" data-i18n="settings.paragraph_indented">Indented (3-1, standard)</option><option value="block" data-i18n="settings.paragraph_block">Block (1-1, blank lines)</option><option value="indented-spaced" data-i18n="settings.paragraph_indented_spaced">Indented, blank line before each paragraph (UKAAF, young readers)</option></select></div>
              <div class="field fmt-transcriber"><label for="set-quoteStyle" data-i18n="settings.quote_style_label">Quotation Marks</label>
                <select id="set-quoteStyle"><option value="faithful" data-i18n="settings.quote_faithful">Faithful to print</option><option value="exchange" data-i18n="settings.quote_exchange">Exchange single → double</option></select></div>
              <div class="field"><label for="set-listStyle" data-i18n="settings.list_style_label">List Format</label>
                <select id="set-listStyle"><option value="spaced" data-i18n="app.settings.list_spaced">Blank-line list (1-3)</option><option value="compact" data-i18n="app.settings.list_compact">Compact list (5-1)</option></select></div>
              <div class="field"><label for="set-tableFormat" data-i18n="settings.table_format_label">Table Layout</label>
                <select id="set-tableFormat">
                  <option value="auto" data-i18n="settings.table_auto">Auto (Listed if wide, Columnar if small)</option>
                  <option value="listed" data-i18n="settings.table_listed">Listed Table Format (UKAAF §8 / BANA §11)</option>
                  <option value="columnar" data-i18n="settings.table_columnar">Columnar Table Format</option>
                  <option value="vertical" data-i18n="settings.table_vertical">Vertical Division (BANA §11.14, sections side by side)</option>
                  <option value="facing" data-i18n="settings.table_facing">Facing Pages (BANA §11.13, read across a left and right page)</option>
                  <option value="interchange" data-i18n="settings.table_interchange">Interchanged Columns and Rows (BANA §11.15, transposed to fit)</option>
                  <option value="stairstep" data-i18n="settings.table_stairstep">Stairstep (BANA §11.18, four columns or fewer)</option>
                  <option value="linear" data-i18n="settings.table_linear">Linear (BANA §11.17, one line per row)</option>
                </select></div>
              <div class="field" id="duplexField"><label for="set-embosserDuplex" data-i18n="settings.duplex_label">Interpoint or single-sided</label>
                <select id="set-embosserDuplex">
                  <option value="double" data-i18n="settings.duplex_double">Interpoint (both sides of the paper)</option>
                  <option value="single" data-i18n="settings.duplex_single">Single-sided</option>
                </select></div>
              <h4 class="tpl-sub" data-i18n="templates.page_heading">Page size</h4>
              <p class="fmt-help" id="pageSizeFixed" data-i18n="templates.page_fixed" hidden>The page size is set by the device this template is made for.</p>
              <div class="field" style="margin-bottom:12px;">
                <label for="set-pageSize" data-i18n="settings.page_size_label">Page size preset</label>
                <select id="set-pageSize">
                  <option value="" data-i18n="settings.page_size_custom">Custom size</option>
                  <option value="us-38x25" data-i18n="settings.page_size_us_38x25">US braille paper 11 × 11½ in (38 × 25)</option>
                  <option value="us-40x25" data-i18n="settings.page_size_us_40x25">US braille paper 11 × 11½ in (40 × 25)</option>
                  <option value="uk-38x27" data-i18n="settings.page_size_uk_38x27">UK 12in paper (38 × 27)</option>
                  <option value="uk-40x27" data-i18n="settings.page_size_uk_40x27">UK 12in paper (40 × 27)</option>
                  <option value="uk-28x27" data-i18n="settings.page_size_uk_28x27">UK A4 (28 × 27)</option>
                  <option value="uk-30x27" data-i18n="settings.page_size_uk_30x27">UK A4 (30 × 27)</option>
                </select>
              </div>
              <div class="field-row" style="margin-bottom:12px;">
                <div class="field"><label for="set-cells" data-i18n="settings.geometry_cells">Cells / Line</label><input id="set-cells" type="number" min="10" max="60" value="38" /></div>
                <div class="field"><label for="set-lines" data-i18n="settings.geometry_lines">Lines / Page</label><input id="set-lines" type="number" min="10" max="45" value="25" /></div>
              </div>
              <div class="field fmt-transcriber"><label for="set-volumePages" data-i18n="settings.volume_pages_label">Volume Split Interval (0 = single volume)</label>
                <input id="set-volumePages" type="number" min="0" max="500" value="0" /></div>
              <fieldset id="docOptionsGroup" data-scope="editor" style="border:1px solid var(--line); border-radius:8px; margin:16px 0 0; padding:8px 12px 10px;">
                <legend data-i18n="app.braille_fmt.doc_title">Braille formatting options</legend>
                <p class="fmt-help" data-i18n="app.braille_fmt.doc_intro">Options for the whole document. They are saved in the document and come back when you open it again.</p>
                <!-- The option controls are built by editor.mjs from Emboss/format/field-registry.mjs (doc options, in GROUPS order). -->
              </fieldset>
            </details>
          </div>

          <div id="tab-hardware" class="settings-panel" role="tabpanel">
            <h3 data-i18n="settings.tab_embosser">Embosser Hardware &amp; Connection</h3>
            <div class="field"><label for="set-connectionType" data-i18n="settings.connection_type_label">Connection Mode</label>
              <select id="set-connectionType">
                <option value="serial" data-i18n="settings.conn_serial">USB Serial / Direct Cable (WebSerial)</option>
                <option value="hid" data-i18n="settings.conn_hid">USB HID / Driverless (Universal WebHID)</option>
                <option value="ble" data-i18n="settings.conn_ble">Wireless Bluetooth Low Energy (Web Bluetooth)</option>
                <option value="network" data-i18n="settings.conn_network">Network / Wi-Fi (REST / WebSocket / IP)</option>
              </select>
              <small id="connectionUnavailableHint" role="status" style="display:none; color:var(--muted); font-size:.78rem; margin-top:4px;"></small></div>
            <!-- One Emboss (Paul, 4 Nov 2026, section P): the embosser model and interpoint / single-sided moved to Template settings. This tab (connection, baud rate,
                 the rasterized-graphics choice, the live display) belongs to writing to devices, which is put aside: it is never shown (hardwareEnabled, settings.mjs). -->
            <div id="networkSettingsGroup" style="display:none; background:var(--btn-bg); border:1px solid var(--line); border-radius:6px; padding:10px 12px; margin-bottom:12px;">
              <h4 style="margin:0 0 8px 0; font-size:.9rem; color:var(--ink);" data-i18n="app.settings.network_heading">Network Embosser (REST / Port 9100 / IP)</h4>
              <div class="field-row">
                <div class="field"><label for="set-networkHost" data-i18n="settings.network_host_label">IP Address or Hostname</label><input id="set-networkHost" type="text" placeholder="192.168.1.150" value="192.168.1.150" /></div>
                <div class="field" style="max-width:110px;"><label for="set-networkPort" data-i18n="settings.network_port_label">Port</label><input id="set-networkPort" type="number" min="1" max="65535" value="9100" /></div>
              </div>
              <small style="color:var(--muted); font-size:.78rem; display:block; margin-top:4px;" data-i18n="app.settings.network_hint">Supports modern HTTP REST /api/print endpoints or raw TCP port 9100.</small>
            </div>
            <div id="bleSettingsGroup" style="display:none; background:var(--btn-bg); border:1px solid var(--line); border-radius:6px; padding:10px 12px; margin-bottom:12px;">
              <h4 style="margin:0 0 8px 0; font-size:.9rem; color:var(--ink);" data-i18n="app.settings.ble_heading">Wireless Bluetooth Low Energy (BLE)</h4>
              <small style="color:var(--muted); font-size:.78rem; display:block;" data-i18n="app.settings.ble_hint">Direct wireless pairing with custom GATT 0xFEB0, DotPad, or Nordic UART embossers without cables or OS drivers.</small>
            </div>
            <div id="hidSettingsGroup" style="display:none; background:var(--btn-bg); border:1px solid var(--line); border-radius:6px; padding:10px 12px; margin-bottom:12px;">
              <h4 style="margin:0 0 8px 0; font-size:.9rem; color:var(--ink);" data-i18n="app.settings.hid_heading">Driverless Universal USB (WebHID)</h4>
              <small style="color:var(--muted); font-size:.78rem; display:block;" data-i18n="app.settings.hid_hint">Connect directly to custom microcontroller embossers (ESP32-S3, RP2040/RP2350, STM32, Arduino) bypassing OS printer-driver lockouts.</small>
            </div>
            <div id="serialBaudGroup" class="field" style="display:none;"><label for="set-baudRate" data-i18n="settings.baud_rate_label">Hardware Serial Baud Rate</label>
              <select id="set-baudRate">
                <option value="9600" data-i18n="app.settings.baud_standard">9600 bps (Standard)</option>
                <option value="19200">19200 bps</option>
                <option value="38400">38400 bps</option>
                <option value="115200" data-i18n="app.settings.baud_high">115200 bps (High Speed)</option>
              </select></div>
            <div class="field field-check" style="margin-top:8px;">
              <label class="check-label" for="set-tactileGraphics">
                <input type="checkbox" id="set-tactileGraphics" checked />
                <span data-i18n="settings.tactile_graphics_label">Enable Tactile Graphics Mode (Tiger &amp; Index rasterization)</span>
              </label>
              <small style="display:block; margin-left:24px; color:var(--muted); font-size:.78rem;" data-i18n="app.settings.graphics_hint">When unchecked, diagrams are exported as accessible Transcriber's Note descriptions for text-only embossers and braille displays.</small>
            </div>
            <div class="field" data-scope="editor" style="margin-top:16px;border-top:1px solid var(--line);padding-top:12px;">
              <div class="field-label" style="font-weight:600;font-size:0.88rem;color:var(--ink);" data-i18n="app.settings.tactile_heading">Tactile Display Live Stream (APH Monarch / DotPad / HID)</div>
              <div style="display:flex;gap:8px;align-items:center;margin-top:6px;flex-wrap:wrap;">
                <button type="button" id="btnConnectTactile" class="tb-btn" style="padding:7px 14px;background:var(--pill-bg);color:var(--ink);border:1px solid var(--line);border-radius:7px;font-weight:600;cursor:pointer;" data-i18n="app.settings.tactile_connect_ble">Connect Bluetooth (DotPad BLE)</button>
                <button type="button" id="btnConnectHid" class="tb-btn" style="padding:7px 14px;background:var(--pill-bg);border:1px solid var(--line);color:var(--ink);border-radius:7px;font-weight:600;cursor:pointer;" data-i18n="app.settings.tactile_connect_hid">Connect USB / HID (Monarch)</button>
                <button type="button" id="btnDisconnectTactile" class="tb-btn" style="padding:7px 14px;background:var(--pill-bg);border:1px solid var(--line);color:var(--ink);border-radius:7px;font-weight:600;cursor:pointer;display:none;" data-i18n="app.settings.tactile_disconnect">Disconnect Display</button>
                <button type="button" id="btnSimulateTactile" class="tb-btn" style="padding:7px 14px;background:var(--pill-bg);border:1px solid var(--line);color:var(--ink);border-radius:7px;font-weight:600;cursor:pointer;" data-i18n="app.settings.tactile_sim_monarch">Test Simulated Monarch (32×10)</button>
                <button type="button" id="btnSimulateDotPad" class="tb-btn" style="padding:7px 14px;background:var(--pill-bg);border:1px solid var(--line);color:var(--ink);border-radius:7px;font-weight:600;cursor:pointer;" data-i18n="app.settings.tactile_sim_dotpad">Test Simulated DotPad (20×10 + 20)</button>
                <span id="tactileConnStatus" style="font-size:0.84rem;color:var(--muted);font-weight:500;" data-i18n="app.settings.tactile_none">No display connected</span>
              </div>
              <small style="display:block;margin-top:6px;color:var(--muted);font-size:.78rem;" data-i18n="app.settings.tactile_hint">Streams the live braille viewport and tactile graphics directly over WebBluetooth (DotPad BLE UART) or WebHID (Monarch/USB) without external drivers.</small>
            </div>
          </div>

          <div id="tab-display" class="settings-panel" role="tabpanel">
            <h3 data-i18n="settings.tab_interface">User Interface &amp; View</h3>
            <div class="field" style="margin-bottom:14px;">
              <label for="set-uiLanguage" data-i18n="settings.language_label">Interface Language</label>
              <select id="set-uiLanguage">
                <option value="en">English (English)</option>
                <option value="es">Español (Spanish)</option>
                <option value="fr">Français (French)</option>
                <option value="de">Deutsch (German)</option>
                <option value="pt">Português (Portuguese)</option>
                <option value="it">Italiano (Italian)</option>
                <option value="nl">Nederlands (Dutch)</option>
                <option value="ar">العربية (Arabic)</option>
                <option value="he">עברית (Hebrew)</option>
              </select>
              <small data-i18n="settings.language_help" style="color:var(--muted); font-size:.78rem; display:block; margin-top:4px;">Select the language used for buttons, menus, dialogs, and screen reader announcements.</small>
            </div>
            <div class="field field-check">
              <label class="check-label" for="set-asciiBraille">
                <input type="checkbox" id="set-asciiBraille" />
                <span><strong data-i18n="toolbar.toggle_brf">Show braille as BRF letters instead of dots</strong> <span data-i18n="app.settings.ascii_hint">— useful for checking a BRF file</span></span>
              </label>
            </div>
            <div class="field field-check" data-scope="editor">
              <label class="check-label" for="set-showTitleField">
                <input type="checkbox" id="set-showTitleField" />
                <span><strong data-i18n="app.settings.show_title_field">Show the Title field above the text</strong> <span data-i18n="app.settings.show_title_field_hint">— the document's title, which Emboss puts at the top of the braille</span></span>
              </label>
            </div>
            <div class="field field-check" data-scope="editor">
              <label class="check-label" for="set-showExplanationBar">
                <input type="checkbox" id="set-showExplanationBar" />
                <span><strong data-i18n="app.settings.show_explanation_bar">Show the explanation bar</strong> <span data-i18n="app.settings.show_explanation_bar_hint">— the strip under the text and braille that explains the braille for the word you are on</span></span>
              </label>
            </div>
            <div class="field field-check">
              <label class="check-label phone-hide" for="set-simpleMode">
                <input type="checkbox" id="set-simpleMode" />
                <span><strong data-i18n="settings.simple_mode_label">Start in Quick Mode</strong> <span data-i18n="app.settings.simple_mode_hint">— open Emboss at the simple converter. Switching between Quick Mode and the editor does not change this.</span></span>
              </label>
            </div>
            <div class="field-row" data-scope="editor" style="margin-top:14px; padding-top:10px; border-top:1px solid var(--line);">
              <div class="field"><label for="set-voice" data-i18n="settings.voice_label">Reading Voice</label><select id="set-voice"></select></div>
              <div class="field"><label for="set-rate"><span data-i18n="settings.speed_label">Reading Speed</span> <span id="rateVal" class="rate-val"></span></label>
                <input id="set-rate" type="range" min="0.5" max="2" step="0.1" value="1" /></div>
            </div>
            <!-- One Emboss (Paul, 4 Nov 2026, section P item 2): the Transcriber tools switch is here, for everyone, off at first. With it on, the Advanced Production tab
                 (Book details, covers), the transcriber controls and tactile graphics show. It shows and hides tools only; it never changes the braille. -->
            <div class="field field-check" style="margin-top:14px; padding-top:10px; border-top:1px solid var(--line);">
              <label class="check-label" for="set-transcriberTools">
                <input type="checkbox" id="set-transcriberTools" aria-describedby="set-transcriberToolsHelp" />
                <span><strong data-i18n="app.settings.transcriber_tools">Show transcriber tools</strong><br><span id="set-transcriberToolsHelp" data-i18n="app.settings.transcriber_tools_help" style="color:var(--muted); font-size:.78rem;">Adds the tools for formal braille books: title and notes pages, special symbols, volumes, tactile graphics and advanced formatting.</span></span>
              </label>
            </div>
          </div>

          <div id="tab-document" class="settings-panel" role="tabpanel">
            <h3 data-i18n="settings.tab_production">Advanced Production</h3>
            <div class="field fmt-transcriber">
              <label class="check-label" for="set-includeCovers">
                <input type="checkbox" id="set-includeCovers" />
                <span><strong data-i18n="settings.include_covers">Tactile Volume Covers</strong> <span data-i18n="app.settings.covers_hint">— embossed title covers when splitting books</span></span>
              </label>
            </div>
            <div class="field fmt-transcriber" data-scope="editor">
              <button type="button" id="btnTitlepageDetails" data-i18n="app.titlepage_details.menu_item" data-i18n-title="app.titlepage_details.menu_item_title" title="The book's title, authors, publisher, ISBN, transcriber and other Title Page facts (K29)">Book details…</button>
            </div>
          </div>
        </div>
      </div>
      <div class="dialog-foot"><button formnovalidate value="close" class="pill-btn" data-i18n="common.done">Done</button></div>
    </form>
  `;

// Controls that only the editor has (data-scope="editor"), by id: Quick Mode leaves these out, and a test pins the list.
export const EDITOR_ONLY_IDS = ['set-voice', 'set-rate', 'set-showTitleField', 'set-showExplanationBar', 'btnTitlepageDetails', 'docOptionsGroup', 'btnConnectTactile', 'btnConnectHid', 'btnDisconnectTactile', 'btnSimulateTactile', 'btnSimulateDotPad'];

export function mountSettingsDialog(dialog, { page = 'editor' } = {}) {
  if (!dialog) return null;
  dialog.innerHTML = SETTINGS_DIALOG_HTML;
  if (page !== 'editor') for (const e of dialog.querySelectorAll('[data-scope="editor"]')) e.remove();
  return dialog;
}

// "Made for" (Paul, 4 Nov 2026, P-J) and the controls it governs, for both pages. A Monarch or DotPad fixes the page size (the preset list, Cells and Lines are
// shown but cannot be changed, with a line saying why) and has no paper embosser model or interpoint choice. `root` is the dialog (Quick Mode) or the document (editor).
export function syncMadeForControls(root, madeFor) {
  const q = (id) => root.querySelector('#' + id);
  const device = madeFor === 'monarch' || madeFor === 'dotpad';
  for (const id of ['set-pageSize', 'set-cells', 'set-lines']) { const e = q(id); if (e) e.disabled = device; }
  for (const id of ['embosserField', 'duplexField']) { const e = q(id); if (e) e.style.display = device ? 'none' : ''; }
  const note = q('pageSizeFixed');
  if (note) note.hidden = !device;
}
// Choosing "Made for" puts the page size in the fields (the same way a page size preset does): the device's own, or - back on Paper - the standard's usual page.
export function applyMadeForSize(root, madeFor, mode) {
  const g = MADE_FOR_PAGE[madeFor] || MODE_GEOMETRY[mode] || MODE_GEOMETRY.ukaaf;
  const cells = root.querySelector('#set-cells'), lines = root.querySelector('#set-lines');
  if (cells) cells.value = g.cells;
  if (lines) lines.value = g.lines;
}

// The tabs: one panel shows at a time.
export function wireSettingsTabs(dialog) {
  dialog.querySelectorAll('.settings-nav .tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-tab');
      dialog.querySelectorAll('.tab-btn').forEach((b) => { const on = b === btn; b.classList.toggle('active', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
      dialog.querySelectorAll('.settings-panel').forEach((p) => p.classList.toggle('active', p.id === tabId));
    });
  });
}

const tOr = (key, fallback, params = {}) => { const v = t(key, params); return v && v !== key ? v : String(fallback).replace(/\{(\w+)\}/g, (_, k) => params[k] ?? ''); };
const uiText = (key, params = {}, fallback = '') => tOr(key, fallback, params);
const displayNames = typeof Intl !== 'undefined' && Intl.DisplayNames ? new Intl.DisplayNames([globalThis.navigator?.language || 'en'], { type: 'language' }) : null;
function languageLabel(c) {
  let name = c.lang;
  try { if (displayNames) name = displayNames.of(c.lang) || c.lang; } catch { /* fallback */ }
  name = name.charAt(0).toUpperCase() + name.slice(1);
  return `${name}${c.grade ? ' (' + c.grade + ')' : ''}`;
}

// ---- Templates: the picker and its buttons (both pages) ----
// `host` is the page: getCurrent() -> { settings, doc } (doc: the open document's Braille formatting options, or undefined where there is none, Quick Mode);
// apply(template) -> the page puts the template's values in force (saves them, fills the controls, brailles again); say(message) -> the page's status line.
// Messages are also written to the dialog's own live region (#tplStatus), the one a screen reader still reads while the dialog is open.
const FIELD_WORDS = { mode: 'layout standard', brailleCode: 'braille code', mathCode: 'maths code', cells: 'cells per line', lines: 'lines per page', quoteStyle: 'quotation marks', listStyle: 'list format', paragraphStyle: 'paragraph style', tableFormat: 'table layout', volumePages: 'volume size', toc: 'contents page', madeFor: 'made for', embosser: 'embosser model', embosserDuplex: 'interpoint or single-sided', contractions: 'contractions' };
const tx = (key, fallback, params = {}) => tOr(`templates.${key}`, fallback, params);
const docOptionLabel = (key) => { const c = ALL_CONTROLS.find((x) => x.field === key && x.group === 'doc'); return c ? tOr(c.labelKey, c.label) : key; };
const problemWords = {
  empty: ['name_empty', 'Type a name for the template.'],
  long: ['name_long', 'Use a shorter name (60 characters at most).'],
  builtin: ['name_builtin', 'BANA and UKAAF are built in. Use a name of your own.'],
  duplicate: ['name_duplicate', 'A template with that name already exists. Use another name.'],
};
const importWords = {
  'not-json': ['import_not_json', 'That file is not a template file. It could not be read.'],
  'not-template': ['import_not_template', 'That file is not an Emboss template.'],
  newer: ['import_newer', 'That template was made by a newer version of Emboss. Update Emboss to use it.'],
  'too-big': ['import_too_big', 'That file is too big to be a template.'],
};
export function bindTemplateUi(dialog, host) {
  const $ = (id) => dialog.querySelector('#' + id);
  const sel = $('tplSelect');
  if (!sel) return null;
  const el = { state: $('tplState'), status: $('tplStatus'), ask: $('tplAsk'), askLabel: $('tplAskLabel'), askName: $('tplAskName'), askError: $('tplAskError'), askOk: $('tplAskOk'), askCancel: $('tplAskCancel'), file: $('tplImportFile') };
  const btn = { revert: $('tplRevert'), save: $('tplSave'), saveAs: $('tplSaveAs'), rename: $('tplRename'), del: $('tplDelete'), exp: $('tplExport'), imp: $('tplImport') };
  let asking = null;   // { kind: 'saveas' | 'rename' | 'delete', opener }
  // `relaxed`: the contractions a template holds count toward "(modified)" only with relaxed braille switched on (?relaxed=1); off, they are kept and ignored.
  const cur = () => { const c = host.getCurrent(); return { settings: c.settings, doc: c.doc, producer: c.producer, relaxed: relaxedEnabled() }; };
  const store = () => loadStore(cur().settings);
  const say = (message) => { if (el.status) el.status.textContent = message; try { host.say?.(message); } catch { /* the page's own status line is a courtesy */ } };
  const words = () => ({ modified: tx('modified', 'modified'), fromDocument: tx('from_document', 'from document') });
  const diffWord = (k) => (k.startsWith('doc.') ? docOptionLabel(k.slice(4)) : tx(`field_${k}`, FIELD_WORDS[k] || k));

  function refresh() {
    const st = store(), c = cur(), a = activeTemplate(st), w = words();
    const diff = differences(st, c), modified = diff.length > 0;
    const own = !a.builtin && a.id !== DOCUMENT_TEMPLATE_ID;
    const rankOf = (x) => (x.builtin ? 0 : x.id === DOCUMENT_TEMPLATE_ID ? 2 : 1);
    const ordered = [...allTemplates(st)].sort((x, y) => (rankOf(x) - rankOf(y)) || (rankOf(x) === 1 ? String(x.name).localeCompare(String(y.name)) : 0));
    sel.replaceChildren(...ordered.map((tpl) => {
      const o = document.createElement('option');
      o.value = tpl.id;
      o.textContent = tpl.id === st.active ? templateLabel(st, c, w) : (tpl.id === DOCUMENT_TEMPLATE_ID ? `${tpl.name} (${w.fromDocument})` : tpl.name);
      return o;
    }));
    sel.value = st.active;
    if (el.state) {
      el.state.textContent = modified ? tx('changed', 'Changed from this template: {list}.', { list: diff.map(diffWord).join(', ') })
        : (a.builtin ? tx('state_builtin', 'A built-in template. It cannot be changed; Save as… keeps your own version.') : (a.id === DOCUMENT_TEMPLATE_ID ? tx('state_document', 'The settings this document was saved with. Save as… keeps them as a template of your own.') : ''));
    }
    btn.revert.hidden = !modified;
    btn.save.hidden = !own; btn.save.disabled = !modified;
    btn.rename.hidden = !own; btn.del.hidden = !own;
    // the Contractions line and the label (web/contractions-ui.mjs) follow the template and its ticks
    try { document.dispatchEvent(new CustomEvent('emboss:templates-refreshed')); } catch { /* an old browser: the line then follows at the next change of braille code */ }
    return { st, a, modified };
  }
  // After an action a button may have gone (Undo changes, Delete): the keyboard goes to the picker rather than to the page behind the dialog.
  const keepFocus = (preferred) => {
    const ae = document.activeElement;
    if (!ae || ae === document.body || ae === dialog || !dialog.contains(ae) || ae.hidden || ae.closest('[hidden]')) (preferred && !preferred.hidden ? preferred : sel).focus();
  };

  async function pick(id) {
    closeAsk(false);
    const r = select(store(), id);
    if (r.error) { refresh(); return; }
    writeStore(r.store);
    await host.apply(r.template);
    const { a } = refresh();
    say(tx('applied', 'Template \u201c{name}\u201d is on.', { name: a.name }));
  }
  sel.addEventListener('change', () => { pick(sel.value); });

  btn.revert.addEventListener('click', async () => {
    const a = activeTemplate(store());
    await host.apply(a);
    refresh(); say(tx('reverted', 'Settings put back to the template \u201c{name}\u201d.', { name: a.name })); keepFocus(sel);
  });
  btn.save.addEventListener('click', () => {
    const st = store(), a = activeTemplate(st);
    const r = saveOver(st, a.id, cur());
    if (r.error) return;
    writeStore(r.store); refresh(); say(tx('saved', 'Saved the template \u201c{name}\u201d.', { name: r.template.name })); keepFocus(sel);
  });

  // The name box: a small form in the page (not a browser prompt), used by Save as, Rename and Delete.
  function openAsk(kind, opener) {
    const a = activeTemplate(store());
    asking = { kind, opener };
    el.askLabel.textContent = kind === 'delete' ? tx('ask_delete', 'Delete the template \u201c{name}\u201d? This cannot be undone.', { name: a.name })
      : kind === 'rename' ? tx('ask_rename', 'New name for the template \u201c{name}\u201d', { name: a.name }) : tx('ask_save_as', 'Name for the new template');
    el.askName.hidden = kind === 'delete';
    el.askName.value = kind === 'rename' ? a.name : '';
    el.askError.textContent = '';
    el.askOk.textContent = kind === 'delete' ? tx('delete_ok', 'Delete') : tx('ok', 'OK');
    el.askCancel.textContent = tx('cancel', 'Cancel');
    el.ask.hidden = false;
    (kind === 'delete' ? el.askCancel : el.askName).focus();
    try { el.ask.scrollIntoView({ block: 'nearest' }); } catch { /* old browser */ }
  }
  const backTo = (opener) => { (opener && !opener.hidden && opener.isConnected ? opener : sel).focus(); };
  function closeAsk(restore) {
    if (!asking) return;
    const { opener } = asking;
    asking = null;
    el.ask.hidden = true;
    el.askError.textContent = '';
    if (restore) backTo(opener);
  }
  btn.saveAs.addEventListener('click', () => openAsk('saveas', btn.saveAs));
  btn.rename.addEventListener('click', () => openAsk('rename', btn.rename));
  btn.del.addEventListener('click', () => openAsk('delete', btn.del));
  el.askCancel.addEventListener('click', () => closeAsk(true));
  async function confirmAsk() {
    if (!asking) return;
    const { kind, opener } = asking;
    const st = store(), a = activeTemplate(st);
    if (kind === 'delete') {
      const r = remove(st, a.id);
      if (r.error) { closeAsk(true); return; }
      writeStore(r.store);
      closeAsk(false);
      const back = activeTemplate(r.store);
      await host.apply(back);   // "returns to the built-in of its standard" (the plan): its values are put in force
      refresh(); say(tx('deleted', 'Deleted the template \u201c{name}\u201d. Back to {back}.', { name: a.name, back: back.name })); sel.focus();
      return;
    }
    const r = kind === 'rename' ? rename(st, a.id, el.askName.value) : saveAs(st, el.askName.value, cur());
    if (r.error) {
      const [key, fb] = problemWords[r.error] || problemWords.empty;
      el.askError.textContent = tx(key, fb);
      el.askName.focus();
      return;
    }
    writeStore(r.store);
    closeAsk(false);
    refresh();
    say(kind === 'rename' ? tx('renamed', 'Renamed to \u201c{name}\u201d.', { name: r.template.name }) : tx('saved_as', 'Saved as the new template \u201c{name}\u201d.', { name: r.template.name }));
    backTo(opener);
  }
  el.askOk.addEventListener('click', confirmAsk);
  el.ask.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeAsk(true); }
    else if (e.key === 'Enter' && e.target === el.askName) { e.preventDefault(); confirmAsk(); }
  });
  // Escape also asks the dialog to close: with the name box open, that closes the box only.
  dialog.addEventListener('cancel', (e) => { if (asking) { e.preventDefault(); closeAsk(true); } });
  dialog.addEventListener('close', () => closeAsk(false));

  btn.exp.addEventListener('click', () => {
    const st = store(), c = cur(), a = activeTemplate(st), modified = differences(st, c).length > 0;
    // The file holds the template as it stands on screen, changes included; a built-in changed is offered under its name with "(modified)".
    const t = modified ? { name: a.builtin ? `${a.name} (${tx('modified', 'modified')})` : a.name, settings: c.settings, doc: c.doc !== undefined ? c.doc : a.doc, producer: a.producer, contractions: c.relaxed ? c.settings.contractions : a.contractions } : a;
    const file = exportTemplate(t);
    const name = exportFileName(t.name);
    const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2) + '\n'], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = name;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    say(tx('exported', 'Saved the template \u201c{name}\u201d to the file {file}.', { name: file.name, file: name }));
    keepFocus(btn.exp);
  });
  btn.imp.addEventListener('click', () => el.file.click());
  el.file.addEventListener('change', async () => {
    const f = el.file.files && el.file.files[0];
    el.file.value = '';
    if (!f) return;
    const fail = (code) => { const [key, fb] = importWords[code] || importWords['not-template']; say(tx(key, fb)); keepFocus(btn.imp); };
    if (f.size > 400000) { fail('too-big'); return; }
    let text;
    try { text = await f.text(); } catch { fail('not-json'); return; }
    const r = importTemplate(store(), text);
    if (r.error) { fail(r.error); return; }
    writeStore(r.store);
    await host.apply(r.template);
    refresh();
    say(r.renamed ? tx('imported_renamed', 'Added the template \u201c{name}\u201d. A template with the name in the file was already here.', { name: r.template.name }) : tx('imported', 'Added the template \u201c{name}\u201d and put it in force.', { name: r.template.name }));
    keepFocus(btn.imp);
  });

  // Any change made inside Settings can make the template "modified" (or not); the controls have applied their change before this runs.
  const onEdit = (e) => { if (e.target.closest('#tplAsk, #tplSelect, #tplImportFile')) return; refresh(); };
  dialog.addEventListener('change', onEdit);
  dialog.addEventListener('input', onEdit);
  refresh();
  return { refresh };
}

// The wiring of the shared controls, for the page that has no editor of its own (Quick Mode). `onChange({ locale, transcriber, code })` runs after
// a change has been saved: the page re-brailles, or re-words itself.
export function bindSettingsDialog(dialog, { onChange = () => {}, say = null } = {}) {
  const $ = (id) => dialog.querySelector('#' + id);
  let codesExpanded = false;
  wireSettingsTabs(dialog);

  function populateUiLanguage() {
    const sel = $('set-uiLanguage'); if (!sel) return;
    const current = loadSettings().uiLanguage || getLocale() || 'en';
    sel.innerHTML = '';
    for (const loc of getOrderedLocales(current)) { const o = document.createElement('option'); o.value = loc.code; o.textContent = `${loc.nativeName} (${loc.name})`; sel.appendChild(o); }
    sel.value = current;
  }
  function populateLanguage() {
    const sel = $('set-language'); if (!sel) return;
    const s = loadSettings();
    const inUse = s.brailleCode || `${s.language}_${s.grade}`;
    const recent = Array.isArray(s.recentCodes) && s.recentCodes.length ? [...s.recentCodes] : [inUse];
    if (inUse && !recent.includes(inUse)) recent.unshift(inUse);
    const top = recent.slice(0, 5);
    const sysLang = ((s.uiLanguage || globalThis.navigator?.language || 'en').split('-')[0] || 'en').toLowerCase();
    // 0-4: the codes used lately, pinned at the top; 10: the system language; 20: everything else (the "more languages" list)
    const rank = (c) => { const i = top.indexOf(c.id); if (i !== -1) return i; if (c.lang === sysLang) return 10; return 20; };
    const near = CODES.filter((c) => rank(c) < 20);
    const base = codesExpanded || !near.length ? CODES : near;
    const shown = base.slice().sort((a, b) => (rank(a) - rank(b)) || languageLabel(a).localeCompare(languageLabel(b)));
    const rest = CODES.length - shown.length;
    sel.innerHTML = '';
    for (const c of shown) { const label = languageLabel(c); sel.appendChild(new Option(c.shipped !== false ? label : tOr('app.codes.needs_internet', '{label} (needs internet first time)', { label }), c.id)); }
    if (!codesExpanded && rest > 0) sel.appendChild(new Option(tOr('app.codes.more', '… more languages ({count})', { count: rest }), '__more__'));
    if (inUse && CODES.some((c) => c.id === inUse)) sel.value = inUse; else if (sel.options.length) sel.value = sel.options[0].value;
  }
  // The four embosser connections: one the browser cannot use is shown but disabled, with the reason beside it.
  function syncConnection(type) {
    type = ['serial', 'hid', 'ble', 'network'].includes(type) ? type : 'serial';
    const sel = $('set-connectionType');
    if (sel) {
      for (const opt of sel.options) {
        const prev = opt.dataset.unavailSuffix;
        if (prev && opt.textContent.endsWith(prev)) opt.textContent = opt.textContent.slice(0, -prev.length);
        delete opt.dataset.unavailSuffix;
        const sup = connectionSupport(opt.value, { text: uiText });
        opt.disabled = !sup.ok;
        if (!sup.ok) { const suffix = ` (${sup.short})`; opt.textContent += suffix; opt.dataset.unavailSuffix = suffix; }
      }
      if (sel.value !== type) sel.value = type;
    }
    const show = (id, on) => { const e = $(id); if (e) e.style.display = on ? 'block' : 'none'; };
    show('networkSettingsGroup', type === 'network'); show('serialBaudGroup', type === 'serial'); show('hidSettingsGroup', type === 'hid'); show('bleSettingsGroup', type === 'ble');
    const hint = $('connectionUnavailableHint');
    if (hint) {
      const sup = connectionSupport(type, { text: uiText });
      hint.textContent = sup.ok ? '' : tOr('app.settings.connection_unavailable', 'This connection is not available in this browser, so Emboss cannot send to the embosser. Use Chrome or Edge, or choose another connection.');
      hint.style.display = sup.ok ? 'none' : 'block';
    }
  }
  const syncPageSize = () => fillPageSizeSelect($('set-pageSize'), $('set-mode')?.value || loadSettings().mode, $('set-cells')?.value ?? '', $('set-lines')?.value ?? '', t);

  // settings -> controls (at start, after a language change, after an embosser is detected)
  function apply() {
    const s = loadSettings();
    const val = (id, v) => { const e = $(id); if (e) e.value = v; };
    const chk = (id, v) => { const e = $(id); if (e) e.checked = !!v; };
    populateUiLanguage(); populateLanguage();
    val('set-mathCode', s.mathCode || 'auto'); val('set-mode', s.mode || 'ukaaf');
    val('set-paragraphStyle', s.paragraphStyle || 'indented'); val('set-quoteStyle', s.quoteStyle || 'faithful'); val('set-listStyle', s.listStyle || 'compact'); val('set-tableFormat', s.tableFormat || 'auto');
    val('set-madeFor', s.madeFor || 'paper'); val('set-embosser', s.embosser || 'generic'); val('set-embosserDuplex', s.embosserDuplex || 'double'); val('set-baudRate', String(s.baudRate || 9600));
    val('set-networkHost', s.networkHost || '192.168.1.150'); val('set-networkPort', s.networkPort || 9100);
    val('set-cells', s.cells); val('set-lines', s.lines); syncPageSize(); syncMadeForControls(dialog, s.madeFor);
    val('set-volumePages', s.volumePages || 0);
    chk('set-includeCovers', s.includeCovers); chk('set-asciiBraille', s.asciiBraille); chk('set-simpleMode', s.simpleMode);
    chk('set-tactileGraphics', s.tactileGraphics !== false);
    chk('set-transcriberTools', s.transcriberTools === true);
    syncConnection(s.connectionType);
  }

  // controls -> settings
  function save() {
    const langVal = $('set-language')?.value || 'en-ueb-g2';
    if (langVal === '__more__') { codesExpanded = true; populateLanguage(); return; }
    const code = CODES.find((c) => c.id === langVal);
    const lang = code ? code.lang : (langVal.split('_')[0] || 'ueb');
    const gr = code ? (code.grade.includes('2') ? 'g2' : 'g1') : (langVal.split('_')[1] || 'g2');
    const cur = loadSettings();
    const recent = [langVal, ...(Array.isArray(cur.recentCodes) ? cur.recentCodes : []).filter((id) => id !== langVal)].slice(0, 5);
    const s = saveSettings({
      brailleCode: langVal, recentCodes: recent, language: lang, grade: gr,
      mathCode: $('set-mathCode')?.value || 'auto', mode: $('set-mode')?.value || 'ukaaf',
      connectionType: $('set-connectionType')?.value || 'serial', networkHost: $('set-networkHost')?.value || '192.168.1.150', networkPort: Number($('set-networkPort')?.value) || 9100,
      madeFor: $('set-madeFor')?.value || 'paper', embosser: $('set-embosser')?.value || 'generic', embosserDuplex: $('set-embosserDuplex')?.value || 'double', baudRate: Number($('set-baudRate')?.value) || 9600,
      tactileGraphics: $('set-tactileGraphics')?.checked !== false,
      tableFormat: $('set-tableFormat')?.value || 'auto', cells: $('set-cells')?.value, lines: $('set-lines')?.value,
      quoteStyle: $('set-quoteStyle')?.value, listStyle: $('set-listStyle')?.value, paragraphStyle: $('set-paragraphStyle')?.value || 'indented',
      volumePages: $('set-volumePages')?.value, includeCovers: $('set-includeCovers')?.checked === true, asciiBraille: $('set-asciiBraille')?.checked === true,
    });
    // the clamped values the store kept, back into the fields
    if ($('set-cells')) $('set-cells').value = s.cells;
    if ($('set-lines')) $('set-lines').value = s.lines;
    if ($('set-volumePages')) $('set-volumePages').value = s.volumePages;
    syncPageSize(); syncMadeForControls(dialog, s.madeFor);
    onChange({ code: code || null });
  }

  // each of these registered before the general listener below, so the new size is what save() keeps
  // (Paul, 4 Nov 2026, P-K: the embosser model no longer sets the page size; a standard sets its usual page only on Paper, a Monarch / DotPad keeps its own)
  $('set-mode')?.addEventListener('change', () => {
    const g = MODE_GEOMETRY[$('set-mode').value];
    if (g && ($('set-madeFor')?.value || 'paper') === 'paper') { $('set-cells').value = g.cells; $('set-lines').value = g.lines; }
  });
  $('set-madeFor')?.addEventListener('change', () => { applyMadeForSize(dialog, $('set-madeFor').value, $('set-mode')?.value); save(); });
  $('set-connectionType')?.addEventListener('change', () => { syncConnection($('set-connectionType').value); save(); });
  $('set-pageSize')?.addEventListener('change', () => {
    const preset = PAGE_SIZE_PRESETS.find((p) => p.id === $('set-pageSize').value);
    if (preset) { $('set-cells').value = preset.cells; $('set-lines').value = preset.lines; }
    save();
  });
  ['set-cells', 'set-lines'].forEach((id) => $(id)?.addEventListener('input', syncPageSize));   // typing a size shows its preset, or "Custom size"
  // set-madeFor, set-connectionType and set-pageSize call save() themselves above
  ['set-networkHost', 'set-networkPort', 'set-baudRate', 'set-embosser', 'set-embosserDuplex', 'set-language', 'set-mathCode', 'set-mode', 'set-tableFormat', 'set-cells', 'set-lines', 'set-quoteStyle', 'set-listStyle', 'set-paragraphStyle', 'set-volumePages', 'set-includeCovers', 'set-asciiBraille', 'set-tactileGraphics'].forEach((id) => {
    $(id)?.addEventListener('change', save);
    if (['set-cells', 'set-lines', 'set-volumePages', 'set-networkHost', 'set-networkPort'].includes(id)) {
      // live while typing, but only for a complete number in range (a half-typed "3" on the way to 32 must not jump to 10)
      $(id)?.addEventListener('input', (e) => {
        const el = e.target;
        if (el.type === 'number') {
          const v = Number(el.value);
          const min = el.min === '' ? -Infinity : Number(el.min), max = el.max === '' ? Infinity : Number(el.max);
          if (el.value === '' || !Number.isInteger(v) || v < min || v > max) return;
        }
        save();
      });
    }
  });
  $('set-transcriberTools')?.addEventListener('change', () => {
    const on = $('set-transcriberTools').checked;
    saveSettings({ transcriberTools: on });
    document.body.classList.toggle('transcriber-tools', on);
    // The Advanced Production tab goes with the switch; if it was the open one, Settings goes back to User Interface (where the switch is).
    if (!on) { const tab = dialog.querySelector('.tab-btn[data-tab="tab-document"]'); if (tab && tab.classList.contains('active')) dialog.querySelector('.tab-btn[data-tab="tab-display"]')?.click(); }
    onChange({ transcriber: true });
  });
  // "Start in Quick Mode" only sets where Emboss opens; it never moves you between the pages (feedback 17 Oct, item 12).
  $('set-simpleMode')?.addEventListener('change', () => { saveSettings({ simpleMode: $('set-simpleMode').checked }); });
  $('set-uiLanguage')?.addEventListener('change', async (e) => {
    saveSettings({ uiLanguage: e.target.value });
    await setLocale(e.target.value);
    populateUiLanguage(); populateLanguage();
    onChange({ locale: true });
  });
  // Templates (X1): Quick Mode has the settings part only (no document, so no document part). Applying a template saves its values - like any change in
  // the controls above, so the braille code is also pushed to the front of the recent codes - fills the controls, and brailles again.
  const templates = bindTemplateUi(dialog, {
    getCurrent: () => ({ settings: loadSettings() }),
    say,
    apply: async (template) => {
      const cur = loadSettings();
      const patch = settingsPatch(template, cur);
      const code = CODES.find((c) => c.id === patch.brailleCode) || null;
      patch.recentCodes = [patch.brailleCode, ...(Array.isArray(cur.recentCodes) ? cur.recentCodes : []).filter((id) => id !== patch.brailleCode)].slice(0, 5);
      saveSettings(patch);
      apply();
      onChange({ code });
    },
  });
  apply();
  templates?.refresh();
  return { apply, populateLanguage, populateUiLanguage, syncPageSize, syncConnection, templates };
}
