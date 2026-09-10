// Driven by Playwright against the installed Chrome (2026-09-02): puppeteer
// was removed from this repository with the Translate audit, and its bundled
// Chromium was never the browser anyone uses.
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';

const downloadOutputPath = '/Users/paulblenkhorn/Downloads/Braille_Embosser_Communication_and_Drivers_Report.pdf';
const artifactOutputPath = '/Users/paulblenkhorn/.gemini/antigravity/brain/697ff2a7-5daa-4ec5-870b-78d7779a4822/Braille_Embosser_Communication_and_Drivers_Report.pdf';

const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Braille Embosser Communication Protocols, Driver Architecture, and Software Integration Report</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 14mm 12mm 14mm 12mm;
      @bottom-right {
        content: counter(page);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 8pt;
        color: #64748b;
      }
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #1e293b;
      line-height: 1.42;
      font-size: 9pt;
      margin: 0;
      padding: 0;
    }
    .header {
      border-bottom: 2px solid #2563eb;
      padding-bottom: 8px;
      margin-bottom: 14px;
    }
    .badge {
      display: inline-block;
      background-color: #eff6ff;
      color: #1d4ed8;
      font-weight: 600;
      font-size: 7.5pt;
      padding: 2px 7px;
      border-radius: 4px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 5px;
      border: 1px solid #bfdbfe;
    }
    h1 {
      font-size: 16pt;
      color: #0f172a;
      margin: 0 0 4px 0;
      font-weight: 700;
      line-height: 1.2;
    }
    .subtitle {
      font-size: 9.5pt;
      color: #64748b;
      margin: 0;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 8px 12px;
      margin-bottom: 14px;
    }
    .meta-item {
      font-size: 8pt;
    }
    .meta-label {
      color: #64748b;
      text-transform: uppercase;
      font-size: 6.8pt;
      font-weight: 600;
      margin-bottom: 2px;
    }
    .meta-val {
      font-weight: 600;
      color: #0f172a;
    }
    h2 {
      font-size: 11.5pt;
      color: #1e3a8a;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 3px;
      margin-top: 16px;
      margin-bottom: 8px;
      page-break-after: avoid;
    }
    h3 {
      font-size: 10pt;
      color: #0f172a;
      margin-top: 12px;
      margin-bottom: 4px;
      page-break-after: avoid;
    }
    p {
      margin: 0 0 7px 0;
      text-align: justify;
    }
    ul, ol {
      margin: 0 0 8px 0;
      padding-left: 18px;
    }
    li {
      margin-bottom: 3px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 10px 0 12px 0;
      font-size: 8pt;
      page-break-inside: avoid;
    }
    th, td {
      border: 1px solid #cbd5e1;
      padding: 5px 7px;
      text-align: left;
      vertical-align: top;
    }
    th {
      background-color: #f1f5f9;
      color: #0f172a;
      font-weight: 600;
    }
    tr:nth-child(even) td {
      background-color: #f8fafc;
    }
    code {
      font-family: 'SF Mono', Monaco, 'Courier New', monospace;
      font-size: 8pt;
      background: #f1f5f9;
      padding: 1px 3px;
      border-radius: 3px;
      border: 1px solid #e2e8f0;
      color: #0f172a;
    }
    pre {
      font-family: 'SF Mono', Monaco, 'Courier New', monospace;
      font-size: 7.6pt;
      background: #0f172a;
      color: #f8fafc;
      padding: 8px 10px;
      border-radius: 5px;
      overflow-x: auto;
      margin: 6px 0 10px 0;
      line-height: 1.35;
      page-break-inside: avoid;
    }
    .callout {
      background-color: #eff6ff;
      border-left: 3px solid #2563eb;
      padding: 7px 10px;
      border-radius: 0 5px 5px 0;
      margin: 10px 0;
      font-size: 8.5pt;
      page-break-inside: avoid;
    }
    .callout-title {
      font-weight: 700;
      color: #1e40af;
      margin-bottom: 2px;
    }
    .callout-warn {
      background-color: #fffbeb;
      border-left-color: #d97706;
    }
    .callout-warn .callout-title {
      color: #b45309;
    }
    .diagram-box {
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      border-radius: 5px;
      padding: 8px 10px;
      font-family: 'SF Mono', Monaco, monospace;
      font-size: 7.2pt;
      line-height: 1.3;
      margin: 8px 0 10px 0;
      page-break-inside: avoid;
      white-space: pre;
    }
    .page-break {
      page-break-before: always;
    }
  </style>
