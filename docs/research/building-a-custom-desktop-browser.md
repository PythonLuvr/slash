# **Technical Reference Manual for Custom Desktop Browser Development (2025-2026)**

## **1\. Multi-Process Browser Architecture**

Modern browser design relies on a multi-process model to enforce security boundaries, guarantee fault isolation, and maximize hardware parallelization.1 This architecture distributes tasks across distinct OS-level processes, preventing a single failure or compromise from impacting the overall system.1

                          \+------------------------+  
                          |     Browser Process    |  \<-- Trusted Coordinator  
                          | (Orchestrator, UI, DB) |  
                          \+------------------------+  
                             /         |        \\  
            Mojo/IPDL IPC   /          |         \\   Mojo/IPDL IPC  
             \[5, 6\] /           |          \\  \[5, 6\]  
                          v            v           v  
           \+------------------+  \+-----------+  \+---------------------+  
           | Renderer Process |  |    GPU    |  |   Network Process   |  
           | (HTML, DOM, JS)  |  |  Process  |  | (Sockets, TLS, DNS) |  
           \+------------------+  \+-----------+  \+---------------------+  
                    |           |                   |  
                    v                  v                   v  
             Sandboxed OS         Sandboxed OS        Sandboxed OS  
               Container            Container           Container  
             \[4, 7\]       \[4, 7\]      \[4, 7\]

### **Process Taxonomy and Responsibilities**

#### **Browser Process (UI and Orchestrator)**

The browser process acts as the privileged core of the application.1 It runs with standard user privileges, manages the lifecycle of all child processes, coordinates native window frames, and handles high-level storage access.1 This process is the only one authorized to perform direct system actions or request resource allocations from the operating system kernel.8

#### **Renderer Process**

The renderer process parses HTML and CSS, builds the Document Object Model (DOM), computes layouts, and runs untrusted guest JavaScript.8 To mitigate exploit risks, renderers run inside highly restricted OS sandboxes that block direct access to the filesystem, network sockets, and system hardware.1 Under site isolation rules, a separate renderer process is allocated for each site origin (![][image1]).2

#### **GPU Process**

The GPU process consolidates rendering commands from multiple renderer processes and the browser UI.12 By separating graphics operations into a dedicated process, the browser isolates GPU driver crashes from other components.7 The GPU process rasterizes drawing commands via hardware-accelerated graphics libraries (such as Skia) and composite frames for screen display.11

#### **Network Process**

The network process manages the entire networking stack, including socket management, HTTP/1.1, HTTP/2, HTTP/3 protocol state tracking, DNS resolution, and TLS handshakes.7 This separation isolates memory parsing vulnerabilities (such as those in TLS libraries or cookie parsers) from more privileged components.8

#### **Utility & Storage Processes**

Browsers allocate transient utility processes to isolate complex parsing tasks, such as out-of-process image decoding, audio processing, and database storage operations.1 This design ensures that parsing malicious media files or executing database operations does not compromise the browser or renderer processes.15

| Architectural Attribute | Chromium | Firefox (Gecko / Fission) | Ladybird |
| :---- | :---- | :---- | :---- |
| **Primary Process Model** | Site-per-process (eTLD+1 locking) 2 | Process-per-site (Fission) 9 | Process-per-tab (with dedicated helper processes) 10 |
| **IPC Framework** | Mojo (MessagePipe / Ports / Nodes) 5 | IPDL (Actor-based protocol definitions) 6 | LibIPC (C++/Rust serialized pipelines) 15 |
| **GPU Isolation** | Dedicated GPU process (Viz compositor) 12 | Dedicated GPU process (WebRender context) 7 | Dedicated Compositor process (out-of-process) 19 |
| **Network Isolation** | Out-of-process Network Service 1 | Out-of-process Socket Process 9 | Out-of-process RequestServer 10 |
| **Sandboxing Strategy** | seccomp-bpf (Linux), AppContainer (Win), Seatbelt (macOS) | seccomp-bpf, restricted token policies, AppSandbox | OS-level sandboxing (WIP), process boundary isolation 15 |

### **Inter-Process Communication (IPC) Implementations**

#### **Chromium (Mojo)**

Chromium's Mojo framework manages inter-process communication using three abstraction layers 5:

1. **Mojo Core:** Implements message routing over a network of "Nodes" (typically processes).5 Endpoints are defined as "Ports," which are represented as random 128-bit numbers.5 Logical communication channels are called "MessagePipes".5  
2. **C System API:** A stable, versioned interface that exposes raw handles (e.g., MessagePipe, DataPipeConsumer, PlatformHandle) and traps.5  
3. **Bindings API:** Automatically generates strongly typed C++, Rust, or JavaScript bindings from interface definition files (.mojom).17

Mojo routes messages on an embedder-provided I/O thread, while message transmission is performed on the sending thread.5 A specialized "Broker" process bootstraps connections between sandboxed nodes by managing handle duplication and establishing direct native IPC channels (such as UNIX sockets or Mach ports) between peers.5

#### **Firefox (IPDL)**

Firefox implements IPC using the Inter-process-communication Protocol Definition Language (IPDL).6 IPDL uses an actor model where communications occur between parent and child objects.6 It features a strict actor hierarchy:

* Top-level actors manage sub-protocols, and child processes use explicit constructor messages (e.g., async PMyManaged()) to instantiate managed actors.6  
* The language enforces message flow constraints via dynamic state machines, allowing messages to be declared as async or sync.6  
* Shared memory buffers (Shmem and SharedMemoryBasic) are integrated directly into the IPDL model.13 Parent and child processes allocate and transfer these buffers to avoid memory-copy overhead during large transfers, such as rendering frame updates.13

#### **Ladybird (LibIPC)**

Ladybird enforces process boundaries using LibIPC.15 The architecture isolates the browser UI process from renderers (WebContent), networking (RequestServer), and compositing processes.10 Serialization and deserialization rules are applied at process boundaries.21 If a deserialization check fails (e.g., due to malformed data), LibIPC gracefully closes the associated socket pair connection, isolating the failure and preventing memory corruption exploits.21

## **2\. Engine Embedding Options**

Selecting an integration target is a key design decision when building a custom browser shell. The table below compares the primary embedding frameworks available in 2025-2026.

