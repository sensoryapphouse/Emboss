// The Settings dialog, one source for both pages (Paul, 17 Oct 2026, feedback item 9a: Quick Mode's Settings had drifted from the editor's — it still
// offered "Interline Print View", removed from the editor's). The editor's and Quick Mode's <dialog id="settingsDialog"> are both filled from
// SETTINGS_DIALOG_HTML here (mountSettingsDialog), so the sections, options, labels, help text and order cannot differ. Settings that only mean
// something where there is an editor or a document are marked data-scope="editor" and left out of Quick Mode: reading voice and speed (Quick Mode
// no longer reads aloud), the Title field and the explanation bar (Quick Mode has neither), Book details and the document's Braille formatting
// options (they belong to a document being edited), and the live tactile-display connection. Transcriber-only settings carry .fmt-transcriber
// (hidden by the page's own rule unless Transcriber tools is on) and beta builds hide .beta-hide ones, on both pages alike.
// settings.mjs stays the single store. The editor wires these controls in editor.mjs; Quick Mode wires them with bindSettingsDialog below, which
// is the same behaviour for the controls the two pages share (tests/settings_panes.test.mjs checks every control is wired in both).
import { loadSettings, saveSettings, MODE_GEOMETRY, EMBOSSER_PRESETS, PAGE_SIZE_PRESETS, fillPageSizeSelect, betaLocked } from '/web/settings.mjs';
import { CODES } from '/Translate/braille-codes.mjs';
import { connectionSupport } from '/format/spooler.mjs';
import { t, getOrderedLocales, getLocale, setLocale } from '/web/i18n.mjs';