</head>
<body>

  <div class="header">
    <div class="badge">Comprehensive Technical Research Report</div>
    <h1>Braille Embosser Communication Protocols, Driver Architectures, and Software Integration</h1>
    <div class="subtitle">A comparative analysis of physical interfaces, escape command sets, tactile graphics raster engines, and driverless network/web architectures.</div>
  </div>

  <div class="meta-grid">
    <div class="meta-item">
      <div class="meta-label">Author / System</div>
      <div class="meta-val">Advanced Agentic Engineering</div>
    </div>
    <div class="meta-item">
      <div class="meta-label">Hardware Surveyed</div>
      <div class="meta-val">Index, ViewPlus, APH, Enabling, Braillo</div>
    </div>
    <div class="meta-item">
      <div class="meta-label">Software Analyzed</div>
      <div class="meta-val">BrailleBlaster, Liblouis, CUPS, Emboss</div>
    </div>
    <div class="meta-item">
      <div class="meta-label">Date</div>
      <div class="meta-val">August 2026</div>
    </div>
  </div>

  <h2>1. Executive Summary &amp; Historical Context</h2>
  <p>
    Thirty years ago, communicating with a Braille embosser was architecturally simple: embossers were connected via <strong>RS-232 serial</strong> (DB-9/DB-25) or <strong>IEEE 1284 Centronics parallel</strong> ports. The host computer ran transcription software (like early Duxbury or Megadots), converted text into 6-dot North American ASCII Braille (ASCII characters 32 to 127 mapped 1:1 to Braille dot patterns), and streamed bytes sequentially to the printer. Line breaks were indicated by <code>CR+LF</code> (<code>\\r\\n</code>), page breaks by <code>Form Feed</code> (<code>\\f</code> / ASCII 12 / <code>0x0C</code>), and hardware handshaking (RTS/CTS or DTR/DSR) prevented buffer overruns against slow mechanical solenoid heads (15–40 characters per second).
  </p>
  <p>
    Today, the embosser landscape has evolved into a multi-tiered ecosystem spanning <strong>USB (Printer Class 07h vs. Virtual COM CDC-ACM)</strong>, <strong>10/100 Ethernet</strong>, <strong>Wi-Fi</strong>, <strong>Bluetooth RFCOMM</strong>, <strong>Raw TCP Sockets (Port 9100)</strong>, <strong>Driverless IPP (Internet Printing Protocol)</strong>, and <strong>Embedded Linux Web Servers</strong>.
  </p>

  <div class="callout">
    <div class="callout-title">The Core Dichotomy: Text Stream vs. Tactile Graphics Rasterization</div>
    Whether an embosser requires an operating system printer driver depends primarily on its workload:
    <ul>
      <li><strong>Character-Based Text Embossing (BRF / PEF):</strong> Does <em>not</em> strictly require a driver. Modern applications can pipe pre-formatted Braille bytes directly over raw TCP sockets (Port 9100), WebSerial, WebUSB, or standard byte streams.</li>
      <li><strong>Tactile Graphics &amp; Multi-Height Embossing (e.g., ViewPlus Tiger):</strong> <em>Requires a printer driver</em>. Standard desktop applications (Word, Illustrator, CAD) draw in RGB pixels and vector coordinates. The driver acts as a raster image processor (RIP), translating visual luminance into multi-level tactile dot heights (1 to 8 distinct physical elevations) and exact dot-pitch matrices (20–100 DPI).</li>
    </ul>
  </div>

  <h2>2. Hardware Interfaces &amp; Transport Evolution</h2>
  <table>
    <thead>
      <tr>
        <th>Interface Type</th>
        <th>Physical Layer</th>
        <th>OS / Transport Protocol</th>
        <th>Data Format</th>
        <th>Primary Hardware Models</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>Raw TCP Socket</strong></td>
        <td>Ethernet (RJ45), Wi-Fi (802.11 b/g/n)</td>
        <td>Port 9100 (JetDirect / AppSocket)</td>
        <td>Raw ASCII Braille (.brf), PEF XML, ESC Packets</td>
        <td>Index V4/V5, APH PageBlaster, ViewPlus Columbia, PixBlaster, Braillo</td>
      </tr>
      <tr>
        <td><strong>USB Printer Class</strong></td>
        <td>USB 2.0 Type-B / Type-C</td>
        <td>USB Class 07h (Subclass 01h, Protocol 01/02h)</td>
        <td>OS Print Spooler (RAW datatype) or PRN / TDSX Raster</td>
        <td>ViewPlus (all), Index V4/V5, Enabling Romeo/Juliet</td>
      </tr>
      <tr>
        <td><strong>USB Virtual COM</strong></td>
        <td>USB to UART (FTDI / Prolific / CDC-ACM)</td>
        <td>Virtual Serial Port (COM / ttyUSB)</td>
        <td>Raw ASCII Braille Byte Stream</td>
        <td>Enabling Technologies, Mountbatten, Index Serial</td>
      </tr>
      <tr>
        <td><strong>Embedded Web Server</strong></td>
        <td>Ethernet / Wi-Fi</td>
        <td>HTTP / HTTPS (Port 80/443), REST API</td>
        <td>.docx, .pdf, .txt, .brf, .pef (Translated on-board via idB)</td>
        <td>Index Braille V5 Series (Everest-D, Basic-D, BrailleBox)</td>
      </tr>
      <tr>
        <td><strong>WebSerial / WebUSB</strong></td>
        <td>Browser Direct (Chrome/Edge/PWA)</td>
        <td>W3C WebSerial / WebUSB APIs</td>
        <td>Direct byte stream with injected hardware headers</td>
        <td>Emboss PWA (Driverless browser-to-hardware printing)</td>
      </tr>
    </tbody>
  </table>

  <h2>3. Manufacturer Protocols &amp; Manuals Deep Dive</h2>

  <h3>A. Index Braille (Basic-D, Everest-D, BrailleBox, FanFold-D) &amp; APH PageBlaster</h3>
  <p>
    <em>Verified against official Index Braille V4/V5 Technical Manuals and the APH PageBlaster User Guide.</em>
  </p>
  <p>
    Index Braille embossers utilize an escape command protocol to configure layout geometry, hammer strike delay, line spacing, and page formatting.
  </p>
  <ul>
    <li><strong>V4 Hardware Architecture:</strong> Connected via USB, Serial, or Ethernet. Software sends an initial escape string to configure the hardware registers before streaming text.
      <pre>// Typical Index V4 / APH PageBlaster hardware setup header:
\\x1bDBT0,LS50,TD0,PN0,MC0,DP2,BI0,CH40,TM0,LP25;
// DBT0 = Direct Braille Text (no internal translation)
// LS50 = 5.0mm line spacing
// TD0  = Tactile Delay off
// PN0  = No hardware page numbers
// MC0  = Left margin column 0
// DP2  = Double-sided / Interpoint (DP1 = Single-sided)
// BI0  = Binding margin 0
// CH40 = 40 Characters per line
// TM0  = Top margin 0
// LP25 = 25 Lines per page
// Followed by body text with \\r\\n and Form Feed (\\x0c), terminated with \\x1b\\x0c</pre>
    </li>
    <li><strong>V5 Hardware Architecture (Embedded Linux Platform):</strong>
      Index V5 embossers feature an on-board Linux single-board computer (ARM SOC). They introduce <strong>Index-direct-Braille (idB)</strong>, which embeds Liblouis directly on the embosser's firmware. Users can send plain Word (<code>.docx</code>), PDF, or unformatted text files over USB thumb drives, Web interface (port 80), or IP printing (port 9100), and the embosser automatically performs Grade 1/2 translation, volume breaking, and page numbering on-board without any PC driver.
    </li>
    <li><strong>APH PageBlaster Specifics:</strong> The PageBlaster is an OEM Index Basic-D V5 unit produced for the American Printing House for the Blind. It incorporates APH speech prompts (e.g., pressing <code>Help + 10</code> speaks the Wi-Fi/Ethernet IP address; <code>Help + Off</code> triggers firmware upgrade from USB). It natively accepts raw Port 9100 socket connections and USB printer class streams.</li>
  </ul>

  <div class="page-break"></div>

  <h3>B. ViewPlus Technologies (Columbia, Delta, Premier, Max, Rogue) &amp; APH PixBlaster</h3>
  <p>
    <em>Verified against official ViewPlus User Manuals, Tiger Software Suite Documentation, and the APH PixBlaster Manual.</em>
  </p>
  <p>
    ViewPlus embossers are built upon proprietary <strong>Tiger Tactile Graphics Technology</strong>. Unlike solenoid embossers that punch single-depth dots, Tiger heads feature floating hammer pins capable of punching at <strong>7 to 8 distinct physical dot heights</strong> at resolutions from <strong>20 DPI to 100 DPI</strong>.
  </p>
  <ul>
    <li><strong>Text Mode (ASCII Braille):</strong> ViewPlus devices support a raw text mode triggered by sending the escape prefix <code>\\x1b*t</code> followed by standard ASCII Braille. In this mode, it behaves like a standard character embosser.</li>
    <li><strong>Tiger Graphics Mode (PRN / TDSX Binary Raster):</strong> To render tactile graphics, the device does <em>not</em> accept text or ASCII characters. It requires a binary dot-matrix raster file (<code>.prn</code> or <code>.tdsx</code>). This stream encodes a 2D coordinate map where each pixel byte dictates the precise hammer velocity and impact depth (e.g., darker visual pixels punch higher dots; lighter pixels punch lower dots).</li>
    <li><strong>Why ViewPlus Requires a Driver:</strong> When printing from mainstream applications like Microsoft Word, Adobe Illustrator, or CorelDRAW, the <strong>ViewPlus Tiger Printer Driver</strong> intercepts standard Windows GDI/XPS or CUPS print calls, performs color-to-height color mapping, applies tactile dithering algorithms, and renders the output into the Tiger binary dot language.</li>
    <li><strong>APH PixBlaster Specifics:</strong> The PixBlaster is an OEM version of the ViewPlus Columbia tractor-fed embosser. It ships with the Tiger Software Suite (TSS) and VP Formatter. It supports USB, Ethernet, and Wi-Fi. For tactile graphics, it must receive pre-rasterized Tiger PRN streams generated by the driver or BrailleBlaster's internal tactile graphics engine.</li>
  </ul>

  <h3>C. Enabling Technologies / HumanWare (Romeo 60, Juliet 120, Thomas, Marathon)</h3>
  <p>
    <em>Verified against Enabling Technologies Technical Reference Manuals.</em>
  </p>
  <p>
    Enabling Technologies embossers utilize the classical ET escape code set:
  </p>
  <pre>// Enabling Technologies Hardware Command Sequence:
