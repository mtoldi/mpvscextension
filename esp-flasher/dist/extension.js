"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deactivate = exports.activate = void 0;
// VS Code API for interacting with the editor, showing messages, progress, etc.
const vscode = __importStar(require("vscode"));
// Allows executing terminal/CLI commands like `mpremote` and `esptool`
const child_process_1 = require("child_process");
// Used to list available serial ports for device connection
const serialport_1 = require("serialport");
// Node.js core modules for filesystem, paths, OS temp directory, HTTPS requests
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const https = __importStar(require("https"));
// Cheerio is a fast, flexible jQuery-like HTML parser for scraping the Micropython firmware page
const cheerio = __importStar(require("cheerio"));
// Fuse.js provides fuzzy searching to find the best matching firmware options based on user input
const fuse_js_1 = __importDefault(require("fuse.js"));
// Called when the extension is activated (e.g. when VS Code starts or the user opens the extension panel)
function activate(context) {
    // Register the Webview View Provider which supplies the HTML UI and handles backend logic
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('espFlasherWebview', // This must match the ID used in `package.json`
    new EspFlasherViewProvider(context) // The class that provides the Webview functionality
    ));
}
exports.activate = activate;
// Called when the extension is deactivated (e.g. when VS Code shuts down or the extension is disabled)
// You can clean up resources here if needed (nothing to clean up in this case)
function deactivate() { }
exports.deactivate = deactivate;
function execCommand(command) {
    return new Promise((resolve, reject) => {
        (0, child_process_1.exec)(command, (err, stdout, stderr) => {
            if (stdout)
                console.log(stdout);
            if (stderr)
                console.error(stderr);
            if (err) {
                reject(err);
            }
            else {
                resolve();
            }
        });
    });
}
class EspFlasherViewProvider {
    constructor(context) {
        this.context = context;
        this.outputChannel = vscode.window.createOutputChannel("ESP Output");
    }
    /**
     * Downloads a firmware binary from the web and flashes it to the selected device.
     *
     * @param firmwareUrl - The full URL to the .bin firmware file.
     * @param port - The serial port where the board is connected (e.g., COM3, /dev/ttyUSB0).
     */
    handleFlashFromWeb(firmwareUrl, port) {
        return __awaiter(this, void 0, void 0, function* () {
            // Create a temporary path where the firmware file will be downloaded
            const tmpPath = path.join(os.tmpdir(), path.basename(firmwareUrl));
            // Download the .bin firmware file to the temporary path
            yield this.downloadFile(firmwareUrl, tmpPath);
            // Construct the esptool command to flash the firmware to the device
            const command = `python -u -m esptool --port ${port} --baud 115200 write_flash --flash_mode keep --flash_size keep --erase-all 0x1000 "${tmpPath}"`;
            // Log the command being executed to the extension's output channel
            this.outputChannel.appendLine(`📤 Executing: ${command}`);
            // Show a progress notification in VS Code while flashing is in progress
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Flashing firmware...',
                cancellable: false,
            }, () => new Promise((resolve, reject) => {
                // Execute the flashing command
                (0, child_process_1.exec)(command, (err, stdout, stderr) => {
                    var _a;
                    // Log stdout and stderr to output channel
                    this.outputChannel.appendLine('[stdout]');
                    this.outputChannel.appendLine(stdout);
                    if (stderr) {
                        this.outputChannel.appendLine('[stderr]');
                        this.outputChannel.appendLine(stderr);
                    }
                    // Show success or error message to the user
                    if (err) {
                        vscode.window.showErrorMessage(`Flash failed: ${stderr || err.message}`);
                        reject(err);
                    }
                    else {
                        vscode.window.showInformationMessage('Flash successful!');
                        resolve();
                        // Ask frontend to re-list files (in case the new firmware changes them)
                        (_a = this._view) === null || _a === void 0 ? void 0 : _a.webview.postMessage({ command: 'triggerListFiles', port });
                    }
                });
            }));
        });
    }
    /**
     * Fetches a list of available MicroPython firmware binaries (.bin files)
     * from the official micropython.org firmware download page for supported boards.
     *
     * Currently limited to 'ESP32_GENERIC' slug but can be extended easily.
     *
     * @returns A Promise that resolves to an array of firmware file names and their download URLs.
     */
    fetchFirmwareList() {
        return __awaiter(this, void 0, void 0, function* () {
            const baseUrl = 'https://micropython.org';
            // List of board slugs to search firmware for. This can be extended for more boards.
            const boardSlugs = [
                'ESP32_GENERIC',
            ];
            const allBinaries = [];
            // Fetch and parse firmware listings for each board
            const fetchPromises = boardSlugs.map(slug => {
                return new Promise((resolve) => {
                    const fullUrl = `${baseUrl}/download/${slug}/`;
                    // Log which URL is being scanned
                    this.outputChannel.appendLine(`🔍 Scanning: ${fullUrl}`);
                    // Perform HTTPS GET request to fetch HTML content of the firmware listing page
                    https.get(fullUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
                        let data = '';
                        // Accumulate response data chunks
                        res.on('data', chunk => data += chunk);
                        // Once the whole page is loaded
                        res.on('end', () => {
                            const $ = cheerio.load(data); // Use Cheerio to parse HTML
                            let count = 0;
                            // Find all <a> tags on the page and extract firmware links
                            $('a').each((_, el) => {
                                const href = $(el).attr('href');
                                // We're only interested in .bin firmware files from the /resources/firmware/ path
                                if (href && href.endsWith('.bin') && href.includes('/resources/firmware/')) {
                                    // Resolve relative URL to full URL
                                    const binUrl = href.startsWith('http') ? href : `${baseUrl}${href}`;
                                    allBinaries.push({
                                        name: path.basename(binUrl),
                                        url: binUrl
                                    });
                                    count++;
                                }
                            });
                            this.outputChannel.appendLine(`✅ Found ${count} .bin files at ${slug}`);
                            resolve();
                        });
                    }).on('error', err => {
                        // Handle request failure gracefully and log it
                        this.outputChannel.appendLine(`⚠️ Failed to fetch ${fullUrl}: ${err.message}`);
                        resolve();
                    });
                });
            });
            // Wait for all fetch operations to complete
            yield Promise.all(fetchPromises);
            this.outputChannel.appendLine(`📦 Total firmware binaries found: ${allBinaries.length}`);
            return allBinaries;
        });
    }
    /**
     * Downloads a file from a given HTTPS URL and saves it to a local destination.
     * Used to fetch firmware binaries before flashing.
     *
     * @param url - The URL of the file to download
     * @param dest - The local path to save the downloaded file
     * @returns A Promise that resolves when the file has been successfully downloaded
     */
    downloadFile(url, dest) {
        return __awaiter(this, void 0, void 0, function* () {
            return new Promise((resolve, reject) => {
                // Create a writable stream to the destination file
                const file = fs.createWriteStream(dest);
                // Start downloading the file via HTTPS
                https.get(url, response => {
                    // Pipe the incoming data directly into the file stream
                    response.pipe(file);
                    // Once the file stream finishes writing
                    file.on('finish', () => {
                        // Close the stream to ensure all data is flushed
                        file.close((err) => {
                            if (err) {
                                reject(err); // Reject if there was an error closing the file
                            }
                            else {
                                resolve(); // Success!
                            }
                        });
                    });
                }).on('error', err => {
                    // On download error, delete the partially written file (if any) and reject
                    fs.unlink(dest, () => reject(err));
                });
            });
        });
    }
    /**
     * Called when the Webview view is resolved and ready to be displayed.
     * This is where we set up the Webview HTML, send initial data, and hook up message listeners.
     */
    resolveWebviewView(webviewView) {
        return __awaiter(this, void 0, void 0, function* () {
            // Store the view reference so we can post messages to it later
            this._view = webviewView;
            // Enable JavaScript execution in the Webview
            webviewView.webview.options = {
                enableScripts: true,
            };
            // Load and assign the Webview HTML content
            webviewView.webview.html = this.getHtml();
            // Get a list of available serial ports (e.g. COM3, /dev/ttyUSB0)
            const ports = yield serialport_1.SerialPort.list();
            // Send the available port list to the frontend dropdown
            webviewView.webview.postMessage({
                command: 'populatePorts',
                ports: ports.map(p => p.path),
            });
            // If ports are available, automatically list files on the first port
            if (ports.length > 0) {
                webviewView.webview.postMessage({
                    command: 'triggerListFiles',
                    port: ports[0].path,
                });
            }
            // Handle incoming messages from the Webview (frontend)
            webviewView.webview.onDidReceiveMessage((message) => __awaiter(this, void 0, void 0, function* () {
                var _a, _b, _c;
                const { port } = message;
                // Skip this check for commands that don't need a port
                const needsPort = !['flashFirmware', 'getPorts', 'searchModules'].includes(message.command);
                if (needsPort && (!port || typeof port !== 'string' || port.trim() === '')) {
                    // Avoid error spam during extension startup or when UI hasn't initialized
                    this.outputChannel.appendLine(`⚠ Ignoring ${message.command} - no port provided yet.`);
                    return;
                }
                // Handle flashing from a local .bin file selected by the user
                if (message.command === 'flashFirmware') {
                    // Ask user to choose a .bin file from disk
                    const fileUri = yield vscode.window.showOpenDialog({
                        filters: { 'BIN files': ['bin'] },
                        canSelectMany: false,
                    });
                    if (!fileUri) {
                        vscode.window.showErrorMessage('No firmware file selected.');
                        return;
                    }
                    const firmwarePath = fileUri[0].fsPath;
                    // Construct esptool.py command (no --chip arg for generic compatibility)
                    const cmd = `python -u -m esptool --port ${message.port} --baud 115200 write_flash --flash_mode keep --flash_size keep --erase-all 0x1000 "${firmwarePath}"`;
                    // Show progress notification during the flashing process
                    vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: 'Flashing firmware...',
                        cancellable: false,
                    }, () => new Promise((resolve, reject) => {
                        // Run the flashing command
                        (0, child_process_1.exec)(cmd, (error, stdout, stderr) => {
                            console.log('Command:', cmd);
                            console.log('STDOUT:', stdout);
                            console.log('STDERR:', stderr);
                            if (error) {
                                vscode.window.showErrorMessage(`Firmware flashing failed: ${stderr || error.message}`);
                                reject(error);
                            }
                            else {
                                vscode.window.showInformationMessage('Firmware flashed successfully!');
                                resolve();
                            }
                        });
                    }));
                }
                // Handle uploading the currently active Python file as 'main.py' to the device
                else if (message.command === 'uploadPython') {
                    const activeEditor = vscode.window.activeTextEditor;
                    // Make sure there's a Python file open and active in the editor
                    if (!activeEditor || activeEditor.document.languageId !== 'python') {
                        vscode.window.showErrorMessage('No active Python file to upload.');
                        return;
                    }
                    const filePath = activeEditor.document.fileName;
                    // Upload the file to the device as 'main.py' using mpremote
                    const uploadCmd = `mpremote connect ${port} fs cp "${filePath}" :main.py`;
                    vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: 'Uploading Python file as main.py...',
                        cancellable: false,
                    }, () => new Promise((resolve, reject) => {
                        // Execute the upload command
                        (0, child_process_1.exec)(uploadCmd, (uploadError, uploadStdout, uploadStderr) => {
                            var _a;
                            if (uploadError) {
                                vscode.window.showErrorMessage(`Upload failed: ${uploadStderr || uploadError.message}`);
                                reject(uploadError);
                                return;
                            }
                            vscode.window.showInformationMessage('Python file uploaded successfully as main.py!');
                            resolve();
                            // Ask the Webview to refresh the list of files on the device
                            (_a = this._view) === null || _a === void 0 ? void 0 : _a.webview.postMessage({ command: 'triggerListFiles', port: message.port });
                        });
                    }));
                }
                // Handle listing files stored on the device using mpremote + os.listdir()
                else if (message.command === 'listFiles') {
                    // Python one-liner that prints all files in the current directory
                    const listCmd = `mpremote connect ${port} exec "import os; print(os.listdir())"`;
                    // Execute the command
                    (0, child_process_1.exec)(listCmd, (err, stdout, stderr) => {
                        var _a;
                        if (err) {
                            vscode.window.showErrorMessage(`Failed to list files: ${stderr || err.message}`);
                            return;
                        }
                        // Try to extract the list from stdout
                        try {
                            const match = stdout.match(/\[[\s\S]*?\]/); // [\s\S] matches any character including newlines
                            const files = match ? JSON.parse(match[0].replace(/'/g, '"')) : [];
                            // Send file list to the frontend to display in the UI
                            (_a = this._view) === null || _a === void 0 ? void 0 : _a.webview.postMessage({ command: 'displayFiles', files });
                        }
                        catch (e) {
                            vscode.window.showErrorMessage('Failed to parse file list.');
                        }
                    });
                }
                // Handle firmware search based on user query (e.g. "esp32", "s3", etc.)
                else if (message.command === 'getFirmwareOptions') {
                    // Fetch the full list of firmware binaries from micropython.org
                    const firmwareList = yield this.fetchFirmwareList();
                    // Set up fuzzy search to match user input to firmware filenames
                    const fuse = new fuse_js_1.default(firmwareList, {
                        keys: ['name'],
                        threshold: 0.4 // Fuzziness sensitivity (lower = stricter match)
                    });
                    // Search using the board name entered in the frontend
                    const matches = fuse.search(message.board || '');
                    // Limit to top 5 matches to avoid flooding the UI
                    const filtered = matches.slice(0, 5).map(m => m.item);
                    // Send the filtered list back to the Webview to populate the dropdown
                    (_a = this._view) === null || _a === void 0 ? void 0 : _a.webview.postMessage({
                        command: 'setFirmwareOptions',
                        options: filtered
                    });
                }
                // Handle flashing firmware directly from a URL selected in the Webview
                else if (message.command === 'flashFromWeb') {
                    const { firmwareUrl, port } = message;
                    // Check that both URL and port were provided
                    if (!firmwareUrl || !port) {
                        vscode.window.showErrorMessage('Firmware URL and port are required for flashing.');
                        return;
                    }
                    // Download the firmware and flash it using esptool
                    yield this.handleFlashFromWeb(firmwareUrl, port);
                }
                // Handle opening a file that exists on the device and showing it in the VS Code editor
                else if (message.command === 'openFileFromDevice') {
                    const { port, filename } = message;
                    // Build a temporary local path to download the file into
                    const tempDir = path.join(os.tmpdir(), 'esp-temp');
                    const localPath = path.join(tempDir, filename);
                    try {
                        // Ensure the temp directory exists
                        yield fs.promises.mkdir(tempDir, { recursive: true });
                        // Build the mpremote command to copy the file from the device
                        const cmd = `mpremote connect ${port} fs cp :"${filename}" "${localPath}"`;
                        this.outputChannel.appendLine(`📥 Downloading ${filename} from device...`);
                        // Run the command to copy the file from the device
                        (0, child_process_1.exec)(cmd, (err, stdout, stderr) => __awaiter(this, void 0, void 0, function* () {
                            if (err) {
                                vscode.window.showErrorMessage(`Failed to download file: ${stderr || err.message}`);
                                return;
                            }
                            // Open the downloaded file in a new VS Code editor tab
                            const doc = yield vscode.workspace.openTextDocument(localPath);
                            yield vscode.window.showTextDocument(doc, { preview: false });
                            vscode.window.showInformationMessage(`Opened ${filename} from device.`);
                        }));
                    }
                    catch (err) {
                        // Handle errors from mkdir or anything before exec
                        const message = err instanceof Error ? err.message : String(err);
                        vscode.window.showErrorMessage(`Failed to prepare file for editing: ${message}`);
                    }
                }
                // Handle uploading the currently active Python file as-is (preserves original filename)
                else if (message.command === 'uploadPythonAsIs') {
                    const activeEditor = vscode.window.activeTextEditor;
                    // Ensure there's an active Python file
                    if (!activeEditor || activeEditor.document.languageId !== 'python') {
                        vscode.window.showErrorMessage('No active Python file to upload.');
                        return;
                    }
                    // Get full file path and extract just the filename
                    const filePath = activeEditor.document.fileName;
                    const fileName = filePath.split(/[/\\]/).pop(); // Cross-platform basename
                    // Build mpremote command to copy the file using its original name
                    const uploadCmd = `mpremote connect ${message.port} fs cp "${filePath}" :"${fileName}"`;
                    vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: `Uploading ${fileName} to device...`,
                        cancellable: false,
                    }, () => new Promise((resolve, reject) => {
                        (0, child_process_1.exec)(uploadCmd, (uploadError, uploadStdout, uploadStderr) => {
                            var _a;
                            if (uploadError) {
                                vscode.window.showErrorMessage(`Upload failed: ${uploadStderr || uploadError.message}`);
                                reject(uploadError);
                                return;
                            }
                            vscode.window.showInformationMessage(`${fileName} uploaded successfully!`);
                            resolve();
                            // Refresh file list in Webview
                            (_a = this._view) === null || _a === void 0 ? void 0 : _a.webview.postMessage({ command: 'triggerListFiles', port: message.port });
                        });
                    }));
                }
                // Handle running a selected Python file from the device
                else if (message.command === 'runPythonFile') {
                    const { filename } = message;
                    // Ensure a filename was provided
                    if (!filename) {
                        vscode.window.showErrorMessage('Filename is required to run the script.');
                        return;
                    }
                    // Strip the .py extension if present to get the module name
                    // const moduleName = filename.endsWith('.py') ? filename.slice(0, -3) : filename;
                    const moduleName = filename
                        .replace(/\.py$/, '') // remove .py
                        .replace(/-/g, '_'); // replace dashes with underscores
                    // Build the mpremote command to import the file on the device
                    const runCmd = `mpremote connect ${port} exec "import ${moduleName}"`;
                    vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: `Running ${filename}...`,
                        cancellable: false,
                    }, () => new Promise((resolve, reject) => {
                        // Execute the command to run the script
                        (0, child_process_1.exec)(runCmd, (runError, runStdout, runStderr) => {
                            // Output everything to the ESP Output channel
                            this.outputChannel.appendLine(`>>> Running ${filename} on ${port}\n`);
                            this.outputChannel.appendLine(runStdout);
                            if (runStderr)
                                this.outputChannel.appendLine(`\n[stderr]\n${runStderr}`);
                            this.outputChannel.show(true); // Bring the Output tab to front
                            if (runError) {
                                vscode.window.showErrorMessage(`Running script failed: ${runStderr || runError.message}`);
                                reject(runError);
                            }
                            else {
                                vscode.window.showInformationMessage(`${filename} ran successfully!`);
                                resolve();
                            }
                        });
                    }));
                }
                // Handle request to get a fresh list of available COM ports
                else if (message.command === 'getPorts') {
                    // Query available serial ports using serialport library
                    const ports = yield serialport_1.SerialPort.list();
                    // Send the port list to the Webview so the dropdown can update
                    (_b = this._view) === null || _b === void 0 ? void 0 : _b.webview.postMessage({
                        command: 'populatePorts',
                        ports: ports.map(p => p.path),
                    });
                }
                // Handle uploading a .py file from disk (not necessarily open in the editor)
                else if (message.command === 'uploadPythonFromPc') {
                    // Ask the user to select a Python file from their file system
                    const fileUri = yield vscode.window.showOpenDialog({
                        filters: { 'Python Files': ['py'] },
                        canSelectMany: false,
                    });
                    // If user canceled or selected nothing
                    if (!fileUri || fileUri.length === 0) {
                        vscode.window.showErrorMessage('No file selected.');
                        return;
                    }
                    // Extract path and filename
                    const filePath = fileUri[0].fsPath;
                    const fileName = path.basename(filePath);
                    // Build command to upload selected file using mpremote
                    const uploadCmd = `mpremote connect ${message.port} fs cp "${filePath}" :"${fileName}"`;
                    vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: `Uploading ${fileName} from PC...`,
                        cancellable: false,
                    }, () => new Promise((resolve, reject) => {
                        // Execute the upload
                        (0, child_process_1.exec)(uploadCmd, (err, stdout, stderr) => {
                            var _a;
                            if (err) {
                                vscode.window.showErrorMessage(`Upload failed: ${stderr || err.message}`);
                                reject(err);
                            }
                            else {
                                vscode.window.showInformationMessage(`${fileName} uploaded successfully!`);
                                resolve();
                                // Refresh file list after upload
                                (_a = this._view) === null || _a === void 0 ? void 0 : _a.webview.postMessage({ command: 'triggerListFiles', port: message.port });
                            }
                        });
                    }));
                }
                // Soldered Modules
                else if (message.command === 'fetchModule') {
                    const { sensor, port, mode } = message;
                    if (!sensor || !port) {
                        vscode.window.showErrorMessage('Module name and port are required.');
                        return;
                    }
                    const baseUrl = `https://api.github.com/repos/SolderedElectronics/Soldered-MicroPython-Modules/contents/Sensors/${sensor}/${sensor}`;
                    const targets = [];
                    if (mode === 'library' || mode === 'all')
                        targets.push(baseUrl);
                    if (mode === 'examples' || mode === 'all')
                        targets.push(`${baseUrl}/Examples`);
                    for (const url of targets) {
                        yield new Promise((resolve) => {
                            https.get(url, { headers: { 'User-Agent': 'vscode-extension' } }, res => {
                                let data = '';
                                res.on('data', chunk => data += chunk);
                                res.on('end', () => __awaiter(this, void 0, void 0, function* () {
                                    try {
                                        const files = JSON.parse(data);
                                        const pyFiles = files.filter((f) => f.name.endsWith('.py'));
                                        if (pyFiles.length === 0) {
                                            vscode.window.showWarningMessage(`No .py files found in ${url}`);
                                            return resolve();
                                        }
                                        for (const file of pyFiles) {
                                            const uploadName = file.name.replace(/-/g, '_'); // Normalize filename
                                            const tempPath = path.join(os.tmpdir(), uploadName);
                                            yield this.downloadFile(file.download_url, tempPath);
                                            const uploadCmd = `mpremote connect ${port} fs cp "${tempPath}" :"${uploadName}"`;
                                            this.outputChannel.appendLine(`⬆ Uploading ${uploadName}`);
                                            yield execCommand(uploadCmd);
                                        }
                                        resolve();
                                    }
                                    catch (err) {
                                        vscode.window.showErrorMessage(`Failed to process ${url}`);
                                        this.outputChannel.appendLine(`❌ Error: ${err}`);
                                        resolve();
                                    }
                                }));
                            }).on('error', err => {
                                vscode.window.showErrorMessage(`Failed to fetch ${url}: ${err.message}`);
                                resolve();
                            });
                        });
                    }
                    vscode.window.showInformationMessage(`✅ Downloaded ${mode} files for "${sensor}"`);
                    (_c = this._view) === null || _c === void 0 ? void 0 : _c.webview.postMessage({ command: 'triggerListFiles', port });
                }
                else if (message.command === 'searchModules') {
                    const keyword = message.keyword || '';
                    const apiUrl = `https://api.github.com/repos/SolderedElectronics/Soldered-MicroPython-Modules/contents/Sensors`;
                    https.get(apiUrl, { headers: { 'User-Agent': 'vscode-extension' } }, res => {
                        let data = '';
                        res.on('data', chunk => data += chunk);
                        res.on('end', () => {
                            var _a;
                            try {
                                const folders = JSON.parse(data).filter((f) => f.type === 'dir').map((f) => f.name);
                                const fuse = new fuse_js_1.default(folders, {
                                    threshold: 0.4,
                                    ignoreLocation: true,
                                    isCaseSensitive: false,
                                });
                                const matches = fuse.search(keyword).slice(0, 15).map(m => m.item);
                                (_a = this._view) === null || _a === void 0 ? void 0 : _a.webview.postMessage({
                                    command: 'setModuleMatches',
                                    matches
                                });
                            }
                            catch (err) {
                                vscode.window.showErrorMessage('Failed to parse module list from GitHub.');
                            }
                        });
                    }).on('error', err => {
                        vscode.window.showErrorMessage(`GitHub API error: ${err.message}`);
                    });
                }
                // Handle deleting a file from the device using os.remove()
                else if (message.command === 'deleteFile') {
                    // Build the Python command to delete the file on the device
                    const delCmd = `mpremote connect ${port} exec "import os; os.remove('${message.filename}')"`;
                    // Execute the delete command
                    (0, child_process_1.exec)(delCmd, (err, stdout, stderr) => {
                        var _a;
                        if (err) {
                            // If something went wrong, show an error message
                            vscode.window.showErrorMessage(`Failed to delete file: ${stderr || err.message}`);
                        }
                        else {
                            // Confirm success to the user
                            vscode.window.showInformationMessage(`Deleted ${message.filename} successfully.`);
                            // Refresh the file list on the frontend
                            (_a = this._view) === null || _a === void 0 ? void 0 : _a.webview.postMessage({ command: 'triggerListFiles', port });
                        }
                    });
                }
            }));
        });
    }
    // Loads the HTML content for the Webview panel from an external file
    getHtml() {
        // Construct an absolute path to the HTML file in the extension directory
        const htmlPath = path.join(this.context.extensionPath, 'src', 'panel', 'index.html');
        // Read the contents of the HTML file as a UTF-8 string
        let html = fs.readFileSync(htmlPath, 'utf8');
        // Return the raw HTML string to be used in the Webview
        return html;
    }
}