export const SETTINGS_DIALOG_HTML = `
    <form method="dialog" class="dialog-body">
      <div class="dialog-head"><h2 data-i18n="settings.title">Settings</h2><button formnovalidate value="close" aria-label="Close" data-i18n-aria="common.close"><svg class="icon" aria-hidden="true" focusable="false"><use href="#icon-xmark"/></svg></button></div>
      <div class="settings-layout">
        <nav class="settings-nav" role="tablist" aria-label="Settings Categories" data-i18n-aria="app.dialog.settings_nav_aria">
          <button type="button" class="tab-btn active" data-tab="tab-rules" role="tab" aria-selected="true"><svg aria-hidden="true" focusable="false" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="vertical-align:-0.125em"><path d="M4 19V5C4 3.89543 4.89543 3 6 3H19.4C19.7314 3 20 3.26863 20 3.6V16.7143" stroke="currentColor" stroke-linecap="round"/><path d="M6 17L20 17" stroke="currentColor" stroke-linecap="round"/><path d="M6 21L20 21" stroke="currentColor" stroke-linecap="round"/><path d="M6 21C4.89543 21 4 20.1046 4 19C4 17.8954 4.89543 17 6 17" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 7L15 7" stroke="currentColor" stroke-linecap="round"/></svg> <span data-i18n="settings.tab_rules">Rules &amp; Standards</span></button>
          <button type="button" class="tab-btn hardware-expert-only" data-tab="tab-hardware" role="tab" aria-selected="false" style="display:none;"><svg aria-hidden="true" focusable="false" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="vertical-align:-0.125em"><path d="M17 13.01L17.01 12.9989" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 17H17M6 10V3.6C6 3.26863 6.26863 3 6.6 3H17.4C17.7314 3 18 3.26863 18 3.6V10M21 20.4V14C21 11.7909 19.2091 10 17 10H7C4.79086 10 3 11.7909 3 14V20.4C3 20.7314 3.26863 21 3.6 21H20.4C20.7314 21 21 20.7314 21 20.4Z" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/></svg> <span data-i18n="settings.tab_embosser">Embosser &amp; Hardware</span></button>
          <button type="button" class="tab-btn" data-tab="tab-display" role="tab" aria-selected="false"><svg aria-hidden="true" focusable="false" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="vertical-align:-0.125em"><path d="M2 21L17 21" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 21L22 21" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 16.4V3.6C2 3.26863 2.26863 3 2.6 3H21.4C21.7314 3 22 3.26863 22 3.6V16.4C22 16.7314 21.7314 17 21.4 17H2.6C2.26863 17 2 16.7314 2 16.4Z" stroke="currentColor" stroke-width="1.5"/></svg> <span data-i18n="settings.tab_interface">User Interface</span></button>
          <button type="button" class="tab-btn" data-tab="tab-document" role="tab" aria-selected="false"><svg aria-hidden="true" focusable="false" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="vertical-align:-0.125em"><path d="M6.75469 17.2828L5.32612 7.28284C5.154 6.07798 6.08892 5 7.30602 5H10.694C11.9111 5 12.846 6.07797 12.6739 7.28284L11.2453 17.2828C11.1046 18.2681 10.2607 19 9.26541 19H8.73459C7.73929 19 6.89545 18.2681 6.75469 17.2828Z" stroke="currentColor" stroke-width="1.5"/><path d="M2 12L6 12M22 12L12 12" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/></svg> <span class="beta-hide" data-i18n="settings.tab_production">Advanced Production</span><span class="beta-only" data-i18n="settings.tab_page_size">Page size</span></button>
        </nav>
        <div class="settings-panels">
          <div id="tab-rules" class="settings-panel active" role="tabpanel">
            <h3 data-i18n="settings.tab_rules">Rules &amp; Translation Standards</h3>
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
            <div class="field fmt-transcriber"><label for="set-paragraphStyle" data-i18n="settings.paragraph_style_label">Paragraph Style</label>
              <select id="set-paragraphStyle"><option value="indented" data-i18n="settings.paragraph_indented">Indented (3-1, standard)</option><option value="block" data-i18n="settings.paragraph_block">Block (1-1, blank lines)</option></select></div>
            <div class="field fmt-transcriber"><label for="set-quoteStyle" data-i18n="settings.quote_style_label">Quotation Marks</label>
              <select id="set-quoteStyle"><option value="faithful" data-i18n="settings.quote_faithful">Faithful to print</option><option value="exchange" data-i18n="settings.quote_exchange">Exchange single → double</option></select></div>
            <div class="field beta-hide"><label for="set-listStyle" data-i18n="settings.list_style_label">List Format</label>
              <select id="set-listStyle"><option value="spaced" data-i18n="app.settings.list_spaced">Blank-line list (1-3)</option><option value="compact" data-i18n="app.settings.list_compact">Compact list (5-1)</option></select></div>
            <div class="field beta-hide"><label for="set-tableFormat" data-i18n="settings.table_format_label">Table Layout</label>
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
            <div class="field"><label for="set-embosser" data-i18n="settings.embosser_preset_label">Embosser Preset Model</label>
              <select id="set-embosser">
                <option value="generic" data-i18n="app.settings.embosser_generic">Generic BRF / Standard Embosser (38x25)</option>
                <option value="monarch">APH Monarch Dynamic Display (32x10)</option>
                <option value="dotpad">DotPad Dynamic Display (20x10 + 20 Braille)</option>
                <option value="custom" data-i18n="app.settings.embosser_custom">Simple One-Page Braille Printer (30x20)</option>
                <option value="aph">APH PageBlaster / PixBlaster (34x25)</option>
                <option value="viewplus">ViewPlus Columbia / Premier (40x25)</option>
                <option value="braillo">Braillo 300 / 600 (42x25)</option>
                <option value="index">Index Basic-D / Everest-D V5 (42x25)</option>
                <option value="romeo">Romeo 60 / Enabling Juliet 120 (40x25)</option>
              </select></div>
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
            <div class="field"><label for="set-embosserDuplex" data-i18n="settings.duplex_label">Duplex Mode</label>
              <select id="set-embosserDuplex">
                <option value="double" data-i18n="settings.duplex_double">Interpoint (Double-Sided)</option>
                <option value="single" data-i18n="settings.duplex_single">Single-Sided (Simplex)</option>
              </select></div>
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
            <div class="field field-check" style="margin-top:8px;">
              <label class="check-label" for="set-tactileRip">
                <input type="checkbox" id="set-tactileRip" />
                <span>Anti-Slicing Tactile Graphics RIP (ViewPlus Tiger / Index raster streams) — Experimental, off by default</span>
              </label>
              <small style="display:block; margin-left:24px; color:var(--muted); font-size:.78rem;">Untested on real embosser hardware. As of 23 Sep 2026 this setting is a placeholder: no embosser or exported file yet carries a rasterized tactile image — turning it on changes nothing else Emboss does.</small>
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
          </div>

          <div id="tab-document" class="settings-panel" role="tabpanel">
            <h3><span class="beta-hide" data-i18n="settings.tab_production">Page Geometry &amp; Volume Splitting</span><span class="beta-only" data-i18n="settings.tab_page_size">Page size</span></h3>
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
            <div class="field fmt-transcriber">
              <label class="check-label" for="set-includeCovers">
                <input type="checkbox" id="set-includeCovers" />
                <span><strong data-i18n="settings.include_covers">Tactile Volume Covers</strong> <span data-i18n="app.settings.covers_hint">— embossed title covers when splitting books</span></span>
              </label>
            </div>
            <div class="field field-check beta-hide" style="margin-top:14px;">
              <label class="check-label" for="set-transcriberTools">
                <input type="checkbox" id="set-transcriberTools" aria-describedby="set-transcriberToolsHelp" />
                <span><strong data-i18n="app.settings.transcriber_tools">Transcriber tools</strong><br><span id="set-transcriberToolsHelp" data-i18n="app.settings.transcriber_tools_help" style="color:var(--muted); font-size:.78rem;">Shows the controls for formal braille books: title and notes pages, special symbols page, volumes and advanced formatting.</span></span>
              </label>
            </div>
            <div class="field fmt-transcriber" data-scope="editor">
              <button type="button" id="btnTitlepageDetails" data-i18n="app.titlepage_details.menu_item" data-i18n-title="app.titlepage_details.menu_item_title" title="The book's title, authors, publisher, ISBN, transcriber and other Title Page facts (K29)">Book details…</button>
            </div>
            <fieldset id="docOptionsGroup" data-scope="editor" style="border:1px solid var(--line); border-radius:8px; margin:16px 0 0; padding:8px 12px 10px;">
              <legend data-i18n="app.braille_fmt.doc_title">Braille formatting options</legend>
              <p class="fmt-help" data-i18n="app.braille_fmt.doc_intro">Options for the whole document. They are saved in the document and come back when you open it again.</p>
              <!-- The option controls are built by editor.mjs from Emboss/format/field-registry.mjs (doc options, in GROUPS order). -->
            </fieldset>
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

// The wiring of the shared controls, for the page that has no editor of its own (Quick Mode). `onChange({ locale, transcriber, code })` runs after
// a change has been saved: the page re-brailles, or re-words itself.
export function bindSettingsDialog(dialog, { onChange = () => {} } = {}) {
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
    val('set-embosser', s.embosser || 'generic'); val('set-embosserDuplex', s.embosserDuplex || 'double'); val('set-baudRate', String(s.baudRate || 9600));
    val('set-networkHost', s.networkHost || '192.168.1.150'); val('set-networkPort', s.networkPort || 9100);
    val('set-cells', s.cells); val('set-lines', s.lines); syncPageSize();
    val('set-volumePages', s.volumePages || 0);
    chk('set-includeCovers', s.includeCovers); chk('set-asciiBraille', s.asciiBraille); chk('set-simpleMode', s.simpleMode);
    chk('set-tactileGraphics', s.tactileGraphics !== false); chk('set-tactileRip', s.tactileRip === true);
    chk('set-transcriberTools', s.transcriberTools === true && !betaLocked());
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
      embosser: $('set-embosser')?.value || 'generic', embosserDuplex: $('set-embosserDuplex')?.value || 'double', baudRate: Number($('set-baudRate')?.value) || 9600,
      tactileGraphics: $('set-tactileGraphics')?.checked !== false, tactileRip: $('set-tactileRip')?.checked === true,
      tableFormat: $('set-tableFormat')?.value || 'auto', cells: $('set-cells')?.value, lines: $('set-lines')?.value,
      quoteStyle: $('set-quoteStyle')?.value, listStyle: $('set-listStyle')?.value, paragraphStyle: $('set-paragraphStyle')?.value || 'indented',
      volumePages: $('set-volumePages')?.value, includeCovers: $('set-includeCovers')?.checked === true, asciiBraille: $('set-asciiBraille')?.checked === true,
    });
    // the clamped values the store kept, back into the fields
    if ($('set-cells')) $('set-cells').value = s.cells;
    if ($('set-lines')) $('set-lines').value = s.lines;
    if ($('set-volumePages')) $('set-volumePages').value = s.volumePages;
    syncPageSize();
    onChange({ code: code || null });
  }

  // each of these registered before the general listener below, so the new size is what save() keeps
  $('set-mode')?.addEventListener('change', () => {
    const g = MODE_GEOMETRY[$('set-mode').value];
    if (g && ($('set-embosser')?.value || 'generic') === 'generic') { $('set-cells').value = g.cells; $('set-lines').value = g.lines; }
  });
  $('set-embosser')?.addEventListener('change', () => {
    const p = EMBOSSER_PRESETS[$('set-embosser').value];
    if (p) { $('set-cells').value = p.cells; $('set-lines').value = p.lines; if (p.baudRate && $('set-baudRate')) $('set-baudRate').value = String(p.baudRate); }
    save();
  });
  $('set-connectionType')?.addEventListener('change', () => { syncConnection($('set-connectionType').value); save(); });
  $('set-pageSize')?.addEventListener('change', () => {
    const preset = PAGE_SIZE_PRESETS.find((p) => p.id === $('set-pageSize').value);
    if (preset) { $('set-cells').value = preset.cells; $('set-lines').value = preset.lines; }
    save();
  });
  ['set-cells', 'set-lines'].forEach((id) => $(id)?.addEventListener('input', syncPageSize));   // typing a size shows its preset, or "Custom size"
  // set-embosser, set-connectionType and set-pageSize call save() themselves above
  ['set-networkHost', 'set-networkPort', 'set-baudRate', 'set-embosserDuplex', 'set-language', 'set-mathCode', 'set-mode', 'set-tableFormat', 'set-cells', 'set-lines', 'set-quoteStyle', 'set-listStyle', 'set-paragraphStyle', 'set-volumePages', 'set-includeCovers', 'set-asciiBraille', 'set-tactileGraphics', 'set-tactileRip'].forEach((id) => {
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
    document.body.classList.toggle('transcriber-tools', on && !betaLocked());
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
  apply();
  return { apply, populateLanguage, populateUiLanguage, syncPageSize, syncConnection };
}