\\x1b\\x00         // Reset embosser to default state
\\x1b\\x0c{lines}  // Set lines per page (e.g. \\x1b\\x0c\\x19 for 25 lines)
\\x1b\\x0e{cols}   // Set characters per line (e.g. \\x1b\\x0e\\x28 for 40 columns)
\\x1b\\x12{1|2}    // Set interpoint duplex mode (1 = Single, 2 = Double)
// Followed by body text, terminated with \\x1a (Ctrl+Z) or \\x0c (Form Feed)</pre>

  <h3>D. Braillo Norway (Braillo 300, 450, 600, 600SR)</h3>
  <p>
    Industrial heavy-duty production embossers (used for high-volume textbook and magazine printing). They utilize continuous 4-page interpoint layout formats, accepting raw ASCII braille, Braillo binary commands (<code>\\x1bM</code> for margins, <code>\\x1bL</code> for line depth), and PEF XML over Ethernet (Port 9100), USB, or serial.
  </p>

  <h2>4. How BrailleBlaster Drives Embossers</h2>
  <p>
    An investigation of the official <strong>BrailleBlaster source code</strong> (APH / Daisy Consortium / Liblouis) reveals how BrailleBlaster interfaces with physical hardware across different manufacturers:
  </p>

  <div class="diagram-box">