| Framework | Binary Footprint | API Architecture | Sandbox Integration | Platform Compatibility | Core Implementations | Reference Repository |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| **CEF (Chromium Embedded)** | 100MB+ 22 | Low-level C/C++ bindings for windows, frames, and V8 contexts.22 | Multi-process sandboxing (inherited from Chromium).24 | Windows, macOS, Linux.25 | Spotify Desktop, custom enterprise shells.22 | [chromiumembedded/cef](https://github.com/chromiumembedded/cef) |
| **Electron webContents** | 90MB+ 23 | High-level JavaScript with Node.js bindings and process controls.23 | Configurable sandbox profiles; supports Node isolation modes. | Windows, macOS, Linux. | VS Code, Slack, Beaker Browser.23 | [electron/electron](https://github.com/electron/electron) |
| **Tauri WebView** | 5MB \- 10MB 23 | Rust-native controls with JS bridge injection.23 | Relies on system-level WebView sandboxing. | Windows, macOS, Linux, Android, iOS.26 | Lightweight utilities, modern application launchers.23 | [tauri-apps/tauri](https://github.com/tauri-apps/tauri) |
| **WebView2** | System dependent (or 180MB fixed) 22 | COM-based C++ and.NET interfaces.22 | Multi-process sandbox managed by Microsoft Edge.24 | Windows-native (with experimental Linux support).22 | Enterprise desktop dashboards.22 | ([https://github.com/MicrosoftEdge/WebView2Feedback](https://github.com/MicrosoftEdge/WebView2Feedback)) |
| **WKWebView** | Integrated into OS | Cocoa API with Swift or Objective-C delegates.27 | Multi-process sandboxing managed by WebKit2.27 | macOS, iOS.27 | Orion, SigmaOS, Arc (macOS native shell). | ([https://github.com/WebKit/WebKit](https://github.com/WebKit/WebKit)) |
| **WebKitGTK** | Integrated into OS | GObject C/C++ interface wrapper.27 | Sandbox separation managed by WebKit2.27 | Linux primarily (experimental macOS/Windows).25 | Epiphany (GNOME Web), Midori, early Ladybird.10 | ([https://github.com/WebKit/WebKit](https://github.com/WebKit/WebKit)) |
| **Servo** | \~72MB (30MB compressed) 28 | Rust-native WebView crate.29 | Rust-enforced memory safety; OS sandboxing planned.29 | Windows, macOS, Linux, Android.26 | Slint UI components, embedded webViews.26 | [servo/servo](https://github.com/servo/servo) |

## **3\. UI Chrome Components & State Coordination**

A browser shell's user interface ("Chrome") coordinates and synchronizes state between the native shell window and the underlying rendering engine.1

\+---------------------------------------------------------------------------------------+  
| \[Forward\]  \[ https://example.com/                       \]\[Menu\]     |  \<-- Browser UI Chrome  
\+---------------------------------------------------------------------------------------+  
|     \[+\]                       |  \<-- Tab Strip  
\+---------------------------------------------------------------------------------------+  
|                                                                                       |  
|                                                                                       |  
|                                 WEB VIEW PORTION                                      |  \<-- Renderer Process  
|                                                                                       |  
|                                                                                       |  
\+---------------------------------------------------------------------------------------+  
|  Find-in-Page: \[ text\_query \] (3 of 10\) \[Up\]\[x\]                                |  \<-- Overlay / Chrome UI  
\+---------------------------------------------------------------------------------------+

### **Omnibox and Address Bar Architecture**

The Omnibox handles URL validation, search query processing, and autocomplete suggestions.

* **State Management:** It maintains states for input buffers, active selection indexes, suggestions dictionary arrays, and protocol validations.  
* **Engine Coordination:** When a user enters text, the Omnibox tokenizer parses the input:  
  1. Validates schemes (file:///, http://, https://) or local loopbacks (localhost, 127.0.0.1).  
  2. If the input does not match a valid URL structure, it translates the text into a search query string (e.g., https://google.com/search?q={query}) and sends a load event to the navigation controller.1  
* **Edge Cases:** Handles malformed URLs, special character sequences, SQL injection attempts in history searches, and asynchronous suggestion delays.32

### **Tab State Machine**

The browser process tracks and updates tab lifecycle states using a finite state machine (FSM).1

        
              |  
              v  
         \+---------+  
         |  Idle   | \<---------------+  
         \+---------+                 |  
              |                      |  
      (Load URL Event)               |  
              |                      |  
              v                      |  
        \+----------+                 |  
   \+---\>| Loading  |                 |  
   |    \+----------+                 |  
   |          |                      |  
(Redirect) (Commit / DOM Ready)  (Suspend Policy)  
   |          |                      |  
   \+----------v                      |  
        \+----------+                 |  
        |  Active  |-----------------+  
        \+----------+                 |  
         /        \\                  |  
        /          \\                 |  
(Crash Event)  (User Leaves Tab)     |  
      /              \\               |  
     v                v              v  
\+---------+      \+-----------------------+  
| Crashed |      | Suspended / Sleeping  |  
\+---------+      \+-----------------------+

* **State Management:** Tracks lifecycle states (Idle, Loading, Active, Suspended, Crashed), process metrics, zoom levels, and page metadata (e.g., titles, favicons).1  
* **Engine Coordination:** Dispatches navigation load commands to the tab's navigation controller, manages loading animation loops, and updates navigation history when a page commits.  
* **Edge Cases:** Manages navigation timeouts, background tabs that execute keepalive fetches during unload events (which can delay process teardown for up to 30 seconds), and automatic crash recovery when a renderer process terminates unexpectedly.1

### **Tab Groups**

* **State Management:** Manages nested tab collections, grouping titles, collapse states, and visual configurations.  
* **Engine Coordination:** Synchronizes layout adjustments with the tab strip. When a group is collapsed, the browser hides the corresponding tab views while keeping their rendering processes alive in the background.

### **Context Menus**

* **State Management:** Tracks open/closed states, screen coordinates, clicked element metadata (e.g., link URLs, source images, selection text), and action rules.  
* **Engine Coordination:** When a user right-clicks inside a webview, the renderer process captures the coordinates, evaluates the underlying target nodes, and sends an IPC event containing the target metadata to the browser process. The browser process then renders a native context menu at those coordinates.  
* **Edge Cases:** Handles cross-origin frame clicks, nested targets (e.g., a linked image), and coordinates validation across dynamic, fast-rendering screens.

### **Find-in-Page Overlay**

* **State Management:** Tracks active search queries, total match counts, selected match indexes, and visual flags.  
* **Engine Coordination:** Dispatches asynchronous text queries to the renderer process over IPC. The renderer runs a document-wide search using the engine's search utility, highlights matches in the rendering layer, and returns the match statistics to update the UI overlay.37  
* **Edge Cases:** Handles dynamically modifying web pages, searches that span across shadow DOM boundaries, and handles scrolling matches into view within nested containers.

### **Download Manager**

* **State Management:** Tracks unique download identifiers, active states (Starting, Downloading, Paused, Completed, Cancelled, Interrupted), file paths, downloaded byte counts, and transfer speeds.38  
* **Engine Coordination:** When a renderer encounters an HTTP response with a Content-Disposition: attachment header, it delegating the transfer to the network process.8 The network process opens a file descriptor on disk and streams binary chunks directly, bypassing the renderer process.8  
* **Edge Cases:** Handles unexpected network drops, duplicate file name collisions, and validation checks for dangerous file extensions.

### **Permission Prompts**

* **State Management:** Tracks origin-permission mappings, permission levels, active prompt queues, and grant status flags.  
* **Engine Coordination:** When a web page requests access to hardware (e.g., navigator.mediaDevices.getUserMedia()), the renderer process pauses execution and sends an IPC request to the browser process. The browser displays a permission prompt, records the user's selection, and sends the decision back to resolve or reject the JavaScript promise in the renderer.  
* **Edge Cases:** Handles permission delegation in cross-origin iframes, rapid click-spamming, and prompt queue overflows.

### **New Tab Page (NTP)**

* **State Management:** Manages custom settings, top-sites lists, and cache validation.  
* **Engine Coordination:** Renders the NTP as a highly restricted local document or WebUI page. The browser injects local state data into the page context using secure IPC pathways.  
* **Edge Cases:** Handles system offline states and sandboxing limitations.

### **Sidebar & Bookmark Bar**

* **State Management:** Tracks hierarchical bookmark trees, panel dimensions, toggle flags, and active panel contexts.35  
* **Engine Coordination:** Reads bookmark definitions from local storage files, listens for storage mutations, and updates the view rendering layers when changes occur.32

### **Status Bar**

* **State Management:** Tracks active visibility states, hover links, security certificates, and task progress.  
* **Engine Coordination:** Monitors hover and progress events dispatched from the renderer thread, updating the status bar UI.

## **4\. Storage Architecture & Cryptographic Security**

Browsers use SQLite databases to persist browsing history, cookies, bookmarks, and user credentials.32

### **SQLite Database Schemas**

#### **Chromium History Database Schema**

The database uses microsecond-precision timestamps relative to the Windows epoch (January 1, 1601 UTC).40

SQL  
\-- Core table tracking URL metadata and page visit frequency   
CREATE TABLE urls (  
    id INTEGER PRIMARY KEY AUTOINCREMENT,  
    url TEXT NOT NULL,  
    title TEXT,  
    visit\_count INTEGER DEFAULT 0 NOT NULL,  
    typed\_count INTEGER DEFAULT 0 NOT NULL,  
    last\_visit\_time INTEGER NOT NULL, \-- Epoch: Microseconds since Jan 1, 1601   
    hidden INTEGER DEFAULT 0 NOT NULL  
);

\-- Indexing for fast address bar autocompletion lookups  
CREATE INDEX urls\_url\_index ON urls (url);

\-- Logs individual visit entries   
CREATE TABLE visits (  
    id INTEGER PRIMARY KEY AUTOINCREMENT,  
    url INTEGER NOT NULL REFERENCES urls(id) ON DELETE CASCADE,  
    visit\_time INTEGER NOT NULL, \-- Epoch: Microseconds since Jan 1, 1601   
    from\_visit INTEGER REFERENCES visits(id),  
    transition INTEGER DEFAULT 0 NOT NULL, \-- Transition bitmask (Direct, Link, Typed)  
    segment\_id INTEGER,  
    visit\_duration INTEGER DEFAULT 0 NOT NULL  
);

\-- Index to optimize historical timeline queries  
CREATE INDEX visits\_visit\_time\_index ON visits (visit\_time);

\-- Tracks file download operations \[32, 38\]  
CREATE TABLE downloads (  
    id INTEGER PRIMARY KEY,  
    guid TEXT NOT NULL,  
    current\_path TEXT NOT NULL,  
    target\_path TEXT NOT NULL,  
    start\_time INTEGER NOT NULL,  
    received\_bytes INTEGER NOT NULL,  
    total\_bytes INTEGER NOT NULL,  
    state INTEGER NOT NULL, \-- 0: In Progress, 1: Complete, 2: Cancelled, 3: Interrupted   
    danger\_type INTEGER DEFAULT 0 NOT NULL,  
    opened INTEGER DEFAULT 0 NOT NULL,  
    last\_modified TEXT,  
    mime\_type TEXT NOT NULL  
);

#### **Firefox Places Database Schema**

Firefox profiles store unified bookmarks and history in places.sqlite.35 Timestamps use microsecond-precision relative to the Unix epoch (January 1, 1970 UTC).35

SQL  
\-- Core table containing visited or bookmarked URLs   
CREATE TABLE moz\_places (  
    id INTEGER PRIMARY KEY,  
    url TEXT UNIQUE,  
    title TEXT,  
    rev\_host TEXT NOT NULL,  
    visit\_count INTEGER DEFAULT 0,  
    hidden INTEGER DEFAULT 0 NOT NULL,  
    typed INTEGER DEFAULT 0 NOT NULL,  
    frecency INTEGER DEFAULT \-1 NOT NULL, \-- Algorithm determining address bar ordering  
    last\_visit\_date INTEGER,  
    guid TEXT UNIQUE  
);

\-- Hierarchical structure storing bookmarks and folders   
CREATE TABLE moz\_bookmarks (  
    id INTEGER PRIMARY KEY,  
    type INTEGER NOT NULL, \-- 1: URL, 2: Folder, 3: Separator  
    fk INTEGER REFERENCES moz\_places(id), \-- Points to associated place  
    parent INTEGER REFERENCES moz\_bookmarks(id),  
    position INTEGER,  
    title TEXT,  
    keyword\_id INTEGER,  
    folder\_type TEXT,  
    dateAdded INTEGER, \-- Microseconds since Unix epoch   
    lastModified INTEGER, \-- Microseconds since Unix epoch   
    guid TEXT UNIQUE  
);

\-- Chronological log of page visits   
CREATE TABLE moz\_historyvisits (  
    id INTEGER PRIMARY KEY,  
    from\_visit INTEGER REFERENCES moz\_historyvisits(id),  
    place\_id INTEGER REFERENCES moz\_places(id),  
    visit\_date INTEGER, \-- Microseconds since Unix epoch   
    visit\_type INTEGER, \-- e.g., 1: Link, 2: Typed, 3: Bookmark   
    session INTEGER  
);

### **Cryptographic Security Models**

#### **Windows App-Bound Encryption**

To prevent unprivileged infostealers from harvesting credentials, Chromium versions 127+ implement **App-Bound Encryption**.41

\+------------------+                   \+----------------------+  
|    chrome.exe    |                   |  Elevation Service   |  
| (User Privilege) |                   |   (SYSTEM Privilege) |  
\+------------------+                   \+----------------------+  
         |                                         |  
         | \-- COM: DecryptData(wrapped\_blob) \----\> |  
         |                                         | \[Verifies signing signature of chrome.exe\]  
         |                                         | \[If validation succeeds: calling process is authentic\]  
         |                                         |  
         |                                         | \---- Calls SYSTEM-level DPAPI  \----+  
         |                                         |                                           |  
         |                                         | \<--- Decrypts Outer Layer \---------------+  
         |                                         |  
         |                                         | \---- Impersonates User & calls DPAPI  \-\>+  
         |                                         |                                                |  
         |                                         | \<--- Decrypts Inner Layer (Plaintext Key) \----+  
         |                                         |  
         | \<-- Return decrypted 32-byte AES Key \---|  
         |  
 \[44\]

1. **IElevator COM Registration:** During installation, the browser registers a system-level COM class helper running with SYSTEM privileges, linking to a signed, browser-specific CLSID (e.g., {708860E0-F641-4611-8895-7D867DD3675B} for Chrome).41  
2. **Encryption Key Wrapping:** The 32-byte symmetric state key is doubly wrapped using DPAPI 42:  
   * **User-level DPAPI:** Encrypts the key using entropy bound to the logged-in user's credentials.42  
   * **SYSTEM-level DPAPI:** Encrypts the payload again, locking it to the system context.42 The wrapped key is prefixed with "APPB" and stored in the JSON format Local State file under os\_crypt.app\_bound\_encrypted\_key.42  
3. **Path and Integrity Validation:** When the browser requests decryption, it sends the wrapped key to the system-level COM service.41 The service verifies that the calling process is a signed, authentic browser executable before performing DPAPI decryption.41 Unsigned utilities or unauthorized processes running in the user's context are denied decryption.41  
4. **Payload Decryption:** The recovered state key is returned to the browser, which uses AES-256-GCM to decrypt cookies or credentials prefixed with "v20" (where legacy entries used "v10" or "v11" DPAPI).44

#### **macOS Keychain Encryption**

On macOS, browsers secure database keys using Keychain Services 46:

1. During installation, the browser creates a Keychain entry named Brave Safe Storage or Chrome Safe Storage containing a randomly generated base64-encoded key.46  
2. The browser calls SecItemCopyMatching to retrieve this key, deriving a cryptographically strong symmetric key using Password-Based Key Derivation Function 2 (PBKDF2 with HMAC-SHA1 or HMAC-SHA256).  
3. The browser uses this symmetric key to decrypt database entries via AES-128-CBC or AES-256-GCM.44

### **Web Storage Engine Mapping to Disk**

\+-----------------------------------------------------------------------------------------+  
|                                    WEB STORAGE LAYER                                    |  
|                                                                                         |  
|  LocalStorage      IndexedDB              Cache API           OPFS            Cookies   |  
|  (JSON Key-Value)  (Files & structured)   (Assets, responses) (SyncAccess)    (Headers) |  
\+-----------------------------------------------------------------------------------------+  
       |                  |                     |                 |                |  
       v                  v                     v                 v                v  
  LevelDB Engine     LevelDB Engine         Raw File          Direct OS        sqlite3 DB  
  (LSM log-files)    (LSM Tables)           Descriptors       File Descriptors (Cookies DB)  
                                     \[32, 47\]

* **LocalStorage:** Maps to LevelDB databases in subdirectories organized by origin. Writes are committed to an in-memory table and periodically flushed to log-structured merge-tree (LSM) files.49  
* **IndexedDB:** Maps to LevelDB tables containing key ranges and indexes, while large binary payloads (blobs, images) are serialized as raw files in an obfuscated system subfolder per origin to minimize database inflation.50  
* **Cache API:** Maps directly to structured file blocks on the local disk. The network process reads cache files directly and serves them without routing transactions through database servers.50  
* **Origin Private File System (OPFS):** Provides web applications with access to a sandboxed, high-performance file system.49 In Web Worker contexts, scripts acquire a FileSystemSyncAccessHandle via createSyncAccessHandle(), which maps directly to a physical file descriptor.49 The engine bypasses transactions and database locks, performing direct in-place writes to disk.50  
* **Cookies:** Stored in a SQL database (e.g., Cookies sqlite). Value fields contain either legacy unencrypted records, DPAPI-encrypted keys ("v10" or "v11"), or App-Bound encrypted payloads ("v20").32

## **5\. Networking Layer & Web Protocols**

Modern browsers implement their own networking logic, utilizing OS socket primitives primarily for raw IP and packet-routing operations.8

\+-----------------------------------------------------------------------------------+  
|                              RENDERER PROCESS                                     |  
|                                                                                   |  
|  \[ Fetch API \] \------\> \------\>  
\+-----------------------------------------------------------------------------------+  
                                         | (Mojo / IPC Sockets) \[8, 16\]  
                                         v  
\+-----------------------------------------------------------------------------------+  
|                              NETWORK PROCESS                                      |  
|                                                                                   |  
|  \+--------------------+  \+----------------------+  \+---------------------------+  |  
|  |     HTTP/1.1       |  |       HTTP/2         |  |       HTTP/3 \+ QUIC       |  |  
|  | (Raw TCP, SSL/TLS) |  | (Multiplexed Streams)|  | (UDP, Congestion Control) |  |  
|  \+--------------------+  \+----------------------+  \+---------------------------+  |  
|            |                        |                           |                 |  
|            \+------------------------+---------------------------+                 |  
|                                     v                                             |  
|                     \+-------------------------------+                             |  
|                     | RFC 9111 Cache-Control Engine |                             |  
|                     \+-------------------------------+                             |  
|                                     |                                             |  
|                                     v                                             |  
|            \+--------------------------------------------------+                   |  
|            | Secure Resolution (DNS-over-HTTPS / DoT Client)  |                   |  
|            \+--------------------------------------------------+                   |  
|                                     |                                             |  
|                                     v                                             |  
|                                                  |  
\+-----------------------------------------------------------------------------------+

### **The Protocol Stack**

* **HTTP/1.1:** Executes sequential request-response lifecycles over standard TCP connections, establishing up to six concurrent TCP sockets per domain origin.  
* **HTTP/2:** Multiplexes multiple logical streams over a single TCP connection, enforcing HPACK header compression, custom stream prioritization, and ping frames to detect connection drift.  
* **HTTP/3 \+ QUIC:** Runs over UDP, combining the cryptographic handshake (TLS 1.3) and connection establishment into a single round-trip (1-RTT or 0-RTT session resumption). It implements congestion control, packet loss recovery, and connection migration to mitigate head-of-line blocking.  
* **Secure DNS Resolution:** Implements DNS-over-HTTPS (DoH, RFC 8484\) and DNS-over-TLS (DoT, RFC 7858\) client layers to run secure name resolutions via secure JSON or wire-format UDP queries over HTTPS.

### **RFC 9111 Cache-Control Enforcement**

The network process implements a parser and state machine to evaluate caching rules:

1. **Pre-flight Checks:** Parses the Cache-Control header (e.g., no-store, no-cache, must-revalidate, max-age={seconds}) and checks for the presence of ETag or Last-Modified headers.  
2. **Staleness Calculation:**  
   ![][image2]  
   ![][image3]  
3. **Validation Flow:** If the cache entry is stale, the engine sends a conditional GET request containing If-None-Match: or If-Modified-Since:. If the server responds with a 304 Not Modified, the engine renews the cache lifetime and serves the cached resource; otherwise, it downloads the fresh resource.

### **Real-Time Protocols**

* **WebSockets:** Standard HTTP headers upgrade connection endpoints (Upgrade: websocket). Once established, the connection switches to binary or text frame structures, bypassing HTTP overhead.  
* **WebRTC:** Implements Peer-to-Peer connectivity, handling ICE candidates, STUN/TURN traversal configurations, and SDP (Session Description Protocol) handshakes.53

### **Operating System vs. Browser Networking Responsibilities**

* **Operating System Layer:** Provides low-level networking primitives, including raw IP routing tables, network interface cards (NIC) configuration, and TCP/UDP socket creation.  
* **Embedded Browser Layer:** Manages domain-specific logic, including proxy routing, cookie parsing, DNS cache-poisoning protection, HTTP/1.1 pipelining, HTTP/2 multiplexing, HTTP/3 QUIC connection state tracking, HSTS (HTTP Strict Transport Security) preloads, and Certificate Pinning enforcement.

## **6\. Security Model & Site Isolation**

Browsers process untrusted code from arbitrary origins, requiring strict security controls to prevent unauthorized access to local resources.2

### **Process Sandboxing Architectures**

To isolate processes from the host operating system, browsers restrict access to system calls, memory, and devices.

       \+-------------------------------------------------------+  
       |                  un-sandboxed Host OS                 |  
       \+-------------------------------------------------------+  
                                  |  
            Spawns & Confines Child Process via Sandbox API  
                                  |  
                                  v  
\+---------------------------------------------------------------------+  
|                          SANDBOXED PROCESS                          |  
|                                                                     |  
|  Linux:                                                             |  
|  \- clone(CLONE\_NEWPID | CLONE\_NEWNET | CLONE\_NEWUSER)               |  
|  \- seccomp-bpf (Blocks raw system calls, e.g., open, execve)        |  
|                                                                     |  
|  Windows:                                                           |  
|  \- AppContainer Token Restrictions                                   |  
|  \- Write restricted directories block access to local filesystem     |  
|                                                                     |  
|  macOS:                                                             |  
|  \- Seatbelt sandbox configuration file (.sb Profile)                |  
|  \- system-call-filter, file-read-metadata restricts system calls     |  
\+---------------------------------------------------------------------+

* **Linux Sandboxing:** Uses namespaces to isolate the process tree (CLONE\_NEWPID), loopback network interfaces (CLONE\_NEWNET), and user context (CLONE\_NEWUSER). It applies a restrictive seccomp-bpf system call filter, immediately terminating the process if it attempts unauthorized actions (e.g., executing open, socket, or execve).  
* **Windows Sandboxing:** Runs processes inside restricted AppContainer sessions. It applies strict security tokens, restricts write access to the filesystem, and blocks process spawning via job object limits.  
* **macOS Sandboxing:** Applies custom Seatbelt sandbox configuration files (.sb profiles) to restrict system call access via structural policies (e.g., system-call-filter, file-read-metadata).

### **Site Isolation & eTLD+1 Boundaries**

Under site isolation rules, a separate renderer process is allocated for each site origin, defined as the scheme plus the effective top-level domain plus one level (![][image1]).2

* **Out-of-Process Iframes (OOPIFs):** If a page contains a cross-site iframe (e.g., https://a.com embeds https://b.com), the browser process allocates separate renderer processes for each origin.1  
* **Compositor Coordination:** Frame layers are rendered to independent memory buffers and composite-rendered via the GPU process using visual coordination trees.12

### **Core Web Security Policies**

* **Same-Origin Policy (SOP):** Restricts scripts on one page from accessing sensitive data on another unless both pages share the exact same protocol, domain, and port.  
* **Cross-Origin Resource Sharing (CORS):** Mediates cross-origin resource access. The network process sends pre-flight options (Access-Control-Request-Method), validating access based on the server's Access-Control-Allow-Origin headers before exposing data.  
* **Content Security Policy (CSP):** The engine parses and enforces CSP headers (e.g., script-src 'self' https://trusted.com), blocking inline scripts, unauthorized eval calls, and unknown domain lookups to mitigate cross-site scripting (XSS).  
* **HTTP Strict Transport Security (HSTS):** Enforces secure connections. If a site returns an Strict-Transport-Security header, the browser redirects all future insecure queries (http://) to secure ports (https://) locally before generating network traffic.

### **Chromium ChildProcessSecurityPolicy (CPSP) Internals**

The browser process maintains a central security manager, the ChildProcessSecurityPolicy (CPSP) singleton.54

* **Jail Checks:** When a sandboxed child process requests access to a URL, database, or local file, CPSP intercepts the request.2 It verifies that the process is registered to request (CanRequestURL) or commit (CanCommitURL) that specific origin.54  
* **Citadel Checks:** CPSP verifies that a process locked to a particular site does not attempt to access cross-site resources, such as cookies, local storage, or passwords.2 If an compromised renderer sends a forged IPC message requesting cross-origin resources, CPSP detects the mismatch and terminates the renderer process.2

## **7\. Rendering Pipeline**

Rendering engine codebases (such as Blink or WebKit) parse raw text into interactive pixels on the screen.8

Raw HTML Text  
     |  
     v  
 \---\> Generates DOM Tree   
     |  
     \+--- (Concurrent Style Recalculation) \<--- CSS Parser \[11, 21\]  
     |  
     v  
 \---\> Computes Element ComputedStyle Styles   
     |  
     v  
\[ Layout Engine (LayoutNG) \] \---\> Builds Box and Fragment Layout Trees   
     |  
     v  
 \---\> Pre-computes Clip/Transform Trees   
     |  
     v  
 \---\> Outputs Display List Paint Ops (Skia Commands)   
     |  
     v  
 \---\> Layer Rasterization & GPU Composite \[12, 14, 19\]

### **1\. Parsing & DOM Construction**

The HTML parser converts raw bytes into Unicode characters, then tokenizes them based on the WHATWG specification.10 The tree-builder consumes these tokens, constructing a hierarchical Document Object Model (DOM) tree of element nodes.11 If speculative preload scanners identify link or script tags during tokenization, they initiate parallel network requests in the background.10

### **2\. Style Recalculation**

The CSS parser parses style rules from external sheets and style tags.11 The engine traverses the DOM tree, matching style definitions to nodes and resolving style inheritance to calculate a ComputedStyle object for every element.21

### **3\. Layout (LayoutNG)**

The layout engine computes the physical geometry and dimensions of the computed nodes.56

* **Box & Fragment Trees:** The layout engine traverses the DOM tree to construct a *box tree* representing the CSS box model hierarchy, which is then mapped to a physical *fragment tree* containing multi-column boundaries, line breaks, and page fragments.31  
* **Constraint Space:** Layout calculations are functional and deterministic.56 Parent containers pass down physical layout constraints (e.g., maximum width, line margins) as an input *Constraint Space*, and the child layout computes its dimensions based solely on these inputs.

### **4\. Pre-Paint & Property Trees**

To isolate paint calculations from layout changes, the engine runs a pre-paint phase.56

* **Property Trees:** Rather than traversing the entire tree to compute transforms during display list playback, the pre-paint phase pre-computes transforms, clips, scroll offsets, and visual effects into independent property trees.21 This ensures that animations and scroll offsets only update property tree values, bypassing layout and paint invalidations.19

### **5\. Paint Stage**

The paint stage generates sequential drawing commands.11 The engine traverses layout fragment nodes, generating localized draw-operation packets (e.g., draw text, draw border, draw rect).11 This output is serialized into a display list of paint operations, which is sent to the compositor thread.31

### **6\. Compositing Pipeline (Composite After Paint)**

* **Rasterization:** The compositor thread splits display list draw packets into uniform grid tiles.14 The GPU process rasterizes these drawing instructions into physical pixel buffers using graphics acceleration libraries (e.g., Skia).11  
* **Compositing:** The compositing engine translates property tree matrices to position the rasterized tiles.12 It blends these layers into a single frame buffer on the GPU, then swaps the front and back buffers to display the pixels on the screen.12

## **8\. Extension System (WebExtensions Manifest V3)**

The WebExtensions architecture isolates extensions from the browser core while allowing safe interaction with web pages.57

\+-----------------------------------------------------------------------------------+  
|                                  BROWSER PROCESS                                  |  
|                                                                                   |  
|  \- Manages permissions, lifecycle, and rule engines                              |  
|  \- declarativeNetRequest Engine: evaluates regex matches against requests        |  
\+-----------------------------------------------------------------------------------+  
       ^                                                                ^  
       | (API bindings / runtime) \[9, 60\]                         | (Isolated World DOM)   
       v                                                                v  
\+---------------------------------------------------------------+ \+-----------------+  
|                      EXTENSION PROCESS                        | | RENDERER PROCESS|  
|                                                               | |                 |  
|  Service Worker (Event-driven background thread)              | | Content Scripts |  
|  \- Wakes up on event hooks, handles background computations   | | (Runs on web    |  
|  \- Automatically terminates after 30 seconds of inactivity     | |  page DOM)      |  
\+---------------------------------------------------------------+ \+-----------------+

### **Manifest File Blueprint**

The JSON file below defines the permission mappings, declarative rulesets, and service worker paths of an extension:

JSON  
{  
  "manifest\_version": 3,  
  "name": "Custom Secure AdBlocker",  
  "version": "1.0.0",  
  "description": "Demonstrates declarative filtering and isolated workers",  
  "permissions":,  
  "host\_permissions": \[  
    "https://\*.example.com/"  
  \],  
  "background": {  
    "service\_worker": "background.js",  
    "type": "module"  
  },  
  "content\_scripts": \[  
    {  
      "matches": \["https://\*.example.com/\*"\],  
      "js": \["content\_script.js"\],  
      "run\_at": "document\_start"  
    }  
  \],  
  "declarative\_net\_request": {  
    "rule\_resources": \[  
      {  
        "id": "ruleset\_1",  
        "enabled": true,  
        "path": "rules.json"  
      }  
    \]  
  }  
}

### **declarativeNetRequest JSON Specification**

The ruleset below blocks network requests matching specific patterns without using javascript-level webRequest hooks 58:

JSON  
    }  
  },  
  {  
    "id": 2,  
    "priority": 2,  
    "action": {  
      "type": "modifyHeaders",  
      "requestHeaders":  
    },  
    "condition": {  
      "urlFilter": "https://api.example.com/\*",  
      "resourceTypes": \["xmlhttprequest"\]  
    }  
  }  
\]

### **Event-Driven Extension Service Workers**

Background service workers in Manifest V3 are event-driven, operating off the main thread to optimize system memory.57

* **State Management:** Background service workers do not maintain persistent in-memory states.57 If a background worker is inactive for 30 seconds, the browser process automatically terminates it, waking it up again only when registered events are triggered.57  
* **Resource Access:** They lack direct access to the webpage DOM, the global window object, and standard networking APIs like XMLHttpRequest.57 Background workers use the global fetch() method and coordinate storage using the chrome.storage API.57  
* **Offscreen Documents:** For tasks that require DOM parsing, audio playback, or local storage access, service workers create offscreen documents using the chrome.offscreen API.57

### **Content Scripts & Isolated Worlds**

* **DOM Access:** Content scripts run in the context of target web pages and can interact with the DOM.60  
* **Isolated Worlds:** To prevent malicious scripts on the web page from tampering with extension variables, content scripts execute in an *Isolated World*.60 This provides a separate JavaScript execution context and global scope while sharing the same underlying DOM tree.60

## **9\. Developer Tools Protocol Implementation (CDP)**

The Chrome DevTools Protocol (CDP) exposes a JSON-RPC interface to inspect, profile, and debug web browsers.61

\+--------------------+                 \+---------------------------------------------+  
| DevTools Frontend  |                 |               BROWSER PROCESS               |  
| (Debugger / Client)|                 |                                             |  
\+--------------------+                 |  DevTools WebSocket Server (Port 9222\)     |  
          |                            \+---------------------------------------------+  
          | JSON-RPC over WebSocket                           |  
          | (e.g., {"method":"Page.navigate",                 | Maps session to target RFH  
          |         "params":{"url":"https://example.com"}})  | Over Mojo \[1, 5\]  
          v                                                   v  
\+------------------------------------+ \+---------------------------------------------+  
|       WebSocket Connection         | |              RENDERER PROCESS               |  
| (Bi-directional transport)  | |                                             |  
\+------------------------------------+ |  V8 Debugger Engine (Runs breakpoint loops) |  
                                       \+---------------------------------------------+

### **CDP Protocol Mechanics**

* **WebSocket Interface:** When the browser is launched with the remote debugging flag enabled (e.g., \--remote-debugging-port=9222), the browser process starts a WebSocket server.62  
* **Bi-directional Communication:** Clients exchange JSON-RPC packets with the server to trigger browser commands (e.g., Page.navigate) and receive real-time notifications (e.g., Network.requestWillBeSent).61  
* **Target Routing:** The browser process tracks debugging sessions and routes command payloads to target processes over Mojo.17

### **Python Script Interfacing Directly with CDP**

The script below connects directly to a browser's WebSocket server to capture page metrics without utilizing intermediate drivers (such as Selenium or Puppeteer) 62:

Python  
import asyncio  
import websockets  
import json

async def capture\_page\_performance(ws\_url, target\_url):  
    \# Establish direct WebSocket connection with target process   
    async with websockets.connect(ws\_url) as ws:  
        \# Enable devtools domains \[61\]  
        await ws.send(json.dumps({"id": 1, "method": "Page.enable"}))  
        await ws.send(json.dumps({"id": 2, "method": "Network.enable"}))  
          
        \# Listen for performance data   
        await ws.send(json.dumps({  
            "id": 3,  
            "method": "Page.navigate",  
            "params": {"url": target\_url}  
        }))  
          
        while True:  
            response \= await ws.recv()  
            data \= json.loads(response)  
              
            \# Print network event responses  
            if "method" in data and data\["method"\] \== "Network.responseReceived":  
                resp\_info \= data\["params"\]\["response"\]  
                print(f"URL: {resp\_info\['url'\]} | Status: {resp\_info\['status'\]}")  
                break

\# Run async cycle  
ws\_target \= "ws://localhost:9222/devtools/page/C8F7E4"  
asyncio.run(capture\_page\_performance(ws\_target, "https://example.com"))

## **10\. Resource Management & Rendering Performance**

### **Tab Suspension Strategies**

To prevent background processes from consuming system memory, browsers put inactive tabs to sleep.1

* **Evaluation Engine:** The browser process evaluates tab activity based on resource consumption and active page features (e.g., playing audio, running WebRTC sessions, or executing background downloads).1  
* **State Serialization:** When a tab is suspended, the browser serializes its active state (e.g., navigation history, scroll coordinates, and form inputs) to disk.1  
* **Process Termination:** The browser terminates the tab's dedicated renderer process.1 When the user returns to the tab, the navigation controller deserializes the state and reloads the page, avoiding memory bottlenecks.1

### **Network Preloading**

* **DNS Prefetch:** Resolves hostnames in the background (\<link rel="dns-prefetch" href="..."\>) to eliminate DNS lookup latency during subsequent navigations.  
* **Preconnect:** Resolves hostnames and establishes TCP/TLS connections in the background (\<link rel="preconnect" href="..."\>) to minimize handshake overhead.  
* **Prefetch:** Downloads resources needed for upcoming navigations in the background and stores them in the HTTP disk cache (\<link rel="prefetch" href="..."\>).

### **Compositor Thread Architecture**

During heavy CPU utilization, rendering execution loops can block layout updates, leading to visual stutter.14 To ensure smooth scrolling, modern compositors offload input handling.14

* **Input Routing:** The browser routes touch and mouse events directly to the compositor thread.14  
* **Non-Fast Scroll Regions:** The engine identifies DOM regions with active wheel or touch event listeners, designating them as *Non-Fast Scroll Regions*.  
* **Fast Path Execution:** If an input event falls outside these regions, the compositor thread handles the scroll transform natively on the GPU, updating property trees without waiting for layout or style recalculations on the main thread.14

### **UI Performance: Virtual Scrolling**

When displaying large datasets (e.g., browsing history containing millions of URLs), rendering every item into the DOM introduces significant layout overhead.32 To optimize performance, the browser UI applies *Virtual Scrolling*.52

* **Visible Window Rendering:** The UI container calculates the viewport's vertical limits and only mounts DOM elements that fall within the visible window.52  
* **Dynamic recycling:** As the user scrolls, the layout engine recycles off-screen containers, dynamically updating their coordinates and content to prevent DOM nodes from bloating memory.52

## **11\. Profiles, Ephemeral Storage, & Sync Engine**

### **Profile Isolation Architecture**

The browser process isolates profile data by grouping internal systems into independent services managed by a dependency registry.66

                \+------------------------------------+  
                |  BrowserContextDependencyManager   |  
                \+------------------------------------+  
                                   | Registers dependencies   
                                   v  
\+-------------------------------------------------------------------------+  
|                              USER PROFILE                               |  
|                                                                         |  
|  \- Keyed Services managed by Factory Singletons                        |  
|                                                                         |  
|  \+---------------------------+             \+-------------------------+  |  
|  |     Profile 1 Storage     |             |     Profile 2 Storage   |  |  
|  |  \- History Database       |             |  \- History Database     |  |  
|  |  \- In-Memory Cookie Jar   |             |  \- In-Memory Cookie Jar |  |  
|  |  \- Network Context        |             |  \- Network Context      |  |  
|  \+---------------------------+             \+-------------------------+  |  
\+-------------------------------------------------------------------------+

1. **KeyedService Factory Registry:** Features (e.g., history, cookies, bookmarks, extensions) are registered as modular dependencies (e.g., ProfileKeyedServiceFactory or BrowserContextKeyedServiceFactory).66  
2. **Instantiation:** When a profile is loaded, the dependency manager instantiates the required services in order, managing interdependent lifecycles (e.g., the Sync Service depends on the History Service).66 This modular design allows compile-time feature flags to dynamically include or exclude systems.66

### **Incognito Mode & Ephemeral Storage**

Incognito mode isolates private browsing data.65

* **In-Memory Storage:** The database engine initializes volatile memory-only instances (e.g., SQLite file::memory: databases) instead of writing to disk.40  
* **Isolated Network Context:** The network process spins up an isolated, ephemeral NetworkContext with a separate, transient cookie jar, discarding all cookies and sessions once the last associated window is closed.8  
* **Process Isolation:** To prevent Spectre-like side-channel attacks from leaking sensitive keys between profiles, incognito tabs run in dedicated, isolated renderer processes.2

### **End-to-End Encrypted Sync Protocol**

Sync services securely synchronize bookmarks, passwords, and history across devices.68

#### **Client-Side Key Generation**

When a user sets up sync, the browser uses the Web Crypto API to derive an encryption key from their credentials.69

1. The client runs PBKDF2 on the user's passphrase with a cryptographically secure salt, outputting a 256-bit key (![][image4]).46  
2. ![][image4] never leaves the local device; only a hashed verifier is sent to the server for authentication.68

#### **Synchronization Flow**

1. **Encryption:** Before sending local data (e.g., a bookmark payload) to the sync server, the browser encrypts it using AES-GCM-256 46:  
   ![][image5]  
2. **Transport:** The client uploads the encrypted payload to the sync server over HTTPS.68 Because the payload is encrypted client-side, the server cannot read or inspect its contents.68  
3. **Conflict Resolution:** The sync engine maintains a Merkle tree to track state updates across devices. When a collision occurs, the client evaluates update timestamps or uses Conflict-Free Replicated Data Types (CRDTs) to merge bookmark changes before uploading the resolved state back to the server.

## **12\. Build Tooling, Tech Stacks, & Phased Build Guidance**

Developing a custom desktop browser in 2025-2026 involves choosing an integration stack that balances binary efficiency, runtime performance, and cross-platform compatibility.10

### **Recommended Tech Stacks**

* **Tauri \+ Rust \+ React:** Combines high-level React UI modules with a secure Rust backend. It leverages the platform's native webview to deliver small binaries (5-10MB), making it ideal for lightweight browsers.23  
* **CEF \+ C++:** Provides low-level control over rendering pipelines and the V8 JavaScript engine. It is suitable for highly customized web layout engines, but requires managing complex, multi-megabyte binary distributions.22  
* **Servo \+ Rust:** An experimental, highly concurrent browser engine written in Rust.29 Using WebRender for GPU-accelerated compositing, it delivers efficient multi-core performance, making it a powerful choice for modern embedded systems.30

### **Standard Project Directory Layout**

browser-workspace/  
├── Cargo.toml                  \# Cargo workspace configuration   
├── src/  
│   ├── main.rs                 \# Main entry point & process boots  
│   ├── browser/  
│   │   ├── mod.rs              \# Tab coordination, UI, profile manager, and IPC broker  
│   │   ├── navigation.rs       \# Navigation controller & tab groups  
│   │   ├── storage/  
│   │   │   ├── mod.rs          \# Database schema migrations & connections  
│   │   │   └── crypt\_win.rs    \# Windows App-Bound COM Elevation decryption helper \[44\]  
│   ├── network/  
│   │   ├── mod.rs              \# Network controller, secure DNS & proxies  
│   │   └── cache.rs            \# RFC 9111 Cache-Control rules engine  
│   ├── extensions/  
│   │   ├── mod.rs              \# Manifest V3 extension worker background runtimes   
│   │   └── dnr\_engine.rs       \# declarativeNetRequest rule parsing & matching \[58\]  
│   ├── ui/                     \# Browser UI chrome (Omnibox, tab strip, status panels)  
│   │   ├── main\_window.rs  
│   │   └── virtual\_scroll.rs   \# Virtual scrolling for history lists 

### **Cargo Build Script Configuration**

The build script below configures static link dependencies and compiles protocol definitions.10

Rust  
// build.rs  
fn main() {  
    // Compile Mojo or custom IPC bindings before compiling browser crates \[17\]  
    \#\[cfg(feature \= "ipc-compilation")\]  
    {  
        println\!("cargo:rerun-if-changed=src/ipc/protocols.json");  
        compile\_custom\_ipc\_bindings("src/ipc/protocols.json");  
    }

    // Link platform-specific secure storage dependencies \[44, 46\]  
    if cfg\!(target\_os \= "windows") {  
        println\!("cargo:rustc-link-lib=dylib=ole32");  
        println\!("cargo:rustc-link-lib=dylib=crypt32");  
    } else if cfg\!(target\_os \= "macos") {  
        println\!("cargo:rustc-link-framework=Security");  
    }  
}

fn compile\_custom\_ipc\_bindings(protocol\_path: &str) {  
    // Auto-generates serialization and parsing code from protocol definitions \[17, 21\]  
    std::process::Command::new("python")  
       .arg("scripts/generate\_ipc.py")  
       .arg(protocol\_path)  
       .status()  
       .unwrap();  
}

### **Phased Build Guidance**

\+----------------------------------------------------------------------------+  
| Phase 1: Bootstrapping & Process Setup                                     |  
|  \- Initialize multi-process coordinator                       |  
|  \- Setup Mojo or IPDL IPC broker \[5, 6\]                             |  
\+----------------------------------------------------------------------------+  
                                     |  
                                     v  
\+----------------------------------------------------------------------------+  
| Phase 2: Storage & Networking Setup                                        |  
|  \- Setup History and Downloads SQLite database tables         |  
|  \- Configure secure DPAPI/Keychain keystores                 |  
|  \- Hook HTTP protocols (HTTP/1.1, HTTP/2, HTTP/3) \[8, 16\]            |  
\+----------------------------------------------------------------------------+  
                                     |  
                                     v  
\+----------------------------------------------------------------------------+  
| Phase 3: Core UI & Engine Embedding                                        |  
|  \- Integrate WebView rendering layer (e.g. Servo or CEF) \[23, 30\]    |  
|  \- Connect Omnibox parser with navigation controller          |  
|  \- Implement Tab state machine transitions                          |  
\+----------------------------------------------------------------------------+  
                                     |  
                                     v  
\+----------------------------------------------------------------------------+  
| Phase 4: Extensions, DevTools, & Performance                               |  
|  \- Build Manifest V3 background service workers and DNR parser |  
|  \- Open remote debugging WebSocket (CDP port 9222\) \[62, 63\]           |  
|  \- Add tab sleep/suspension states                            |  
\+----------------------------------------------------------------------------+  
                                     |  
                                     v  
\+----------------------------------------------------------------------------+  
| Phase 5: Security Hardening & Native Integrations                          |  
|  \- Integrate seccomp/AppContainer/Seatbelt sandboxing containers            |  
|  \- Apply Site Isolation & OOPIF process boundaries           |  
|  \- Install App-Bound COM elevation decryption helper         |  
\+----------------------------------------------------------------------------+

## **13\. Keyboard Shortcuts & Accessibility**

### **Keyboard Shortcut Dispatcher**

The browser process captures keypress events from the operating system before forwarding them to active webviews.31

* **The Dispatcher:** Captures key combinations using platform-specific APIs (e.g., WM\_KEYDOWN on Windows, NSEvent on macOS).  
* **Preemption Hierarchy:**  
  1. *System Preemption:* The browser checks if the key combination matches a global browser shortcut (e.g., Ctrl+T to open a tab, Ctrl+Shift+N to open incognito, Ctrl+D to bookmark, F5 to reload).71 If a match is found, the browser intercepts the event and executes the associated action, bypassing web contents.71  
  2. *Webpage Delivery:* If no match is found, the browser forwards the keypress event to the active webview, where the renderer dispatches it to the DOM.26

### **Focus Management**

The browser chrome coordinates tab focus with the active rendering engine.72

* **Cyclic Navigation:** Users cycle focus between chrome controls (Omnibox, reload button, home button) and interactive webpage elements using the Tab and Shift+Tab keys.71  
* **Caret Browsing:** If Caret Browsing is enabled (toggled via F7), the renderer inserts a text cursor into non-editable text, allowing users to select webpage text using the keyboard.71

### **Screen Reader Integration**

To interface with screen readers (e.g., NVDA, JAWS, VoiceOver), the browser chrome must expose its UI hierarchy to accessibility APIs (MSAA/IAccessible2 on Windows, AXUIElement on macOS, AT-SPI on Linux).72

* **Chrome UI Accessibility:** Chrome elements use ARIA attributes to describe interactive states to assistive technologies 72:  
  * Buttons specify aria-keyshortcuts (e.g., aria-keyshortcuts="Control+D") to declare associated shortcuts.73  
  * Menus and popups apply appropriate role attributes (e.g., role="menu", role="combobox") and dynamic state properties (e.g., aria-expanded, aria-activedescendant) to describe active focus hierarchies.  
* **Rendering Tree Accessibility:** The renderer process compiles the DOM tree into an *Accessibility Tree*, mapping web contents to normalized layouts. When a web page updates, the renderer dispatches targeted accessibility events across the IPC boundary, prompting screen readers to announce updates.72

## **14\. Real-World Browser Case Studies**

Analyzing production browser architectures reveals how different projects navigate technical and security tradeoffs.10

### **Ladybird**

Originally developed as a side experiment within SerenityOS, Ladybird is a fully independent browser built from scratch to challenge the dominance of Blink and WebKit.10

* **Independence:** It does not inherit code from Chrome or Firefox; its entire layout engine (LibWeb), JavaScript interpreter (LibJS), and networking client (LibHTTP) are written from scratch.10  
* **Memory Safety:** While historically written in C++, Ladybird has adopted Rust to rewrite its HTML parser, URL parser, and core components, shifting key parsing pipelines to memory-safe languages to mitigate security risks.10  
* **Process Architecture:** Ladybird uses a robust multi-process architecture, isolating web content rendering (WebContent), image decoding (ImageDecoder), networking (RequestServer), and compositing (Compositor) into separate, out-of-process boundaries.10

### **Servo**

Developed by Mozilla and now managed under open governance by the Linux Foundation Europe, Servo is an experimental, highly concurrent browser engine written in Rust.29

* **Parallelism:** Unlike traditional single-threaded layout pipelines, Servo splits tasks (such as selector matching, layout calculations, and rendering) across concurrent workers.31  
* **GPU Composition:** Servo uses WebRender—the same highly optimized hardware-accelerated GPU rasterization engine used in Firefox.31  
* **Embeddability:** Now available on crates.io, Servo is designed as a modular, lightweight alternative to CEF for applications requiring efficient, platform-independent web rendering.30

### **Brave**

Brave is a security-focused browser built on top of the Chromium project.11

* **Engine Customization:** Rather than writing an engine from scratch, Brave forks Chromium, maintaining complete compatibility with Blink and V8 while stripping out telemetry and Google Services integrations.23  
* **Content Blocking:** Brave replaces standard extension ad-blockers with a native content blocking engine.19 Powered by adblock-rust, the engine compiles Adblock Plus and EasyList-style rulesets into optimized binary structures, performing request filtering and cosmetic CSS injection directly within the network and rendering pipelines.19  
* **Device Bound Credentials:** Brave was an early adopter of Device Bound Session Credentials (DBSC) and App-Bound Encryption to prevent malware from hijacking active session cookies.42

### **Arc (The Browser Company)**

Arc reimagines the traditional browser user interface by organizing navigation around sidebars, spaces, and workspace folders.

* **Architecture Evolution:** Arc initially shipped as a highly customized shell built on top of Electron.23 To bypass performance bottlenecks and access native system features, Arc migrated its desktop clients to native shells (built with Swift on macOS and C\# on Windows) that embed chromium engines directly.27  
* **State Coordination:** By separating the UI rendering layer from the rendering engine, Arc coordinates user interactions (such as collapsing sidebar panels or organizing spaces) locally in the native shell, keeping tab rendering contexts sandboxed in the background.1

### **Vivaldi**

Vivaldi targets power users by providing an advanced, highly customizable user interface chrome.

* **Architecture:** To bypass Chromium's rendering limitations, Vivaldi is built on top of the Chromium Embedded Framework (CEF).22  
* **UI Chrome Implementation:** Unlike traditional browsers that render the UI chrome natively, Vivaldi's user interface is written in React and JavaScript. This custom interface runs in a privileged web context alongside the rendering engine, allowing users to customize panel layouts, themes, and shortcuts dynamically.

### **Beaker Browser**

Beaker was an experimental, open-source peer-to-peer web browser built on top of Electron.23

* **Decentralization:** It integrated the Dat and Hypercore protocols directly into the browser shell, allowing users to host and share websites directly from their devices without central servers.  
* **Process Isolation:** Beaker mapped custom schemes (dat://, hyper://) directly to its internal node-based replication client, sandboxing peer-to-peer operations from the standard rendering context.2

#### **Works cited**

1. Multi-process Architecture \- The Chromium Projects, accessed June 4, 2026, [https://www.chromium.org/developers/design-documents/multi-process-architecture/](https://www.chromium.org/developers/design-documents/multi-process-architecture/)  
2. Process Model and Site Isolation \- Chromium Docs, accessed June 4, 2026, [https://chromium.googlesource.com/chromium/src/+/main/docs/process\_model\_and\_site\_isolation.md](https://chromium.googlesource.com/chromium/src/+/main/docs/process_model_and_site_isolation.md)  
3. Site Isolation: Process Separation for Web Sites within the Browser \- USENIX, accessed June 4, 2026, [https://www.usenix.org/conference/usenixsecurity19/presentation/reis](https://www.usenix.org/conference/usenixsecurity19/presentation/reis)  
4. Site Isolation Design Document \- The Chromium Projects, accessed June 4, 2026, [https://www.chromium.org/developers/design-documents/site-isolation/](https://www.chromium.org/developers/design-documents/site-isolation/)  
5. Mojo Core Overview, accessed June 4, 2026, [https://chromium.googlesource.com/chromium/src/+/master/mojo/core/README.md](https://chromium.googlesource.com/chromium/src/+/master/mojo/core/README.md)  
6. IPDL: Inter-Thread and Inter-Process Message Passing \- Firefox Source Docs, accessed June 4, 2026, [https://firefox-source-docs.mozilla.org/ipc/ipdl.html](https://firefox-source-docs.mozilla.org/ipc/ipdl.html)  
7. Process Isolation in Firefox, accessed June 4, 2026, [https://mozilla.github.io/firefox-browser-architecture/text/0012-process-isolation-in-firefox.html](https://mozilla.github.io/firefox-browser-architecture/text/0012-process-isolation-in-firefox.html)  
8. 101 Chrome Exploitation — Part 1: Architecture \- Operation Zero RU, accessed June 4, 2026, [https://opzero.ru/press/101-chrome-exploitation-part-1-architecture/](https://opzero.ru/press/101-chrome-exploitation-part-1-architecture/)  
9. Process Model — Firefox Source Docs documentation \- Mozilla, accessed June 4, 2026, [https://firefox-source-docs.mozilla.org/dom/ipc/process\_model.html](https://firefox-source-docs.mozilla.org/dom/ipc/process_model.html)  
10. Build Ladybird Browser on Ubuntu, Fedora, and macOS | ComputingForGeeks, accessed June 4, 2026, [https://computingforgeeks.com/install-ladybird-browser/](https://computingforgeeks.com/install-ladybird-browser/)  
11. What is Blink? | Web Platform \- Chrome for Developers, accessed June 4, 2026, [https://developer.chrome.com/docs/web-platform/blink](https://developer.chrome.com/docs/web-platform/blink)  
12. Life of a Pixel \- YouTube, accessed June 4, 2026, [https://www.youtube.com/watch?v=K2QHdgAKP-s](https://www.youtube.com/watch?v=K2QHdgAKP-s)  
13. Effectively Fuzzing the IPC Layer in Firefox – Attack & Defense (Archive) \- The Mozilla Blog, accessed June 4, 2026, [https://blog.mozilla.org/attack-and-defense/2021/01/27/effectively-fuzzing-the-ipc-layer-in-firefox/](https://blog.mozilla.org/attack-and-defense/2021/01/27/effectively-fuzzing-the-ipc-layer-in-firefox/)  
14. Life of a pixel (Chrome University 2019\) \- YouTube, accessed June 4, 2026, [https://www.youtube.com/watch?v=m-J-tbAlFic](https://www.youtube.com/watch?v=m-J-tbAlFic)  
15. LadybirdBrowser/ladybird: Truly independent web browser \- GitHub, accessed June 4, 2026, [https://github.com/LadybirdBrowser/ladybird](https://github.com/LadybirdBrowser/ladybird)  
16. Introduction to Ladybird, accessed June 4, 2026, [https://ladybirdbrowser-ladybird-72.mintlify.app/introduction](https://ladybirdbrowser-ladybird-72.mintlify.app/introduction)  
17. Mojo docs (go/mojo-docs) \- Mojo, accessed June 4, 2026, [https://chromium.googlesource.com/chromium/src/+/HEAD/mojo/README.md](https://chromium.googlesource.com/chromium/src/+/HEAD/mojo/README.md)  
18. Processes, Threads and IPC — Firefox Source Docs documentation \- Mozilla, accessed June 4, 2026, [https://firefox-source-docs.mozilla.org/ipc/index.html](https://firefox-source-docs.mozilla.org/ipc/index.html)  
19. This Month in Ladybird \- May 2026, accessed June 4, 2026, [https://ladybird.org/newsletter/2026-05-31](https://ladybird.org/newsletter/2026-05-31)  
20. Making Mojo Exploits More Difficult | Microsoft Browser Vulnerability Research, accessed June 4, 2026, [https://microsoftedge.github.io/edgevr/posts/Making-Mojo-Exploits-More-Difficult/](https://microsoftedge.github.io/edgevr/posts/Making-Mojo-Exploits-More-Difficult/)  
21. This Month in Ladybird \- January 2026, accessed June 4, 2026, [https://ladybird.org/newsletter/2026-01-31/](https://ladybird.org/newsletter/2026-01-31/)  
22. Choosing The Rendering Engine \- HTML Executable, accessed June 4, 2026, [https://www.htmlexe.com/help/topics/choosing-rendering-engine.html](https://www.htmlexe.com/help/topics/choosing-rendering-engine.html)  
23. WebView2, Electron challengers, and (slightly) lighter desktop web applications, accessed June 4, 2026, [https://blog.scottlogic.com/2023/02/01/webview2-electron-challengers-and-slightly-lighter-desktop-web-applications.html](https://blog.scottlogic.com/2023/02/01/webview2-electron-challengers-and-slightly-lighter-desktop-web-applications.html)  
24. CefSharp vs WebView2 \- chromium embedded \- Stack Overflow, accessed June 4, 2026, [https://stackoverflow.com/questions/70360189/cefsharp-vs-webview2](https://stackoverflow.com/questions/70360189/cefsharp-vs-webview2)  
25. WebView for Gtk4, cross-platform (Lin, Win, Mac). CEF or WebKit \- GNOME Discourse, accessed June 4, 2026, [https://discourse.gnome.org/t/webview-for-gtk4-cross-platform-lin-win-mac-cef-or-webkit/28611](https://discourse.gnome.org/t/webview-for-gtk4-cross-platform-lin-win-mac-cef-or-webkit/28611)  
26. Using Servo with Slint: A Journey of Rust and Rendering, accessed June 4, 2026, [https://slint.dev/blog/using-servo-with-slint](https://slint.dev/blog/using-servo-with-slint)  
27. Building Webkit in Windows? : r/learnprogramming \- Reddit, accessed June 4, 2026, [https://www.reddit.com/r/learnprogramming/comments/1mr8jx0/building\_webkit\_in\_windows/](https://www.reddit.com/r/learnprogramming/comments/1mr8jx0/building_webkit_in_windows/)  
28. servo-fetch — embedding the Servo browser engine as a Rust library (CLI \+ crate) \- Reddit, accessed June 4, 2026, [https://www.reddit.com/r/rust/comments/1t6fw7s/servofetch\_embedding\_the\_servo\_browser\_engine\_as/](https://www.reddit.com/r/rust/comments/1t6fw7s/servofetch_embedding_the_servo_browser_engine_as/)  
29. Servo aims to empower developers with a lightweight, high-performance alternative for embedding web technologies in applications., accessed June 4, 2026, [https://servo.org/](https://servo.org/)  
30. Servo Now on crates.io: What Rust Devs Need to Know \- DEV Community, accessed June 4, 2026, [https://dev.to/onsen/servo-now-on-cratesio-what-rust-devs-need-to-know-41jb](https://dev.to/onsen/servo-now-on-cratesio-what-rust-devs-need-to-know-41jb)  
31. Architecture \- The Servo Book, accessed June 4, 2026, [https://book.servo.org/design-documentation/architecture.html](https://book.servo.org/design-documentation/architecture.html)  
32. Google Chrome Database Structure and Schema Diagram, accessed June 4, 2026, [https://databasesample.com/database/google-chrome-database](https://databasesample.com/database/google-chrome-database)  
33. Building Predictable UI with State Machine Architectures \- NamasteDev Blogs, accessed June 4, 2026, [https://namastedev.com/blog/building-predictable-ui-with-state-machine-architectures/](https://namastedev.com/blog/building-predictable-ui-with-state-machine-architectures/)  
34. Application Design Patterns: State Machines \- NI \- National Instruments, accessed June 4, 2026, [https://www.ni.com/en/support/documentation/supplemental/16/simple-state-machine-template-documentation.html](https://www.ni.com/en/support/documentation/supplemental/16/simple-state-machine-template-documentation.html)  
35. Firefox places.sqlite Database \- Windows Forensic Handbook \- GitBook, accessed June 4, 2026, [https://psmths.gitbook.io/windows-forensics/artifacts-by-activity/browser-activity/history/firefox-places-sqlite](https://psmths.gitbook.io/windows-forensics/artifacts-by-activity/browser-activity/history/firefox-places-sqlite)  
36. Security: Site Isolation bypass after BrowsingInstance state deleted \[40054801\] \- Chromium, accessed June 4, 2026, [https://issues.chromium.org/issues/40054801](https://issues.chromium.org/issues/40054801)  
37. Access my old browser history : r/firefox \- Reddit, accessed June 4, 2026, [https://www.reddit.com/r/firefox/comments/1s21gcc/access\_my\_old\_browser\_history/](https://www.reddit.com/r/firefox/comments/1s21gcc/access_my_old_browser_history/)  
38. Google Chrome Download History \- Linux Sleuthing, accessed June 4, 2026, [https://linuxsleuthing.blogspot.com/2011/06/google-chrome-download-history.html](https://linuxsleuthing.blogspot.com/2011/06/google-chrome-download-history.html)  
39. Places.sqlite \- MozillaZine Knowledge Base, accessed June 4, 2026, [https://kb.mozillazine.org/Places.sqlite](https://kb.mozillazine.org/Places.sqlite)  
40. Chromium browsing history database \- Wikiversity, accessed June 4, 2026, [https://en.wikiversity.org/wiki/Chromium\_browsing\_history\_database](https://en.wikiversity.org/wiki/Chromium_browsing_history_database)  
41. Browser Forensics in 2026: App-Bound Encryption and Live Triage | ElcomSoft blog, accessed June 4, 2026, [https://blog.elcomsoft.com/2026/01/browser-forensics-in-2026-app-bound-encryption-and-live-triage/](https://blog.elcomsoft.com/2026/01/browser-forensics-in-2026-app-bound-encryption-and-live-triage/)  
42. C4 Bomb: Blowing Up Chrome's AppBound Cookie Encryption \- CyberArk, accessed June 4, 2026, [https://www.cyberark.com/resources/threat-research-blog/c4-bomb-blowing-up-chromes-appbound-cookie-encryption](https://www.cyberark.com/resources/threat-research-blog/c4-bomb-blowing-up-chromes-appbound-cookie-encryption)  
43. Bypassing “app-bound” encryption implemented by Google Chrome, in order to steal cookies without administrator rights | Devoteam, accessed June 4, 2026, [https://www.devoteam.com/expert-view/contournement-du-chiffrement-app-bound-sur-google-chrome-sans-droits-administrateurs/](https://www.devoteam.com/expert-view/contournement-du-chiffrement-app-bound-sur-google-chrome-sans-droits-administrateurs/)  
44. Chrome-App-Bound-Encryption-Decryption/docs/RESEARCH.md at main \- GitHub, accessed June 4, 2026, [https://github.com/xaitax/Chrome-App-Bound-Encryption-Decryption/blob/main/docs/RESEARCH.md](https://github.com/xaitax/Chrome-App-Bound-Encryption-Decryption/blob/main/docs/RESEARCH.md)  
45. DPAPI \- Extracting Passwords \- HackTricks, accessed June 4, 2026, [https://hacktricks.wiki/en/windows-hardening/windows-local-privilege-escalation/dpapi-extracting-passwords.html](https://hacktricks.wiki/en/windows-hardening/windows-local-privilege-escalation/dpapi-extracting-passwords.html)  
46. The Current State of Browser Cookies \- CyberArk, accessed June 4, 2026, [https://www.cyberark.com/resources/threat-research-blog/the-current-state-of-browser-cookies](https://www.cyberark.com/resources/threat-research-blog/the-current-state-of-browser-cookies)  
47. Encryption format for Chrome browser cookies \- GitHub Gist, accessed June 4, 2026, [https://gist.github.com/creachadair/937179894a24571ce9860e2475a2d2ec](https://gist.github.com/creachadair/937179894a24571ce9860e2475a2d2ec)  
48. Sensitive data storage – Brave Help Center, accessed June 4, 2026, [https://support.brave.app/hc/en-us/articles/29808985123085-Sensitive-data-storage](https://support.brave.app/hc/en-us/articles/29808985123085-Sensitive-data-storage)  
49. LocalStorage vs. IndexedDB vs. Cookies vs. OPFS vs. WASM-SQLite | RxDB \- JavaScript Database, accessed June 4, 2026, [https://rxdb.info/articles/localstorage-indexeddb-cookies-opfs-sqlite-wasm.html](https://rxdb.info/articles/localstorage-indexeddb-cookies-opfs-sqlite-wasm.html)  
50. 3x faster project loads with the origin private file system \- Between the Barndoors, accessed June 4, 2026, [https://barndoors.lumafield.com/3x-faster-project-loads-with-the-origin-private-file-system/](https://barndoors.lumafield.com/3x-faster-project-loads-with-the-origin-private-file-system/)  
51. IndexedDB API \- MDN Web Docs \- Mozilla, accessed June 4, 2026, [https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB\_API](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)  
52. Browser Storage Comparison: sql.js vs IndexedDB vs localStorage \- GitHub Pages, accessed June 4, 2026, [https://recca0120.github.io/en/2026/03/06/browser-storage-comparison/](https://recca0120.github.io/en/2026/03/06/browser-storage-comparison/)  
53. WebRTC P2P Replication with RxDB \- Sync Browsers and Devices, accessed June 4, 2026, [https://rxdb.info/replication-webrtc.html](https://rxdb.info/replication-webrtc.html)  
54. content/public/browser/child\_process\_security\_policy.h \- chromium/src \- Git at Google, accessed June 4, 2026, [https://chromium.googlesource.com/chromium/src/+/c467942ca64b6bf6a88ab8f30151f47fa8b20102/content/public/browser/child\_process\_security\_policy.h](https://chromium.googlesource.com/chromium/src/+/c467942ca64b6bf6a88ab8f30151f47fa8b20102/content/public/browser/child_process_security_policy.h)  
55. Design Documents \- The Chromium Projects, accessed June 4, 2026, [https://www.chromium.org/developers/design-documents/](https://www.chromium.org/developers/design-documents/)  
56. RenderingNG deep-dive: BlinkNG | Chromium \- Chrome for Developers, accessed June 4, 2026, [https://developer.chrome.com/docs/chromium/blinkng](https://developer.chrome.com/docs/chromium/blinkng)  
57. Migrate to a service worker | Chrome for Developers, accessed June 4, 2026, [https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers](https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers)  
58. Extensions / Manifest V3 \- Chrome for Developers, accessed June 4, 2026, [https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)  
59. Work-in-Progress: Manifest V3 Unveiled: Navigating the New Era of Browser Extensions, accessed June 4, 2026, [https://arxiv.org/html/2404.08310v1](https://arxiv.org/html/2404.08310v1)  
60. Understanding Chrome Extensions: A Developer's Guide to Manifest V3 \- DEV Community, accessed June 4, 2026, [https://dev.to/javediqbal8381/understanding-chrome-extensions-a-developers-guide-to-manifest-v3-233l](https://dev.to/javediqbal8381/understanding-chrome-extensions-a-developers-guide-to-manifest-v3-233l)  
61. Chrome DevTools Protocol \- GitHub Pages, accessed June 4, 2026, [https://chromedevtools.github.io/devtools-protocol/](https://chromedevtools.github.io/devtools-protocol/)  
62. Chrome DevTools Protocol (CDP) \- Pydoll, accessed June 4, 2026, [https://pydoll.tech/docs/deep-dive/fundamentals/cdp/](https://pydoll.tech/docs/deep-dive/fundamentals/cdp/)  
63. Chrome DevTools Protocol (CDP) \- Browser Run \- Cloudflare Docs, accessed June 4, 2026, [https://developers.cloudflare.com/browser-run/cdp/](https://developers.cloudflare.com/browser-run/cdp/)  
64. What is the Chrome DevTools Protocol (CDP) in web scraping? | Firecrawl Glossary, accessed June 4, 2026, [https://www.firecrawl.dev/glossary/web-scraping-apis/chrome-devtools-protocol-web-scraping](https://www.firecrawl.dev/glossary/web-scraping-apis/chrome-devtools-protocol-web-scraping)  
65. Ephemeral mode \- Chrome Enterprise and Education Help, accessed June 4, 2026, [https://support.google.com/chrome/a/answer/3538894?hl=en](https://support.google.com/chrome/a/answer/3538894?hl=en)  
66. Profile Architecture \- The Chromium Projects, accessed June 4, 2026, [https://www.chromium.org/developers/design-documents/profile-architecture/](https://www.chromium.org/developers/design-documents/profile-architecture/)  
67. Feature request: Support incognito/isolated browser contexts in new\_page tool · Issue \#1985 · ChromeDevTools/chrome-devtools-mcp \- GitHub, accessed June 4, 2026, [https://github.com/ChromeDevTools/chrome-devtools-mcp/issues/1985](https://github.com/ChromeDevTools/chrome-devtools-mcp/issues/1985)  
68. Bookmark Sync Security \- Comprehensive Browser List \- WebCull, accessed June 4, 2026, [https://webcull.com/blog/2024/08/bookmark-sync-security](https://webcull.com/blog/2024/08/bookmark-sync-security)  
69. End-to-End Encryption in the Browser | by Kadir Osman Ust | Medium, accessed June 4, 2026, [https://kadirosmanust.medium.com/end-to-end-encryption-in-the-browser-5a1345aeb6e9](https://kadirosmanust.medium.com/end-to-end-encryption-in-the-browser-5a1345aeb6e9)  
70. 3-Level Comprehensive File Encryption: Ultimate Data Protection \- ownCloud, accessed June 4, 2026, [https://owncloud.com/features/comprehensive-file-encryption/](https://owncloud.com/features/comprehensive-file-encryption/)  
71. Chrome keyboard shortcuts \- Computer \- Google Accessibility Help, accessed June 4, 2026, [https://support.google.com/accessibility/answer/157179?hl=en\&co=GENIE.Platform%3DDesktop](https://support.google.com/accessibility/answer/157179?hl=en&co=GENIE.Platform%3DDesktop)  
72. Handling keyboard navigation for ARIA \- Orange digital accessibility guidelines, accessed June 4, 2026, [https://a11y-guidelines.orange.com/en/articles/keyboard-navigation/](https://a11y-guidelines.orange.com/en/articles/keyboard-navigation/)  
73. aria-keyshortcuts attribute \- MDN Web Docs \- Mozilla, accessed June 4, 2026, [https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-keyshortcuts](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-keyshortcuts)  
74. Ladybird Browser, accessed June 4, 2026, [https://ladybird.org/](https://ladybird.org/)  
75. Ladybird Browser: First Impressions & Easy Installation Guide \- Habr, accessed June 4, 2026, [https://habr.com/en/articles/838636/](https://habr.com/en/articles/838636/)  
76. The Ladybird browser project shifts to Rust \- LWN.net, accessed June 4, 2026, [https://lwn.net/Articles/1059812/](https://lwn.net/Articles/1059812/)  
77. Protecting Cookies with Device Bound Session Credentials \- Google Blog, accessed June 4, 2026, [https://blog.google/security/protecting-cookies-with-device-bound-session-credentials/](https://blog.google/security/protecting-cookies-with-device-bound-session-credentials/)

[image1]: <data:image/png;base64,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>

[image2]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAmwAAAAyCAYAAADhjoeLAAAD4klEQVR4Xu3dTahtYxgH8Fc+IuQrbkJuMVEGSkxQEiGRYqDIgImkjIRrcktmlCJJIkkUJVFidKQk5GNEoZCPgaSEknw8/9a7Wuucs8++h3NxdX6/+rffvdZeH+8ePT3v2ue0BgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA7KtOq1y+diMAAP+MHyt/9GR86Ord7YbKibP3Gd9bea9yzGz7MvtVnmmrzwMAwF9we88i57SpiDu+8vls30bSgTtszbbb2vpiEACATUqxtpklzs0WbNe19QUbAABbsKxg+6pN+56q/FJ5pHJpGzpp71dOqTxUOblyRuXbyuP9c3FzG5Zcc54r23DO7Huyclflp/7+pr7vgOGwdkHl4zZc54XKEX37Vu2svFZ5s/Jw5frKp5VbKw9WXq180D97f+WLtv4eMs4S8huVE9q0pHxk3z/3YuWtypmVdysH9u0517OVa9pw7B1t6nRm3rmvXOflvg0A2MaWFWxntWnf2g7bSuXpPt5RuW+2fW2H7ec2nSfPsn3YhmMOr7xeOa/vu6cN14kULbv7+PTKjX08l2JqWU6dPrpKnqv7vXJJf7+rcnfffm7l17498/uhj3MP86XjnW0oNFOAPVo5ZLZvLoVhCsLI9a7o41sq3/Txl234/nKuk9rqeX/XxwDANraoYHusDYVTukIbFWzpKqUblaIlyXNqB7fFBVu6aPPzjIVPPrfSXyPbx4ItBdXzbTr/ooJtK1ba6utmrpHX3G/sX7mq8lHlucoTffsoHbjc5+jCNhWL+aFFnttLIZcuY7qRL7Vp7ukojsVgCrbdfZxrzOc9dioBgG1sUcGWZbgUG8sKtu/b0BEb5QcKWc5caUMhNBZA8XcLtmv7OM6ejUdX7yFHTx9dZ6XtuWDLPaQTFrmvFFMpykYPtGHeY3dukXknL+fOtTKvfB/jfOfH5rPzee+tpWAA4H8sy4FjgZDCIc+OjZ2kZQVbuktfz97f2Ybj04k6qg1Li6N5wZYl0VwzFhVseV4s8uzX230c8yJmq3KfWYrNkmwsK9jG4vKiNnwvuY8cf3Gb/lTJb23oxC2STuS4DJquWs6X5DnAT9pQWJ7fpu8gHbnM+9j+fm/OGwDYpna09Q/bH9emh+u3KoXi2iXWf1OWecfrH9Q27qQtk+NznhhfX2lDkRvpZuYHGGOxGvPrAgDwH/isrV42TrcuXTcAAPYR+UHDZW34rxHvtOHPeAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMAG/gSpdqhy0R8RZwAAAABJRU5ErkJggg==>

[image3]: <data:image/png;base64,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>

[image4]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAC4AAAAaCAYAAADIUm6MAAACPUlEQVR4Xu2WT0gVURTGv7AgjYgKymhTUIoVmEStWlQoGC2KFuGf/qyiIIoQRCwIIaJ/myhdJAq1qChaKORC3NQmLIU2QRAItiihKDe6ktTv49zL3Bl7oKG9C70PfszMPffNO3Pmu/cMUFBB/5cOkh9kJuAXORXMuZ6J95JVQTyv6iLTpDoboLaTd+QkWZmJ5VVryRAZJZvTIRwir8iWzHgUqiA/SR+SihaRS+QmKXZj0akR5t0Wdy3/dsB8vsxPilH3yRTZT8rIBzJI1oSTYpP39xdygTyDJa2FWhvMi07e37/JVbKC1MGso4dYnkyNS97frUj8vJF8IuNklxuLTtq/vb9DtcEeSMfo5P09AqtyKFVaFVfls7FSco3cIs9h3fcw6XTofLc715yLpIechhVigBxDoh3kEXlCHmAem8IeMkleYq6Xda1xVV0dM5S2zePuXG+qxp1rMb+FFWQ1uUvWwSyopJ7C1lAleQ8ryE4yTLaRcvKZ7EMOqa1/Q/r74zupd/ENsBuH8Y+wm0tavBOwZI7AmpWkhN/AHkZv7IQblx4j6RObyGt3bMKfC7ckUnetIjdgnwnng1gbaXdjW4PxXIlrTAX4J43uLJLdZi8sUS+NfyW3kU4mV+KymRqeX0d6WDXBJdFl2G4ky9xD4nFJr7wb6V3qHBmDebmBPIStLR3Xw76JXpAz5A7msTj/VkpO1ZSnvb91LHGxZiz8z7VoF/qbRZGq308OkKPpUNzS3n4F9rpVvYIKypdmAZ4Bb4EoKGD6AAAAAElFTkSuQmCC>

[image5]: <data:image/png;base64,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>