+---------------------------------------------------------------------------------------------+
|                               BRAILLEBLASTER EMBOSSING PIPELINE                              |
+---------------------------------------------------------------------------------------------+
|                                                                                             |
|   1. SOURCE DOCUMENT                                                                        |
|      XML / HTML / DOCX / NFX (NIMAS)                                                        |
|                                                                                             |
|   2. TRANSLATION &amp; FORMATTING ENGINE                                                        |
|      Liblouis (UEB / EBAE / Nemeth) + Daisy BrailleUtils / PEF Generator                     |
|                                                                                             |
|   3. EMBOSSER ROUTING &amp; DISPATCH (org.brailleblaster.embossers / libembosser)               |
|                                                                                             |
|      [A] Standard Character Embossers          [B] ViewPlus / PixBlaster Graphics Embosser   |
|          (Index, Enabling, Braillo, Generic)       (Columbia, PixBlaster, Delta, Premier)   |
|                 |                                             |                             |
|                 v                                             v                             |
|          Generate Raw ASCII BRF / PEF                 Generate Tiger Dot-Matrix Raster      |
|          + Injected Hardware Escape Codes             (TDSX / PRN Multi-Height Stream)      |
|                 |                                             |                             |
|                 +----------------------+----------------------+                             |
|                                        |                                                    |
|   4. PHYSICAL TRANSPORT DISPATCH       v                                                    |
|      [1] Java Print Service (javax.print) via DocFlavor.BYTE_ARRAY.AUTOSENSE                |
|      [2] Direct Network TCP Socket -> socket://&lt;ip&gt;:9100                                    |
|      [3] Direct Virtual Serial Port -> jSerialComm / COM port stream                        |
|                                                                                             |
+---------------------------------------------------------------------------------------------+</div>

  <h3>Key Architectural Strategies in BrailleBlaster:</h3>
  <ol>
    <li><strong>Bypassing GDI via <code>DocFlavor.BYTE_ARRAY.AUTOSENSE</code>:</strong>
      When sending standard text to Index or Enabling embossers configured in Windows/macOS, BrailleBlaster does <em>not</em> use standard graphical printing (<code>DocFlavor.SERVICE_FORMATTED.PAGEABLE</code>). Instead, it queries the <code>PrintService</code> and sends a raw byte array marked <code>AUTOSENSE</code>. This instructs the OS print spooler to pass the raw ASCII Braille bytes directly to the USB/network endpoint without rasterizing fonts or altering character codes.
    </li>
    <li><strong>Direct Socket Communication (Port 9100):</strong>
      For networked embossers (Index V4/V5, ViewPlus, PageBlaster, PixBlaster), BrailleBlaster can open a direct raw TCP socket to port 9100, streaming the pre-formatted BRF/PEF buffer without touching the operating system's print spooler or printer list.
    </li>
    <li><strong>Dedicated ViewPlus Tactile Graphics Subsystem:</strong>
      When embossing mixed text and tactile graphics to ViewPlus devices, BrailleBlaster activates its tactile graphics module. It converts vector shapes, MathML formulas, and embedded diagrams into Tiger-compatible dot arrays with modulated dot height values.
    </li>
  </ol>

  <div class="page-break"></div>

  <h2>5. Detailed Analysis: Why Do Some Embossers Need Printer Drivers?</h2>
  <p>
    The necessity of an installed operating system printer driver is governed by four fundamental engineering requirements:
  </p>

  <div class="callout callout-warn">
    <div class="callout-title">1. Tactile Graphics Rasterization &amp; Multi-Height Dithering (ViewPlus / PixBlaster)</div>
    Standard desktop programs (Microsoft Word, Adobe Illustrator, CorelDRAW, web browsers) have no built-in knowledge of Braille dot spacing or solenoid strike velocity. When a user clicks "Print" in Word, the application issues Windows GDI (Graphics Device Interface) or XPS vector/bitmap drawing commands.
    <br><br>
    The <strong>ViewPlus Tiger Driver</strong> functions as a specialized Raster Image Processor (RIP):
    <ul>
      <li>It intercepts 2D RGB/CMYK visual paths and bitmaps.</li>
      <li>It computes pixel brightness and converts luminance into <strong>7–8 physical dot heights</strong> (e.g. pure black = tallest dot; light gray = low dot; white = no dot).</li>
      <li>It enforces tactile resolution limits (typically 20 DPI) so lines remain distinct to human fingertip touch.</li>
      <li>It compiles this data into the proprietary binary <strong>Tiger PRN/TDSX language</strong>. Without the driver, standard design software cannot talk to tactile graphics hardware.</li>
    </ul>
  </div>

  <h3>2. USB Device Class Arbitration &amp; OS Endpoint Locking</h3>
  <p>
    Under USB specifications, devices declare their interface class:
  </p>
  <ul>
    <li><strong>USB Class 07h (Printer Device Class):</strong> Most modern USB embossers present as USB Class 07h. Under Windows and macOS, the operating system kernel automatically binds the USB printer class driver (<code>usbprint.sys</code> on Windows; <code>usbtbd</code> on macOS) to the physical port. Once bound, user-space applications cannot open a raw COM handle to the device; data <em>must</em> pass through the OS Print Spooler subsystem via an installed printer driver queue.</li>
    <li><strong>USB CDC-ACM (Virtual COM):</strong> Embossers that present as virtual COM ports bypass the print spooler, allowing raw byte streaming directly to <code>COM3</code> or <code>/dev/ttyUSB0</code>.</li>
  </ul>

  <h3>3. Automatic Hardware Header Injection &amp; Configuration</h3>
  <p>
    When printing from general software, users select options in the standard OS Print Dialog (e.g., Paper Size: 11.5x11 inches, Duplex: Double-Sided, Interline Spacing). A printer driver translates these graphical UI checkboxes into the exact vendor-specific escape sequences (e.g., Index <code>\\x1bDP2,CH40,LP25;</code> or Enabling <code>\\x1b\\x122</code>) and prepends them to the document payload.
  </p>

  <h3>4. Enterprise Spooling, Network Queues, &amp; Error Telemetry</h3>
  <p>
    In educational institutions and production centers, multiple transcribers share embossers across LAN networks. Operating system printer drivers integrate with Windows Print Server and CUPS, providing job queuing, priority scheduling, paper-out detection, jam alerts, and retry logic.
  </p>

  <h2>6. When Are Printer Drivers NOT Needed?</h2>
  <ul>
    <li><strong>Raw TCP Socket Streaming (Port 9100):</strong> Any network-connected Index, ViewPlus, PageBlaster, PixBlaster, or Braillo embosser accepts raw bidirectional TCP streams on port 9100. Any script, terminal command, or web service can send pre-translated <code>.brf</code> or <code>.pef</code> files directly without drivers.</li>
    <li><strong>Browser-Native WebSerial / WebUSB (Modern PWAs like Emboss):</strong> Using the W3C WebSerial API, browser applications can communicate directly with USB-connected embossers, dynamically injecting vendor escape headers (Index, ViewPlus, Enabling, Braillo) and streaming ASCII Braille in pure JavaScript.</li>
    <li><strong>Onboard Translation Firmware (Index V5 idB):</strong> Index V5 embossers parse plain Word (<code>.docx</code>), PDF, and text files directly via their embedded web interface or USB flash drive without host drivers.</li>
  </ul>

  <h2>7. Comprehensive Architectural Summary Table</h2>
  <table>
    <thead>
      <tr>
        <th>Manufacturer / Model</th>
        <th>Physical Interfaces</th>
        <th>Escape / Command Set</th>
        <th>Driver Required?</th>
        <th>Port 9100 Raw?</th>
        <th>Tactile Graphics Capability</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>Index Basic-D / Everest-D (V5)</strong></td>
        <td>USB, Ethernet, Wi-Fi, Bluetooth, USB Host</td>
        <td>Index V5 Escape Set, idB on-board translation</td>
        <td>No for BRF/PEF; Optional for OS Spooler</td>
        <td><strong>Yes</strong></td>
        <td>High-resolution dot matrix (tactile mode)</td>
      </tr>
      <tr>
        <td><strong>APH PageBlaster</strong></td>
        <td>USB, Ethernet, Wi-Fi, Bluetooth, USB Host</td>
        <td>Index V5 Escape Set (<code>\\x1bDBT0...;</code>)</td>
        <td>No for BRF/PEF; Optional for OS Spooler</td>
        <td><strong>Yes</strong></td>
        <td>Standard dot matrix via TactileView</td>
      </tr>
      <tr>
        <td><strong>ViewPlus Columbia / Delta / Max</strong></td>
        <td>USB, Ethernet, Wi-Fi, Bluetooth</td>
        <td>Tiger Language (PRN/TDSX) &amp; Text (<code>\\x1b*t</code>)</td>
        <td><strong>Yes for Graphics / TSS</strong>; No for raw text</td>
        <td><strong>Yes</strong></td>
        <td><strong>Full Multi-Height (7–8 levels, 20–100 DPI)</strong></td>
      </tr>
      <tr>
        <td><strong>APH PixBlaster</strong></td>
        <td>USB, Ethernet, Wi-Fi, Bluetooth</td>
        <td>Tiger Language (PRN/TDSX) &amp; Text (<code>\\x1b*t</code>)</td>
        <td><strong>Yes for Graphics / TSS</strong>; No for raw text</td>
        <td><strong>Yes</strong></td>
        <td><strong>Full Multi-Height (7–8 levels, 20–100 DPI)</strong></td>
      </tr>
      <tr>
        <td><strong>Enabling Romeo 60 / Juliet 120</strong></td>
        <td>USB, Serial, Ethernet, Wi-Fi</td>
        <td>ET Command Set (<code>\\x1b\\x00</code>, <code>\\x1b\\x0c</code>)</td>
        <td>No for BRF; Optional for OS Spooler</td>
        <td><strong>Yes</strong></td>
        <td>Standard uniform dot matrix</td>
      </tr>
      <tr>
        <td><strong>Braillo 300 / 450 / 600</strong></td>
        <td>Ethernet, USB, Serial</td>
        <td>Braillo Binary / ESC Set (<code>\\x1bM</code>, <code>\\x1bL</code>)</td>
        <td>No for BRF/PEF; Optional for OS Spooler</td>
        <td><strong>Yes</strong></td>
        <td>Heavy-duty production interpoint</td>
      </tr>
    </tbody>
  </table>

  <h2>8. Architectural Blueprint &amp; Recommendations for a Simple One-Page Braille Printer</h2>
  <p>
    For an engineering project building a <strong>simple one-page (cut-sheet / card) Braille text printer</strong> (without complex multi-height tactile graphics), the primary goals should be: <em>zero user software installation, cross-platform compatibility, zero OS driver requirements, and instantaneous workflow integration</em>.
  </p>

  <div class="callout">
    <div class="callout-title">The Recommended Golden Path: USB CDC-ACM Virtual Serial + WebSerial Integration</div>
    <strong>Do NOT implement USB Printer Class (Class 07h).</strong> USB Printer Class forces the operating system (Windows/macOS) to attach kernel print drivers, requiring you to create signed INF files or PPD drivers.
    <br><br>
    <strong>Instead, implement standard USB CDC-ACM (Virtual COM Port, Class 02h/0Ah) on your microcontroller firmware</strong> (e.g., ESP32, Raspberry Pi Pico / RP2040, STM32, or Arduino):
    <ul>
      <li><strong>100% Driverless Out-of-the-Box:</strong> Modern Windows 10/11 (<code>usbser.sys</code>), macOS, Linux, ChromeOS, and Android include native USB CDC-ACM drivers. No installer or driver download is required.</li>
      <li><strong>Direct Browser 1-Click Embossing (W3C WebSerial):</strong> Web transcription tools (such as <strong>Emboss PWA</strong>) can communicate directly with the embosser over USB with a single click. The user visits the website, clicks "Emboss", selects the detected port, and the page punches immediately.</li>
      <li><strong>Standard Software Compatibility:</strong> Traditional desktop software (BrailleBlaster, Duxbury DBT) can immediately emboss to it by configuring a "Generic Text Embosser" assigned to the assigned COM / ttyUSB port.</li>
    </ul>
  </div>

  <h3>A. Recommended Hardware &amp; Transport Stack</h3>
  <table>
    <thead>
      <tr>
        <th>Transport Tier</th>
        <th>Physical Interface</th>
        <th>Firmware Implementation</th>
        <th>User Experience / Workflow</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>Primary (USB)</strong></td>
        <td>USB-C (CDC-ACM Virtual COM)</td>
        <td>Standard CDC Serial Stack at 115,200 baud (ESP32-S3, RP2040 TinyUSB, STM32)</td>
        <td><strong>1-Click WebSerial embossing from Emboss PWA</strong>; standard COM port in BrailleBlaster/DBT; command line (<code>cat file.brf &gt; COM3</code>).</td>
      </tr>
      <tr>
        <td><strong>Secondary (Wi-Fi Network)</strong></td>
        <td>Wi-Fi (802.11 b/g/n) on ESP32 or Pico-W</td>
        <td>Raw TCP Server on Port 9100 + Lightweight HTTP REST Server (Port 80)</td>
        <td><strong>Raw Port 9100 network embossing</strong> from any LAN device; Local Web UI (<code>http://braille.local</code>) allowing drag-and-drop <code>.brf</code> upload from phone/tablet.</td>
      </tr>
      <tr>
        <td><strong>Wireless (Mobile)</strong></td>
        <td>Bluetooth LE (BLE) / Bluetooth Classic</td>
        <td>Nordic UART Service (NUS) or SPP Profile</td>
        <td>Direct wireless embossing from iOS/iPadOS/Android mobile apps via WebBluetooth.</td>
      </tr>
    </tbody>
  </table>

  <h3>B. Minimalist &amp; Robust Command Protocol Specification</h3>
  <p>
    Keep the communications protocol simple, text-based, and human-readable. Accept standard North American ASCII Braille characters (ASCII 32 to 127) as well as direct UTF-8 Unicode Braille patterns (<code>\\u2800</code> to <code>\\u28FF</code>):
  </p>

  <div class="diagram-box">
+---------------------------------------------------------------------------------------------+
|                     SIMPLE ONE-PAGE BRAILLE PRINTER PROTOCOL SPECIFICATION                  |
+---------------------------------------------------------------------------------------------+
|                                                                                             |
|   1. LINE ADVANCE:                                                                          |
|      CR (\\r / 0x0D) or LF (\\n / 0x0A) -> Advances stepper motor to next line               |
|                                                                                             |
|   2. PAGE EJECT &amp; FEED:                                                                     |
|      Form Feed (FF / \\f / 0x0C) -> Ejects finished sheet and positions next blank card     |
|                                                                                             |
|   3. RESET / CLEAR BUFFER:                                                                  |
|      ESC @ (\\x1b@ / 0x1B 0x40) -> Clears head buffer and re-homes carriage steppers         |
|                                                                                             |
|   4. OPTIONAL GEOMETRY HEADER:                                                              |
|      ESC [ C {cols} ; L {lines} ] -> Configures max cells per line (e.g. \\x1b[C30;L20])     |
|                                                                                             |
|   5. BIDIRECTIONAL STATUS TELEMETRY (Query byte: '?'):                                      |
|      Host sends '?' -> Firmware replies: "READY\\n", "BUSY\\n", or "OUT_OF_PAPER\\n"          |
|                                                                                             |
+---------------------------------------------------------------------------------------------+</div>

  <h3>C. Summary of Recommended User Access Workflows</h3>
  <ol>
    <li><strong>Web-First Driverless Embossing (The Emboss Workflow):</strong> The user prepares their text/math document in the Emboss PWA. Clicking "Emboss" triggers <code>navigator.serial.requestPort()</code>, streams the pre-translated BRF lines with <code>CR+LF</code> and a trailing <code>Form Feed</code>, and displays real-time progress. Zero drivers, zero installation, works on Chromebooks, Mac, Windows, and Linux.</li>
    <li><strong>Universal Network Drop (Wi-Fi Port 9100):</strong> In classroom settings, students on iPads or laptops can send Braille jobs across the local network using a standard raw socket or a browser-based drop zone at <code>http://braille.local</code>.</li>
    <li><strong>Legacy Desktop Integration (BrailleBlaster / Duxbury):</strong> Instruct users to select <em>"Generic Text Only Embosser"</em> and choose the Virtual COM port or IP address.</li>
  </ol>

  <h2>9. Direct ASCII Streaming Compatibility Guide: Can You Just Send ASCII + CR + LF + FF?</h2>
  <p>
    A common and critical architectural question is: <em>Can software literally just stream raw ASCII text characters terminated with Carriage Return (<code>\\r</code>), Line Feed (<code>\\n</code>), and Form Feed (<code>\\f</code> / <code>0x0C</code>) to produce embossed Braille across various machines?</em>
  </p>

  <div class="callout">
    <div class="callout-title">The Fundamental Distinction: Visual Print Text vs. North American ASCII Braille</div>
    Before evaluating hardware behavior, it is essential to distinguish between the two data payloads:
    <ul>
      <li><strong>Visual Print Text (e.g. <code>"Hello 123!"</code>):</strong> If you stream un-translated visual text to a raw embosser, it will punch literal uncontracted Grade 1 letters. However, punctuation and digits will be completely corrupt (e.g. the ASCII digit <code>1</code> punches dot-1 <code>⠁</code> without a number prefix <code>⠼</code>; visual punctuation does not match Braille dot standards). <em>Only embossers with on-board translation engines (like Index V5 idB) can translate visual text.</em></li>
      <li><strong>North American ASCII Braille / BRF (e.g. <code>",HELLO #ABC!"</code>):</strong> This is pre-translated Braille where every ASCII character code (32–127) corresponds 1:1 to an exact physical 6-dot cell pattern (e.g. <code>,</code> = dot 6; <code>#</code> = dots 3-4-5-6). <em>This is what embossers expect in text mode.</em></li>
    </ul>
  </div>

  <h3>Manufacturer-by-Manufacturer ASCII Streaming Matrix</h3>
  <table>
    <thead>
      <tr>
        <th>Manufacturer / Model</th>
        <th>Can Stream Bare ASCII + CR + LF + FF?</th>
        <th>Required Prefix / Escape Switch</th>
        <th>Technical Behavior &amp; Failure Modes</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>Custom 1-Page Printer</strong></td>
        <td><strong style="color: #16a34a;">YES (100% Native)</strong></td>
        <td>None required</td>
        <td>Microcontroller firmware decodes ASCII Braille table directly to pin solenoids; <code>\\r\\n</code> steps line motor; <code>\\f</code> ejects card.</td>
      </tr>
      <tr>
        <td><strong>Enabling Technologies</strong><br>(Romeo 60, Juliet 120)</td>
        <td><strong style="color: #16a34a;">YES (100% Native)</strong></td>
        <td>None required (Optional reset <code>\\x1b\\x00</code>)</td>
        <td>Built specifically for raw ASCII Braille streams. Automatically uses hardware keypad settings for margins and line limits.</td>
      </tr>
      <tr>
        <td><strong>Index Braille</strong><br>(Basic-D, Everest-D, PageBlaster)</td>
        <td><strong style="color: #ca8a04;">YES, but Recommended Header</strong></td>
        <td><code>\\x1bDBT0,CH40,LP25;</code> (Direct Braille Mode)</td>
        <td>If embosser is set to default DBT mode, bare ASCII streams work. <em>Caution:</em> If the unit was left in internal translation mode (idB), bare ASCII might undergo "double-translation". Sending <code>\\x1bDBT0...;</code> guarantees transparent punch.</td>
      </tr>
      <tr>
        <td><strong>ViewPlus / APH PixBlaster</strong><br>(Columbia, Delta, Max, Premier)</td>
        <td><strong style="color: #dc2626;">CONDITIONAL (Requires Prefix)</strong></td>
        <td><code>\\x1b*t</code> (Switch to Text Mode)</td>
        <td><strong>Cannot send bare ASCII by default.</strong> Powers up in Tiger Graphics mode (expecting binary pixel raster). Sending bare ASCII causes errors. Sending the 4-byte switch <code>\\x1b*t</code> immediately enables raw ASCII Braille streaming.</td>
      </tr>
      <tr>
        <td><strong>Braillo Norway</strong><br>(Braillo 300, 450, 600)</td>
        <td><strong style="color: #16a34a;">YES</strong></td>
        <td>None (or sheet format setup <code>\\x1bM</code>)</td>
        <td>Punches raw ASCII Braille directly across 2-page or 4-page interpoint continuous sheets.</td>
      </tr>
      <tr>
        <td><strong>Mountbatten / Perkins SMART</strong></td>
        <td><strong style="color: #16a34a;">YES (In Terminal Mode)</strong></td>
        <td>Terminal mode command</td>
        <td>Acts as a live Braille teletype terminal; punches cells in real-time as bytes arrive over serial/USB.</td>
      </tr>
    </tbody>
  </table>

  <h3>Summary Recommendation for Web / Software Engines</h3>
  <p>
    To build a universal streaming engine (such as in <strong>Emboss PWA</strong> or embedded controllers):
  </p>
  <ol>
    <li>Always translate text into <strong>North American ASCII Braille (BRF)</strong> before streaming.</li>
    <li>For maximum hardware interoperability, inspect the target model and inject the appropriate 1-line prefix (e.g. <code>\\x1b*t</code> for ViewPlus, <code>\\x1bDBT0...;</code> for Index, or plain stream for Enabling and your Custom 1-Page Brailler).</li>
    <li>Terminate every page with <code>Form Feed</code> (<code>\\x0c</code>) to trigger physical page eject across all manufacturers.</li>
  </ol>

</body>
</html>
`;

async function generatePDF() {
  console.log('Launching headless browser...');
  const browser = await chromium.launch({ channel: 'chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setContent(htmlContent, { waitUntil: 'networkidle' });

  console.log('Rendering PDF document...');
  const pdfBuffer = await page.pdf({
    path: downloadOutputPath,
    format: 'A4',
    printBackground: true,
    margin: {
      top: '16mm',
      right: '12mm',
      bottom: '16mm',
      left: '12mm'
    }
  });

  // Also write to artifacts directory
  fs.writeFileSync(artifactOutputPath, pdfBuffer);

  await browser.close();
  console.log(`Successfully generated PDF at:\n  -> ${downloadOutputPath}\n  -> ${artifactOutputPath}`);
}

generatePDF().catch((err) => {
  console.error('PDF generation failed:', err);
  process.exit(1);
});
